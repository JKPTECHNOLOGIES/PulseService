/**
 * Purchase Order Line Scrap Service
 *
 * Handles "scrap a repairable part from the PO" — the disposition used when a
 * part was sent to a vendor for repair (a REPAIRABLE_RETURN PO line) and the
 * vendor reports it cannot be fixed.
 *
 * What it does, atomically (operational writes):
 *   1. Cancels the single PO line (lineStatus=CANCELLED, cancellationType=REPAIRABLE_SCRAP)
 *      WITHOUT affecting the rest of the PO.
 *   2. Scraps the linked serial (RepairableItem → SCRAPPED / BEYOND_REPAIR / Scrapped).
 *      No stock change — the serial is off-shelf (IN_REPAIR_EXTERNAL), not in inventory.
 *   3. Marks the active RepairHistory row SCRAPPED.
 *   4. Advances the linked repair WorkOrder repairWorkflowStatus → SCRAPPED (if any).
 *   5. Recomputes the PO header totalAmount from the remaining (non-cancelled) lines.
 *
 * After the operational transaction (best-effort, non-fatal — mirrors the
 * codebase convention that GL/history failures never block the operational write):
 *   6. Releases the scrapped line's PO commitment GL + budget.
 *   7. Writes a SCRAPPED repairable-item history event + an audit log entry.
 *
 * Serial resolution: REPAIRABLE_RETURN lines do NOT reliably carry
 * POLine.repairableItemId (legacy data leaves it null). The serial is resolved
 * via POLine.repairableItemId ?? Requisition(POLine.requisitionId).repairableItemId,
 * and POLine.repairableItemId is back-filled when resolved through the requisition.
 *
 * Scope: scrap-only. A replacement repair is handled by generating a NEW
 * requisition through the normal flow — this service creates nothing new.
 */

