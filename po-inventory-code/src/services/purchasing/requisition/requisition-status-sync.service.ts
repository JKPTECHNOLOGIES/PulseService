/**
 * Requisition Status Sync Service
 *
 * Keeps requisition header status in sync with downstream lifecycle events:
 * - PO sent to supplier → "Ordered"
 * - Items partially received → "PartiallyFulfilled"
 * - All items fully received → "Fulfilled"
 * - Invoice matched on fully received items → "Fulfilled" (confirmed)
 *
 * BATCH 5 (B5-5/B5-1): This service now supports transactional execution.
 * All methods accept an optional Prisma transaction client (`tx`) parameter.
 * When provided, reads and writes run inside the caller's transaction — preventing
 * async drift between `status` (String) and `approvalStatus` (Enum).
 * When omitted, falls back to the default `prisma` client (backward compatible).
 *
 * This service is called from:
 * - PO workflow (send to supplier)
 * - PO receiving service (receive items)
 * - Invoice approval service (upload/match invoice)
 * - Requisition workflow service (status transitions)
 */

import { PrismaClient, RequisitionApprovalStatus, RequisitionLineStatus as PrismaRequisitionLineStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { RequisitionStatus } from "./requisition.types";

// ---------------------------------------------------------------------------
// Prisma transaction client type (mirrors po-gl.service.ts pattern)
// ---------------------------------------------------------------------------
type PrismaTxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ---------------------------------------------------------------------------
// Status ↔ ApprovalStatus mapping (B5-1)
// ---------------------------------------------------------------------------

/**
 * Maps a requisition's string `status` value to the corresponding
 * `RequisitionApprovalStatus` enum value stored in `approvalStatus`.
 *
 * This is the single source of truth for the bidirectional mapping so that
 * every code path that sets `status` can atomically set `approvalStatus` too.
 */
export function mapStatusToApprovalStatus(status: string): RequisitionApprovalStatus {
  const map: Record<string, RequisitionApprovalStatus> = {
    "Draft":              RequisitionApprovalStatus.DRAFT,
    "Submitted":          RequisitionApprovalStatus.PENDING,
    "Pending":            RequisitionApprovalStatus.PENDING,
    "Approved":           RequisitionApprovalStatus.APPROVED,
    "Rejected":           RequisitionApprovalStatus.REJECTED,
    "Cancelled":          RequisitionApprovalStatus.CANCELLED,
    "Ordered":            RequisitionApprovalStatus.ORDERED,
    "Fulfilled":          RequisitionApprovalStatus.FULFILLED,
    "PartiallyFulfilled": RequisitionApprovalStatus.PARTIALLY_FULFILLED,
    "Partially Fulfilled":RequisitionApprovalStatus.PARTIALLY_FULFILLED,
    "PartiallyApproved":  RequisitionApprovalStatus.PARTIALLY_APPROVED,
    "Partially Approved": RequisitionApprovalStatus.PARTIALLY_APPROVED,
  };
  return map[status] ?? RequisitionApprovalStatus.DRAFT;
}

/**
 * Result of a requisition status sync operation
 */
export interface RequisitionSyncResult {
  requisitionId: string;
  reqNumber: string;
  previousStatus: string;
  newStatus: string;
  changed: boolean;
  reason: string;
}

class RequisitionStatusSyncService {
  // ---------------------------------------------------------------------------
  // Transaction helper (B5-5) — mirrors po-gl.service.ts pattern
  // ---------------------------------------------------------------------------

  /**
   * Return the provided transaction client, or fall back to the global prisma
   * instance when no transaction is supplied.
   */
  private db(tx?: PrismaTxClient): PrismaTxClient {
    return tx ?? prisma;
  }

  /**
   * Sync a single requisition's status based on its linked PO lines.
   *
   * Logic:
   * 1. Find all RequisitionLines for this requisition
   * 2. For each line, find the linked POLine (via poLineId or requisitionLineId)
   * 3. Compare receivedQuantity vs ordered quantity on each POLine
   * 4. Determine overall requisition status:
   *    - All lines have fully received PO lines → "Fulfilled"
   *    - Some lines have partially/fully received PO lines → "PartiallyFulfilled"
   *    - All lines are on POs but nothing received → "Ordered"
   *    - No PO lines linked → keep current status
   *
   * @param requisitionId - The ID of the requisition to sync
   * @param tx - Optional Prisma transaction client for atomic execution (B5-5)
   */
  async syncRequisitionStatus(requisitionId: string, tx?: PrismaTxClient): Promise<RequisitionSyncResult> {
    const db = this.db(tx);

    const requisition = await db.requisition.findUnique({
      where: { id: requisitionId },
      select: {
        id: true,
        reqNumber: true,
        status: true,
        lines: {
          select: {
            id: true,
            lineStatus: true,
            poLineId: true,
            purchaseOrderId: true,
          },
        },
      },
    });

    if (!requisition) {
      return {
        requisitionId,
        reqNumber: "UNKNOWN",
        previousStatus: "UNKNOWN",
        newStatus: "UNKNOWN",
        changed: false,
        reason: "Requisition not found",
      };
    }

    const previousStatus = requisition.status;

    // If requisition is in a terminal state that shouldn't be overridden, skip
    if (previousStatus === RequisitionStatus.CANCELLED || previousStatus === RequisitionStatus.REJECTED) {
      return {
        requisitionId,
        reqNumber: requisition.reqNumber,
        previousStatus,
        newStatus: previousStatus,
        changed: false,
        reason: "Requisition is in terminal state",
      };
    }

    // Get all req lines that are linked to PO lines
    const reqLinesWithPO = requisition.lines.filter(
      (line) => line.poLineId ?? line.purchaseOrderId,
    );

    // If no lines are linked to POs, can't determine downstream status
    if (reqLinesWithPO.length === 0) {
      return {
        requisitionId,
        reqNumber: requisition.reqNumber,
        previousStatus,
        newStatus: previousStatus,
        changed: false,
        reason: "No lines linked to purchase orders",
      };
    }

    // Get all linked PO line IDs
    const poLineIds = reqLinesWithPO
      .map((line) => line.poLineId)
      .filter((id): id is string => id !== null);

    // Also find PO lines via requisitionLineId (reverse lookup)
    const reqLineIds = requisition.lines.map((l) => l.id);
    const poLinesViaReqLineId = await db.pOLine.findMany({
      where: {
        requisitionLineId: { in: reqLineIds },
      },
      select: {
        id: true,
        quantity: true,
        receivedQuantity: true,
        requisitionLineId: true,
        purchaseOrder: {
          select: {
            id: true,
            status: true,
          },
        },
        receipts: {
          where: { isReturn: false },
          select: {
            id: true,
            invoiceId: true,
          },
        },
      },
    });

    // Also get PO lines by direct poLineId
    const poLinesDirect = poLineIds.length > 0
      ? await db.pOLine.findMany({
          where: { id: { in: poLineIds } },
          select: {
            id: true,
            quantity: true,
            receivedQuantity: true,
            requisitionLineId: true,
            purchaseOrder: {
              select: {
                id: true,
                status: true,
              },
            },
            receipts: {
              where: { isReturn: false },
              select: {
                id: true,
                invoiceId: true,
              },
            },
          },
        })
      : [];

    // Merge and deduplicate PO lines
    const allPOLines = new Map<string, typeof poLinesDirect[0]>();
    for (const pl of [...poLinesDirect, ...poLinesViaReqLineId]) {
      allPOLines.set(pl.id, pl);
    }

    if (allPOLines.size === 0) {
      return {
        requisitionId,
        reqNumber: requisition.reqNumber,
        previousStatus,
        newStatus: previousStatus,
        changed: false,
        reason: "No PO lines found for requisition lines",
      };
    }

    // Analyze each PO line AND check PO header statuses
    const totalPOLines = allPOLines.size;
    let fullyReceivedCount = 0;
    let partiallyReceivedCount = 0;
    let anyReceived = false;
    
    // Track PO header statuses to handle Closed/Received POs
    const poStatuses = new Set<string>();

    for (const poLine of allPOLines.values()) {
      const ordered = poLine.quantity instanceof Decimal
        ? poLine.quantity.toNumber()
        : Number(poLine.quantity);
      const received = poLine.receivedQuantity instanceof Decimal
        ? poLine.receivedQuantity.toNumber()
        : Number(poLine.receivedQuantity);

      if (received >= ordered && ordered > 0) {
        fullyReceivedCount++;
        anyReceived = true;
      } else if (received > 0) {
        partiallyReceivedCount++;
        anyReceived = true;
      }
      
      // Track the PO's header status
      if (poLine.purchaseOrder.status) {
        poStatuses.add(poLine.purchaseOrder.status);
      }
    }

    // Determine new status
    // Priority: PO header status (Closed/Received) takes precedence over received quantity logic
    let newStatus: string;
    let reason: string;
    
    // FIX: Compare PO-linked lines against the ACTUAL requisition line count
    // to detect partial conversions where some req lines have no PO yet.
    const totalReqLines = requisition.lines.length;
    const allReqLinesOnPOs = reqLinesWithPO.length >= totalReqLines;
    
    // Check if ALL linked POs are in a terminal state (Closed or Received)
    const allPOsClosed = poStatuses.size > 0 &&
      [...poStatuses].every(s => s === "Closed" || s === "Received");
    const anyPOClosed = poStatuses.has("Closed") || poStatuses.has("Received");

    if (allReqLinesOnPOs) {
      // ALL req lines are on POs — use full status determination logic
      if (allPOsClosed) {
        // ALL linked POs are Closed or Received → Requisition is Fulfilled
        newStatus = RequisitionStatus.FULFILLED;
        reason = `All linked PO(s) are ${[...poStatuses].join("/")} — requisition fulfilled`;
      } else if (fullyReceivedCount === totalPOLines) {
        // All lines fully received
        newStatus = RequisitionStatus.FULFILLED;
        reason = `All ${totalPOLines} PO line(s) fully received`;
      } else if (anyPOClosed || anyReceived) {
        // Some POs closed/received or some items received
        if (anyPOClosed && !anyReceived) {
          // PO is closed but nothing received — treat as fulfilled (short-close scenario)
          newStatus = RequisitionStatus.FULFILLED;
          reason = `Linked PO(s) closed (short-close) — requisition fulfilled`;
        } else {
          newStatus = RequisitionStatus.PARTIALLY_FULFILLED;
          reason = `${fullyReceivedCount} fully received, ${partiallyReceivedCount} partially received of ${totalPOLines} PO line(s)`;
        }
      } else {
        // All on PO but nothing received yet → Ordered
        newStatus = RequisitionStatus.ORDERED;
        reason = `All ${totalPOLines} line(s) on purchase orders, awaiting receipt`;
      }
    } else {
      // NOT all req lines are on POs — partial conversion scenario.
      // Some lines have been converted to POs, but others are still pending conversion.
      if (anyReceived || anyPOClosed) {
        // Some PO lines are being received/closed, but other req lines have no PO yet
        newStatus = RequisitionStatus.PARTIALLY_FULFILLED;
        reason = `${reqLinesWithPO.length} of ${totalReqLines} line(s) on POs (some received/closed), remaining lines still convertible`;
      } else {
        // Some lines on POs but nothing received, other lines not on POs at all.
        // Keep as "Approved" so remaining lines can still be converted to POs.
        // (No "Partially Ordered" status exists in the RequisitionStatus enum — B5-3)
        newStatus = RequisitionStatus.APPROVED;
        reason = `${reqLinesWithPO.length} of ${totalReqLines} line(s) on POs — remaining lines still convertible`;
      }
    }

    // Only update if status actually changed
    const changed = newStatus !== previousStatus;
    if (changed) {
      // B5-1: Map string status to RequisitionApprovalStatus enum and update both atomically
      const newApprovalStatus = mapStatusToApprovalStatus(newStatus);

      // Update requisition status (both status and approvalStatus)
      await db.requisition.update({
        where: { id: requisitionId },
        data: {
          status: newStatus,
          approvalStatus: newApprovalStatus,
        },
      });

      // Also update requisition line statuses
      for (const poLine of allPOLines.values()) {
        const ordered = poLine.quantity instanceof Decimal
          ? poLine.quantity.toNumber()
          : Number(poLine.quantity);
        const received = poLine.receivedQuantity instanceof Decimal
          ? poLine.receivedQuantity.toNumber()
          : Number(poLine.receivedQuantity);
        const poStatus = poLine.purchaseOrder.status;

        let lineStatus: PrismaRequisitionLineStatus;
        if (poStatus === "Closed" || poStatus === "Received") {
          // PO is Closed/Received → line is fulfilled regardless of received quantities
          lineStatus = PrismaRequisitionLineStatus.FULFILLED;
        } else if (received >= ordered && ordered > 0) {
          lineStatus = PrismaRequisitionLineStatus.FULFILLED;
        } else if (received > 0) {
          lineStatus = PrismaRequisitionLineStatus.PARTIALLY_FULFILLED;
        } else {
          lineStatus = PrismaRequisitionLineStatus.ORDERED;
        }

        // Update req line via the requisitionLineId
        if (poLine.requisitionLineId) {
          await db.requisitionLine.update({
            where: { id: poLine.requisitionLineId },
            data: { lineStatus },
          });
        }
      }

      // Update computed counters on the requisition
      await this.updateRequisitionCounters(requisitionId, tx);
    }

    return {
      requisitionId,
      reqNumber: requisition.reqNumber,
      previousStatus,
      newStatus,
      changed,
      reason,
    };
  }

  /**
   * Sync requisition status for ALL requisitions linked to a purchase order.
   * Called after PO status changes (send, receive, etc.)
   *
   * @param purchaseOrderId - The PO whose linked requisitions should be synced
   * @param tx - Optional Prisma transaction client for atomic execution (B5-5)
   */
  async syncRequisitionsForPO(purchaseOrderId: string, tx?: PrismaTxClient): Promise<RequisitionSyncResult[]> {
    const db = this.db(tx);

    // Find requisition IDs from two sources:
    // 1. PO.requisitionIds array
    // 2. POLine.requisitionId fields
    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        requisitionIds: true,
        lines: {
          select: {
            requisitionId: true,
          },
        },
      },
    });

    if (!po) return [];

    // Collect unique requisition IDs
    const reqIds = new Set<string>();
    for (const id of po.requisitionIds) {
      if (id) reqIds.add(id);
    }
    for (const line of po.lines) {
      if (line.requisitionId) reqIds.add(line.requisitionId);
    }

    // Sync each requisition (pass through the tx so all run in the same transaction)
    const results: RequisitionSyncResult[] = [];
    for (const reqId of reqIds) {
      const result = await this.syncRequisitionStatus(reqId, tx);
      results.push(result);
    }

    return results;
  }

  /**
   * Sync ALL requisitions that are linked to purchase orders.
   * Used as a one-time retroactive fix for existing data.
   *
   * NOTE: This bulk operation does NOT accept a tx parameter because it may
   * process hundreds of requisitions and would exceed transaction timeout limits.
   */
  async syncAllLinkedRequisitions(): Promise<RequisitionSyncResult[]> {
    // Find all requisitions that have lines linked to POs
    const requisitions = await prisma.requisition.findMany({
      where: {
        OR: [
          { purchaseOrderId: { not: null } },
          { lines: { some: { purchaseOrderId: { not: null } } } },
          { lines: { some: { poLineId: { not: null } } } },
        ],
        status: {
          notIn: [
            RequisitionStatus.CANCELLED,
            RequisitionStatus.REJECTED,
          ],
        },
      },
      select: { id: true, reqNumber: true },
    });

    logger.info(`[ReqStatusSync] Found ${requisitions.length} requisitions linked to POs, syncing...`);

    const results: RequisitionSyncResult[] = [];
    for (const req of requisitions) {
      try {
        const result = await this.syncRequisitionStatus(req.id);
        results.push(result);
        if (result.changed) {
          logger.info(`[ReqStatusSync] ${result.reqNumber}: ${result.previousStatus} -> ${result.newStatus} (${result.reason})`);
        }
      } catch (error) {
        logger.error(`[ReqStatusSync] Failed to sync ${req.reqNumber}: ${error instanceof Error ? error.message : String(error)}`);
        results.push({
          requisitionId: req.id,
          reqNumber: req.reqNumber,
          previousStatus: "ERROR",
          newStatus: "ERROR",
          changed: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const changedCount = results.filter((r) => r.changed).length;
    logger.info(`[ReqStatusSync] Sync complete: ${changedCount}/${results.length} requisitions updated`);

    return results;
  }

  /**
   * Update the computed line counters on a requisition.
   * These are denormalized fields for fast queries.
   *
   * @param requisitionId - The requisition to update counters for
   * @param tx - Optional Prisma transaction client for atomic execution (B5-5)
   */
  private async updateRequisitionCounters(requisitionId: string, tx?: PrismaTxClient): Promise<void> {
    const db = this.db(tx);

    const lines = await db.requisitionLine.findMany({
      where: { requisitionId },
      select: { lineStatus: true },
    });

    const counts = {
      totalLines: lines.length,
      pendingLines: lines.filter((l) => l.lineStatus === "PENDING").length,
      approvedLines: lines.filter((l) => l.lineStatus === "APPROVED").length,
      orderedLines: lines.filter((l) => l.lineStatus === "ORDERED").length,
      fulfilledLines: lines.filter(
        (l) => l.lineStatus === "FULFILLED" || l.lineStatus === "PARTIALLY_FULFILLED",
      ).length,
      cancelledLines: lines.filter((l) => l.lineStatus === "CANCELLED").length,
    };

    await db.requisition.update({
      where: { id: requisitionId },
      data: counts,
    });
  }
}

const globalForReqStatusSync = globalThis as unknown as { requisitionStatusSyncService: RequisitionStatusSyncService | undefined };
export const requisitionStatusSyncService = globalForReqStatusSync.requisitionStatusSyncService ?? (globalForReqStatusSync.requisitionStatusSyncService = new RequisitionStatusSyncService());
