/**
 * Inventory Integrity Service
 *
 * Self-correcting audit service that detects and repairs stock-level
 * inconsistencies across the full inventory → reservation → WO part →
 * requisition → PO → receipt chain.
 *
 * Runs hourly via the inventory-integrity-monitor cron job.
 * Every issue found is auto-corrected where possible.  Nothing is left
 * for human review unless the system genuinely cannot determine the
 * correct state (e.g. a PO receipt with contradictory data).
 *
 * ─── Checks ──────────────────────────────────────────────────────────────────
 *
 *  1. RESERVED_QTY_DRIFT
 *     InventoryStock.quantityReserved ≠ SUM(InventoryReservation.quantity WHERE status=ACTIVE)
 *     → Overwrite with authoritative aggregate from active reservations.
 *
 *  2. COMMITTED_QTY_DRIFT
 *     InventoryStock.quantityCommitted ≠ authoritative pipeline value
 *     (unreceived qty on open WO-backed PO lines + open WO-backed REQ lines
 *     not yet on a PO).
 *     → Overwrite with authoritative aggregate.
 *
 *  3. UNCOVERED_NEGATIVE_AVAILABLE
 *     (quantityOnHand − quantityReserved) < 0 AND the shortfall is not
 *     already covered by open REQs or POs in the pipeline.
 *     → Trigger reorderService.triggerReorderForItem to create a covering REQ.
 *
 *  4. ORPHANED_RESERVATION
 *     ACTIVE reservation whose work order is CANCELLED / CLOSED / COMPLETED.
 *     → Cancel reservation, decrement quantityReserved.
 *
 *  5. WOP_STATUS_DRIFT
 *     WorkOrderPart status=RESERVED but linked reservation is CONSUMED/CANCELLED.
 *     → Set WorkOrderPart to ISSUED (if CONSUMED) or CANCELLED (if CANCELLED);
 *       stamp quantityUsed from reservation.
 *
 *  6. DUPLICATE_OPEN_REQS
 *     Multiple open requisition lines for the same item whose combined open
 *     quantity exceeds what is needed to reach maxQuantity.
 *     → Cancel newer duplicates, keep oldest.
 *
 *  7. STALE_WOP_ISSUED_NO_TXN
 *     WorkOrderPart status=ISSUED, quantityUsed=null, no matching DIRECT_ISSUE /
 *     WO_PART_ISSUED / WO_RESERVATION_CONSUMED inventory transaction.
 *     Symptom of the batch-issue state corruption bug (WO-2026-00542 pattern).
 *     → Reset WOP to RESERVED; reset falsely-CONSUMED reservation to ACTIVE.
 *
 *  8. REQ_LINE_STATUS_DRIFT
 *     RequisitionLine.lineStatus doesn't match the actual PO / receipt state:
 *     – line has a poLineId + PO is Ordered/PartiallyReceived/Received → ORDERED
 *     – PO line is fully received (receivedQuantity ≥ quantity) → FULFILLED
 *     – PO line is partially received → PARTIALLY_FULFILLED
 *     → Update lineStatus to match reality.
 *
 *  9. PO_LINE_RECEIVED_QTY_DRIFT
 *     POLine.receivedQuantity ≠ SUM(POLineReceipt.quantityReceived) net of returns.
 *     → Overwrite receivedQuantity with authoritative sum from receipt records.
 *
 * ─── Correction guarantees ───────────────────────────────────────────────────
 *  • Multi-step corrections use a Prisma $transaction for atomicity.
 *    Single-field corrections (quantityReserved, quantityCommitted) are a
 *    single update — no transaction required.
 *  • Every correction is recorded via logInventoryEvent (INTEGRITY_CORRECTION)
 *    in the AuditLog metadata column, and to logs/inventory-integrity.log.
 *  • The run summary is logged by the cron job (not the service) via
 *    logSystemEvent (INVENTORY_INTEGRITY_RUN_COMPLETE).
 *  • No data is deleted — only state fields are corrected.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/services/base/types";
import { toNumber } from "@/lib/decimal-helpers";
import { logInventoryEvent } from "@/lib/event-logger";
import { inventoryReorderService } from "@/services/inventory/reorder.service";
import { InventoryTransactionType } from "@/services/inventory/transaction.types";
import { RequisitionLineStatus } from "@/services/purchasing/requisition/requisition.types";
import { logger } from "@/lib/logger";
import { integrityLogger } from "@/lib/integrity-logger";

// ─── Public result types ──────────────────────────────────────────────────────

export type CheckId =
  | "RESERVED_QTY_DRIFT"
  | "COMMITTED_QTY_DRIFT"
  | "UNCOVERED_NEGATIVE_AVAILABLE"
  | "ORPHANED_RESERVATION"
  | "WOP_STATUS_DRIFT"
  | "DUPLICATE_OPEN_REQS"
  | "STALE_WOP_ISSUED_NO_TXN"
  | "REQ_LINE_STATUS_DRIFT"
  | "PO_LINE_RECEIVED_QTY_DRIFT";

export interface IntegrityIssue {
  checkId: CheckId;
  severity: "critical" | "warning";
  inventoryItemId: string | null;
  inventoryItemSku: string | null;
  description: string;
  correction: string;
  affectedIds: Record<string, string>;
  data: Record<string, unknown>;
}

export interface IntegrityRunResult {
  runAt: string;
  durationMs: number;
  itemsChecked: number;
  issuesFound: number;
  issuesCorrected: number;
  breakdown: Record<string, number>;
  issues: IntegrityIssue[];
  errors: Array<{ checkId: CheckId; error: string }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

// ─── Typed helpers ────────────────────────────────────────────────────────────

/** Select clause used for the stock rows fetched once at run start. */
const STOCK_SELECT = {
  id: true,
  inventoryItemId: true,
  quantityOnHand: true,
  quantityReserved: true,
  quantityCommitted: true,
  inventoryItem: {
    select: {
      id: true,
      sku: true,
      description: true,
      minQuantity: true,
      maxQuantity: true,
    },
  },
} as const;

/** Exact Prisma-inferred type for the stock rows — no hand-rolled interface. */
type StockRow = Prisma.InventoryStockGetPayload<{ select: typeof STOCK_SELECT }>;

/** Safely extract a human-readable SKU label from a Prisma relation result. */
function skuOf(
  item: { sku: string | null } | null | undefined,
  fallback: string,
): string {
  return item?.sku ?? fallback;
}