import {
  LineItemType,
  POLineStatus,
  POLineCancellationType,
  RepairableStatus,
  RepairableCondition,
  RepairStatus,
  RepairWorkflowStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { logger } from "@/lib/logger";
import { repairableItemHistoryService } from "@/services/repairable-items";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import { GLEventType } from "@/types/gl-rules";
import { BudgetTrackingService } from "@/services/budgets/budget-tracking.service";

export interface ScrapRepairableLineInput {
  reason: string;
}

export interface ScrapRepairableLineResult {
  poLineId: string;
  poNumber: string;
  serialNumber: string | null;
  repairableItemId: string | null;
  newPOTotal: number;
  glReleased: boolean;
}

// RepairHistory rows in any of these states are still "live" and should be
// flipped to SCRAPPED. Terminal states are excluded so we never re-stamp a
// closed history row.
const TERMINAL_REPAIR_STATUSES: RepairStatus[] = [
  RepairStatus.COMPLETED,
  RepairStatus.RETURNED,
  RepairStatus.CANCELLED,
  RepairStatus.SCRAPPED,
];

class PurchaseOrderLineScrapService {
  private readonly resource = PermissionResource.PURCHASING;

  /**
   * Scrap a REPAIRABLE_RETURN PO line: cancel the line and scrap its serial.
   *
   * @param context - Service context (user/permissions for audit + auth)
   * @param poId    - Purchase Order id
   * @param lineId  - PO line id (must be a REPAIRABLE_RETURN line in OPEN status)
   * @param input   - { reason } free-text scrap reason (required)
   */
  async scrapRepairableLine(
    context: ServiceContext,
    poId: string,
    lineId: string,
    input: ScrapRepairableLineInput,
  ): Promise<ScrapRepairableLineResult> {
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestError("A scrap reason is required.");
    }

    // ── Load PO line + PO + linked serial/req/wo ────────────────────────────
    const poLine = await prisma.pOLine.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        purchaseOrderId: true,
        lineType: true,
        lineStatus: true,
        description: true,
        quantity: true,
        receivedQuantity: true,
        totalPrice: true,
        inventoryItemId: true,
        repairableItemId: true,
        requisitionId: true,
        workOrderId: true,
        purchaseOrder: { select: { id: true, poNumber: true } },
        chargeAllocations: {
          select: {
            accountCodeId: true,
            departmentId: true,
            projectId: true,
            areaId: true,
            percentage: true,
          },
        },
      },
    });

    if (!poLine) {
      throw new NotFoundError("POLine", lineId);
    }
    if (poLine.purchaseOrderId !== poId) {
      throw new BadRequestError(
        `PO line ${lineId} does not belong to purchase order ${poId}.`,
      );
    }
    if (poLine.lineType !== LineItemType.REPAIRABLE_RETURN) {
      throw new BadRequestError(
        `Only repairable-return lines can be scrapped. Line ${lineId} is ${poLine.lineType}.`,
      );
    }
    if (poLine.lineStatus === POLineStatus.CANCELLED) {
      throw new BadRequestError("This line has already been cancelled.");
    }
    if (Number(poLine.receivedQuantity) > 0) {
      throw new BadRequestError(
        "This line has already been received — the repaired part is back in inventory and cannot be scrapped from the PO.",
      );
    }

    const poNumber = poLine.purchaseOrder.poNumber;

    // ── Resolve the serial: direct FK first, then the repair requisition ─────
    let serialId: string | null = poLine.repairableItemId ?? null;
    if (!serialId && poLine.requisitionId) {
      const req = await prisma.requisition.findUnique({
        where: { id: poLine.requisitionId },
        select: { isRepairRequisition: true, repairableItemId: true },
      });
      if (req?.repairableItemId) {
        serialId = req.repairableItemId;
      }
    }

    if (!serialId) {
      throw new BadRequestError(
        `Cannot resolve the repairable serial for line ${lineId} (no repairableItemId on the line or its requisition). ` +
          `Scrap aborted to avoid cancelling the line without scrapping a part.`,
      );
    }

    const serial = await prisma.repairableItem.findUnique({
      where: { id: serialId },
      select: {
        id: true,
        serialNumber: true,
        status: true,
        inventoryItemId: true,
        purchaseCost: true,
        totalRepairCost: true,
      },
    });
    if (!serial) {
      throw new NotFoundError("RepairableItem", serialId);
    }
    if (serial.status === RepairableStatus.SCRAPPED) {
      throw new BadRequestError(
        `Serial ${serial.serialNumber} is already scrapped.`,
      );
    }

    // User display name for audit fields
    const user = await prisma.user.findUnique({
      where: { id: context.userId },
      select: { firstName: true, lastName: true },
    });
    const userName =
      context.userName ||
      (user ? `${user.firstName} ${user.lastName}`.trim() : "Unknown User");

    const financialImpact =
      Number(serial.purchaseCost ?? 0) + Number(serial.totalRepairCost);

    // Find the active (non-terminal) RepairHistory for this serial to flip to SCRAPPED.
    const activeRepairHistory = await prisma.repairHistory.findFirst({
      where: {
        repairableItemId: serial.id,
        repairStatus: { notIn: TERMINAL_REPAIR_STATUSES },
      },
      orderBy: { initiatedDate: "desc" },
      select: { id: true },
    });

    // ── Operational writes (atomic) ─────────────────────────────────────────
    const newPOTotal = await prisma.$transaction(async (tx) => {
      // 1. Cancel the PO line (back-fill repairableItemId for traceability).
      await tx.pOLine.update({
        where: { id: poLine.id },
        data: {
          lineStatus: POLineStatus.CANCELLED,
          cancellationType: POLineCancellationType.REPAIRABLE_SCRAP,
          cancelledAt: new Date(),
          cancelledBy: context.userId,
          cancelledByName: userName,
          cancelledReason: reason,
          repairableItemId: serial.id,
        },
      });

      // 2. Scrap the serial — no stock change (it is off-shelf in repair).
      await tx.repairableItem.update({
        where: { id: serial.id },
        data: {
          status: RepairableStatus.SCRAPPED,
          condition: RepairableCondition.BEYOND_REPAIR,
          currentLocation: "Scrapped",
          lastModifiedBy: context.userId,
        },
      });

      // 3. Close the active repair history as SCRAPPED.
      if (activeRepairHistory) {
        await tx.repairHistory.update({
          where: { id: activeRepairHistory.id },
          data: {
            repairStatus: RepairStatus.SCRAPPED,
            completedDate: new Date(),
            repairDescription:
              `Vendor could not repair the part. Scrapped from PO ${poNumber}. ` +
              `Reason: ${reason}`,
          },
        });
      }

      // 4. Advance the linked repair WO workflow status (if any has one set).
      if (poLine.workOrderId) {
        await tx.workOrder.updateMany({
          where: {
            id: poLine.workOrderId,
            repairWorkflowStatus: { not: null },
          },
          data: { repairWorkflowStatus: RepairWorkflowStatus.SCRAPPED },
        });
      }

      // 5. Recompute the PO header total from the remaining OPEN lines.
      const remainingLines = await tx.pOLine.findMany({
        where: {
          purchaseOrderId: poId,
          lineStatus: { not: POLineStatus.CANCELLED },
        },
        select: { totalPrice: true },
      });
      const recomputed = remainingLines.reduce(
        (sum, l) => sum.add(l.totalPrice),
        new Prisma.Decimal(0),
      );
      await tx.purchaseOrder.update({
        where: { id: poId },
        data: { totalAmount: recomputed },
      });

      return recomputed.toNumber();
    });

    logger.info(
      `[PO Line Scrap] Line ${poLine.id} on PO ${poNumber} cancelled (REPAIRABLE_SCRAP); ` +
        `serial ${serial.serialNumber} scrapped. New PO total=${newPOTotal}. By=${userName}.`,
      { poId, poLineId: poLine.id, repairableItemId: serial.id },
    );

    // ── GL commitment release (best-effort, non-fatal) ──────────────────────
    let glReleased = false;
    try {
      glReleased = await this.releaseLineCommitmentGL(context, {
        poId,
        poNumber,
        poLineId: poLine.id,
        lineDescription: poLine.description,
        lineAmount: Number(poLine.totalPrice),
        allocations: poLine.chargeAllocations.map((a) => ({
          accountCodeId: a.accountCodeId,
          departmentId: a.departmentId,
          projectId: a.projectId,
          areaId: a.areaId,
          percentage: Number(a.percentage),
        })),
      });
    } catch (glErr) {
      logger.error(
        `[PO Line Scrap] GL commitment release FAILED for line ${poLine.id} on PO ${poNumber} ` +
          `(non-fatal — scrap committed; manual GL remediation may be required): ` +
          `${glErr instanceof Error ? glErr.message : String(glErr)}`,
        { poId, poLineId: poLine.id },
      );
    }

    // ── History + audit (best-effort, non-fatal) ────────────────────────────
    try {
      await repairableItemHistoryService.logScrapped(
        context,
        serial.id,
        `Scrapped from PO ${poNumber} (line cancelled — vendor could not repair). ` +
          `Reason: ${reason}. Financial impact: $${financialImpact.toFixed(2)}.`,
      );
    } catch {
      /* non-fatal */
    }

    try {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CANCEL,
        "POLine",
        poLine.id,
        `${poNumber} — ${poLine.description}`,
        {
          lineStatus: POLineStatus.OPEN,
          serialStatus: serial.status,
        },
        {
          lineStatus: POLineStatus.CANCELLED,
          cancellationType: POLineCancellationType.REPAIRABLE_SCRAP,
          serialStatus: RepairableStatus.SCRAPPED,
          serialNumber: serial.serialNumber,
          reason,
          newPOTotal,
          glReleased,
        },
      );
    } catch {
      /* non-fatal */
    }

    return {
      poLineId: poLine.id,
      poNumber,
      serialNumber: serial.serialNumber,
      repairableItemId: serial.id,
      newPOTotal,
      glReleased,
    };
  }

  /**
   * Release the scrapped line's PO commitment.
   *
   * These vendor-repair POs post a single aggregate PO-level EXPENDITURE GL at
   * approval (commitment for every line). There is no per-line GL transaction to
   * reverse, so we post a targeted per-line REVERSAL for just this line's amount:
   * regenerate the line's PO_APPROVE entries from its charge allocations
   * (REPAIRABLE_RETURN uses NON_STOCK GL treatment), sign-flip them, post a
   * REVERSAL keyed to the POLine, then release budget via unconsumeBudgetFromGL.
   *
   * This mirrors PurchaseOrderWorkflowService.close()'s per-line commitment
   * release pattern exactly. Returns true if a release GL was posted.
   */
  private async releaseLineCommitmentGL(
    context: ServiceContext,
    params: {
      poId: string;
      poNumber: string;
      poLineId: string;
      lineDescription: string;
      lineAmount: number;
      allocations: Array<{
        accountCodeId: string | null;
        departmentId: string | null;
        projectId: string | null;
        areaId: string | null;
        percentage: number;
      }>;
    },
  ): Promise<boolean> {
    const {
      poId,
      poNumber,
      poLineId,
      lineDescription,
      lineAmount,
      allocations,
    } = params;

    // Idempotency: don't double-release if a POLine reversal already exists.
    const existing = await prisma.gLTransaction.findFirst({
      where: {
        referenceType: "POLine",
        referenceId: poLineId,
        transactionType: "REVERSAL",
        status: "POSTED",
      },
      select: { id: true },
    });
    if (existing) {
      logger.info(
        `[PO Line Scrap] Commitment reversal already exists for line ${poLineId}; skipping GL release.`,
      );
      return false;
    }

    if (allocations.length === 0) {
      logger.warn(
        `[PO Line Scrap] Line ${poLineId} on PO ${poNumber} has no charge allocations — ` +
          `cannot regenerate commitment GL. Manual GL release may be required.`,
      );
      return false;
    }

    // Regenerate the same PO_APPROVE entries the approval posted for this line.
    const releaseEntries: Array<{
      entryType: "DEBIT" | "CREDIT";
      glAccountId: string;
      amount: number;
      accountCodeId?: string;
      departmentId?: string;
      projectId?: string;
      areaId?: string;
      description?: string;
    }> = [];

    for (const alloc of allocations) {
      if (!alloc.accountCodeId) continue;
      const allocationAmount = lineAmount * (alloc.percentage / 100);

      const ruleResult = await glRuleEngineService.evaluateRules(
        context,
        GLEventType.PO_APPROVE,
        {
          amount: allocationAmount,
          accountCodeId: alloc.accountCodeId,
          departmentId: alloc.departmentId ?? undefined,
          areaId: alloc.areaId ?? undefined,
          projectId: alloc.projectId ?? undefined,
          transactionDate: new Date(),
          referenceType: "POLine",
          referenceId: poLineId,
          referenceNumber: poNumber,
          poNumber,
          // REPAIRABLE_RETURN uses NON_STOCK accounting treatment for PO_APPROVE.
          lineType: "NON_STOCK",
          sourceType: "MANUAL",
        },
      );

      if (!ruleResult.success || !ruleResult.matched) {
        logger.warn(
          `[PO Line Scrap] No GL rule matched PO_APPROVE for line ${poLineId} on PO ${poNumber}; ` +
            `cannot release commitment automatically.`,
        );
        return false;
      }

      // Sign-flip each entry to reverse the original commitment.
      for (const entry of ruleResult.entries) {
        releaseEntries.push({
          entryType: entry.entryType === "DEBIT" ? "CREDIT" : "DEBIT",
          glAccountId: entry.glAccountId,
          amount: entry.amount,
          accountCodeId: entry.accountCodeId,
          departmentId: entry.departmentId,
          projectId: entry.projectId,
          areaId: entry.areaId,
          description: `Scrap release - ${poNumber} - ${lineDescription}`,
        });
      }
    }

    if (releaseEntries.length === 0) {
      return false;
    }

    const budgetPeriod = await getCurrentBudgetPeriod(prisma);

    const reversalTxnId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "REVERSAL",
        referenceType: "POLine",
        referenceId: poLineId,
        referenceNumber: poNumber,
        description:
          `Scrap release - reverse commitment - ${poNumber} - ${lineDescription}`.substring(
            0,
            255,
          ),
        lines: releaseEntries,
        reversalReason: `Repairable part scrapped from PO ${poNumber}`,
      },
    );

    await glTransactionService.postTransaction(context, reversalTxnId);

    // Release the committed budget. totalAmount is the sum of ALL reversal lines
    // (debit + credit) — the checksum unconsumeBudgetFromGL validates against,
    // identical to PurchaseOrderWorkflowService.close().
    const reversalTotal = releaseEntries.reduce((s, l) => s + l.amount, 0);
    const budgetTracker = new BudgetTrackingService(prisma);
    await budgetTracker.unconsumeBudgetFromGL(context, {
      periodId: budgetPeriod.id,
      glTransactionId: reversalTxnId,
      referenceType: "PurchaseOrder",
      referenceId: poId,
      referenceNumber: poNumber,
      totalAmount: reversalTotal,
    });

    logger.info(
      `[PO Line Scrap] Released commitment GL for line ${poLineId} on PO ${poNumber}. ` +
        `glTxnId=${reversalTxnId}, lineAmount=${lineAmount}.`,
    );
    return true;
  }
}

const globalForPOLineScrap = globalThis as unknown as {
  purchaseOrderLineScrapService: PurchaseOrderLineScrapService | undefined;
};

export const purchaseOrderLineScrapService =
  globalForPOLineScrap.purchaseOrderLineScrapService ??
  (globalForPOLineScrap.purchaseOrderLineScrapService =
    new PurchaseOrderLineScrapService());