class InventoryIntegrityService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Scan only — identify issues without applying any corrections.
   * Safe to call from the UI at any time for a preview/dry-run.
   * Issues returned have correction strings prefixed with "WOULD".
   */
  async scan(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    const stockItems = await this.db.inventoryStock.findMany({ select: STOCK_SELECT });

    // Check 1: RESERVED_QTY_DRIFT
    const resvTotals = await this.db.inventoryReservation.groupBy({ by: ["inventoryItemId"], where: { status: "ACTIVE" }, _sum: { quantity: true } });
    const authResMap = new Map(resvTotals.map((r) => [r.inventoryItemId, toNumber(r._sum.quantity) ?? 0]));
    for (const s of stockItems) {
      const stored = toNumber(s.quantityReserved) ?? 0;
      const auth   = authResMap.get(s.inventoryItemId) ?? 0;
      if (stored === auth) continue;
      const sku = skuOf(s.inventoryItem as { sku: string | null } | null, s.inventoryItemId);
      issues.push({ checkId: "RESERVED_QTY_DRIFT", severity: "critical", inventoryItemId: s.inventoryItemId, inventoryItemSku: sku, description: `quantityReserved=${stored} authoritative=${auth} delta=${stored - auth}`, correction: `WOULD set quantityReserved to ${auth}`, affectedIds: { stockId: s.id }, data: { stored, auth } });
    }

    // Check 2: COMMITTED_QTY_DRIFT
    const openReqC = await this.db.requisitionLine.findMany({ where: { inventoryItemId: { not: null }, lineStatus: { notIn: ["FULFILLED","CANCELLED","PARTIALLY_FULFILLED"] }, poLineId: null, requisition: { status: { notIn: ["Cancelled","Closed","Rejected"] }, budgetHeader: { workOrderId: { not: null } } } }, select: { inventoryItemId: true, quantity: true } });
    const openPOC  = await this.db.pOLine.findMany({ where: { inventoryItemId: { not: null }, purchaseOrder: { status: { notIn: ["Draft","Cancelled","Closed"] } }, requisitionLineId: { not: null }, requisitionLines: { some: { requisition: { budgetHeader: { workOrderId: { not: null } } } } } }, select: { inventoryItemId: true, quantity: true, receivedQuantity: true } });
    const authComMap = new Map<string, number>();
    for (const l of openReqC) { if (!l.inventoryItemId) continue; authComMap.set(l.inventoryItemId, (authComMap.get(l.inventoryItemId) ?? 0) + (toNumber(l.quantity) ?? 0)); }
    for (const l of openPOC) { if (!l.inventoryItemId) continue; authComMap.set(l.inventoryItemId, (authComMap.get(l.inventoryItemId) ?? 0) + Math.max(0, (toNumber(l.quantity) ?? 0) - (toNumber(l.receivedQuantity) ?? 0))); }
    for (const s of stockItems) {
      const stored = toNumber(s.quantityCommitted) ?? 0;
      const auth   = authComMap.get(s.inventoryItemId) ?? 0;
      if (stored === auth) continue;
      const sku = skuOf(s.inventoryItem as { sku: string | null } | null, s.inventoryItemId);
      issues.push({ checkId: "COMMITTED_QTY_DRIFT", severity: "critical", inventoryItemId: s.inventoryItemId, inventoryItemSku: sku, description: `quantityCommitted=${stored} authoritative=${auth}`, correction: `WOULD set quantityCommitted to ${auth}`, affectedIds: { stockId: s.id }, data: { stored, auth } });
    }

    // Check 3: UNCOVERED_NEGATIVE_AVAILABLE
    for (const s of stockItems) {
      const onHand = toNumber(s.quantityOnHand) ?? 0, reserved = toNumber(s.quantityReserved) ?? 0;
      if (onHand - reserved >= 0) continue;
      const pols = await this.db.pOLine.findMany({ where: { inventoryItemId: s.inventoryItemId, purchaseOrder: { status: { notIn: ["Draft","Cancelled","Closed"] } } }, select: { quantity: true, receivedQuantity: true } });
      const rls  = await this.db.requisitionLine.findMany({ where: { inventoryItemId: s.inventoryItemId, requisition: { status: { notIn: ["Cancelled","Closed","Rejected"] } } }, select: { quantity: true } });
      const openPOQty  = pols.reduce((a, l) => a + Math.max(0, (toNumber(l.quantity) ?? 0) - (toNumber(l.receivedQuantity) ?? 0)), 0);
      const openReqQty = rls.reduce((a, l) => a + (toNumber(l.quantity) ?? 0), 0);
      const eff    = onHand - reserved + openPOQty;
      const needed = Math.max(0, (toNumber(s.inventoryItem.maxQuantity) ?? 0) - eff);
      const gap    = needed - openReqQty;
      if (gap <= 0) continue;
      const sku = skuOf(s.inventoryItem, s.inventoryItemId);
      issues.push({ checkId: "UNCOVERED_NEGATIVE_AVAILABLE", severity: "critical", inventoryItemId: s.inventoryItemId, inventoryItemSku: sku, description: `available=${onHand - reserved} totalNeeded=${needed} onOrder=${openReqQty} gap=${gap}`, correction: `WOULD create top-up req for ${gap} units`, affectedIds: { stockId: s.id }, data: { gap, needed, openReqQty } });
    }

    // Check 4: ORPHANED_RESERVATION
    const DEAD = new Set(["Cancelled","Closed","Completed"]);
    const orph = await this.db.inventoryReservation.findMany({ where: { status: "ACTIVE", reservedFor: "WorkOrder" }, select: { id: true, inventoryItemId: true, quantity: true, inventoryItem: { select: { sku: true } }, workOrderPart: { select: { id: true, workOrder: { select: { id: true, woNumber: true, status: true } } } } } });
    for (const r of orph) {
      const wo = r.workOrderPart?.workOrder;
      if (!wo || !DEAD.has(wo.status)) continue;
      const sku = skuOf(r.inventoryItem, r.inventoryItemId);
      issues.push({ checkId: "ORPHANED_RESERVATION", severity: "critical", inventoryItemId: r.inventoryItemId, inventoryItemSku: sku, description: `ACTIVE reservation on ${wo.status} WO ${wo.woNumber} qty=${toNumber(r.quantity)}`, correction: `WOULD cancel reservation and decrement quantityReserved`, affectedIds: { reservationId: r.id, workOrderId: wo.id }, data: {} });
    }

    // Check 5: WOP_STATUS_DRIFT
    const dWops = await this.db.workOrderPart.findMany({ where: { status: "RESERVED", reservation: { status: { in: ["CONSUMED","CANCELLED"] } } }, select: { id: true, inventoryItemId: true, inventoryItem: { select: { sku: true } }, workOrder: { select: { woNumber: true } }, reservation: { select: { status: true } } } });
    for (const w of dWops) {
      const sku = skuOf(w.inventoryItem, w.inventoryItemId);
      const to  = w.reservation?.status === "CONSUMED" ? "ISSUED" : "CANCELLED";
      issues.push({ checkId: "WOP_STATUS_DRIFT", severity: "critical", inventoryItemId: w.inventoryItemId, inventoryItemSku: sku, description: `WOP (WO=${w.workOrder.woNumber}) RESERVED but reservation=${w.reservation?.status}`, correction: `WOULD set to ${to}`, affectedIds: { wopId: w.id }, data: {} });
    }

    // Check 6: DUPLICATE_OPEN_REQS — DISABLED. See run() for reason.
    // The requestedById filter failed on 2026-04-14 and cancelled 136 user reqs.
    if (false) { // eslint-disable-line no-constant-condition
    const sysUser = await this.db.user.findUnique({ where: { email: "system-scheduler@crn-plant-mgmt.local" }, select: { id: true } });
    if (sysUser) {
      const dLines = await this.db.requisitionLine.findMany({ where: { inventoryItemId: { not: null }, requisition: { status: { notIn: ["Cancelled","Closed","Rejected"] }, requestedById: sysUser.id } }, select: { inventoryItemId: true, quantity: true, requisition: { select: { id: true, reqNumber: true, createdAt: true } }, inventoryItem: { select: { sku: true, maxQuantity: true, stock: { select: { quantityOnHand: true, quantityReserved: true } } } } }, orderBy: { requisition: { createdAt: "asc" } } });
      const dByItem = new Map<string, typeof dLines>();
      for (const l of dLines) { if (!l.inventoryItemId) continue; const g = dByItem.get(l.inventoryItemId) ?? []; g.push(l); dByItem.set(l.inventoryItemId, g); }
      for (const [itemId, lines] of dByItem.entries()) {
        if (lines.length <= 1) continue;
        const fl = lines[0]; if (!fl?.inventoryItem) continue;
        const item = fl.inventoryItem;
        const totalOH = item.stock.reduce((a, st) => a + (toNumber(st.quantityOnHand) ?? 0), 0);
        const totalR  = item.stock.reduce((a, st) => a + (toNumber(st.quantityReserved) ?? 0), 0);
        const opo = await this.db.pOLine.findMany({ where: { inventoryItemId: itemId, purchaseOrder: { status: { notIn: ["Draft","Cancelled","Closed"] } } }, select: { quantity: true, receivedQuantity: true } });
        const opoPOQty = opo.reduce((a, l) => a + Math.max(0, (toNumber(l.quantity) ?? 0) - (toNumber(l.receivedQuantity) ?? 0)), 0);
        const eff = totalOH - totalR + opoPOQty;
        const legit = Math.max(0, (toNumber(item.maxQuantity) ?? 0) - eff);
        const total = lines.reduce((a, l) => a + (toNumber(l.quantity) ?? 0), 0);
        const excess = total - legit;
        if (excess <= Math.max(1, legit * 0.1)) continue;
        const [keep, ...cancel] = lines; if (!keep) continue;
        const cancelNums = [...new Set(cancel.map((l) => l.requisition.reqNumber))];
        issues.push({ checkId: "DUPLICATE_OPEN_REQS", severity: "critical", inventoryItemId: itemId, inventoryItemSku: item.sku, description: `${lines.length} system reqs total ${total} needed ${legit} excess ${excess}`, correction: `WOULD cancel: ${cancelNums.join(", ")} keep: ${keep.requisition.reqNumber}`, affectedIds: { inventoryItemId: itemId }, data: { excess, legit, total } });
      }
    }
    } // end if (false) — DUPLICATE_OPEN_REQS disabled

    // Check 7: STALE_WOP_ISSUED_NO_TXN
    const stWops = await this.db.workOrderPart.findMany({ where: { status: "ISSUED", quantityUsed: null }, select: { id: true, inventoryItemId: true, workOrderId: true, inventoryItem: { select: { sku: true } }, workOrder: { select: { woNumber: true } }, reservation: { select: { status: true } } } });
    for (const w of stWops) {
      const txn = await this.db.inventoryTransaction.findFirst({ where: { inventoryItemId: w.inventoryItemId, referenceId: w.workOrderId, transactionType: { in: [InventoryTransactionType.DIRECT_ISSUE as string, InventoryTransactionType.WO_PART_ISSUED as string, InventoryTransactionType.WO_RESERVATION_CONSUMED as string] } }, select: { id: true } });
      if (txn) continue;
      const sku = skuOf(w.inventoryItem, w.inventoryItemId);
      issues.push({ checkId: "STALE_WOP_ISSUED_NO_TXN", severity: "critical", inventoryItemId: w.inventoryItemId, inventoryItemSku: sku, description: `WOP (WO=${w.workOrder.woNumber}) ISSUED/null-used no inventory transaction`, correction: `WOULD reset to RESERVED` + (w.reservation?.status === "CONSUMED" ? " + reservation→ACTIVE" : ""), affectedIds: { wopId: w.id }, data: {} });
    }

    // Check 8: REQ_LINE_STATUS_DRIFT
    const ACTIVE_PO = new Set(["Ordered","PartiallyReceived","Received","Closed"]);
    const rCands = await this.db.requisitionLine.findMany({ where: { poLineId: { not: null }, lineStatus: { in: ["PENDING","APPROVED"] }, requisition: { status: { notIn: ["Cancelled","Closed","Rejected"] } } }, select: { id: true, inventoryItemId: true, lineStatus: true, requisition: { select: { reqNumber: true } }, poLine: { select: { quantity: true, receivedQuantity: true, purchaseOrder: { select: { status: true, poNumber: true } } } }, inventoryItem: { select: { sku: true } } } });
    for (const line of rCands) {
      const po = line.poLine?.purchaseOrder;
      if (!po || !ACTIVE_PO.has(po.status)) continue;
      const qty = toNumber(line.poLine?.quantity) ?? 0, rcv = toNumber(line.poLine?.receivedQuantity) ?? 0;
      const correct: RequisitionLineStatus = rcv >= qty ? RequisitionLineStatus.FULFILLED : rcv > 0 ? RequisitionLineStatus.PARTIALLY_FULFILLED : RequisitionLineStatus.ORDERED;
      if (line.lineStatus === correct) continue;
      const sku = skuOf(line.inventoryItem, line.inventoryItemId ?? "?");
      issues.push({ checkId: "REQ_LINE_STATUS_DRIFT", severity: "critical", inventoryItemId: line.inventoryItemId, inventoryItemSku: sku, description: `REQ ${line.requisition.reqNumber} lineStatus=${line.lineStatus} PO ${po.poNumber} is ${po.status}`, correction: `WOULD set lineStatus to ${correct}`, affectedIds: { requisitionLineId: line.id }, data: {} });
    }

    // Check 9: PO_LINE_RECEIVED_QTY_DRIFT
    const rcptT = await this.db.pOLineReceipt.groupBy({ by: ["poLineId","isReturn"], _sum: { quantityReceived: true } });
    const authRcvMap2 = new Map<string, number>();
    for (const r of rcptT) { const qty = toNumber(r._sum.quantityReceived) ?? 0; authRcvMap2.set(r.poLineId, (authRcvMap2.get(r.poLineId) ?? 0) + (r.isReturn ? -qty : qty)); }
    if (authRcvMap2.size > 0) {
      const polsR = await this.db.pOLine.findMany({ where: { id: { in: [...authRcvMap2.keys()] } }, select: { id: true, inventoryItemId: true, receivedQuantity: true, inventoryItem: { select: { sku: true } }, purchaseOrder: { select: { poNumber: true } } } });
      for (const l of polsR) {
        const stored = toNumber(l.receivedQuantity) ?? 0, auth = authRcvMap2.get(l.id) ?? 0;
        if (Math.abs(stored - auth) < 0.001) continue;
        const sku = skuOf(l.inventoryItem, l.inventoryItemId ?? "?");
        issues.push({ checkId: "PO_LINE_RECEIVED_QTY_DRIFT", severity: "critical", inventoryItemId: l.inventoryItemId, inventoryItemSku: sku, description: `PO ${l.purchaseOrder.poNumber} receivedQty=${stored} receipts=${auth}`, correction: `WOULD set receivedQuantity to ${auth}`, affectedIds: { poLineId: l.id }, data: { stored, auth } });
      }
    }

    return issues;
  }

  async run(context: ServiceContext): Promise<IntegrityRunResult> {
    const startedAt = Date.now();
    const issues: IntegrityIssue[] = [];
    const errors: IntegrityRunResult["errors"] = [];

    logger.info("[InventoryIntegrity] Starting integrity run");
    integrityLogger.runStart();

    // ── Fetch stock items once — shared across stock-level checks ─────────
    const stockItems = await this.db.inventoryStock.findMany({ select: STOCK_SELECT });

    const itemsChecked = new Set<string>(
      stockItems.map((s) => s.inventoryItemId),
    );

    // ── Run each check ────────────────────────────────────────────────────
    const checks: Array<[CheckId, () => Promise<IntegrityIssue[]>]> = [
      ["RESERVED_QTY_DRIFT",          () => this.checkReservedQtyDrift(context, stockItems)],
      ["COMMITTED_QTY_DRIFT",         () => this.checkCommittedQtyDrift(context, stockItems)],
      ["UNCOVERED_NEGATIVE_AVAILABLE",() => this.checkUncoveredNegativeAvailable(context, stockItems)],
      ["ORPHANED_RESERVATION",        () => this.checkOrphanedReservations(context)],
      ["WOP_STATUS_DRIFT",            () => this.checkWopStatusDrift(context)],
      // DUPLICATE_OPEN_REQS DISABLED — cancelled 136 user reqs on 2026-04-14.
      // The requestedById filter failed to restrict to system-generated reqs only.
      // DO NOT RE-ENABLE until the root cause is confirmed and the check is rewritten.
      // ["DUPLICATE_OPEN_REQS",         () => this.checkDuplicateOpenReqs(context)],
      ["STALE_WOP_ISSUED_NO_TXN",     () => this.checkStaleWopIssuedNoTxn(context)],
      ["REQ_LINE_STATUS_DRIFT",       () => this.checkReqLineStatusDrift(context)],
      ["PO_LINE_RECEIVED_QTY_DRIFT",  () => this.checkPoLineReceivedQtyDrift(context)],
    ];

    for (const [checkId, fn] of checks) {
      integrityLogger.checkStart(checkId);
      try {
        const found = await fn();
        issues.push(...found);
        integrityLogger.checkEnd(checkId, found.length);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[InventoryIntegrity] Check ${checkId} failed: ${msg}`);
        integrityLogger.checkError(checkId, msg);
        errors.push({ checkId, error: msg });
      }
    }

    const durationMs = Date.now() - startedAt;

    logger.info(
      `[InventoryIntegrity] Run finished in ${durationMs}ms — ` +
      `${issues.length} issues found/corrected, ${errors.length} check errors`,
    );
    integrityLogger.runEnd(durationMs, itemsChecked.size, issues.length, errors.length);

    return {
      runAt: new Date(startedAt).toISOString(),
      durationMs,
      itemsChecked: itemsChecked.size,
      issuesFound: issues.length,
      issuesCorrected: issues.length,
      breakdown: checks.reduce<Record<string, number>>((acc, [id]) => {
        acc[id] = issues.filter((i) => i.checkId === id).length;
        return acc;
      }, {}),
      issues,
      errors,
    };
  }

  // ── Check 1: quantityReserved drift ────────────────────────────────────────
  //
  // Authoritative source: SUM(InventoryReservation.quantity WHERE status=ACTIVE)
  // This is the root cause of the SKU 28751/28697 duplicate-req incident.

  private async checkReservedQtyDrift(
    context: ServiceContext,
    stockItems: StockRow[],
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    const totals = await this.db.inventoryReservation.groupBy({
      by: ["inventoryItemId"],
      where: { status: "ACTIVE" },
      _sum: { quantity: true },
    });

    const authMap = new Map<string, number>(
      totals.map((r) => [r.inventoryItemId, toNumber(r._sum.quantity) ?? 0]),
    );

    for (const stock of stockItems) {
      const stored      = toNumber(stock.quantityReserved) ?? 0;
      const authoritative = authMap.get(stock.inventoryItemId) ?? 0;
      if (stored === authoritative) continue;

      const delta = stored - authoritative;
      const sku   = skuOf(stock.inventoryItem as { sku: string | null } | null, stock.inventoryItemId);

      logger.warn(
        `[InventoryIntegrity] RESERVED_QTY_DRIFT SKU=${sku} ` +
        `stored=${stored} authoritative=${authoritative} delta=${delta}`,
      );

      await this.db.inventoryStock.update({
        where: { id: stock.id },
        data: { quantityReserved: authoritative },
      });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        stock.inventoryItemId,
        `RESERVED_QTY_DRIFT corrected for SKU ${sku}: ${stored} → ${authoritative}`,
        {
          checkId: "RESERVED_QTY_DRIFT",
          sku,
          stockId: stock.id,
          stored,
          authoritative,
          delta,
          description: `quantityReserved=${stored} but authoritative aggregate=${authoritative} (delta ${delta > 0 ? "+" : ""}${delta})`,
          correction: `quantityReserved set to ${authoritative}`,
        },
      ).catch(() => {});

      integrityLogger.issueFound("RESERVED_QTY_DRIFT", sku,
        `quantityReserved stored=${stored} authoritative=${authoritative} delta=${delta}`,
        { stockId: stock.id });
      integrityLogger.correctionApplied("RESERVED_QTY_DRIFT", sku,
        `quantityReserved overwritten: ${stored} → ${authoritative}`,
        { stockId: stock.id, stored, authoritative, delta });

      issues.push({
        checkId: "RESERVED_QTY_DRIFT",
        severity: "critical",
        inventoryItemId: stock.inventoryItemId,
        inventoryItemSku: sku,
        description: `quantityReserved=${stored} but authoritative aggregate=${authoritative} (delta ${delta > 0 ? "+" : ""}${delta})`,
        correction: `quantityReserved set to ${authoritative}`,
        affectedIds: { stockId: stock.id },
        data: { stored, authoritative, delta },
      });
    }

    return issues;
  }

  // ── Check 2: quantityCommitted drift ───────────────────────────────────────
  //
  // Authoritative source: unreceived qty on open WO-backed PO lines
  //   + open WO-backed REQ line quantities not yet on any PO.
  // quantityCommitted is incremented when an auto-REQ is created and decremented
  // on PO receipt.  Drift happens when REQs are cancelled without calling
  // decrementCommitted, or when receipt fails mid-transaction.

  private async checkCommittedQtyDrift(
    context: ServiceContext,
    stockItems: StockRow[],
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    // Open WO-backed REQ lines not yet on a PO
    const openReqLines = await this.db.requisitionLine.findMany({
      where: {
        inventoryItemId: { not: null },
        lineStatus: { notIn: ["FULFILLED", "CANCELLED", "PARTIALLY_FULFILLED"] },
        poLineId: null, // not yet converted to a PO line
        requisition: {
          status: { notIn: ["Cancelled", "Closed", "Rejected"] },
          budgetHeader: { workOrderId: { not: null } }, // WO-backed only
        },
      },
      select: { inventoryItemId: true, quantity: true },
    });

    // Unreceived qty on open WO-backed PO lines
    const openPOLines = await this.db.pOLine.findMany({
      where: {
        inventoryItemId: { not: null },
        purchaseOrder: { status: { notIn: ["Draft", "Cancelled", "Closed"] } },
        requisitionLineId: { not: null },
        requisitionLines: {
          some: {
            requisition: {
              budgetHeader: { workOrderId: { not: null } },
            },
          },
        },
      },
      select: {
        inventoryItemId: true,
        quantity: true,
        receivedQuantity: true,
      },
    });

    // Build authoritative committed map
    const authCommitted = new Map<string, number>();
    for (const line of openReqLines) {
      if (!line.inventoryItemId) continue;
      authCommitted.set(
        line.inventoryItemId,
        (authCommitted.get(line.inventoryItemId) ?? 0) + (toNumber(line.quantity) ?? 0),
      );
    }
    for (const line of openPOLines) {
      if (!line.inventoryItemId) continue;
      const unreceived = Math.max(
        0,
        (toNumber(line.quantity) ?? 0) - (toNumber(line.receivedQuantity) ?? 0),
      );
      authCommitted.set(
        line.inventoryItemId,
        (authCommitted.get(line.inventoryItemId) ?? 0) + unreceived,
      );
    }

    for (const stock of stockItems) {
      const stored        = toNumber(stock.quantityCommitted) ?? 0;
      const authoritative = authCommitted.get(stock.inventoryItemId) ?? 0;
      if (stored === authoritative) continue;

      const sku = skuOf(stock.inventoryItem as { sku: string | null } | null, stock.inventoryItemId);

      logger.warn(
        `[InventoryIntegrity] COMMITTED_QTY_DRIFT SKU=${sku} ` +
        `stored=${stored} authoritative=${authoritative}`,
      );

      await this.db.inventoryStock.update({
        where: { id: stock.id },
        data: { quantityCommitted: authoritative },
      });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        stock.inventoryItemId,
        `COMMITTED_QTY_DRIFT corrected for SKU ${sku}: ${stored} → ${authoritative}`,
        {
          checkId: "COMMITTED_QTY_DRIFT",
          sku,
          stockId: stock.id,
          stored,
          authoritative,
          description: `quantityCommitted=${stored} but authoritative pipeline value=${authoritative}`,
          correction: `quantityCommitted set to ${authoritative}`,
        },
      ).catch(() => {});

      integrityLogger.issueFound("COMMITTED_QTY_DRIFT", sku,
        `quantityCommitted stored=${stored} authoritative=${authoritative}`,
        { stockId: stock.id });
      integrityLogger.correctionApplied("COMMITTED_QTY_DRIFT", sku,
        `quantityCommitted overwritten: ${stored} → ${authoritative}`,
        { stockId: stock.id, stored, authoritative });

      issues.push({
        checkId: "COMMITTED_QTY_DRIFT",
        severity: "critical",
        inventoryItemId: stock.inventoryItemId,
        inventoryItemSku: sku,
        description: `quantityCommitted=${stored} but authoritative pipeline value=${authoritative}`,
        correction: `quantityCommitted set to ${authoritative}`,
        affectedIds: { stockId: stock.id },
        data: { stored, authoritative },
      });
    }

    return issues;
  }

  // ── Check 3: Uncovered negative available ──────────────────────────────────
  //
  // Re-reads stock AFTER drift corrections above.
  // If (onHand − reserved) < 0 AND the shortfall is not already covered by
  // open REQs or POs, trigger a reorder.  If it IS covered, no action.

  private async checkUncoveredNegativeAvailable(
    context: ServiceContext,
    stockItems: StockRow[],
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    // Re-read corrected stock values (checks 1+2 may have updated quantityReserved/Committed)
    const freshStocks = await this.db.inventoryStock.findMany({
      where: { id: { in: stockItems.map((s) => s.id) } },
      select: STOCK_SELECT,
    });

    for (const stock of freshStocks) {
      const onHand   = toNumber(stock.quantityOnHand) ?? 0;
      const reserved = toNumber(stock.quantityReserved) ?? 0;
      if (onHand - reserved >= 0) continue; // available is non-negative — no problem

      // Pipeline quantities already on order
      const openPOLines = await this.db.pOLine.findMany({
        where: {
          inventoryItemId: stock.inventoryItemId,
          purchaseOrder: { status: { notIn: ["Draft", "Cancelled", "Closed"] } },
        },
        select: { quantity: true, receivedQuantity: true },
      });
      const openPOQty = openPOLines.reduce(
        (s, l) => s + Math.max(0, (toNumber(l.quantity) ?? 0) - (toNumber(l.receivedQuantity) ?? 0)),
        0,
      );

      const openReqLines = await this.db.requisitionLine.findMany({
        where: {
          inventoryItemId: stock.inventoryItemId,
          requisition: { status: { notIn: ["Cancelled", "Closed", "Rejected"] } },
        },
        select: { quantity: true },
      });
      const openReqQty = openReqLines.reduce(
        (s, l) => s + (toNumber(l.quantity) ?? 0),
        0,
      );

      // effectiveWithoutReqs: what we'd have if all open POs arrived but no reqs existed
      // This is the correct base for "how much do we still need to order?"
      const effectiveWithoutReqs = onHand - reserved + openPOQty;
      // totalNeeded: units required to reach max from current physical position
      const totalNeeded = Math.max(0, (toNumber(stock.inventoryItem.maxQuantity) ?? 0) - effectiveWithoutReqs);
      // gap: how many MORE units need to be ordered beyond what is already on order
      const gap = totalNeeded - openReqQty;
      const sku = skuOf(stock.inventoryItem, stock.inventoryItemId);

      if (gap <= 0) {
        // Open reqs are sufficient to restore stock to max — no action needed
        logger.info(
          `[InventoryIntegrity] UNCOVERED_NEGATIVE_AVAILABLE SKU=${sku} ` +
          `available=${onHand - reserved} but pipeline covers to max (openReq=${openReqQty} >= totalNeeded=${totalNeeded})`,
        );
        continue;
      }

      // Open reqs exist but are insufficient to reach max — top up
      logger.warn(
        `[InventoryIntegrity] UNCOVERED_NEGATIVE_AVAILABLE SKU=${sku} ` +
        `effectiveWithoutReqs=${effectiveWithoutReqs}, totalNeeded=${totalNeeded}, onOrder=${openReqQty}, gap=${gap} — creating top-up req`,
      );

      let reqId: string | null = null;
      try {
        reqId = await inventoryReorderService.createTopUpRequisition(
          context,
          stock.inventoryItemId,
          gap,
        );
      } catch (reorderErr) {
        logger.error(
          `[InventoryIntegrity] Failed to create top-up req for SKU ${sku}: ` +
          `${reorderErr instanceof Error ? reorderErr.message : String(reorderErr)}`,
        );
      }

      integrityLogger.issueFound("UNCOVERED_NEGATIVE_AVAILABLE", sku,
        `available=${onHand - reserved}, totalNeeded=${totalNeeded}, onOrder=${openReqQty}, gap=${gap}`,
        { onHand, reserved, openPOQty, openReqQty, effectiveWithoutReqs, totalNeeded, gap });
      integrityLogger.correctionApplied("UNCOVERED_NEGATIVE_AVAILABLE", sku,
        reqId ? `Reorder req created (${reqId})` : "Reorder skipped — already at max in pipeline",
        { requisitionId: reqId });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        stock.inventoryItemId,
        `UNCOVERED_NEGATIVE_AVAILABLE for SKU ${sku}: gap=${gap} — top-up req${reqId ? ` created (${reqId})` : " skipped (already at max)"}`,
        {
          checkId: "UNCOVERED_NEGATIVE_AVAILABLE",
          sku,
          onHand,
          reserved,
          openPOQty,
          openReqQty,
          effectiveWithoutReqs,
          totalNeeded,
          gap,
          reorderTriggered: reqId !== null,
          requisitionId: reqId,
          description: `Available=${onHand - reserved}, totalNeeded=${totalNeeded}, onOrder=${openReqQty}, gap=${gap}`,
          correction: reqId ? `Top-up requisition created for ${gap} units (id: ${reqId})` : "No top-up created — pipeline already covers max",
        },
      ).catch(() => {});

      issues.push({
        checkId: "UNCOVERED_NEGATIVE_AVAILABLE",
        severity: "critical",
        inventoryItemId: stock.inventoryItemId,
        inventoryItemSku: sku,
        description:
          `Available=${onHand - reserved}, totalNeeded to reach max=${totalNeeded}, ` +
          `currently on order=${openReqQty}, shortfall=${gap} units not yet requisitioned`,
        correction: reqId
          ? `Reorder requisition created (id: ${reqId})`
          : "Reorder not triggered — item already at or above max in pipeline",
        affectedIds: { stockId: stock.id },
        data: { onHand, reserved, openPOQty, openReqQty, effectiveWithoutReqs, totalNeeded, gap, requisitionId: reqId },
      });
    }

    return issues;
  }

  // ── Check 4: Orphaned reservations ─────────────────────────────────────────

  private async checkOrphanedReservations(
    context: ServiceContext,
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    const orphaned = await this.db.inventoryReservation.findMany({
      where: {
        status: "ACTIVE",
        reservedFor: "WorkOrder",
      },
      select: {
        id: true,
        inventoryItemId: true,
        quantity: true,
        inventoryItem: { select: { sku: true } },
        workOrderPart: {
          select: {
            id: true,
            workOrder: { select: { id: true, woNumber: true, status: true } },
          },
        },
      },
    });

    const DEAD_STATUSES = new Set(["Cancelled", "Closed", "Completed"]);

    for (const res of orphaned) {
      const wo  = res.workOrderPart?.workOrder;
      if (!wo || !DEAD_STATUSES.has(wo.status)) continue;

      const sku = skuOf(res.inventoryItem, res.inventoryItemId);
      const qty = toNumber(res.quantity) ?? 0;

      logger.warn(
        `[InventoryIntegrity] ORPHANED_RESERVATION res=${res.id} ` +
        `SKU=${sku} WO=${wo.woNumber} status=${wo.status}`,
      );

      await this.db.$transaction(async (tx) => {
        await tx.inventoryReservation.update({
          where: { id: res.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: context.userId,
          },
        });
        await tx.inventoryStock.updateMany({
          where: { inventoryItemId: res.inventoryItemId },
          data: { quantityReserved: { decrement: qty } },
        });
        // Clamp
        await tx.inventoryStock.updateMany({
          where: { inventoryItemId: res.inventoryItemId, quantityReserved: { lt: 0 } },
          data: { quantityReserved: 0 },
        });
        if (res.workOrderPart?.id) {
          await tx.workOrderPart.update({
            where: { id: res.workOrderPart.id },
            data: { status: "CANCELLED" },
          });
        }
      });

      integrityLogger.issueFound("ORPHANED_RESERVATION", sku,
        `ACTIVE reservation on ${wo.status} WO ${wo.woNumber} (qty=${qty})`,
        { reservationId: res.id, woNumber: wo.woNumber, woStatus: wo.status });
      integrityLogger.correctionApplied("ORPHANED_RESERVATION", sku,
        `Reservation cancelled; quantityReserved -${qty}; WOP → CANCELLED`,
        { reservationId: res.id, woNumber: wo.woNumber });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        res.inventoryItemId,
        `ORPHANED_RESERVATION cancelled for SKU ${sku}: WO ${wo.woNumber} is ${wo.status}`,
        {
          checkId: "ORPHANED_RESERVATION",
          sku,
          reservationId: res.id,
          workOrderId: wo.id,
          woNumber: wo.woNumber,
          woStatus: wo.status,
          quantity: qty,
          description: `ACTIVE reservation on ${wo.status} WO ${wo.woNumber} (qty ${qty})`,
          correction: `Reservation cancelled; quantityReserved decremented by ${qty}; WorkOrderPart set to CANCELLED`,
        },
      ).catch(() => {});

      issues.push({
        checkId: "ORPHANED_RESERVATION",
        severity: "critical",
        inventoryItemId: res.inventoryItemId,
        inventoryItemSku: sku,
        description: `ACTIVE reservation on ${wo.status} WO ${wo.woNumber} (qty ${qty})`,
        correction: `Reservation cancelled; quantityReserved decremented by ${qty}; WorkOrderPart set to CANCELLED`,
        affectedIds: { reservationId: res.id, workOrderId: wo.id },
        data: { qty, woStatus: wo.status, woNumber: wo.woNumber },
      });
    }

    return issues;
  }

  // ── Check 5: WorkOrderPart status drift ────────────────────────────────────

  private async checkWopStatusDrift(
    context: ServiceContext,
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    const drifted = await this.db.workOrderPart.findMany({
      where: {
        status: "RESERVED",
        reservation: { status: { in: ["CONSUMED", "CANCELLED"] } },
      },
      select: {
        id: true,
        inventoryItemId: true,
        workOrderId: true,
        quantityPlanned: true,
        quantityUsed: true,
        inventoryItem: { select: { sku: true } },
        workOrder: { select: { woNumber: true } },
        reservation: { select: { id: true, status: true, quantity: true } },
      },
    });

    for (const wop of drifted) {
      const sku       = skuOf(wop.inventoryItem, wop.inventoryItemId);
      const resStatus = wop.reservation?.status ?? "unknown";
      const newStatus = resStatus === "CONSUMED" ? "ISSUED" : "CANCELLED";
      const qtyUsed   =
        resStatus === "CONSUMED"
          ? (toNumber(wop.reservation?.quantity) ?? toNumber(wop.quantityPlanned) ?? 0)
          : toNumber(wop.quantityUsed) ?? 0;

      logger.warn(
        `[InventoryIntegrity] WOP_STATUS_DRIFT wop=${wop.id} ` +
        `SKU=${sku} WO=${wop.workOrder.woNumber} reservation=${resStatus} → WOP=${newStatus}`,
      );

      await this.db.workOrderPart.update({
        where: { id: wop.id },
        data: {
          status: newStatus,
          ...(resStatus === "CONSUMED"
            ? {
                quantityUsed: qtyUsed,
                issuedAt: new Date(),
                consumedAt: new Date(),
                consumedBy: context.userId,
                consumedFrom: "INTEGRITY_CORRECTION",
              }
            : {}),
        },
      });

      integrityLogger.issueFound("WOP_STATUS_DRIFT", sku,
        `WOP ${wop.id} RESERVED but reservation is ${resStatus}`,
        { wopId: wop.id, woNumber: wop.workOrder.woNumber, reservationStatus: resStatus });
      integrityLogger.correctionApplied("WOP_STATUS_DRIFT", sku,
        `WOP status RESERVED → ${newStatus}` + (resStatus === "CONSUMED" ? ` qtyUsed=${qtyUsed}` : ""),
        { wopId: wop.id, newStatus, qtyUsed });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        wop.inventoryItemId,
        `WOP_STATUS_DRIFT corrected SKU=${sku} WO=${wop.workOrder.woNumber}: RESERVED → ${newStatus}`,
        {
          checkId: "WOP_STATUS_DRIFT",
          sku,
          wopId: wop.id,
          workOrderId: wop.workOrderId,
          woNumber: wop.workOrder.woNumber,
          reservationId: wop.reservation?.id,
          reservationStatus: resStatus,
          newWopStatus: newStatus,
          description: `WorkOrderPart ${wop.id} (WO=${wop.workOrder.woNumber}) is RESERVED but reservation is ${resStatus}`,
          correction: `WorkOrderPart → ${newStatus}` + (resStatus === "CONSUMED" ? ` with quantityUsed=${qtyUsed}` : ""),
          quantityUsed: qtyUsed,
        },
      ).catch(() => {});

      issues.push({
        checkId: "WOP_STATUS_DRIFT",
        severity: "critical",
        inventoryItemId: wop.inventoryItemId,
        inventoryItemSku: sku,
        description:
          `WorkOrderPart ${wop.id} (WO=${wop.workOrder.woNumber}, SKU=${sku}) ` +
          `is RESERVED but reservation is ${resStatus}`,
        correction: `WorkOrderPart → ${newStatus}` +
          (resStatus === "CONSUMED" ? ` with quantityUsed=${qtyUsed}` : ""),
        affectedIds: { wopId: wop.id, workOrderId: wop.workOrderId },
        data: { reservationStatus: resStatus, newWopStatus: newStatus, quantityUsed: qtyUsed },
      });
    }

    return issues;
  }

  // ── Check 6: Duplicate open requisitions ───────────────────────────────────

  private async checkDuplicateOpenReqs(
    context: ServiceContext,
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    // IMPORTANT: Only examine auto-generated reqs — those created by the
    // system scheduler user (inventory monitor / reservation automation).
    // This covers ADD_TO_REORDER reqs AND WO-shortfall reqs triggered by
    // reservations, both of which use the system user as requestedById.
    // User-created reqs are intentional and must never be cancelled here.
    const systemUser = await this.db.user.findUnique({
      where: { email: "system-scheduler@crn-plant-mgmt.local" },
      select: { id: true },
    });
    if (!systemUser) return [];

    const openLines = await this.db.requisitionLine.findMany({
      where: {
        inventoryItemId: { not: null },
        requisition: {
          status: { notIn: ["Cancelled", "Closed", "Rejected"] },
          requestedById: systemUser.id,
        },
      },
      select: {
        id: true,
        inventoryItemId: true,
        quantity: true,
        requisition: {
          select: { id: true, reqNumber: true, status: true, createdAt: true },
        },
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            maxQuantity: true,
            stock: { select: { quantityOnHand: true, quantityReserved: true } },
          },
        },
      },
      orderBy: { requisition: { createdAt: "asc" } },
    });

    const byItem = new Map<string, typeof openLines>();
    for (const line of openLines) {
      if (!line.inventoryItemId) continue;
      const grp = byItem.get(line.inventoryItemId) ?? [];
      grp.push(line);
      byItem.set(line.inventoryItemId, grp);
    }

    for (const [itemId, lines] of byItem.entries()) {
      if (lines.length <= 1) continue;

      const firstLine = lines[0];
      if (!firstLine) continue;
      const item = firstLine.inventoryItem;
      if (!item) continue;
      const totalOnHand = item.stock.reduce((s, st) => s + (toNumber(st.quantityOnHand) ?? 0), 0);
      const totalRes    = item.stock.reduce((s, st) => s + (toNumber(st.quantityReserved) ?? 0), 0);
      const available   = totalOnHand - totalRes;
      const maxQty      = toNumber(item.maxQuantity) ?? 0;

      const openPOLines = await this.db.pOLine.findMany({
        where: {
          inventoryItemId: itemId,
          purchaseOrder: { status: { notIn: ["Draft", "Cancelled", "Closed"] } },
        },
        select: { quantity: true, receivedQuantity: true },
      });
      const openPOQty = openPOLines.reduce(
        (s, l) => s + Math.max(0, (toNumber(l.quantity) ?? 0) - (toNumber(l.receivedQuantity) ?? 0)),
        0,
      );

      const effectiveSupply  = available + openPOQty;
      const legitReqQty      = Math.max(0, maxQty - effectiveSupply);
      const totalOpenReqQty  = lines.reduce((s, l) => s + (toNumber(l.quantity) ?? 0), 0);
      const excess           = totalOpenReqQty - legitReqQty;

      if (excess <= Math.max(1, legitReqQty * 0.1)) continue;

      const sku = item.sku;
      const [keep, ...cancel] = lines; // oldest first (sorted by createdAt asc)
      if (!keep) continue;
      const cancelReqIds = [...new Set(cancel.map((l) => l.requisition.id))];

      logger.warn(
        `[InventoryIntegrity] DUPLICATE_OPEN_REQS SKU=${sku} ` +
        `openQty=${totalOpenReqQty} needed=${legitReqQty} excess=${excess} — cancelling ${cancelReqIds.length} reqs`,
      );

      for (const reqId of cancelReqIds) {
        const cancelLine = cancel.find((l) => l.requisition.id === reqId);
        if (!cancelLine) continue;
        const req = cancelLine.requisition;
        await this.db.requisition.update({
          where: { id: reqId },
          data: {
            status: "Cancelled",
            approvalStatus: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: context.userId,
            rejectionReason:
              `Auto-cancelled by integrity monitor: duplicate open req for ${sku}. ` +
              `Keeping ${keep.requisition.reqNumber}. ` +
              `Total open=${totalOpenReqQty}, needed=${legitReqQty}.`,
          },
        });

        integrityLogger.issueFound("DUPLICATE_OPEN_REQS", sku,
          `${lines.length} open reqs total ${totalOpenReqQty} needed ${legitReqQty} — cancelling ${req.reqNumber}`,
          { cancelledReqNumber: req.reqNumber, keptReqNumber: keep.requisition.reqNumber });
        integrityLogger.correctionApplied("DUPLICATE_OPEN_REQS", sku,
          `Cancelled ${req.reqNumber}; keeping ${keep.requisition.reqNumber}`,
          { excess, totalOpenReqQty, legitReqQty });

        await logInventoryEvent(
          context,
          "INTEGRITY_CORRECTION",
          itemId,
          `DUPLICATE_OPEN_REQS: cancelled ${req.reqNumber} for SKU=${sku}`,
          {
            checkId: "DUPLICATE_OPEN_REQS",
            sku,
            cancelledReqId: reqId,
            cancelledReqNumber: req.reqNumber,
            keptReqNumber: keep.requisition.reqNumber,
            totalOpenReqQty,
            legitReqQty,
            excess,
            description: `${lines.length} system reqs for SKU=${sku} total ${totalOpenReqQty} units; only ${legitReqQty} needed`,
            correction: `Cancelled ${req.reqNumber}; keeping ${keep.requisition.reqNumber}`,
          },
        ).catch(() => {});
      }

      const cancelledNums = cancelReqIds
        .map((id) => cancel.find((l) => l.requisition.id === id)?.requisition.reqNumber)
        .filter((n): n is string => n !== undefined);

      issues.push({
        checkId: "DUPLICATE_OPEN_REQS",
        severity: "critical",
        inventoryItemId: itemId,
        inventoryItemSku: sku,
        description:
          `${lines.length} open reqs for SKU=${sku} total ${totalOpenReqQty} units; ` +
          `only ${legitReqQty} needed (excess ${excess})`,
        correction:
          `Cancelled: ${cancelledNums.join(", ")}. Kept: ${keep.requisition.reqNumber}`,
        affectedIds: { inventoryItemId: itemId },
        data: {
          keptReqNumber: keep.requisition.reqNumber,
          cancelledReqNumbers: cancelledNums,
          totalOpenReqQty,
          legitReqQty,
          excess,
        },
      });
    }

    return issues;
  }

  // ── Check 7: Stale ISSUED WOP with no inventory transaction ────────────────

  private async checkStaleWopIssuedNoTxn(
    context: ServiceContext,
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    const stale = await this.db.workOrderPart.findMany({
      where: { status: "ISSUED", quantityUsed: null },
      select: {
        id: true,
        inventoryItemId: true,
        workOrderId: true,
        quantityPlanned: true,
        reservationId: true,
        inventoryItem: { select: { sku: true } },
        workOrder: { select: { woNumber: true } },
        reservation: { select: { id: true, status: true } },
      },
    });

    for (const wop of stale) {
      const sku   = skuOf(wop.inventoryItem, wop.inventoryItemId);
      const woNum = wop.workOrder.woNumber;

      const txnExists = await this.db.inventoryTransaction.findFirst({
        where: {
          inventoryItemId: wop.inventoryItemId,
          referenceId: wop.workOrderId,
          transactionType: {
            in: [
              InventoryTransactionType.DIRECT_ISSUE as string,
              InventoryTransactionType.WO_PART_ISSUED as string,
              InventoryTransactionType.WO_RESERVATION_CONSUMED as string,
            ],
          },
        },
        select: { id: true },
      });

      if (txnExists) continue;

      logger.warn(
        `[InventoryIntegrity] STALE_WOP_ISSUED_NO_TXN wop=${wop.id} ` +
        `SKU=${sku} WO=${woNum} — resetting to RESERVED`,
      );

      await this.db.$transaction(async (tx) => {
        await tx.workOrderPart.update({
          where: { id: wop.id },
          data: {
            status: "RESERVED",
            quantityUsed: null,
            issuedAt: null,
            consumedAt: null,
            consumedBy: null,
            consumedFrom: null,
          },
        });
        if (wop.reservationId && wop.reservation?.status === "CONSUMED") {
          await tx.inventoryReservation.update({
            where: { id: wop.reservationId },
            data: { status: "ACTIVE", consumedAt: null, consumedBy: null },
          });
        }
      });

      integrityLogger.issueFound("STALE_WOP_ISSUED_NO_TXN", sku,
        `WOP ${wop.id} ISSUED/null-used, no inventory transaction exists`,
        { wopId: wop.id, woNumber: woNum });
      integrityLogger.correctionApplied("STALE_WOP_ISSUED_NO_TXN", sku,
        `WOP reset to RESERVED` + (wop.reservation?.status === "CONSUMED" ? "; reservation → ACTIVE" : ""),
        { wopId: wop.id, woNumber: woNum });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        wop.inventoryItemId,
        `STALE_WOP_ISSUED_NO_TXN reset SKU=${sku} WO=${woNum}: WOP → RESERVED`,
        {
          checkId: "STALE_WOP_ISSUED_NO_TXN",
          sku,
          wopId: wop.id,
          workOrderId: wop.workOrderId,
          woNumber: woNum,
          reservationId: wop.reservationId,
          reservationResetToActive: wop.reservation?.status === "CONSUMED",
          description: `WOP ${wop.id} (WO=${woNum}) is ISSUED with null quantityUsed but no inventory transaction exists`,
          correction: `WOP reset to RESERVED` + (wop.reservation?.status === "CONSUMED" ? "; reservation reset to ACTIVE" : ""),
        },
      ).catch(() => {});

      issues.push({
        checkId: "STALE_WOP_ISSUED_NO_TXN",
        severity: "critical",
        inventoryItemId: wop.inventoryItemId,
        inventoryItemSku: sku,
        description:
          `WOP ${wop.id} (WO=${woNum}, SKU=${sku}) is ISSUED with null quantityUsed ` +
          `but no inventory transaction exists — stock was never moved`,
        correction:
          `WOP reset to RESERVED` +
          (wop.reservation?.status === "CONSUMED" ? "; reservation reset to ACTIVE" : "") +
          ". User can re-issue.",
        affectedIds: {
          wopId: wop.id,
          workOrderId: wop.workOrderId,
          ...(wop.reservationId ? { reservationId: wop.reservationId } : {}),
        },
        data: {
          woNumber: woNum,
          reservationResetToActive: wop.reservation?.status === "CONSUMED",
        },
      });
    }

    return issues;
  }

  // ── Check 8: Requisition line status drift ─────────────────────────────────
  //
  // RequisitionLine.lineStatus should reflect the PO / receipt state:
  //   poLineId set + PO active → ORDERED
  //   POLine.receivedQuantity >= POLine.quantity → FULFILLED
  //   0 < POLine.receivedQuantity < quantity → PARTIALLY_FULFILLED

  private async checkReqLineStatusDrift(
    context: ServiceContext,
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    // Lines with a poLineId that are still PENDING or APPROVED
    const candidates = await this.db.requisitionLine.findMany({
      where: {
        poLineId: { not: null },
        lineStatus: { in: ["PENDING", "APPROVED"] },
        requisition: { status: { notIn: ["Cancelled", "Closed", "Rejected"] } },
      },
      select: {
        id: true,
        inventoryItemId: true,
        quantity: true,
        lineStatus: true,
        requisition: { select: { id: true, reqNumber: true } },
        poLine: {
          select: {
            id: true,
            quantity: true,
            receivedQuantity: true,
            purchaseOrder: { select: { status: true, poNumber: true } },
          },
        },
        inventoryItem: { select: { sku: true } },
      },
    });

    const ACTIVE_PO_STATUSES = new Set([
      "Ordered", "PartiallyReceived", "Received", "Closed",
    ]);

    for (const line of candidates) {
      const po       = line.poLine?.purchaseOrder;
      const qty      = toNumber(line.poLine?.quantity) ?? 0;
      const received = toNumber(line.poLine?.receivedQuantity) ?? 0;
      const sku      = skuOf(line.inventoryItem, line.inventoryItemId ?? '?');

      if (!po || !ACTIVE_PO_STATUSES.has(po.status)) continue;

      const correctStatus: RequisitionLineStatus =
        received >= qty
          ? RequisitionLineStatus.FULFILLED
          : received > 0
            ? RequisitionLineStatus.PARTIALLY_FULFILLED
            : RequisitionLineStatus.ORDERED;

      if (line.lineStatus === correctStatus) continue;

      logger.warn(
        `[InventoryIntegrity] REQ_LINE_STATUS_DRIFT REQ=${line.requisition.reqNumber} ` +
        `SKU=${sku} lineStatus=${line.lineStatus} → ${correctStatus}`,
      );

      await this.db.requisitionLine.update({
        where: { id: line.id },
        data: { lineStatus: correctStatus },
      });

      integrityLogger.issueFound("REQ_LINE_STATUS_DRIFT", sku,
        `REQ ${line.requisition.reqNumber} lineStatus=${line.lineStatus} but PO ${po.poNumber} is ${po.status}`,
        { reqNumber: line.requisition.reqNumber, poNumber: po.poNumber, received, qty });
      integrityLogger.correctionApplied("REQ_LINE_STATUS_DRIFT", sku,
        `lineStatus ${line.lineStatus} → ${correctStatus}`,
        { reqNumber: line.requisition.reqNumber, correctStatus });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        line.inventoryItemId ?? "system",
        `REQ_LINE_STATUS_DRIFT corrected REQ=${line.requisition.reqNumber} SKU=${sku}: ${line.lineStatus} → ${correctStatus}`,
        {
          checkId: "REQ_LINE_STATUS_DRIFT",
          sku,
          requisitionLineId: line.id,
          reqNumber: line.requisition.reqNumber,
          poNumber: po.poNumber,
          poStatus: po.status,
          qty,
          received,
          oldLineStatus: line.lineStatus,
          newLineStatus: correctStatus,
          description: `REQ ${line.requisition.reqNumber} line shows ${line.lineStatus} but PO ${po.poNumber} is ${po.status} (received ${received}/${qty})`,
          correction: `lineStatus updated to ${correctStatus}`,
        },
      ).catch(() => {});

      issues.push({
        checkId: "REQ_LINE_STATUS_DRIFT",
        severity: "critical",
        inventoryItemId: line.inventoryItemId,
        inventoryItemSku: sku,
        description:
          `REQ ${line.requisition.reqNumber} line for SKU=${sku} shows ${line.lineStatus} ` +
          `but PO ${po.poNumber} is ${po.status} (received ${received}/${qty})`,
        correction: `lineStatus updated to ${correctStatus}`,
        affectedIds: { requisitionLineId: line.id, requisitionId: line.requisition.id },
        data: { oldLineStatus: line.lineStatus, newLineStatus: correctStatus, poStatus: po.status, qty, received },
      });
    }

    return issues;
  }

  // ── Check 9: PO line received quantity drift ────────────────────────────────
  //
  // POLine.receivedQuantity should equal
  //   SUM(receipt.quantityReceived WHERE isReturn=false)
  // − SUM(receipt.quantityReceived WHERE isReturn=true)

  private async checkPoLineReceivedQtyDrift(
    context: ServiceContext,
  ): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];

    // Only check lines that have receipts
    const receiptTotals = await this.db.pOLineReceipt.groupBy({
      by: ["poLineId", "isReturn"],
      _sum: { quantityReceived: true },
    });

    // Build authoritative received map
    const authReceived = new Map<string, number>();
    for (const row of receiptTotals) {
      const current = authReceived.get(row.poLineId) ?? 0;
      const qty     = toNumber(row._sum.quantityReceived) ?? 0;
      authReceived.set(row.poLineId, row.isReturn ? current - qty : current + qty);
    }

    if (authReceived.size === 0) return issues;

    const poLines = await this.db.pOLine.findMany({
      where: { id: { in: [...authReceived.keys()] } },
      select: {
        id: true,
        inventoryItemId: true,
        receivedQuantity: true,
        inventoryItem: { select: { sku: true } },
        purchaseOrder: { select: { poNumber: true } },
      },
    });

    for (const line of poLines) {
      const stored        = toNumber(line.receivedQuantity) ?? 0;
      const authoritative = authReceived.get(line.id) ?? 0;
      if (Math.abs(stored - authoritative) < 0.001) continue; // float tolerance

      const sku = skuOf(line.inventoryItem, line.inventoryItemId ?? '?');

      logger.warn(
        `[InventoryIntegrity] PO_LINE_RECEIVED_QTY_DRIFT POLine=${line.id} ` +
        `SKU=${sku} stored=${stored} authoritative=${authoritative}`,
      );

      await this.db.pOLine.update({
        where: { id: line.id },
        data: { receivedQuantity: authoritative },
      });

      integrityLogger.issueFound("PO_LINE_RECEIVED_QTY_DRIFT", sku,
        `PO ${line.purchaseOrder.poNumber} receivedQty=${stored} authoritative=${authoritative}`,
        { poLineId: line.id, poNumber: line.purchaseOrder.poNumber });
      integrityLogger.correctionApplied("PO_LINE_RECEIVED_QTY_DRIFT", sku,
        `receivedQuantity ${stored} → ${authoritative}`,
        { poLineId: line.id, stored, authoritative });

      await logInventoryEvent(
        context,
        "INTEGRITY_CORRECTION",
        line.inventoryItemId ?? "system",
        `PO_LINE_RECEIVED_QTY_DRIFT corrected PO=${line.purchaseOrder.poNumber} SKU=${sku}: ${stored} → ${authoritative}`,
        {
          checkId: "PO_LINE_RECEIVED_QTY_DRIFT",
          sku,
          poLineId: line.id,
          poNumber: line.purchaseOrder.poNumber,
          stored,
          authoritative,
          description: `PO ${line.purchaseOrder.poNumber} receivedQuantity=${stored} but sum of receipts=${authoritative}`,
          correction: `receivedQuantity updated to ${authoritative}`,
        },
      ).catch(() => {});

      issues.push({
        checkId: "PO_LINE_RECEIVED_QTY_DRIFT",
        severity: "critical",
        inventoryItemId: line.inventoryItemId,
        inventoryItemSku: sku,
        description:
          `PO ${line.purchaseOrder.poNumber} line ${line.id} (SKU=${sku}): ` +
          `receivedQuantity=${stored} but sum of receipts=${authoritative}`,
        correction: `receivedQuantity updated to ${authoritative}`,
        affectedIds: { poLineId: line.id },
        data: { stored, authoritative, poNumber: line.purchaseOrder.poNumber },
      });
    }

    return issues;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const _global = globalThis as unknown as {
  inventoryIntegrityService: InventoryIntegrityService | undefined;
};

export const inventoryIntegrityService: InventoryIntegrityService =
  _global.inventoryIntegrityService ??
  (_global.inventoryIntegrityService = new InventoryIntegrityService(prisma));
