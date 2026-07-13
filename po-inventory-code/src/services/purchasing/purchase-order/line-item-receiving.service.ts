/**
 * Line Item Receiving Service
 *
 * Unified receiving service for all line item types:
 * - INVENTORY: Updates inventory stock levels
 * - SERVICE: Records service completion details
 * - CONSUMABLE: Tracks consumable usage
 * - NON_STOCK: Linked to inventory items but does NOT update stock levels
 *
 * All types:
 * - Create POLineReceipt records
 * - Charge budgets on receipt
 * - Support split allocations
 * - Maintain comprehensive audit trail
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { repairableItemHistoryService } from "@/services/repairable-items/repairable-item-history.service";
import { repairableItemNotificationService } from "@/services/repairable-items/repairable-item-notification.service";
import { poGLService } from "@/services/purchasing/po-gl.service";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import { financeSettingsService } from "@/services/finance/finance-settings.service";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { GLEventType, type RuleEvaluationContext } from "@/types/gl-rules";
import { getCurrentBudgetPeriod } from "@/services/gl";
import { Decimal } from "@prisma/client/runtime/library";
import {
  LineItemType,
  RepairableStatus,
  RepairableCondition,
  type PrismaClient,
} from "@prisma/client";
import { generateRepairableTrackingId } from "@/services/inventory/repairable-tracking-id";
import type { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";
import { checkPermission } from "@/services/shared/permissions";
import { inventoryStockService } from "@/services/inventory/stock/inventory-stock.service";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { notificationService } from "@/services/notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { PURCHASING_NOTIFICATIONS } from "@/services/notifications/notification-types-registry";
import {
  type ReceiveInventoryItemDTO,
  type ReceiveServiceItemDTO,
  type ReceiveConsumableItemDTO,
  type ReceiveNonStockItemDTO,
  type ReceiveRepairableReturnItemDTO,
  type BatchReceiveItemsDTO,
  isReceiveInventoryItem,
  isReceiveServiceItem,
  isReceiveConsumableItem,
  isReceiveNonStockItem,
  isReceiveRepairableReturnItem,
  validateBatchReceiveItems,
} from "./line-item.types";

/**
 * Prisma interactive transaction client type
 */
type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * PO Line with relations as loaded in batchReceive (inventoryItem + chargeAllocations)
 */
interface POLineWithRelations {
  id: string;
  purchaseOrderId: string;
  lineType: LineItemType;
  description: string | null;
  quantity: Decimal;
  receivedQuantity: Decimal;
  receivedAmount: Decimal;
  unitPrice: Decimal;
  inventoryItemId: string | null;
  workOrderId: string | null;
  repairableItemId?: string | null;
  canReceive: boolean;
  requiresInvoiceMatch: boolean;
  approvedInvoiceAmount: Decimal | null;
  chargeAllocations: Array<{
    id: string;
    accountCodeId: string | null;
    departmentId: string | null;
    projectId: string | null;
    areaId: string | null;
  }>;
  inventoryItem: {
    id: string;
    sku: string | null;
    isRepairable: boolean;
  } | null;
}

/**
 * Result of receiving a single line item
 */
export interface ReceiveLineItemResult {
  poLineId: string;
  lineType: LineItemType;
  receiptId: string;
  receiptNumber: string;
  quantityReceived: number;
  totalCost: number;
  budgetCharged: boolean;
  budgetTransactionIds: string[];
  /** Serial numbers auto-created for repairable inventory items during this
   *  receipt (empty for non-repairable items). Used for label printing. */
  serialNumbers?: string[];
}

/**
 * Result of batch receiving operation
 */
export interface BatchReceiveResult {
  success: boolean;
  receipts: ReceiveLineItemResult[];
  totalCost: number;
  errors: Array<{
    itemId: string;
    error: string;
  }>;
}

/**
 * Result of reversing/voiding a receipt
 */
export interface VoidReceiptResult {
  receiptId: string;
  receiptNumber: string;
  quantityReversed: number;
  totalCostReversed: number;
  glReversalsAttempted: number;
  glReversalsSucceeded: number;
  inventoryAdjusted: boolean;
  poStatusUpdated: string;
  invoiceUnlinked: boolean;
  invoiceId: string | null;
  invoiceMatchStatusUpdated: string | null;
}

/**
 * Alias for VoidReceiptResult â€” use this with reverseReceipt()
 */
export type ReverseReceiptResult = VoidReceiptResult;

/**
 * Line Item Receiving Service
 *
 * Handles receiving for all line item types with:
 * - Type-specific processing
 * - Budget charging on receipt
 * - Comprehensive audit trail
 * - Transaction safety
 */
class LineItemReceivingService {
  private readonly resource = PermissionResource.PURCHASING;

  /**
   * Receive multiple line items in a batch
   *
   * This is the main entry point for receiving operations.
   * It processes each item according to its type and handles
   * all database operations in a single transaction.
   *
   * DUPLICATE PREVENTION:
   * - Checks for recent duplicate receipts (within 60 seconds)
   * - Supports idempotency keys for exact duplicate detection
   * - Uses transaction locking to prevent race conditions
   *
   * @param ctx - Service context
   * @param poId - Purchase order ID
   * @param input - Batch receive input
   * @param idempotencyKey - Optional idempotency key for duplicate prevention
   * @returns Batch receive result
   */
  async batchReceive(
    ctx: ServiceContext,
    poId: string,
    input: BatchReceiveItemsDTO,
    idempotencyKey?: string,
  ): Promise<BatchReceiveResult> {
    // Log every receiving attempt at the start so we can trace failures
    // even if the operation fails before creating any records
    logger.info(
      `[LineItemReceiving] batchReceive STARTED for PO ${poId} by ${ctx.userName} (${ctx.userId})`,
      {
        poId,
        userId: ctx.userId,
        userName: ctx.userName,
        itemCount: input.items.length,
        idempotencyKey: idempotencyKey ?? null,
        items: input.items.map((i) => ({
          itemId: i.itemId,
          quantityReceived: i.quantityReceived,
        })),
      },
    );

    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(ctx, permission);

    // Validate input
    const validated = validateBatchReceiveItems(input);

    // Extract freight cost information
    const freightCost = validated.freightCost || 0;
    const capitalizeFreight = validated.capitalizeFreight;

    // Verify PO exists and can receive
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: {
          include: {
            inventoryItem: true,
            chargeAllocations: true,
          },
        },
      },
    });

    if (!po) {
      throw new NotFoundError("PurchaseOrder", poId);
    }

    if (!["Ordered", "PartiallyReceived"].includes(po.status)) {
      throw new BadRequestError(
        `Cannot receive items for PO in ${po.status} status. PO must be in Ordered or PartiallyReceived status.`,
      );
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // PRE-VALIDATION PHASE: Validate ALL items can succeed before any writes
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const preValidationErrors = await this.preValidateReceivingBatch(
      ctx,
      po as {
        id: string;
        poNumber: string;
        supplierId: string | null;
        lines: POLineWithRelations[];
      },
      validated.items.map((i) => ({
        itemId: i.itemId,
        quantityReceived: i.quantityReceived,
      })),
    );

    if (preValidationErrors.length > 0) {
      logger.warn(
        `[LineItemReceiving] PRE-VALIDATION FAILED for PO ${po.poNumber}. ` +
          `${preValidationErrors.length} error(s) found. No receipts created.`,
        {
          poId,
          poNumber: po.poNumber,
          userId: ctx.userId,
          userName: ctx.userName,
          errors: preValidationErrors,
        },
      );

      return {
        success: false,
        receipts: [],
        totalCost: 0,
        errors: preValidationErrors,
      };
    }

    logger.info(
      `[LineItemReceiving] GL pre-validation PASSED for PO ${po.poNumber}. ${validated.items.length} items validated. Proceeding to transaction.`,
      { poId, poNumber: po.poNumber, itemCount: validated.items.length },
    );

    // Process all items in a transaction
    // B0-7: Increased timeout to 30s because GL operations now run inside the transaction
    // After pre-validation passes, any error inside the transaction causes full rollback.
    let result: {
      receipts: ReceiveLineItemResult[];
      errors: Array<{ itemId: string; error: string }>;
      totalCost: number;
      newStatus: string;
    };

    try {
      result = await prisma.$transaction(
        async (tx) => {
          const receipts: ReceiveLineItemResult[] = [];
          let totalCost = 0;

          for (const item of validated.items) {
            // Find PO line
            const poLine = po.lines.find((l) => l.id === item.itemId);
            if (!poLine) {
              throw new BadRequestError(
                `Line item ${item.itemId} not found in purchase order`,
              );
            }

            // DUPLICATE PREVENTION: Check for recent duplicate receipts
            // This prevents double-clicks and race conditions
            const oneMinuteAgo = new Date(Date.now() - 60000);
            const recentReceipts = await tx.pOLineReceipt.findMany({
              where: {
                poLineId: poLine.id,
                receivedAt: { gte: oneMinuteAgo },
                quantityReceived: item.quantityReceived,
                status: "ACTIVE", // B5-7: Only check active receipts for duplicates
              },
              orderBy: { receivedAt: "desc" },
              take: 1,
            });

            if (recentReceipts.length > 0 && recentReceipts[0]) {
              const timeDiff =
                Date.now() - recentReceipts[0].receivedAt.getTime();
              throw new BadRequestError(
                `Duplicate receipt detected for line ${item.itemId}. A receipt for this quantity was created ${Math.round(timeDiff / 1000)} seconds ago.`,
              );
            }

            // ══════════════════════════════════════════════════════════════════
            // DRIFT REPAIR: Self-heal POLine.receivedQuantity / receivedAmount
            // from the actual active receipts before running the over-receive
            // check. Historical data has shown cases where reversal sequences
            // left the denormalized receivedQuantity out of sync with the sum
            // of active receipt quantities — this zeroed out remainingQty and
            // blocked legitimate future receives (see mistake registry M-021).
            // Reconciling here on every receive turns the field into a
            // self-healing cache and keeps the receive path working even if a
            // prior write path was buggy.
            // ══════════════════════════════════════════════════════════════════
            if (poLine.lineType === LineItemType.SERVICE) {
              const activeReceipts = await tx.pOLineReceipt.findMany({
                where: {
                  poLineId: poLine.id,
                  status: "ACTIVE",
                  isReturn: false,
                },
                select: { quantityReceived: true, totalCost: true },
              });
              const authoritativeQty = activeReceipts.reduce(
                (s, r) => s.add(new Decimal(r.quantityReceived)),
                new Decimal(0),
              );
              const authoritativeAmt = activeReceipts.reduce(
                (s, r) => s.add(new Decimal(r.totalCost)),
                new Decimal(0),
              );
              const storedQty = new Decimal(poLine.receivedQuantity);
              const storedAmt = new Decimal(poLine.receivedAmount);
              const qtyDrift = !storedQty.equals(authoritativeQty);
              const amtDrift = !storedAmt.equals(authoritativeAmt);
              if (qtyDrift || amtDrift) {
                await tx.pOLine.update({
                  where: { id: poLine.id },
                  data: {
                    receivedQuantity: authoritativeQty,
                    receivedAmount: authoritativeAmt.toNumber(),
                  },
                });
                // Refresh the in-memory poLine so the over-receive check below
                // sees the healed values (poLine came from the outer findUnique).
                poLine.receivedQuantity = authoritativeQty;
                poLine.receivedAmount = authoritativeAmt;
                logger.warn(
                  `[LineItemReceiving] SERVICE line drift repair on ${poLine.id}: ` +
                    `receivedQuantity ${storedQty.toString()}→${authoritativeQty.toString()}, ` +
                    `receivedAmount $${storedAmt.toString()}→$${authoritativeAmt.toString()} ` +
                    `(${activeReceipts.length} active receipt(s))`,
                );
              }
            }

            // Validate quantity based on whether it's a return or receipt
            const currentReceived = new Decimal(poLine.receivedQuantity);
            // Round quantityReceived to 4 decimal places to avoid IEEE 754 floating point artifacts
            // e.g., 1.0 - 0.96 = 0.040000000000000036 in JS, but we want 0.04
            let quantityChange = new Decimal(
              item.quantityReceived,
            ).toDecimalPlaces(6);
            let newReceived = currentReceived.add(quantityChange);
            const ordered = new Decimal(poLine.quantity);

            const isReturn = item.quantityReceived < 0;

            if (isReturn) {
              // For returns: ensure we don't return more than received
              if (newReceived.lessThan(0)) {
                throw new BadRequestError(
                  `Cannot return more than received for line ${item.itemId}. Already received: ${currentReceived.toString()}, Attempting to return: ${Math.abs(item.quantityReceived)}`,
                );
              }
            } else {
              // For receipts: use tolerance for over-receive check
              // This prevents rejection due to floating point artifacts like 1.000000000000000036 > 1.0
              const RECEIVE_TOLERANCE = new Decimal("0.000001");
              if (newReceived.minus(ordered).greaterThan(RECEIVE_TOLERANCE)) {
                // For SERVICE lines (dollar-mode: quantity = ordered dollars, unitPrice = $1),
                // "ordered" and "current" are dollar amounts, so produce a dollar-friendly message.
                const isServiceDollarMode =
                  poLine.lineType === LineItemType.SERVICE &&
                  new Decimal(poLine.unitPrice).equals(1);
                if (isServiceDollarMode) {
                  const orderedDollars = ordered.toDecimalPlaces(2);
                  const receivedDollars = currentReceived.toDecimalPlaces(2);
                  const remainingDollars =
                    orderedDollars.minus(receivedDollars);
                  const attemptingDollars = new Decimal(
                    item.quantityReceived,
                  ).toDecimalPlaces(2);
                  throw new BadRequestError(
                    `This invoice ($${attemptingDollars}) exceeds the remaining balance on this PO line. ` +
                      `PO line total: $${orderedDollars} — Already received: $${receivedDollars} — ` +
                      `Remaining: $${remainingDollars}. ` +
                      `To receive this invoice the PO needs to be updated to cover the additional amount.`,
                  );
                }
                throw new BadRequestError(
                  `Cannot receive more than ordered quantity for line ${item.itemId}. Ordered: ${ordered.toString()}, Already received: ${currentReceived.toString()}, Attempting: ${item.quantityReceived}`,
                );
              }

              // If newReceived is within tolerance but slightly over, clamp it to ordered
              if (newReceived.greaterThan(ordered)) {
                // Adjust quantityChange so total equals exactly ordered
                quantityChange = ordered.minus(currentReceived);
                newReceived = ordered;
              }
            }

            // Process based on line type
            let receiptResult: ReceiveLineItemResult;

            switch (poLine.lineType) {
              case LineItemType.INVENTORY:
                if (!isReceiveInventoryItem(item)) {
                  throw new BadRequestError(
                    `Invalid receive data for INVENTORY line type on item ${item.itemId}`,
                  );
                }
                receiptResult = await this.receiveInventoryItem(
                  ctx,
                  tx,
                  poLine,
                  item,
                  freightCost,
                  capitalizeFreight,
                  idempotencyKey,
                  undefined, // adminOverride
                  po.poNumber, // poNumber â€” passed through to serial provenance notes
                );
                break;

              case LineItemType.SERVICE:
                if (!isReceiveServiceItem(item)) {
                  throw new BadRequestError(
                    `Invalid receive data for SERVICE line type on item ${item.itemId}`,
                  );
                }
                receiptResult = await this.receiveServiceItem(
                  ctx,
                  tx,
                  poLine,
                  item,
                  idempotencyKey,
                );
                break;

              case LineItemType.CONSUMABLE:
                if (!isReceiveConsumableItem(item)) {
                  throw new BadRequestError(
                    `Invalid receive data for CONSUMABLE line type on item ${item.itemId}`,
                  );
                }
                receiptResult = await this.receiveConsumableItem(
                  ctx,
                  tx,
                  poLine,
                  item,
                  idempotencyKey,
                );
                break;

              case LineItemType.NON_STOCK:
                if (!isReceiveNonStockItem(item)) {
                  throw new BadRequestError(
                    `Invalid receive data for NON_STOCK line type on item ${item.itemId}`,
                  );
                }
                receiptResult = await this.receiveNonStockItem(
                  ctx,
                  tx,
                  poLine,
                  item,
                  idempotencyKey,
                );
                break;

              case LineItemType.REPAIRABLE_RETURN:
                if (!isReceiveRepairableReturnItem(item)) {
                  throw new BadRequestError(
                    `Invalid receive data for REPAIRABLE_RETURN line type on item ${item.itemId}`,
                  );
                }
                receiptResult = await this.receiveRepairableReturnItem(
                  ctx,
                  tx,
                  poLine,
                  item,
                  idempotencyKey,
                  po.poNumber,
                );
                break;

              default:
                throw new BadRequestError(
                  `Unknown line type: ${poLine.lineType} on item ${item.itemId}`,
                );
            }

            receipts.push(receiptResult);
            totalCost += receiptResult.totalCost;

            // B2-4: Update PO line received quantity and dollar amount for ALL line types
            // Previously only SERVICE lines tracked receivedAmount â€” now all types do
            const currentReceivedAmount = new Decimal(poLine.receivedAmount);
            const receiptAmount = new Decimal(receiptResult.totalCost);
            const newReceivedAmount = currentReceivedAmount.add(receiptAmount);

            const updateData: {
              receivedQuantity: typeof newReceived;
              receivedAmount: number;
            } = {
              receivedQuantity: newReceived,
              receivedAmount: newReceivedAmount.toNumber(),
            };

            await tx.pOLine.update({
              where: { id: item.itemId },
              data: updateData,
            });
          }

          // Update PO status based on received quantities
          const updatedLines = await tx.pOLine.findMany({
            where: { purchaseOrderId: poId },
            select: {
              quantity: true,
              receivedQuantity: true,
            },
          });

          const allFullyReceived = updatedLines.every((line) =>
            new Decimal(line.receivedQuantity).greaterThanOrEqualTo(
              new Decimal(line.quantity),
            ),
          );

          const anyReceived = updatedLines.some((line) =>
            new Decimal(line.receivedQuantity).greaterThan(0),
          );

          let newStatus = po.status;
          if (allFullyReceived) {
            newStatus = "Received";
          } else if (anyReceived) {
            newStatus = "PartiallyReceived";
          }

          if (newStatus !== po.status) {
            await tx.purchaseOrder.update({
              where: { id: poId },
              data: {
                status: newStatus,
                receivedDate: newStatus === "Received" ? new Date() : null,
              },
            });

            // AUTOMATIC STATUS SYNC: If PO is fully received, sync any linked repair requisitions
            if (newStatus === "Received" && po.requisitionIds.length > 0) {
              // Check each linked requisition to see if it's a repair requisition.
              // Uses the legacy path only: isRepairRequisition=true on the header.
              // (workOrderId does not exist as a scalar field on Requisition —
              //  the "new path" via workOrderId was removed to fix a runtime 500.)
              for (const reqId of po.requisitionIds) {
                const reqRow = await tx.requisition.findUnique({
                  where: { id: reqId },
                  select: {
                    id: true,
                    isRepairRequisition: true,
                    repairableItemId: true,
                  },
                });
                if (!reqRow) continue;

                // Resolve the repairable item ID from the legacy path
                const resolvedRepairableItemId: string | null =
                  reqRow.isRepairRequisition
                    ? (reqRow.repairableItemId ?? null)
                    : null;

                if (resolvedRepairableItemId) {
                  const requisition = {
                    repairableItemId: resolvedRepairableItemId,
                  };

                  // Guard: if any PO line is REPAIRABLE_RETURN and references this serial,
                  // receiveRepairableReturnItem() already completed the repair and returned
                  // the item to inventory atomically. Only mark the REQ as Received —
                  // skip the legacy REPAIR_COMPLETE path to avoid overwriting AVAILABLE → REPAIR_COMPLETE.
                  const handledByNewPath = po.lines.some(
                    (l) =>
                      l.lineType === LineItemType.REPAIRABLE_RETURN &&
                      l.repairableItemId === resolvedRepairableItemId,
                  );
                  if (handledByNewPath) {
                    try {
                      await tx.requisition.update({
                        where: { id: reqId },
                        data: { status: "Received" },
                      });
                    } catch (_e) {
                      /* non-fatal */
                    }
                    continue;
                  }

                  try {
                    // Update requisition status to "Received" first
                    await tx.requisition.update({
                      where: { id: reqId },
                      data: { status: "Received" },
                    });

                    // Find the associated repair history record
                    // Include REQUISITION_CREATED status for external repairs that go straight to PO

                    const repairHistory = await tx.repairHistory.findFirst({
                      where: {
                        repairableItemId: requisition.repairableItemId,
                        requisitionId: reqId,
                        repairStatus: {
                          in: [
                            "REQUISITION_CREATED",
                            "IN_PROGRESS",
                            "AWAITING_PARTS",
                          ],
                        },
                      },
                      orderBy: { initiatedDate: "desc" },
                    });

                    if (repairHistory) {
                      // Calculate total cost from PO lines
                      const poLines = await tx.pOLine.findMany({
                        where: { purchaseOrderId: poId },
                        select: {
                          unitPrice: true,
                          quantity: true,
                        },
                      });

                      const totalCost = poLines.reduce((sum, line) => {
                        const lineCost =
                          Number(line.unitPrice) * Number(line.quantity);
                        return sum + lineCost;
                      }, 0);

                      // Complete the repair directly in the transaction
                      // We can't use the service method because it creates its own transaction
                      // and would read stale data
                      const completedDate = new Date();

                      // Use conditionAfter from the repair history if already set
                      // (e.g. IM manually completed it). Otherwise leave it null —
                      // the IM sets the actual condition when returning to inventory.
                      // Never hardcode GOOD: the condition depends on what the vendor returned.
                      const conditionAfterRepair =
                        repairHistory.conditionAfter ?? null;

                      await tx.repairHistory.update({
                        where: { id: repairHistory.id },
                        data: {
                          repairStatus: "COMPLETED",
                          actualStartDate:
                            repairHistory.actualStartDate ?? completedDate,
                          completedDate,
                          actualCost: totalCost,
                          repairDescription: `External repair completed via PO ${po.poNumber}. Condition to be confirmed by IM on return to inventory.`,
                          ...(conditionAfterRepair
                            ? { conditionAfter: conditionAfterRepair }
                            : {}),
                        },
                      });

                      // Update repairable item with repair statistics.
                      // Do NOT set condition here — the IM sets the actual condition
                      // when they return the item to inventory via CompleteRepairDialog.
                      await tx.repairableItem.update({
                        where: { id: requisition.repairableItemId },
                        data: {
                          status: "REPAIR_COMPLETE",
                          lastRepairDate: completedDate,
                          repairCount: { increment: 1 },
                          totalRepairCost: { increment: totalCost },
                        },
                      });

                      // Advance the repair WO workflow status to REPAIR_COMPLETE so the
                      // WO page reflects the correct state immediately after PO receive.
                      if (repairHistory.workOrderId) {
                        await tx.workOrder.updateMany({
                          where: {
                            id: repairHistory.workOrderId,
                            repairWorkflowStatus: { not: null },
                          },
                          data: { repairWorkflowStatus: "REPAIR_COMPLETE" },
                        });
                      }

                      // Write REPAIR_COMPLETED history event.
                      // Uses global prisma (not tx) — runs as a separate statement,
                      // which is acceptable for an audit log.
                      try {
                        await repairableItemHistoryService.logRepairCompleted(
                          ctx,
                          requisition.repairableItemId,
                          repairHistory.id,
                          `External repair completed via PO ${po.poNumber}. ` +
                            `Cost: $${totalCost.toFixed(2)}. Part received back — return to inventory to restore stock.`,
                        );
                        // Also log the status change for visibility in the timeline
                        await repairableItemHistoryService.logStatusChange(
                          ctx,
                          {
                            repairableItemId: requisition.repairableItemId,
                            eventType: "STATUS_CHANGED" as const,
                            previousStatus: "IN_REPAIR_EXTERNAL",
                            newStatus: "REPAIR_COMPLETE",
                            notes: `PO ${po.poNumber} fully received. Part is back — IM to return to inventory.`,
                          },
                        );
                      } catch (_historyError) {
                        // History failure must not block receiving
                      }
                    } else {
                      // Fallback: Just update the repairable item status if no repair history found
                      await tx.repairableItem.update({
                        where: { id: requisition.repairableItemId },
                        data: {
                          status: "REPAIR_COMPLETE",
                          currentLocation: "Receiving",
                        },
                      });
                      // Log fallback status change
                      try {
                        await repairableItemHistoryService.logStatusChange(
                          ctx,
                          {
                            repairableItemId: requisition.repairableItemId,
                            eventType: "STATUS_CHANGED" as const,
                            previousStatus: "IN_REPAIR_EXTERNAL",
                            newStatus: "REPAIR_COMPLETE",
                            notes: `PO ${po.poNumber} fully received. No repair history found — status updated. IM to verify and return to inventory.`,
                          },
                        );
                      } catch (_historyError) {
                        // Non-fatal
                      }
                    }

                    // Notify all IMs that the part is back and ready to return to inventory.
                    // Uses global prisma (outside tx) — acceptable for notifications.
                    try {
                      // Fetch the repairable item to get serial number and inventory item SKU
                      const repItemForNotif =
                        await prisma.repairableItem.findUnique({
                          where: { id: requisition.repairableItemId },
                          select: {
                            id: true,
                            serialNumber: true,
                            inventoryItem: {
                              select: { sku: true, description: true },
                            },
                          },
                        });
                      // Get supplier name from the repair history if available
                      const supplierForNotif = repairHistory?.supplierId
                        ? await prisma.supplier.findUnique({
                            where: { id: repairHistory.supplierId },
                            select: { name: true },
                          })
                        : null;

                      if (repItemForNotif) {
                        await repairableItemNotificationService.notifyRepairCompleteReturnRequired(
                          ctx,
                          {
                            repairableItemId: repItemForNotif.id,
                            serialNumber: repItemForNotif.serialNumber,
                            inventoryItemSku: repItemForNotif.inventoryItem.sku,
                            inventoryItemDescription:
                              repItemForNotif.inventoryItem.description,
                            initiatedByUserId:
                              repairHistory != null
                                ? repairHistory.initiatedBy
                                : null,
                            actualCost: totalCost,
                            poNumber: po.poNumber,
                            supplierName: supplierForNotif?.name,
                          },
                        );
                      }
                    } catch (_notifError) {
                      // Non-fatal
                    }

                    // No need to call syncRequisitionStatus - we've already updated everything we need
                  } catch (_error) {
                    // Log error but don't fail the entire receiving operation
                  }
                }
              }
            }
          }

          return {
            receipts,
            errors: [] as Array<{ itemId: string; error: string }>,
            totalCost,
            newStatus,
          };
        },
        { timeout: 30000 },
      );
    } catch (txError) {
      // Transaction failed â€” ALL changes are rolled back by Prisma.
      // Convert the error into a BatchReceiveResult so callers get a structured response.
      const errorMessage =
        txError instanceof Error
          ? txError.message
          : "Unknown transaction error";
      logger.error(
        `[LineItemReceiving] TRANSACTION FAILED for PO ${po.poNumber}. ` +
          `All receipts rolled back. Error: ${errorMessage}`,
        {
          poId,
          poNumber: po.poNumber,
          userId: ctx.userId,
          userName: ctx.userName,
          error: errorMessage,
          stack: txError instanceof Error ? txError.stack : undefined,
        },
      );

      return {
        success: false,
        receipts: [],
        totalCost: 0,
        errors: [{ itemId: "TRANSACTION", error: errorMessage }],
      };
    }

    // â”€â”€â”€ Comprehensive Audit Logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Log the overall batch receive operation on the PO.
    // Use AuditAction.RECEIVE (not UPDATE) so the History tab renders this as
    // a green "Items Received" entry rather than an amber "Updated" entry.
    await auditLogService.logCrudOperation(
      ctx,
      AuditAction.RECEIVE,
      "PurchaseOrder",
      poId,
      po.poNumber,
      { status: po.status },
      {
        action: "BATCH_RECEIVE",
        newStatus: result.newStatus,
        receiptsCreated: result.receipts.length,
        totalCost: result.totalCost,
        errorsCount: result.errors.length,
        errors: result.errors,
        receipts: result.receipts.map((r) => ({
          receiptId: r.receiptId,
          receiptNumber: r.receiptNumber,
          poLineId: r.poLineId,
          lineType: r.lineType,
          quantityReceived: r.quantityReceived,
          totalCost: r.totalCost,
          budgetCharged: r.budgetCharged,
        })),
      },
    );

    // Log each individual receipt creation for granular traceability
    // This ensures every POLineReceipt has a corresponding audit log entry
    // so we can always answer "who received what, when, and on which PO line"
    for (const receipt of result.receipts) {
      const poLine = po.lines.find((l) => l.id === receipt.poLineId);
      await auditLogService.logCrudOperation(
        ctx,
        AuditAction.CREATE,
        "POLineReceipt",
        receipt.receiptId,
        receipt.receiptNumber,
        {},
        {
          receiptNumber: receipt.receiptNumber,
          poId,
          poNumber: po.poNumber,
          poLineId: receipt.poLineId,
          lineDescription: poLine?.description ?? "Unknown",
          lineType: receipt.lineType,
          inventoryItemId: poLine?.inventoryItemId ?? null,
          inventoryItemSku: poLine?.inventoryItem?.sku ?? null,
          quantityReceived: receipt.quantityReceived,
          totalCost: receipt.totalCost,
          budgetCharged: receipt.budgetCharged,
          budgetTransactionIds: receipt.budgetTransactionIds,
          receivedByUserId: ctx.userId,
          receivedByName: ctx.userName,
        },
      );
    }

    // B3-8: Receipt created notifications â€” notify PO creator for each receipt
    for (const receipt of result.receipts) {
      try {
        const poLine = po.lines.find((l) => l.id === receipt.poLineId);
        await notificationService.sendNotification(ctx, {
          userId: po.createdBy ?? ctx.userId,
          type: PURCHASING_NOTIFICATIONS.RECEIPT_CREATED.type,
          category: NotificationCategory.PURCHASING,
          title: `Receipt ${receipt.receiptNumber} Created`,
          message: `Receipt ${receipt.receiptNumber} created for PO ${po.poNumber} â€” ${poLine?.description ?? "Line item"}.`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/purchase-orders/${po.id}`,
          actionLabel: "View Purchase Order",
          data: {
            poNumber: po.poNumber,
            poId: po.id,
            receiptId: receipt.receiptId,
            lineDescription: poLine?.description ?? "Unknown",
          },
        });
      } catch (notifError) {
        logger.error(
          "[B3-8] Failed to send receipt created notification",
          notifError,
        );
      }
    }

    // Log any errors that occurred during receiving so they're traceable
    if (result.errors.length > 0) {
      logger.warn(
        `[LineItemReceiving] batchReceive completed with ${result.errors.length} error(s) for PO ${po.poNumber}`,
        {
          poId,
          poNumber: po.poNumber,
          userId: ctx.userId,
          userName: ctx.userName,
          errors: result.errors,
          receiptsCreated: result.receipts.length,
        },
      );
    }

    // Auto-close is handled exclusively by the 90-day inactivity cron job (po-auto-close.ts).
    // Event-driven auto-close was removed because it was closing POs immediately on receive,
    // preventing re-receiving and re-invoicing at corrected pricing.

    // B3-9: PO receiving status notifications â€” wire PO_RECEIVED and PO_PARTIALLY_RECEIVED
    if (result.newStatus !== po.status) {
      if (result.newStatus === "Received") {
        try {
          await notificationService.sendNotification(ctx, {
            userId: po.createdBy ?? ctx.userId,
            type: PURCHASING_NOTIFICATIONS.PO_RECEIVED.type,
            category: NotificationCategory.PURCHASING,
            title: `PO ${po.poNumber} Fully Received`,
            message: `All items on purchase order ${po.poNumber} have been received.`,
            priority: NotificationPriority.NORMAL,
            actionUrl: `/purchasing/purchase-orders/${po.id}`,
            actionLabel: "View Purchase Order",
            data: { poNumber: po.poNumber, poId: po.id },
          });
        } catch (notifError) {
          logger.error(
            "[B3-9] Failed to send PO received notification",
            notifError,
          );
        }
      } else if (result.newStatus === "PartiallyReceived") {
        try {
          await notificationService.sendNotification(ctx, {
            userId: po.createdBy ?? ctx.userId,
            type: PURCHASING_NOTIFICATIONS.PO_PARTIALLY_RECEIVED.type,
            category: NotificationCategory.PURCHASING,
            title: `PO ${po.poNumber} Partially Received`,
            message: `Some items on purchase order ${po.poNumber} have been received.`,
            priority: NotificationPriority.NORMAL,
            actionUrl: `/purchasing/purchase-orders/${po.id}`,
            actionLabel: "View Purchase Order",
            data: { poNumber: po.poNumber, poId: po.id },
          });
        } catch (notifError) {
          logger.error(
            "[B3-9] Failed to send PO partially received notification",
            notifError,
          );
        }
      }
    }

    const finalResult = {
      success: result.errors.length === 0,
      receipts: result.receipts,
      totalCost: result.totalCost,
      errors: result.errors,
    };

    return finalResult;
  }

  /**
   * Resolve an optional invoiceId for non-SERVICE line types.
   *
   * When the frontend explicitly passes an `invoiceId`, validate that the
   * invoice exists, belongs to this PO, and has been approved.  Returns the
   * validated id + minimal invoice info, or null when no invoice was
   * supplied (preserving existing behaviour where no invoice link is set).
   *
   * This is intentionally extracted so INVENTORY, CONSUMABLE and NON_STOCK
   * receive methods can share the same logic without duplicating the
   * validation that already exists in `receiveServiceItem`.
   *
   * @private
   */
  private async resolveOptionalInvoiceId(
    ctx: ServiceContext,
    tx: PrismaTx,
    poLine: POLineWithRelations,
    invoiceId: string | null | undefined,
    lineTypeLabel: string,
  ): Promise<{
    linkedInvoiceId: string | null;
    invoiceNumber: string | null;
    invoiceDate: Date | null;
  }> {
    if (!invoiceId) {
      return { linkedInvoiceId: null, invoiceNumber: null, invoiceDate: null };
    }

    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        approvalStatus: true,
        purchaseOrderId: true,
      },
    });

    if (!invoice) {
      throw new BadRequestError(
        `Selected invoice not found (ID: ${invoiceId}) for ${lineTypeLabel} line. Please select a valid invoice.`,
      );
    }

    if (invoice.purchaseOrderId !== poLine.purchaseOrderId) {
      throw new BadRequestError(
        `Selected invoice ${invoice.invoiceNumber} does not belong to this purchase order.`,
      );
    }

    const approvedStatuses = ["REQUESTOR_APPROVED", "FULLY_APPROVED"];
    if (!approvedStatuses.includes(invoice.approvalStatus)) {
      throw new BadRequestError(
        `Selected invoice ${invoice.invoiceNumber} is not approved (status: ${invoice.approvalStatus}). ` +
          `Only approved invoices can be used for receiving.`,
      );
    }

    // DUPLICATE INVOICE RECEIVING PREVENTION: Check if THIS SPECIFIC PO LINE already
    // has an active (non-reversed, non-voided, non-return) receipt linked to this invoice.
    //
    // Scoped to poLineId -- NOT the entire invoice -- because when a full-PO invoice is
    // used and only SOME lines were reversed, the other lines' active receipts must not
    // block re-receiving on the reversed line.  Each PO line may only have one active
    // receipt per invoice, but different lines sharing the same invoice are allowed.
    const existingActiveReceipts = await tx.pOLineReceipt.count({
      where: {
        invoiceId: invoiceId,
        poLineId: poLine.id, // <- scoped to this PO line only
        status: "ACTIVE",
        isReturn: false,
      },
    });

    if (existingActiveReceipts > 0) {
      throw new BadRequestError(
        `Invoice ${invoice.invoiceNumber} has already been received for this line ` +
          `(${existingActiveReceipts} active receipt(s) exist on this line). ` +
          `If the previous receipt was incorrect, reverse it first before creating a new receipt.`,
      );
    }

    logger.info(
      `[LineItemReceiving] User explicitly selected invoice ${invoice.invoiceNumber} (${invoice.id}) ` +
        `for ${lineTypeLabel} receipt on PO line ${poLine.id}`,
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        poLineId: poLine.id,
        selectedBy: ctx.userName,
      },
    );

    return {
      linkedInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
    };
  }

  /**
   * Receive an INVENTORY line item
   *
   * Process:
   * 1. Create POLineReceipt record
   * 2. Update inventory stock via inventoryStockService
   * 3. Create GL transaction via POGLService (handles budget tracking)
   * 4. Handle freight costs if provided
   *
   * @private
   */
  private async receiveInventoryItem(
    ctx: ServiceContext,
    tx: PrismaTx,
    poLine: POLineWithRelations,
    item: ReceiveInventoryItemDTO,
    freightCost: number = 0,
    capitalizeFreight: boolean = true,
    idempotencyKey?: string,
    adminOverride?: boolean,
    poNumber?: string,
  ): Promise<ReceiveLineItemResult> {
    // B2-2: Server-side over-receive validation
    const orderedQty = Number(poLine.quantity);
    const currentReceivedQty = Number(poLine.receivedQuantity);
    const newQty = Number(item.quantityReceived);
    const OVER_RECEIVE_TOLERANCE = 1.1; // 10% over is allowed

    if (
      orderedQty > 0 &&
      currentReceivedQty + newQty > orderedQty * OVER_RECEIVE_TOLERANCE
    ) {
      // Check for admin override flag
      if (!adminOverride) {
        throw new BadRequestError(
          `Cannot receive ${newQty} units â€” this would exceed the ordered quantity of ${orderedQty} ` +
            `(already received: ${currentReceivedQty}). Maximum receivable: ${orderedQty * OVER_RECEIVE_TOLERANCE - currentReceivedQty}. ` +
            `An administrator can override this limit.`,
        );
      }
      logger.warn(
        `[B2-2] Admin override: Over-receiving on PO line ${poLine.id}. ` +
          `Ordered: ${orderedQty}, Previously received: ${currentReceivedQty}, New: ${newQty}`,
      );
    }

    const unitCost = new Decimal(poLine.unitPrice);
    const totalCost = unitCost.mul(item.quantityReceived);

    // Generate receipt number
    const receiptNumber = await this.generateReceiptNumber(tx, "RCPT");

    // Determine if this is a return (negative quantity)
    const isReturn = item.quantityReceived < 0;

    // Serials auto-created for repairable items below; returned for label printing.
    const createdSerialNumbers: string[] = [];

    // Append idempotency key to notes for tracking
    const notesWithIdempotency = idempotencyKey
      ? `${item.notes ?? ""}${item.notes ? " " : ""}[IDEMPOTENCY:${idempotencyKey}]`
      : item.notes;

    // Resolve optional invoice selection for INVENTORY items
    const invoiceResolution = await this.resolveOptionalInvoiceId(
      ctx,
      tx,
      poLine,
      item.invoiceId,
      "INVENTORY",
    );

    // Create POLineReceipt with proper columns (NO metadata)
    const receipt = await tx.pOLineReceipt.create({
      data: {
        poLineId: poLine.id,
        receiptNumber,
        quantityReceived: item.quantityReceived,
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        receivedBy: item.receivedBy,
        receivedByName: item.receivedByName,
        receivedAt: item.receivedAt ?? new Date(),
        invoiceNumber: invoiceResolution.invoiceNumber ?? item.invoiceNumber,
        invoiceDate: invoiceResolution.invoiceDate ?? item.invoiceDate,
        invoiceId: invoiceResolution.linkedInvoiceId,
        notes: notesWithIdempotency,
        // INVENTORY-specific fields
        storeId: item.storeId,
        bin: item.bin || "MAIN",
        lotNumber: item.lotNumber,
        serialNumbers: item.serialNumbers,
        // NEW: Document tracking and return fields
        documentNumber: item.documentNumber,
        isReturn: isReturn,
        originalReceiptId: item.originalReceiptId,
      },
    });

    // Log POLineReceipt creation immediately so we can detect partial failures.
    // Since this runs inside a Prisma transaction, if inventory update fails below,
    // the transaction rolls back and this receipt is never committed.
    // This log entry lets us trace exactly what was attempted.
    logger.info(
      `[LineItemReceiving] POLineReceipt created in tx: ${receipt.id} (${receiptNumber}) ` +
        `for PO line ${poLine.id} | qty=${item.quantityReceived} | cost=$${totalCost.toFixed(6)} | ` +
        `by=${item.receivedByName} | store=${item.storeId} | bin=${item.bin} | ` +
        `doc=${item.documentNumber ?? "N/A"} | isReturn=${isReturn}`,
      {
        receiptId: receipt.id,
        receiptNumber,
        poLineId: poLine.id,
        purchaseOrderId: poLine.purchaseOrderId,
        inventoryItemId: poLine.inventoryItemId,
        quantityReceived: item.quantityReceived,
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        storeId: item.storeId,
        bin: item.bin,
        documentNumber: item.documentNumber,
        isReturn,
      },
    );

    // Update inventory stock (handle both receipts and returns)
    // NOTE: Repair POs also increment inventory here because the item WAS decremented
    // via direct issue when it was originally sent for repair.
    if (poLine.inventoryItemId) {
      if (isReturn) {
        // For returns, we need to decrement inventory
        const stockResult = await inventoryStockService.adjust(
          poLine.inventoryItemId,
          item.storeId,
          0, // Will be calculated based on current stock
          {
            context: ctx,
            reason: "CORRECTION",
            userId: item.receivedBy,
            userName: item.receivedByName,
            notes: `PO Return/Correction: ${item.notes ?? "No notes"}. Doc: ${item.documentNumber ?? "N/A"}`,
          },
        );

        if (!stockResult.success) {
          throw new BadRequestError(
            `Failed to update inventory stock for return: ${stockResult.error}`,
          );
        }

        // Get current stock and adjust by the return amount
        const currentStock = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: poLine.inventoryItemId,
              storeId: item.storeId,
              bin: item.bin || "MAIN",
            },
          },
        });

        if (currentStock) {
          const currentQty = Number(currentStock.quantityOnHand);
          const returnQty = Math.abs(item.quantityReceived);
          const newQty = Math.max(0, currentQty - returnQty);

          await tx.inventoryStock.update({
            where: {
              inventoryItemId_storeId_bin: {
                inventoryItemId: poLine.inventoryItemId,
                storeId: item.storeId,
                bin: item.bin || "MAIN",
              },
            },
            data: {
              quantityOnHand: newQty,
            },
          });
        }
      } else {
        // Normal receipt - increment inventory
        const stockResult = await inventoryStockService.receive(
          poLine.inventoryItemId,
          item.quantityReceived,
          {
            context: ctx,
            storeId: item.storeId,
            bin: item.bin || "MAIN",
            purchaseOrderId: poLine.purchaseOrderId,
            purchaseOrderNumber: poNumber, // Serial provenance: record PO number in notes
            referenceType: "PurchaseOrder", // Serial provenance: mark this as a PO receive
            userId: item.receivedBy,
            userName: item.receivedByName,
            notes: `${item.notes ?? ""}. Doc: ${item.documentNumber ?? "N/A"}`,
            unitCost: unitCost.toNumber(),
            // Serials for repairable items are created by THIS service's own loop
            // below (with purchaseCost). Without this flag inventoryStockService
            // .receive() would ALSO auto-generate serials → 2 serials per unit
            // received (double-serialization). The receive still increments
            // quantityOnHand; it just must not create serials here.
            skipSerialGeneration: true,
          },
        );

        if (!stockResult.success) {
          throw new BadRequestError(
            `Failed to update inventory stock: ${stockResult.error}`,
          );
        }

        // Decrement quantityCommitted: goods have arrived, so on-order units are no longer "committed"
        // Only decrement if this PO line was created from a REQ that had a WO budget header
        try {
          const poLineData = await tx.pOLine.findUnique({
            where: { id: poLine.id },
            select: { requisitionLineId: true },
          });

          if (poLineData?.requisitionLineId && poLine.inventoryItemId) {
            // Check if the REQ that owns this line has a WO budget header
            const reqLine = await tx.requisitionLine.findUnique({
              where: { id: poLineData.requisitionLineId },
              select: {
                requisition: {
                  select: {
                    budgetHeader: { select: { workOrderId: true } },
                  },
                },
              },
            });

            const hasWOLink = !!reqLine?.requisition.budgetHeader?.workOrderId;
            if (hasWOLink) {
              await inventoryStockService.decrementCommitted(
                poLine.inventoryItemId,
                item.quantityReceived,
              );
              logger.info(
                `[LineItemReceiving] quantityCommitted decremented by ${item.quantityReceived} for item ${poLine.inventoryItemId} ` +
                  `(PO line ${poLine.id} linked to WO-backed REQ)`,
              );
            }
          }
        } catch (commitErr) {
          // Non-fatal: log but don't fail the receipt
          logger.warn(
            `[LineItemReceiving] Failed to decrement quantityCommitted for item ${poLine.inventoryItemId}: ` +
              `${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
          );
        }

        // ── Create RepairableItem serials for repairable inventory ────────────
        // When receiving a PO line for an item marked isRepairable=true, create
        // one RepairableItem record per unit so every physical part has a serial
        // number and can be tracked through the repair workflow.
        //
        // Serial format: REP-{SKU}-{N} (next sequential, auto-generated).
        // IMPORTANT: tx is passed to generateRepairableTrackingId (not global prisma)
        // so that iteration N+1 can see the serial created by iteration N in the
        // same transaction. Using global prisma here causes P2002 on qty > 1.
        if (poLine.inventoryItemId && poLine.inventoryItem?.isRepairable) {
          const unitCount = Math.floor(Math.abs(item.quantityReceived));

          // Reuse serials preserved from a prior REVERSED receipt on THIS line
          // (price / packing-slip correction → reverse → re-receive). Reusing keeps
          // the original serial number instead of minting a new one. Only AVAILABLE
          // serials whose source receipt was reversed on this exact line qualify.
          const reusableSerials = await tx.repairableItem.findMany({
            where: {
              inventoryItemId: poLine.inventoryItemId,
              status: RepairableStatus.AVAILABLE,
              sourcePOLineReceipt: {
                poLineId: poLine.id,
                status: "REVERSED",
              },
            },
            orderBy: { createdAt: "desc" },
            take: unitCount,
            select: { id: true, serialNumber: true },
          });

          for (let i = 0; i < unitCount; i++) {
            const reuse = reusableSerials[i];
            if (reuse) {
              // Re-link the preserved serial to this new receipt and update its
              // purchase cost to the corrected price. The serial NUMBER is kept.
              await tx.repairableItem.update({
                where: { id: reuse.id },
                data: {
                  status: RepairableStatus.AVAILABLE,
                  currentLocation: item.bin || "MAIN",
                  purchaseCost: unitCost.toDecimalPlaces(2),
                  lastModifiedBy: item.receivedBy,
                  sourcePOLineReceiptId: receipt.id,
                },
              });
              createdSerialNumbers.push(reuse.serialNumber);
              logger.info(
                `[LineItemReceiving] RepairableItem ${reuse.serialNumber} (id=${reuse.id}) REUSED ` +
                  `on re-receive of PO ${poNumber ?? poLine.purchaseOrderId} ` +
                  `(serial number preserved after reversal).`,
              );
              try {
                await repairableItemHistoryService.logCreated(
                  ctx,
                  reuse.id,
                  `Serial ${reuse.serialNumber} re-received on PO ${poNumber ?? ""} ` +
                    `after reversal. Unit cost: $${unitCost.toFixed(2)}.`,
                );
              } catch {
                /* non-fatal — audit gap better than blocking receipt */
              }
              continue;
            }

            // No reusable serial — mint a new one (original behavior).
            const serial: string = await generateRepairableTrackingId(
              // Use tx (not global prisma) so that the sequence reads inside the
              // generator can see serials created earlier in this same loop.
              // Without this, iteration 2 of qty=3 reads stale committed data
              // and tries to create the same serial number as iteration 1
              // → P2002 unique constraint violation.
              tx,
              poLine.inventoryItemId,
            );
            const newSerial = await tx.repairableItem.create({
              data: {
                serialNumber: serial,
                inventoryItemId: poLine.inventoryItemId,
                condition: RepairableCondition.NEW,
                status: RepairableStatus.AVAILABLE,
                currentLocation: item.bin || "MAIN",
                purchaseCost: unitCost.toDecimalPlaces(2),
                createdBy: item.receivedBy,
                lastModifiedBy: item.receivedBy,
                isAutoGenerated: true,
                // Link the serial to the receipt that created it so reversing
                // that receipt can remove exactly these serials (no orphans).
                sourcePOLineReceiptId: receipt.id,
              },
            });
            // Collect the serial so it can be returned for label printing.
            createdSerialNumbers.push(serial);
            logger.info(
              `[LineItemReceiving] RepairableItem ${serial} (id=${newSerial.id}) created ` +
                `for PO ${poNumber ?? poLine.purchaseOrderId} receive ` +
                `(inventoryItemId=${poLine.inventoryItemId})`,
            );
            // Non-fatal audit trail
            try {
              await repairableItemHistoryService.logCreated(
                ctx,
                newSerial.id,
                `Serial ${serial} auto-created on PO ${poNumber ?? ""} receipt. ` +
                  `Unit cost: $${unitCost.toFixed(2)}.`,
              );
            } catch {
              /* non-fatal — audit gap better than blocking receipt */
            }
          }
        }
      }
    }

    // Get PO details for GL transaction
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poLine.purchaseOrderId },
      include: {
        supplier: true,
        lines: {
          where: { id: poLine.id },
          include: { inventoryItem: true },
        },
      },
    });

    // Get account code from validated charge allocations
    const allocValidation = this.validateChargeAllocations(poLine);
    if (!allocValidation.valid) {
      throw new BadRequestError(allocValidation.errors.join("; "));
    }
    const { accountCodeId, departmentId, projectId, areaId } = allocValidation;

    // Get inventory item details
    const inventoryItem = po?.lines[0]?.inventoryItem;

    // B0-7: Create GL transaction via POGLService INSIDE the Prisma transaction.
    // The tx client is passed so GL/budget operations share the same connection.
    // If GL fails, the entire transaction (receipt + data changes) rolls back.
    let glTransactionId: string | undefined;
    let budgetUpdated = false;

    try {
      if (isReturn) {
        // Use POGLService for return transaction
        const glResult = await poGLService.createReturnTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            returnId: receipt.id,
            returnNumber: receiptNumber,
            returnDate: item.receivedAt ?? new Date(),
            originalReceiptId: item.originalReceiptId ?? receipt.id,
            poLineId: poLine.id,
            inventoryItemId: poLine.inventoryItemId ?? undefined,
            inventoryItemSku: inventoryItem?.sku,
            description: poLine.description ?? "Inventory Return",
            quantity: item.quantityReceived, // Negative value
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(), // Negative value
            reason: item.notes ?? "PO Return",
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      } else {
        // Use POGLService for receipt transaction
        const glResult = await poGLService.createReceiptTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            receiptId: receipt.id,
            receiptNumber,
            receiptDate: item.receivedAt ?? new Date(),
            poLineId: poLine.id,
            inventoryItemId: poLine.inventoryItemId ?? undefined,
            inventoryItemSku: inventoryItem?.sku,
            description: poLine.description ?? "Inventory Receipt",
            quantity: item.quantityReceived,
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(),
            accountCodeId,
            departmentId,
            projectId,
            areaId,
            freightCost,
            capitalizeFreight,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      }
    } catch (glError) {
      // B0-7: GL failure now rolls back the entire transaction (receipt + data changes)
      logger.error(
        `[LineItemReceiving] GL CREATION FAILED for INVENTORY receipt ${receipt.id} (${receiptNumber}). ` +
          `Rolling back transaction. ` +
          `PO=${po?.poNumber ?? "UNKNOWN"}, poLineId=${poLine.id}, ` +
          `amount=$${totalCost.toFixed(6)}, qty=${item.quantityReceived}, isReturn=${isReturn}`,
        {
          error: glError instanceof Error ? glError.message : String(glError),
          stack: glError instanceof Error ? glError.stack : undefined,
          receiptId: receipt.id,
          receiptNumber,
          poNumber: po?.poNumber ?? "UNKNOWN",
          purchaseOrderId: poLine.purchaseOrderId,
          poLineId: poLine.id,
          lineType: "INVENTORY",
          totalCost: totalCost.toNumber(),
          quantityReceived: item.quantityReceived,
          isReturn,
          accountCodeId,
          departmentId,
          projectId,
          areaId,
        },
      );
      throw glError; // B0-7: Re-throw to roll back the entire transaction
    }

    return {
      poLineId: poLine.id,
      lineType: LineItemType.INVENTORY,
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      quantityReceived: item.quantityReceived,
      totalCost: totalCost.toNumber(),
      budgetCharged: budgetUpdated,
      budgetTransactionIds: glTransactionId ? [glTransactionId] : [],
      serialNumbers: createdSerialNumbers,
    };
  }

  /**
   * Receive a SERVICE line item
   *
   * Process:
   * 1. Create POLineReceipt record
   * 2. Create ServiceReceipt record with service-specific details
   * 3. Create GL transaction via POGLService (handles budget tracking)
   *
   * @private
   */
  private async receiveServiceItem(
    ctx: ServiceContext,
    tx: PrismaTx,
    poLine: POLineWithRelations,
    item: ReceiveServiceItemDTO,
    idempotencyKey?: string,
  ): Promise<ReceiveLineItemResult> {
    // INVOICE APPROVAL BLOCKING: Check if service line can be received
    // SERVICE lines require an approved invoice before they can be received
    if (!poLine.canReceive) {
      throw new BadRequestError(
        `Cannot receive service line: Invoice approval required. ` +
          `Service lines must have an approved invoice before they can be received. ` +
          `Please ensure finance has uploaded and matched an invoice, and the requisition requestor has approved it.`,
      );
    }

    const unitCost = new Decimal(poLine.unitPrice);
    const totalCost = unitCost.mul(item.quantityReceived);

    // DOLLAR-AMOUNT VALIDATION: Check if receipt exceeds approved invoice amount
    // For SERVICE lines with invoice approval, validate that the receipt value doesn't exceed available amount
    if (poLine.requiresInvoiceMatch && poLine.approvedInvoiceAmount) {
      const approvedAmount = new Decimal(poLine.approvedInvoiceAmount);
      const receivedAmount = new Decimal(poLine.receivedAmount);
      const availableAmount = approvedAmount.minus(receivedAmount);

      if (totalCost.greaterThan(availableAmount)) {
        throw new BadRequestError(
          `Cannot receive $${totalCost.toFixed(6)}. Only $${availableAmount.toFixed(6)} approved and available. ` +
            `Approved invoice amount: $${approvedAmount.toFixed(6)}, Already received: $${receivedAmount.toFixed(6)}`,
        );
      }
    }

    // Generate receipt number
    const receiptNumber = await this.generateReceiptNumber(tx, "SVC");

    // Determine if this is a return (negative quantity)
    const isReturn = item.quantityReceived < 0;

    // Append idempotency key to notes for tracking
    const notesWithIdempotency = idempotencyKey
      ? `${item.notes ?? ""}${item.notes ? " " : ""}[IDEMPOTENCY:${idempotencyKey}]`
      : item.notes;

    // B2-3-FIX: Invoice selection â€” use explicit invoiceId from user when provided,
    // otherwise fall back to auto-selection for backward compatibility.
    let linkedInvoiceId: string | null = null;
    let approvedInvoice: {
      id: string;
      invoiceNumber: string;
      invoiceDate: Date | null;
      approvalStatus: string;
    } | null = null;

    if (item.invoiceId) {
      // User explicitly selected an invoice â€” validate it exists and is approved
      const userSelectedInvoice = await tx.invoice.findUnique({
        where: { id: item.invoiceId },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          approvalStatus: true,
          purchaseOrderId: true,
        },
      });

      if (!userSelectedInvoice) {
        throw new BadRequestError(
          `Selected invoice not found (ID: ${item.invoiceId}). Please select a valid invoice.`,
        );
      }

      if (userSelectedInvoice.purchaseOrderId !== poLine.purchaseOrderId) {
        throw new BadRequestError(
          `Selected invoice ${userSelectedInvoice.invoiceNumber} does not belong to this purchase order.`,
        );
      }

      const approvedStatuses = ["REQUESTOR_APPROVED", "FULLY_APPROVED"];
      if (!approvedStatuses.includes(userSelectedInvoice.approvalStatus)) {
        throw new BadRequestError(
          `Selected invoice ${userSelectedInvoice.invoiceNumber} is not approved (status: ${userSelectedInvoice.approvalStatus}). ` +
            `Only approved invoices can be used for receiving.`,
        );
      }

      // DUPLICATE INVOICE RECEIVING PREVENTION: Check if THIS SPECIFIC PO LINE already
      // has an active receipt linked to this invoice.  Scoped to poLineId so that
      // other PO lines' active receipts on the same invoice do not block re-receiving
      // on a line whose previous receipt was reversed.
      const existingActiveReceipts = await tx.pOLineReceipt.count({
        where: {
          invoiceId: item.invoiceId,
          poLineId: poLine.id, // <- scoped to this PO line only
          status: "ACTIVE",
          isReturn: false,
        },
      });

      if (existingActiveReceipts > 0) {
        throw new BadRequestError(
          `Invoice ${userSelectedInvoice.invoiceNumber} has already been received for this line ` +
            `(${existingActiveReceipts} active receipt(s) exist on this line). ` +
            `If the previous receipt was incorrect, reverse it first before creating a new receipt.`,
        );
      }

      linkedInvoiceId = userSelectedInvoice.id;
      approvedInvoice = {
        id: userSelectedInvoice.id,
        invoiceNumber: userSelectedInvoice.invoiceNumber,
        invoiceDate: userSelectedInvoice.invoiceDate,
        approvalStatus: userSelectedInvoice.approvalStatus,
      };

      logger.info(
        `[LineItemReceiving] User explicitly selected invoice ${userSelectedInvoice.invoiceNumber} (${userSelectedInvoice.id}) ` +
          `for service receipt on PO line ${poLine.id}`,
        {
          invoiceId: userSelectedInvoice.id,
          invoiceNumber: userSelectedInvoice.invoiceNumber,
          poLineId: poLine.id,
          selectedBy: ctx.userName,
        },
      );
    } else {
      // No explicit invoice selected — auto-detect via InvoiceLineItem junction.
      // Exclude voided invoices: voidedAt is stamped on void regardless of approvalStatus.
      // This guards against the historical bug where voidInvoice() left approvalStatus as
      // FULLY_APPROVED, which caused voided invoices to appear in this query.
      const invoiceLineItem = await tx.invoiceLineItem.findFirst({
        where: {
          poLineId: poLine.id,
          invoice: {
            approvalStatus: {
              in: ["REQUESTOR_APPROVED", "FULLY_APPROVED"],
            },
            voidedAt: null,
          },
        },
        include: { invoice: true },
        orderBy: { invoice: { createdAt: "desc" } },
      });

      linkedInvoiceId = invoiceLineItem?.invoiceId ?? null;

      // Fallback: If no InvoiceLineItem junction exists, fall back to PO-level invoice lookup.
      // This handles older data that may not have junction records. Exclude voided
      // invoices (voidedAt set) even when approvalStatus is still FULLY_APPROVED — see
      // the junction-query comment above. (Previously this fallback was duplicated and
      // the second copy dropped the voidedAt guard, allowing a voided invoice to be
      // linked to a new receipt.)
      approvedInvoice = invoiceLineItem?.invoice
        ? {
            id: invoiceLineItem.invoice.id,
            invoiceNumber: invoiceLineItem.invoice.invoiceNumber,
            invoiceDate: invoiceLineItem.invoice.invoiceDate,
            approvalStatus: invoiceLineItem.invoice.approvalStatus,
          }
        : await tx.invoice.findFirst({
            where: {
              purchaseOrderId: poLine.purchaseOrderId,
              approvalStatus: {
                in: ["REQUESTOR_APPROVED", "FULLY_APPROVED"],
              },
              voidedAt: null,
            },
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              approvalStatus: true,
            },
            orderBy: {
              requestorApprovedAt: "desc",
            },
          });

      logger.info(
        `[LineItemReceiving] Auto-selected invoice for service receipt on PO line ${poLine.id}: ` +
          `${approvedInvoice ? `${approvedInvoice.invoiceNumber} (${approvedInvoice.id})` : "NONE"}`,
        {
          invoiceId: approvedInvoice?.id ?? null,
          invoiceNumber: approvedInvoice?.invoiceNumber ?? null,
          poLineId: poLine.id,
          autoSelectionMethod: invoiceLineItem
            ? "junction"
            : "po-level-fallback",
        },
      );
    }

    // Create POLineReceipt with invoice relationship
    const receipt = await tx.pOLineReceipt.create({
      data: {
        poLineId: poLine.id,
        receiptNumber,
        quantityReceived: item.quantityReceived,
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        receivedBy: item.receivedBy,
        receivedByName: item.receivedByName,
        receivedAt: item.receivedAt ?? new Date(),
        invoiceNumber: approvedInvoice?.invoiceNumber ?? item.invoiceNumber,
        invoiceDate: approvedInvoice?.invoiceDate ?? item.invoiceDate,
        invoiceId: linkedInvoiceId ?? approvedInvoice?.id, // B2-3: Prefer junction-based invoice link, fallback to PO-level
        notes: notesWithIdempotency,
        // NEW: Document tracking and return fields
        documentNumber: item.documentNumber,
        isReturn: isReturn,
        originalReceiptId: item.originalReceiptId,
      },
    });

    // Create ServiceReceipt with proper columns (NO metadata)
    await tx.serviceReceipt.create({
      data: {
        poLineReceiptId: receipt.id,
        serviceDate: item.serviceDate,
        serviceProvider: item.serviceProvider,
        hoursOrUnits: item.hoursOrUnits,
        completionNotes: item.completionNotes,
        qualityRating: item.qualityRating,
      },
    });

    // Get PO details for GL transaction
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poLine.purchaseOrderId },
      include: {
        supplier: true,
      },
    });

    // Fetch FinanceSettings defaults for dept fallback
    const [_woDefaults2, _invDefaults2] = await Promise.all([
      financeSettingsService.getWorkOrderDefaults(),
      financeSettingsService.getInventoryDefaults(),
    ]);

    // Get account code from validated charge allocations
    const allocValidation = this.validateChargeAllocations(poLine, {
      departmentId: _woDefaults2.defaultWorkOrderDepartmentId,
      inventoryDepartmentId: _invDefaults2.defaultInventoryDepartmentId,
    });
    if (!allocValidation.valid) {
      throw new BadRequestError(allocValidation.errors.join("; "));
    }
    const { accountCodeId, departmentId, projectId, areaId } = allocValidation;

    // B0-7: Create GL transaction via POGLService INSIDE the Prisma transaction.
    // The tx client is passed so GL/budget operations share the same connection.
    // If GL fails, the entire transaction (receipt + data changes) rolls back.
    let glTransactionId: string | undefined;
    let budgetUpdated = false;

    try {
      if (isReturn) {
        // Use POGLService for return transaction
        const glResult = await poGLService.createReturnTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            returnId: receipt.id,
            returnNumber: receiptNumber,
            returnDate: item.receivedAt ?? new Date(),
            originalReceiptId: item.originalReceiptId ?? receipt.id,
            poLineId: poLine.id,
            description: poLine.description ?? "Service Return",
            quantity: item.quantityReceived, // Negative value
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(), // Negative value
            reason: item.notes ?? "Service Return",
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      } else {
        // Use POGLService for receipt transaction
        const glResult = await poGLService.createServiceReceiptTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            receiptId: receipt.id,
            receiptNumber,
            receiptDate: item.receivedAt ?? new Date(),
            poLineId: poLine.id,
            description: poLine.description ?? "Service Receipt",
            quantity: item.quantityReceived,
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(),
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      }
    } catch (glError) {
      // B0-7: GL failure now rolls back the entire transaction (receipt + data changes)
      logger.error(
        `[LineItemReceiving] GL CREATION FAILED for SERVICE receipt ${receipt.id} (${receiptNumber}). ` +
          `Rolling back transaction. ` +
          `PO=${po?.poNumber ?? "UNKNOWN"}, poLineId=${poLine.id}, ` +
          `amount=$${totalCost.toFixed(6)}, qty=${item.quantityReceived}, isReturn=${isReturn}`,
        {
          error: glError instanceof Error ? glError.message : String(glError),
          stack: glError instanceof Error ? glError.stack : undefined,
          receiptId: receipt.id,
          receiptNumber,
          poNumber: po?.poNumber ?? "UNKNOWN",
          purchaseOrderId: poLine.purchaseOrderId,
          poLineId: poLine.id,
          lineType: "SERVICE",
          totalCost: totalCost.toNumber(),
          quantityReceived: item.quantityReceived,
          isReturn,
          accountCodeId,
          departmentId,
          projectId,
          areaId,
        },
      );
      throw glError; // B0-7: Re-throw to roll back the entire transaction
    }

    return {
      poLineId: poLine.id,
      lineType: LineItemType.SERVICE,
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      quantityReceived: item.quantityReceived,
      totalCost: totalCost.toNumber(),
      budgetCharged: budgetUpdated,
      budgetTransactionIds: glTransactionId ? [glTransactionId] : [],
    };
  }

  /**
   * Receive a CONSUMABLE line item
   *
   * Process:
   * 1. Create POLineReceipt record
   * 2. Create ConsumableUsage record with usage tracking
   * 3. Create GL transaction via POGLService (handles budget tracking)
   *
   * @private
   */
  private async receiveConsumableItem(
    ctx: ServiceContext,
    tx: PrismaTx,
    poLine: POLineWithRelations,
    item: ReceiveConsumableItemDTO,
    idempotencyKey?: string,
    adminOverride?: boolean,
  ): Promise<ReceiveLineItemResult> {
    // B2-2: Server-side over-receive validation
    const orderedQty = Number(poLine.quantity);
    const currentReceivedQty = Number(poLine.receivedQuantity);
    const newQty = Number(item.quantityReceived);
    const OVER_RECEIVE_TOLERANCE = 1.1; // 10% over is allowed

    if (
      orderedQty > 0 &&
      currentReceivedQty + newQty > orderedQty * OVER_RECEIVE_TOLERANCE
    ) {
      if (!adminOverride) {
        throw new BadRequestError(
          `Cannot receive ${newQty} units â€” this would exceed the ordered quantity of ${orderedQty} ` +
            `(already received: ${currentReceivedQty}). Maximum receivable: ${orderedQty * OVER_RECEIVE_TOLERANCE - currentReceivedQty}. ` +
            `An administrator can override this limit.`,
        );
      }
      logger.warn(
        `[B2-2] Admin override: Over-receiving on PO line ${poLine.id}. ` +
          `Ordered: ${orderedQty}, Previously received: ${currentReceivedQty}, New: ${newQty}`,
      );
    }

    const unitCost = new Decimal(poLine.unitPrice);
    const totalCost = unitCost.mul(item.quantityReceived);

    // Generate receipt number
    const receiptNumber = await this.generateReceiptNumber(tx, "CON");

    // Determine if this is a return (negative quantity)
    const isReturn = item.quantityReceived < 0;

    // Append idempotency key to notes for tracking
    const notesWithIdempotency = idempotencyKey
      ? `${item.notes ?? ""}${item.notes ? " " : ""}[IDEMPOTENCY:${idempotencyKey}]`
      : item.notes;

    // Resolve optional invoice selection for CONSUMABLE items
    const invoiceResolution = await this.resolveOptionalInvoiceId(
      ctx,
      tx,
      poLine,
      item.invoiceId,
      "CONSUMABLE",
    );

    // Create POLineReceipt (NO metadata)
    const receipt = await tx.pOLineReceipt.create({
      data: {
        poLineId: poLine.id,
        receiptNumber,
        quantityReceived: item.quantityReceived,
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        receivedBy: item.receivedBy,
        receivedByName: item.receivedByName,
        receivedAt: item.receivedAt ?? new Date(),
        invoiceNumber: invoiceResolution.invoiceNumber ?? item.invoiceNumber,
        invoiceDate: invoiceResolution.invoiceDate ?? item.invoiceDate,
        invoiceId: invoiceResolution.linkedInvoiceId,
        notes: notesWithIdempotency,
        // NEW: Document tracking and return fields
        documentNumber: item.documentNumber,
        isReturn: isReturn,
        originalReceiptId: item.originalReceiptId,
      },
    });

    // Create ConsumableUsage with proper columns (NO metadata)
    await tx.consumableUsage.create({
      data: {
        poLineReceiptId: receipt.id,
        usedBy: item.usedBy,
        usedByName: item.usedByName,
        usedAt: item.usedAt ?? new Date(),
        departmentId: item.departmentId,
        areaId: item.areaId,
        purpose: item.purpose,
        notes: item.notes,
      },
    });

    // Get PO details for GL transaction
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poLine.purchaseOrderId },
      include: {
        supplier: true,
      },
    });

    // Fetch FinanceSettings defaults for dept fallback
    const [_woDefaults3, _invDefaults3] = await Promise.all([
      financeSettingsService.getWorkOrderDefaults(),
      financeSettingsService.getInventoryDefaults(),
    ]);

    // Get account code from validated charge allocations
    const allocValidation = this.validateChargeAllocations(poLine, {
      departmentId: _woDefaults3.defaultWorkOrderDepartmentId,
      inventoryDepartmentId: _invDefaults3.defaultInventoryDepartmentId,
    });
    if (!allocValidation.valid) {
      throw new BadRequestError(allocValidation.errors.join("; "));
    }
    const { accountCodeId, departmentId, projectId, areaId } = allocValidation;

    // B0-7: Create GL transaction via POGLService INSIDE the Prisma transaction.
    // The tx client is passed so GL/budget operations share the same connection.
    // If GL fails, the entire transaction (receipt + data changes) rolls back.
    let glTransactionId: string | undefined;
    let budgetUpdated = false;

    try {
      if (isReturn) {
        // Use POGLService for return transaction
        const glResult = await poGLService.createReturnTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            returnId: receipt.id,
            returnNumber: receiptNumber,
            returnDate: item.receivedAt ?? new Date(),
            originalReceiptId: item.originalReceiptId ?? receipt.id,
            poLineId: poLine.id,
            description: poLine.description ?? "Consumable Return",
            quantity: item.quantityReceived, // Negative value
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(), // Negative value
            reason: item.notes ?? "Consumable Return",
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      } else {
        // Use POGLService for receipt transaction
        const glResult = await poGLService.createConsumableReceiptTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            receiptId: receipt.id,
            receiptNumber,
            receiptDate: item.receivedAt ?? new Date(),
            poLineId: poLine.id,
            description: poLine.description ?? "Consumable Receipt",
            quantity: item.quantityReceived,
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(),
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      }
    } catch (glError) {
      // B0-7: GL failure now rolls back the entire transaction (receipt + data changes)
      logger.error(
        `[LineItemReceiving] GL CREATION FAILED for CONSUMABLE receipt ${receipt.id} (${receiptNumber}). ` +
          `Rolling back transaction. ` +
          `PO=${po?.poNumber ?? "UNKNOWN"}, poLineId=${poLine.id}, ` +
          `amount=$${totalCost.toFixed(6)}, qty=${item.quantityReceived}, isReturn=${isReturn}`,
        {
          error: glError instanceof Error ? glError.message : String(glError),
          stack: glError instanceof Error ? glError.stack : undefined,
          receiptId: receipt.id,
          receiptNumber,
          poNumber: po?.poNumber ?? "UNKNOWN",
          purchaseOrderId: poLine.purchaseOrderId,
          poLineId: poLine.id,
          lineType: "CONSUMABLE",
          totalCost: totalCost.toNumber(),
          quantityReceived: item.quantityReceived,
          isReturn,
          accountCodeId,
          departmentId,
          projectId,
          areaId,
        },
      );
      throw glError; // B0-7: Re-throw to roll back the entire transaction
    }

    return {
      poLineId: poLine.id,
      lineType: LineItemType.CONSUMABLE,
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      quantityReceived: item.quantityReceived,
      totalCost: totalCost.toNumber(),
      budgetCharged: budgetUpdated,
      budgetTransactionIds: glTransactionId ? [glTransactionId] : [],
    };
  }

  /**
   * Receive a NON_STOCK line item
   *
   * NON_STOCK items are linked to inventory items but do NOT update stock levels.
   * Uses PO_RECEIPT_NSI for GL event type and charge allocations for account resolution.
   *
   * Process:
   * 1. Create POLineReceipt record
   * 2. Create GL transaction via POGLService using PO_RECEIPT_NSI event
   * 3. NO stock/inventory updates (unlike INVENTORY type)
   *
   * @private
   */
  private async receiveNonStockItem(
    ctx: ServiceContext,
    tx: PrismaTx,
    poLine: POLineWithRelations,
    item: ReceiveNonStockItemDTO,
    idempotencyKey?: string,
    adminOverride?: boolean,
  ): Promise<ReceiveLineItemResult> {
    // B2-2: Server-side over-receive validation
    const orderedQty = Number(poLine.quantity);
    const currentReceivedQty = Number(poLine.receivedQuantity);
    const newQty = Number(item.quantityReceived);
    const OVER_RECEIVE_TOLERANCE = 1.1; // 10% over is allowed

    if (
      orderedQty > 0 &&
      currentReceivedQty + newQty > orderedQty * OVER_RECEIVE_TOLERANCE
    ) {
      if (!adminOverride) {
        throw new BadRequestError(
          `Cannot receive ${newQty} units â€” this would exceed the ordered quantity of ${orderedQty} ` +
            `(already received: ${currentReceivedQty}). Maximum receivable: ${orderedQty * OVER_RECEIVE_TOLERANCE - currentReceivedQty}. ` +
            `An administrator can override this limit.`,
        );
      }
      logger.warn(
        `[B2-2] Admin override: Over-receiving on PO line ${poLine.id}. ` +
          `Ordered: ${orderedQty}, Previously received: ${currentReceivedQty}, New: ${newQty}`,
      );
    }

    const unitCost = new Decimal(poLine.unitPrice);
    const totalCost = unitCost.mul(item.quantityReceived);

    // Generate receipt number
    const receiptNumber = await this.generateReceiptNumber(tx, "NSI");

    // Determine if this is a return (negative quantity)
    const isReturn = item.quantityReceived < 0;

    // Append idempotency key to notes for tracking
    const notesWithIdempotency = idempotencyKey
      ? `${item.notes ?? ""}${item.notes ? " " : ""}[IDEMPOTENCY:${idempotencyKey}]`
      : item.notes;

    // Resolve optional invoice selection for NON_STOCK items
    const invoiceResolution = await this.resolveOptionalInvoiceId(
      ctx,
      tx,
      poLine,
      item.invoiceId,
      "NON_STOCK",
    );

    // Create POLineReceipt (NO stock updates, NO metadata)
    const receipt = await tx.pOLineReceipt.create({
      data: {
        poLineId: poLine.id,
        receiptNumber,
        quantityReceived: item.quantityReceived,
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        receivedBy: item.receivedBy,
        receivedByName: item.receivedByName,
        receivedAt: item.receivedAt ?? new Date(),
        invoiceNumber: invoiceResolution.invoiceNumber ?? item.invoiceNumber,
        invoiceDate: invoiceResolution.invoiceDate ?? item.invoiceDate,
        invoiceId: invoiceResolution.linkedInvoiceId,
        notes: notesWithIdempotency,
        // Document tracking and return fields
        documentNumber: item.documentNumber,
        isReturn: isReturn,
        originalReceiptId: item.originalReceiptId,
      },
    });

    // Log POLineReceipt creation
    logger.info(
      `[LineItemReceiving] NON_STOCK POLineReceipt created in tx: ${receipt.id} (${receiptNumber}) ` +
        `for PO line ${poLine.id} | qty=${item.quantityReceived} | cost=$${totalCost.toFixed(6)} | ` +
        `by=${item.receivedByName} | inventoryItemId=${poLine.inventoryItemId ?? "N/A"} | ` +
        `doc=${item.documentNumber ?? "N/A"} | isReturn=${isReturn}`,
      {
        receiptId: receipt.id,
        receiptNumber,
        poLineId: poLine.id,
        purchaseOrderId: poLine.purchaseOrderId,
        inventoryItemId: poLine.inventoryItemId,
        quantityReceived: item.quantityReceived,
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        documentNumber: item.documentNumber,
        isReturn,
        lineType: "NON_STOCK",
      },
    );

    // NOTE: NON_STOCK items do NOT update inventory stock levels.
    // They are linked to inventory items for reference but stock is not tracked.

    // Get PO details for GL transaction
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poLine.purchaseOrderId },
      include: {
        supplier: true,
        lines: {
          where: { id: poLine.id },
          include: { inventoryItem: true },
        },
      },
    });

    // Fetch FinanceSettings defaults for dept fallback
    const [_woDefaults4, _invDefaults4] = await Promise.all([
      financeSettingsService.getWorkOrderDefaults(),
      financeSettingsService.getInventoryDefaults(),
    ]);

    // Get account code from validated charge allocations
    const allocValidation = this.validateChargeAllocations(poLine, {
      departmentId: _woDefaults4.defaultWorkOrderDepartmentId,
      inventoryDepartmentId: _invDefaults4.defaultInventoryDepartmentId,
    });
    if (!allocValidation.valid) {
      throw new BadRequestError(allocValidation.errors.join("; "));
    }
    const { accountCodeId, departmentId, projectId, areaId } = allocValidation;

    // Get inventory item details (NON_STOCK may have an inventoryItem link)
    const inventoryItem = po?.lines[0]?.inventoryItem;

    // B0-7: Create GL transaction via POGLService INSIDE the Prisma transaction.
    // Uses PO_RECEIPT_NSI event type for non-stock items.
    // The tx client is passed so GL/budget operations share the same connection.
    // If GL fails, the entire transaction (receipt + data changes) rolls back.
    let glTransactionId: string | undefined;
    let budgetUpdated = false;

    try {
      if (isReturn) {
        // Use POGLService for return transaction
        const glResult = await poGLService.createReturnTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            returnId: receipt.id,
            returnNumber: receiptNumber,
            returnDate: item.receivedAt ?? new Date(),
            originalReceiptId: item.originalReceiptId ?? receipt.id,
            poLineId: poLine.id,
            inventoryItemId: poLine.inventoryItemId ?? undefined,
            inventoryItemSku: inventoryItem?.sku,
            description: poLine.description ?? "Non-Stock Return",
            quantity: item.quantityReceived, // Negative value
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(), // Negative value
            reason: item.notes ?? "Non-Stock Return",
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      } else {
        // Use POGLService for NON_STOCK receipt transaction
        const glResult = await poGLService.createNonStockReceiptTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            receiptId: receipt.id,
            receiptNumber,
            receiptDate: item.receivedAt ?? new Date(),
            poLineId: poLine.id,
            inventoryItemId: poLine.inventoryItemId ?? undefined,
            inventoryItemSku: inventoryItem?.sku,
            description: poLine.description ?? "Non-Stock Receipt",
            quantity: item.quantityReceived,
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(),
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      }
    } catch (glError) {
      // B0-7: GL failure now rolls back the entire transaction (receipt + data changes)
      logger.error(
        `[LineItemReceiving] GL CREATION FAILED for NON_STOCK receipt ${receipt.id} (${receiptNumber}). ` +
          `Rolling back transaction. ` +
          `PO=${po?.poNumber ?? "UNKNOWN"}, poLineId=${poLine.id}, ` +
          `amount=$${totalCost.toFixed(6)}, qty=${item.quantityReceived}, isReturn=${isReturn}`,
        {
          error: glError instanceof Error ? glError.message : String(glError),
          stack: glError instanceof Error ? glError.stack : undefined,
          receiptId: receipt.id,
          receiptNumber,
          poNumber: po?.poNumber ?? "UNKNOWN",
          purchaseOrderId: poLine.purchaseOrderId,
          poLineId: poLine.id,
          lineType: "NON_STOCK",
          totalCost: totalCost.toNumber(),
          quantityReceived: item.quantityReceived,
          isReturn,
          accountCodeId,
          departmentId,
          projectId,
          areaId,
        },
      );
      throw glError; // B0-7: Re-throw to roll back the entire transaction
    }

    return {
      poLineId: poLine.id,
      lineType: LineItemType.NON_STOCK,
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      quantityReceived: item.quantityReceived,
      totalCost: totalCost.toNumber(),
      budgetCharged: budgetUpdated,
      budgetTransactionIds: glTransactionId ? [glTransactionId] : [],
    };
  }

  /**
   * Receive a REPAIRABLE_RETURN line item.
   *
   * Unlike every other line type, this method completes the entire vendor
   * repair workflow atomically in the same database transaction as the receipt:
   *
   *  1. Creates POLineReceipt
   *  2. Finds the active RepairHistory and stamps it RETURNED
   *  3. Sets RepairableItem.status = AVAILABLE + location = Main Warehouse
   *  4. Increments InventoryStock.quantityOnHand by 1
   *  5. Advances WorkOrder.repairWorkflowStatus = RETURNED_TO_INVENTORY
   *  6. Posts GL (non-stock expense: DR Maintenance/Repair expense, CR AP)
   *
   * No separate "Complete Repair" step is needed after this call.
   *
   * @private
   */
  private async receiveRepairableReturnItem(
    ctx: ServiceContext,
    tx: PrismaTx,
    poLine: POLineWithRelations,
    item: ReceiveRepairableReturnItemDTO,
    idempotencyKey?: string,
    poNumber?: string,
  ): Promise<ReceiveLineItemResult> {
    const unitCost = new Decimal(poLine.unitPrice);
    const totalCost = unitCost.mul(Math.abs(item.quantityReceived));
    const receiptNumber = await this.generateReceiptNumber(tx, "RPR");
    const isReturn = item.quantityReceived < 0;
    const notesWithIdempotency = idempotencyKey
      ? `${item.notes ?? ""}${item.notes ? " " : ""}[IDEMPOTENCY:${idempotencyKey}]`
      : item.notes;

    // ── 1. Create POLineReceipt ─────────────────────────────────────────────
    const receipt = await tx.pOLineReceipt.create({
      data: {
        poLineId: poLine.id,
        receiptNumber,
        quantityReceived: item.quantityReceived,
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        receivedBy: item.receivedBy,
        receivedByName: item.receivedByName,
        receivedAt: item.receivedAt ?? new Date(),
        notes: notesWithIdempotency,
        documentNumber: item.documentNumber ?? null,
        isReturn,
        originalReceiptId: item.originalReceiptId ?? null,
      },
    });

    logger.info(
      `[LineItemReceiving] REPAIRABLE_RETURN receipt created: ${receipt.id} (${receiptNumber}) ` +
        `for PO line ${poLine.id} | repairableItemId=${poLine.repairableItemId ?? "N/A"} | ` +
        `cost=$${totalCost.toFixed(2)} | by=${item.receivedByName}`,
      {
        receiptId: receipt.id,
        receiptNumber,
        poLineId: poLine.id,
        repairableItemId: poLine.repairableItemId,
        quantityReceived: item.quantityReceived,
        totalCost: totalCost.toNumber(),
        isReturn,
      },
    );

    // ── 2. Auto-complete repair workflow (receipts only, not reversals) ──────
    if (!isReturn && poLine.repairableItemId) {
      const repairableItemId = poLine.repairableItemId;
      const repairCost = totalCost.toNumber();
      const completedDate = new Date();

      // Find the active repair history for this serial
      const repairHistory = await tx.repairHistory.findFirst({
        where: {
          repairableItemId,
          repairStatus: {
            in: [
              "REQUISITION_CREATED",
              "IN_PROGRESS",
              "AWAITING_PARTS",
              "SENT_TO_VENDOR",
              "RECEIVED_FROM_VENDOR",
            ],
          },
        },
        orderBy: { initiatedDate: "desc" },
      });

      if (repairHistory) {
        // Stamp repair as RETURNED (skips the COMPLETED intermediate — done in one step)
        // Condition is always GOOD — the vendor repaired the part and there is no
        // condition picker on the PO receive page.
        await tx.repairHistory.update({
          where: { id: repairHistory.id },
          data: {
            repairStatus: "RETURNED",
            completedDate,
            returnedDate: completedDate,
            actualStartDate: repairHistory.actualStartDate ?? completedDate,
            actualCost: repairCost,
            conditionAfter: "GOOD",
            repairDescription:
              `Vendor repair completed and received via PO ${poNumber ?? poLine.purchaseOrderId}. ` +
              `Part returned to inventory automatically on PO receipt.`,
          },
        });

        // Return serial to AVAILABLE with condition GOOD
        await tx.repairableItem.update({
          where: { id: repairableItemId },
          data: {
            status: "AVAILABLE",
            condition: "GOOD",
            currentLocation: "Main Warehouse",
            lastRepairDate: completedDate,
            repairCount: { increment: 1 },
            totalRepairCost: { increment: repairCost },
          },
        });

        // Increment quantityOnHand +1 — restores the stock decremented when
        // the good spare was Direct-Issued at the start of the repair cycle
        if (poLine.inventoryItemId) {
          const stockRecord = await tx.inventoryStock.findFirst({
            where: { inventoryItemId: poLine.inventoryItemId },
            orderBy: { quantityOnHand: "desc" },
          });
          if (stockRecord) {
            await tx.inventoryStock.update({
              where: {
                inventoryItemId_storeId_bin: {
                  inventoryItemId: stockRecord.inventoryItemId,
                  storeId: stockRecord.storeId,
                  bin: stockRecord.bin || "MAIN",
                },
              },
              data: { quantityOnHand: { increment: 1 } },
            });
            logger.info(
              `[LineItemReceiving] REPAIRABLE_RETURN: stock +1 for inventoryItemId=${poLine.inventoryItemId} ` +
                `(store=${stockRecord.storeId}, bin=${stockRecord.bin || "MAIN"})`,
            );
          }
        }

        // Advance repair WO workflow status
        if (repairHistory.workOrderId) {
          await tx.workOrder.updateMany({
            where: {
              id: repairHistory.workOrderId,
              repairWorkflowStatus: { not: null },
            },
            data: { repairWorkflowStatus: "RETURNED_TO_INVENTORY" },
          });
        }

        // Audit history — non-fatal, uses global prisma (log only)
        try {
          await repairableItemHistoryService.logStatusChange(ctx, {
            repairableItemId,
            eventType: "STATUS_CHANGED" as const,
            previousStatus: "IN_REPAIR_EXTERNAL",
            newStatus: "AVAILABLE",
            notes:
              `PO ${poNumber ?? poLine.purchaseOrderId} received. ` +
              `Repair complete — returned to inventory automatically.`,
          });
        } catch (_historyErr) {
          // Non-fatal
        }

        // Notify IMs — non-fatal
        try {
          const repItem = await prisma.repairableItem.findUnique({
            where: { id: repairableItemId },
            select: {
              id: true,
              serialNumber: true,
              repairCount: true,
              inventoryItem: { select: { sku: true, description: true } },
            },
          });
          if (repItem) {
            await repairableItemNotificationService.notifyReturnedToInventory(
              ctx,
              {
                repairableItemId: repItem.id,
                serialNumber: repItem.serialNumber,
                inventoryItemSku: repItem.inventoryItem.sku,
                repairCount: repItem.repairCount,
                totalRepairCost: repairCost,
              },
            );
          }
        } catch (_notifErr) {
          // Non-fatal
        }
      } else {
        // No active repair history found — update serial status only as a safety fallback
        logger.warn(
          `[LineItemReceiving] REPAIRABLE_RETURN: no active RepairHistory found for ` +
            `repairableItemId=${repairableItemId}. Setting AVAILABLE without repair audit trail.`,
        );
        await tx.repairableItem.update({
          where: { id: repairableItemId },
          data: { status: "AVAILABLE", currentLocation: "Main Warehouse" },
        });
      }
    }

    // ── 3. GL posting (non-stock expense: DR Maintenance/Repair, CR AP) ──────
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poLine.purchaseOrderId },
      include: {
        supplier: true,
        lines: { where: { id: poLine.id }, include: { inventoryItem: true } },
      },
    });

    const [_woDefaults, _invDefaults] = await Promise.all([
      financeSettingsService.getWorkOrderDefaults(),
      financeSettingsService.getInventoryDefaults(),
    ]);

    const allocValidation = this.validateChargeAllocations(poLine, {
      departmentId: _woDefaults.defaultWorkOrderDepartmentId,
      inventoryDepartmentId: _invDefaults.defaultInventoryDepartmentId,
    });
    if (!allocValidation.valid) {
      throw new BadRequestError(allocValidation.errors.join("; "));
    }
    const { accountCodeId, departmentId, projectId, areaId } = allocValidation;
    const inventoryItem = po?.lines[0]?.inventoryItem;

    let glTransactionId: string | undefined;
    let budgetUpdated = false;

    try {
      if (isReturn) {
        const glResult = await poGLService.createReturnTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            returnId: receipt.id,
            returnNumber: receiptNumber,
            returnDate: item.receivedAt ?? new Date(),
            originalReceiptId: item.originalReceiptId ?? receipt.id,
            poLineId: poLine.id,
            inventoryItemId: poLine.inventoryItemId ?? undefined,
            inventoryItemSku: inventoryItem?.sku,
            description: poLine.description ?? "Repairable Return Reversal",
            quantity: item.quantityReceived,
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(),
            reason: item.notes ?? "Repairable Return Reversal",
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      } else {
        // Vendor repair is an operating expense — reuse non-stock GL path
        const glResult = await poGLService.createNonStockReceiptTransaction(
          ctx,
          {
            purchaseOrderId: poLine.purchaseOrderId,
            poNumber: po?.poNumber ?? "UNKNOWN",
            supplierId: po?.supplierId ?? "",
            supplierName: po?.supplier.name ?? "Unknown Supplier",
            receiptId: receipt.id,
            receiptNumber,
            receiptDate: item.receivedAt ?? new Date(),
            poLineId: poLine.id,
            inventoryItemId: poLine.inventoryItemId ?? undefined,
            inventoryItemSku: inventoryItem?.sku,
            description: poLine.description ?? "Vendor Repair Return",
            quantity: item.quantityReceived,
            unitCost: unitCost.toNumber(),
            totalCost: totalCost.toNumber(),
            accountCodeId,
            departmentId,
            projectId,
            areaId,
          },
          tx,
        );
        glTransactionId = glResult.glTransactionId;
        budgetUpdated = glResult.budgetUpdated;
      }
    } catch (glError) {
      logger.error(
        `[LineItemReceiving] GL CREATION FAILED for REPAIRABLE_RETURN receipt ${receipt.id} (${receiptNumber}). ` +
          `Rolling back transaction. PO=${po?.poNumber ?? "UNKNOWN"}, poLineId=${poLine.id}, ` +
          `amount=$${totalCost.toFixed(2)}, isReturn=${isReturn}`,
        {
          error: glError instanceof Error ? glError.message : String(glError),
          stack: glError instanceof Error ? glError.stack : undefined,
          receiptId: receipt.id,
          receiptNumber,
          poLineId: poLine.id,
          lineType: "REPAIRABLE_RETURN",
          totalCost: totalCost.toNumber(),
          quantityReceived: item.quantityReceived,
        },
      );
      throw glError; // Re-throw to roll back the entire transaction
    }

    return {
      poLineId: poLine.id,
      lineType: LineItemType.REPAIRABLE_RETURN,
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      quantityReceived: item.quantityReceived,
      totalCost: totalCost.toNumber(),
      budgetCharged: budgetUpdated,
      budgetTransactionIds: glTransactionId ? [glTransactionId] : [],
    };
  }

  /**
   * Generate unique receipt number using database sequence
   *
   * RACE CONDITION FIX:
   * - Uses PostgreSQL sequence for atomic, unique number generation
   * - Eliminates race conditions completely
   * - Format: PREFIX-YYYYMM-NNNN (e.g., RCPT-202602-0001)
   *
   * @private
   */

  private async generateReceiptNumber(
    tx: PrismaTx,
    prefix: string,
  ): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    // Get next value from database sequence (atomic operation)
    // This is guaranteed to be unique across all concurrent transactions
    const result = await (
      tx as unknown as { $queryRaw: typeof prisma.$queryRaw }
    ).$queryRaw<Array<{ nextval: bigint }>>`
      SELECT nextval('receipt_number_seq')
    `;

    const sequenceNumber = Number(result[0]?.nextval ?? 0);
    const sequence = String(sequenceNumber).padStart(4, "0");
    const receiptNumber = `${prefix}-${year}${month}-${sequence}`;

    return receiptNumber;
  }
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // GL PRE-VALIDATION HELPERS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Validate charge allocations on a PO line.
   *
   * Returns the first allocation's account code ID and budget dimensions,
   * or an error array if the allocation is missing or has no account code.
   * This is used both by preValidateReceivingBatch() and by the individual
   * receiveXxxItem() methods to replace the unsafe `poLine.chargeAllocations[0]`
   * access that previously defaulted to an empty string.
   */
  private validateChargeAllocations(
    poLine: POLineWithRelations,
    fallback?: {
      departmentId?: string | null;
      inventoryDepartmentId?: string | null;
    },
  ): {
    valid: boolean;
    // '' (empty string) is the sentinel for "no account code assigned".
    // The GL rule engine uses this sentinel to match GLR-0040
    // (condition: ACCOUNT_CODE EQUALS "").  Do NOT convert '' to undefined
    // here — the rule engine would interpret undefined as null and GLR-0040
    // would not fire.  Conversion to NULL for DB writes is done in
    // po-gl.service.ts (safeAccountCodeId) and in gl-transaction.service.ts.
    accountCodeId: string;
    departmentId: string | undefined;
    projectId: string | undefined;
    areaId: string | undefined;
    errors: string[];
  } {
    const errors: string[] = [];

    if (poLine.chargeAllocations.length === 0) {
      // INVENTORY lines with no project context are handled by GL rule GLR-0040
      // (FIXED accounts DR 1535 / CR 2111). No charge allocation is required for
      // GL posting to succeed.
      // INVENTORY lines WITH a work order may carry a project, so require an
      // allocation to carry projectId so GLR-0027 fires and posts to CIP 1580.
      if (poLine.lineType === LineItemType.INVENTORY) {
        if (!poLine.workOrderId) {
          // No work order — no project context; GLR-0040 handles it.
          // Use defaultInventoryDepartmentId from FinanceSettings as the dept dimension.
          return {
            valid: true,
            accountCodeId: "",
            departmentId: fallback?.inventoryDepartmentId ?? undefined,
            projectId: undefined,
            areaId: undefined,
            errors: [],
          };
        }
        // Has work order (possible project context) but no allocation — block to
        // avoid mis-routing to 1535 instead of CIP 1580.
        errors.push(
          `Inventory line '${poLine.description ?? poLine.id}' is linked to a work order and may be charged to a project. A charge allocation is required for correct GL posting.`,
        );
        return {
          valid: false,
          accountCodeId: "",
          departmentId: undefined,
          projectId: undefined,
          areaId: undefined,
          errors,
        };
      }

      errors.push(
        `PO line "${poLine.description ?? poLine.id}" (line #${poLine.id}) is missing charge allocations. ` +
          `Please add account code allocations before receiving.`,
      );
      return {
        valid: false,
        accountCodeId: "",
        departmentId: undefined,
        projectId: undefined,
        areaId: undefined,
        errors,
      };
    }

    const allocation = poLine.chargeAllocations[0];
    if (!allocation) {
      errors.push(
        `PO line "${poLine.description ?? poLine.id}" has no valid charge allocation.`,
      );
      return {
        valid: false,
        accountCodeId: "",
        departmentId: undefined,
        projectId: undefined,
        areaId: undefined,
        errors,
      };
    }

    const accountCodeId = allocation.accountCodeId;
    if (!accountCodeId || accountCodeId.trim() === "") {
      errors.push(
        `PO line "${poLine.description ?? poLine.id}" has a charge allocation without an account code. ` +
          `Please assign an account code to the allocation before receiving.`,
      );
      return {
        valid: false,
        accountCodeId: "",
        departmentId: undefined,
        projectId: undefined,
        areaId: undefined,
        errors,
      };
    }

    // Priority: alloc dept → WO default (if no project on alloc) → inventory default
    const resolvedDeptId =
      allocation.departmentId ??
      (!allocation.projectId
        ? (fallback?.departmentId ?? fallback?.inventoryDepartmentId)
        : undefined) ??
      undefined;

    return {
      valid: true,
      accountCodeId,
      departmentId: resolvedDeptId,
      projectId: allocation.projectId ?? undefined,
      areaId: allocation.areaId ?? undefined,
      errors: [],
    };
  }

  /**
   * Map PO line type + return flag to the correct GL event type for rule evaluation.
   */
  private getGLEventTypeForLine(
    lineType: LineItemType,
    isReturn: boolean,
  ): GLEventType {
    if (isReturn) return GLEventType.PO_RETURN;

    switch (lineType) {
      case LineItemType.INVENTORY:
        return GLEventType.PO_RECEIPT_INV;
      case LineItemType.SERVICE:
        return GLEventType.PO_RECEIPT_SVC;
      case LineItemType.CONSUMABLE:
        return GLEventType.PO_RECEIPT_CON;
      case LineItemType.NON_STOCK:
        return GLEventType.PO_RECEIPT_NSI;
      case LineItemType.REPAIRABLE_RETURN:
        return GLEventType.PO_RECEIPT_NSI; // vendor repair expense = non-stock GL treatment
      default:
        return GLEventType.PO_RECEIPT_INV;
    }
  }

  /**
   * Pre-validate ALL items in a batch receive operation.
   *
   * Runs BEFORE any database writes to ensure every item can succeed GL posting.
   * Validates:
   *  1. An active budget period exists
   *  2. Each PO line exists and has charge allocations with a valid accountCodeId
   *  3. GL rules exist and match for each line type (dry-run evaluation)
   *  4. GL entries are balanced
   *
   * Collects ALL errors instead of stopping at the first one so the user can
   * fix everything in one pass.
   *
   * @returns Array of validation errors (empty = all valid)
   */
  private async preValidateReceivingBatch(
    ctx: ServiceContext,
    po: {
      id: string;
      poNumber: string;
      supplierId: string | null;
      lines: POLineWithRelations[];
    },
    items: Array<{ itemId: string; quantityReceived: number }>,
  ): Promise<Array<{ itemId: string; error: string }>> {
    const errors: Array<{ itemId: string; error: string }> = [];

    // 1. Check budget period exists (shared across all items)
    try {
      await getCurrentBudgetPeriod(prisma);
    } catch (err) {
      if (err instanceof BadRequestError) {
        errors.push({
          itemId: "GLOBAL",
          error:
            "No active budget period found for the receiving date. Contact your administrator.",
        });
        return errors; // Can't proceed without a budget period
      }
      // DB connection or unexpected error â€” let it propagate
      throw err;
    }

    // 2. Per-item validation
    for (const item of items) {
      const poLine = po.lines.find((l) => l.id === item.itemId);

      // 2a. PO line exists
      if (!poLine) {
        errors.push({
          itemId: item.itemId,
          error: "Line item not found in purchase order.",
        });
        continue;
      }

      // 2b. Charge allocations exist with valid accountCodeId.
      // Pre-validation uses defaults for consistency with the actual receive path.
      const [_woDef, _invDef] = await Promise.all([
        financeSettingsService.getWorkOrderDefaults(),
        financeSettingsService.getInventoryDefaults(),
      ]);
      const allocValidation = this.validateChargeAllocations(poLine, {
        departmentId: _woDef.defaultWorkOrderDepartmentId,
        inventoryDepartmentId: _invDef.defaultInventoryDepartmentId,
      });
      if (!allocValidation.valid) {
        for (const err of allocValidation.errors) {
          errors.push({ itemId: item.itemId, error: err });
        }
        continue;
      }

      // 2c. GL rules exist and match for the line type (dry-run evaluation)
      const isReturn = item.quantityReceived < 0;
      const glEventType = this.getGLEventTypeForLine(poLine.lineType, isReturn);

      try {
        const unitCost = Number(poLine.unitPrice);
        const totalCost = unitCost * Math.abs(item.quantityReceived);

        const ruleContext: RuleEvaluationContext = {
          amount: totalCost,
          accountCodeId: allocValidation.accountCodeId,
          departmentId: allocValidation.departmentId,
          projectId: allocValidation.projectId,
          areaId: allocValidation.areaId,
          poId: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId ?? "",
          supplierName: "", // Not critical for rule matching
          receiptId: "PRE_VALIDATION",
          receiptNumber: "PRE_VALIDATION",
          inventoryItemId: poLine.inventoryItemId ?? undefined,
          transactionDate: new Date(),
          referenceType: "POLineReceipt",
          referenceId: "PRE_VALIDATION",
          referenceNumber: "PRE_VALIDATION",
          // REPAIRABLE_RETURN uses the same GL rules as NON_STOCK (expense debit)
          itemType:
            poLine.lineType === LineItemType.REPAIRABLE_RETURN
              ? "NON_STOCK"
              : poLine.lineType,
        };

        const ruleResult = await glRuleEngineService.evaluateRules(
          ctx,
          glEventType,
          ruleContext,
        );

        if (!ruleResult.success || !ruleResult.matched) {
          errors.push({
            itemId: item.itemId,
            error:
              `No GL rules found for account code on PO line "${poLine.description ?? item.itemId}" ` +
              `(type: ${poLine.lineType}). Please configure GL rules for ${glEventType} before receiving. ` +
              `Contact your administrator.`,
          });
          continue;
        }

        // Defensive fallback: evaluateRules() currently throws GLBalanceError for unbalanced
        // entries (caught below), so this check is rarely reached. Kept as safety net in case
        // the rule engine behavior changes in the future.
        if (!ruleResult.isBalanced) {
          errors.push({
            itemId: item.itemId,
            error:
              `GL entries are not balanced for "${poLine.description ?? item.itemId}" ` +
              `(debits=${ruleResult.totalDebits}, credits=${ruleResult.totalCredits}). ` +
              `Please review GL rule configuration for ${glEventType}. Contact your administrator.`,
          });
        }
      } catch (glError) {
        errors.push({
          itemId: item.itemId,
          error:
            `GL validation failed for "${poLine.description ?? item.itemId}": ` +
            `${glError instanceof Error ? glError.message : "Unknown GL error"}. Contact your administrator.`,
        });
      }
    }

    return errors;
  }

  /**
   * Get all receipts for a purchase order
   *
   * Retrieves all POLineReceipt records with optional filtering by:
   * - Line type (INVENTORY, SERVICE, CONSUMABLE)
   * - Date range
   *
   * Includes related ServiceReceipt and ConsumableUsage records.
   *
   * @param ctx - Service context
   * @param poId - Purchase order ID
   * @param filters - Optional filters
   * @returns Receipt data with related records
   */
  async getReceipts(
    ctx: ServiceContext,
    poId: string,
    filters?: {
      lineType?: "INVENTORY" | "SERVICE" | "CONSUMABLE" | "NON_STOCK";
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<{
    receipts: Array<{
      id: string;
      receiptNumber: string;
      poLineId: string;
      lineType: LineItemType;
      quantityReceived: number;
      unitCost: number;
      totalCost: number;
      receivedBy: string;
      receivedByName: string;
      receivedAt: Date;
      documentNumber: string | null;
      invoiceNumber: string | null;
      invoiceDate: Date | null;
      /** Direct FK to the linked invoice.  Null when no invoice or after a void (cleared by voidInvoice). */
      invoiceId: string | null;
      /** Status of the linked invoice (e.g. 'Voided', 'Approved', 'Paid').  Null when no invoice. */
      invoiceStatus: string | null;
      /** invoiceNumber with -VOID-<timestamp> / -REJECTED-<timestamp> suffix stripped — safe for display. */
      displayInvoiceNumber: string | null;
      notes: string | null;
      // INVENTORY-specific fields
      storeId: string | null;
      bin: string | null;
      lotNumber: string | null;
      serialNumbers: string[];
      poLine: {
        id: string;
        description: string;
        quantity: number;
        receivedQuantity: number;
        unitPrice: number;
      };
      serviceReceipt?: {
        id: string;
        serviceDate: Date;
        serviceProvider: string | null;
        hoursOrUnits: number | null;
        completionNotes: string | null;
        qualityRating: number | null;
      };
      consumableUsage?: {
        id: string;
        usedBy: string | null;
        usedByName: string | null;
        usedAt: Date;
        departmentId: string | null;
        areaId: string | null;
        purpose: string | null;
      };
    }>;
    totalReceipts: number;
    totalCost: number;
  }> {
    logger.info(`[getReceipts] Loading receipts for PO: ${poId}`);

    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(ctx, permission);

    // Verify PO exists
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true },
    });

    if (!po) {
      logger.error(`[getReceipts] PO not found: ${poId}`);
      throw new NotFoundError("PurchaseOrder", poId);
    }

    // Build where clause
    const where: {
      poLine: { purchaseOrderId: string };
      receivedAt?: { gte?: Date; lte?: Date };
    } = {
      poLine: { purchaseOrderId: poId },
    };

    if (filters?.startDate || filters?.endDate) {
      where.receivedAt = {};
      if (filters.startDate) {
        where.receivedAt.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.receivedAt.lte = filters.endDate;
      }
    }

    // Get receipts with related data
    const receipts = await prisma.pOLineReceipt.findMany({
      where,
      include: {
        poLine: {
          select: {
            id: true,
            lineNumber: true,
            lineType: true,
            description: true,
            quantity: true,
            receivedQuantity: true,
            unitPrice: true,
            purchaseOrderId: true,
            inventoryItem: {
              select: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
        },
        serviceReceipts: {
          select: {
            id: true,
            serviceDate: true,
            serviceProvider: true,
            hoursOrUnits: true,
            completionNotes: true,
            qualityRating: true,
          },
        },
        consumableUsages: {
          select: {
            id: true,
            usedBy: true,
            usedByName: true,
            usedAt: true,
            departmentId: true,
            areaId: true,
            purpose: true,
          },
        },
        // Include return/reversal receipts to determine reversed status
        returnReceipts: {
          select: {
            id: true,
            receiptNumber: true,
            notes: true,
          },
        },
      },
      orderBy: { receivedAt: "desc" },
    });

    logger.info(
      `[getReceipts] Found ${receipts.length} raw receipts for PO: ${poId}`,
    );

    // Get invoice information for receipts that have invoice numbers.
    // The map is keyed by:
    //   1. The full invoice number (for active invoices, which haven't been renamed).
    //   2. The *stripped* original number (for voided invoices whose invoiceNumber
    //      was renamed to "<orig>-VOID-<timestamp>" by voidInvoice()).
    //      This ensures receipt.invoiceNumber (still the original value on the receipt
    //      row) can resolve back to the voided invoice after VOID-01 cleared the FK.
    type InvoiceMapEntry = {
      id: string;
      invoiceNumber: string;
      status: string;
      displayNumber: string;
      isVoided: boolean;
    };
    const receiptInvoiceMap = new Map<string, InvoiceMapEntry>();
    const poIds = [...new Set(receipts.map((r) => r.poLine.purchaseOrderId))];

    if (poIds.length > 0) {
      const poInvoices = await prisma.invoice.findMany({
        where: {
          purchaseOrderId: { in: poIds },
        },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          voidedAt: true,
          purchaseOrderId: true,
        },
      });

      for (const invoice of poInvoices) {
        const isVoided =
          invoice.status === "Voided" ||
          invoice.status === "VOIDED" ||
          invoice.voidedAt !== null;
        // Strip -VOID-<timestamp> or -REJECTED-<timestamp> suffix to recover the
        // original vendor invoice number that the receipt row still carries.
        const displayNumber = invoice.invoiceNumber
          .replace(/-VOID-\d+$/, "")
          .replace(/-REJECTED-\d+$/, "");

        const entry: InvoiceMapEntry = {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          displayNumber,
          isVoided,
        };

        // Always map by the full (possibly suffixed) invoice number.
        receiptInvoiceMap.set(invoice.invoiceNumber, entry);

        // For voided/rejected invoices, ALSO map by the stripped original number so
        // that receipt.invoiceNumber (which was stored before the rename) hits the map.
        if (displayNumber !== invoice.invoiceNumber) {
          // Only write the stripped-number key if no non-void invoice already claimed it
          // (avoids overwriting a live invoice with the same original number, which would
          //  be an extremely unusual edge case but worth guarding against).
          if (!receiptInvoiceMap.has(displayNumber)) {
            receiptInvoiceMap.set(displayNumber, entry);
          }
        }
      }
    }

    // Filter by line type if specified
    const filteredReceipts = filters?.lineType
      ? receipts.filter((r) => r.poLine.lineType === filters.lineType)
      : receipts;

    // Calculate total cost
    const totalCost = filteredReceipts.reduce(
      (sum, r) => sum + Number(r.totalCost),
      0,
    );

    // Transform to response format
    const transformedReceipts = filteredReceipts.map((receipt) => {
      // Resolve invoice info.  Priority:
      //   1. Direct FK (receipt.invoiceId) — set on active receipts.
      //      After VOID-01 fix, this is NULL for receipts whose invoice was voided.
      //   2. Map lookup by receipt.invoiceNumber (the denormalised original vendor
      //      number stored on the receipt row, never renamed during void).
      //      This resolves voided invoices because the map is keyed by BOTH the
      //      renamed suffix number AND the stripped original number.
      const invoiceInfoByFk = receipt.invoiceId
        ? (receiptInvoiceMap.get(
            // receipts created before VOID-01 still have the FK; look up by the ID
            // via a linear search of the map's values (the map keys are invoice numbers,
            // not IDs, so we need the values).  For active invoices the number lookup
            // below will also succeed, making this path redundant — but it's a safety net.
            [...receiptInvoiceMap.values()].find(
              (e) => e.id === receipt.invoiceId,
            )?.invoiceNumber ?? "",
          ) ?? null)
        : null;
      const invoiceInfoByNum = receipt.invoiceNumber
        ? receiptInvoiceMap.get(receipt.invoiceNumber)
        : null;
      // Prefer FK-based resolution; fall back to number lookup (covers voided invoices).
      const invoiceInfo = invoiceInfoByFk ?? invoiceInfoByNum ?? null;
      const resolvedInvoiceId = receipt.invoiceId ?? invoiceInfo?.id ?? null;

      return {
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        poLineId: receipt.poLineId,
        lineType: receipt.poLine.lineType,
        quantityReceived: Number(receipt.quantityReceived),
        unitCost: Number(receipt.unitCost),
        totalCost: Number(receipt.totalCost),
        receivedBy: receipt.receivedBy,
        receivedByName: receipt.receivedByName,
        receivedAt: receipt.receivedAt,
        documentNumber: receipt.documentNumber,
        invoiceNumber: receipt.invoiceNumber,
        invoiceDate: receipt.invoiceDate,
        invoiceId: resolvedInvoiceId,
        /** Status of the linked invoice — 'Voided', 'Approved', 'Paid', etc. */
        invoiceStatus: invoiceInfo?.status ?? null,
        /** Vendor invoice number with void/rejected suffix stripped — always safe to display. */
        displayInvoiceNumber:
          invoiceInfo?.displayNumber ?? receipt.invoiceNumber,
        notes: receipt.notes,
        // Void/status field â€” important for VOIDED receipts to show in audit trail with correct label
        status: receipt.status,
        // Return/reversal fields
        isReturn: receipt.isReturn,
        originalReceiptId: receipt.originalReceiptId,
        returnReceipts: receipt.returnReceipts.map((rr) => ({
          id: rr.id,
          receiptNumber: rr.receiptNumber,
          notes: rr.notes,
        })),
        // INVENTORY-specific fields (proper columns, NO metadata)
        storeId: receipt.storeId,
        bin: receipt.bin,
        lotNumber: receipt.lotNumber,
        serialNumbers: receipt.serialNumbers,
        poLine: {
          id: receipt.poLine.id,
          lineNumber: receipt.poLine.lineNumber,
          description: receipt.poLine.description,
          quantity: Number(receipt.poLine.quantity),
          receivedQuantity: Number(receipt.poLine.receivedQuantity),
          unitPrice: Number(receipt.poLine.unitPrice),
          inventoryItem: receipt.poLine.inventoryItem
            ? {
                id: receipt.poLine.inventoryItem.id,
                sku: receipt.poLine.inventoryItem.sku,
                name: receipt.poLine.inventoryItem.name,
              }
            : null,
        },
        serviceReceipt: receipt.serviceReceipts[0]
          ? {
              id: receipt.serviceReceipts[0].id,
              serviceDate: receipt.serviceReceipts[0].serviceDate,
              serviceProvider: receipt.serviceReceipts[0].serviceProvider,
              hoursOrUnits: receipt.serviceReceipts[0].hoursOrUnits
                ? Number(receipt.serviceReceipts[0].hoursOrUnits)
                : null,
              completionNotes: receipt.serviceReceipts[0].completionNotes,
              qualityRating: receipt.serviceReceipts[0].qualityRating,
            }
          : undefined,
        consumableUsage: receipt.consumableUsages[0]
          ? {
              id: receipt.consumableUsages[0].id,
              usedBy: receipt.consumableUsages[0].usedBy,
              usedByName: receipt.consumableUsages[0].usedByName,
              usedAt: receipt.consumableUsages[0].usedAt,
              departmentId: receipt.consumableUsages[0].departmentId,
              areaId: receipt.consumableUsages[0].areaId,
              purpose: receipt.consumableUsages[0].purpose,
            }
          : undefined,
      };
    });

    return {
      receipts: transformedReceipts,
      totalReceipts: transformedReceipts.length,
      totalCost,
    };
  }

  /**
   * Reverses a receipt â€” the canonical method for undoing a receipt.
   *
   * This is the unified receipt reversal mechanism that replaces the old voidReceipt().
   * It handles ALL line types (INVENTORY, SERVICE, CONSUMABLE, NON_STOCK).
   *
   * Process:
   * 1. Permission check (same pattern as batchReceive)
   * 2. Load and validate the receipt
   * 3. Within a Prisma transaction:
   *    a. Soft-void the receipt (update notes â€” no voided field exists on POLineReceipt)
   *    b. Decrease PO line receivedQuantity
   *    c. Reverse receivedAmount for ALL line types
   *    d. For INVENTORY type: reverse inventory stock
   *    e. Invoice cleanup: unlink receipt from invoice, recalculate match status
   *    f. Recalculate PO-level invoice match flags
   *    g. Recalculate PO status
   * 4. Outside transaction: Reverse GL entries via glReversalService
   * 5. Audit trail via auditLogService
   *
   * NOTE: The POLineReceipt model has no `status` or `voidedAt` field.
   * The void is tracked via notes annotation and quantity/GL reversal.
   *
   * @param ctx - Service context
   * @param receiptId - The POLineReceipt ID to reverse
   * @param reason - Reason for reversing (defaults to 'Receipt reversed')
   * @returns The reversal result with details
   */
  async reverseReceipt(
    ctx: ServiceContext,
    receiptId: string,
    reason: string = "Receipt reversed",
  ): Promise<VoidReceiptResult> {
    // 1. Permission check (same pattern as batchReceive)
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(ctx, permission);

    // 2. Load the receipt with its PO line, PO, and related data
    const receipt = await prisma.pOLineReceipt.findUnique({
      where: { id: receiptId },
      include: {
        poLine: {
          include: {
            purchaseOrder: {
              include: { supplier: true },
            },
            chargeAllocations: true,
            inventoryItem: true,
          },
        },
        serviceReceipts: true,
        consumableUsages: true,
      },
    });

    if (!receipt) {
      throw new NotFoundError("POLineReceipt", receiptId);
    }

    // 3. Validate receipt can be reversed
    if (receipt.isReturn) {
      throw new BadRequestError(
        "Cannot reverse a return receipt. Only original receipts can be reversed.",
      );
    }

    // Check if receipt has already been voided/reversed (check status field first, then notes for backward compat)
    if (
      receipt.status === "REVERSED" ||
      receipt.status === "VOIDED" ||
      receipt.notes?.startsWith("[VOIDED]")
    ) {
      throw new BadRequestError(
        "This receipt has already been voided/reversed.",
      );
    }

    const po = receipt.poLine.purchaseOrder;
    // B2-5: Allow reversal on Closed POs (will be reopened to PartiallyReceived)
    // Only block Cancelled POs â€” Closed POs need reversal to fix receiving discrepancies
    if (po.status === "Cancelled") {
      throw new BadRequestError(
        `Cannot reverse receipt for PO in ${po.status} status. PO must not be Cancelled.`,
      );
    }

    const quantityReceived = Number(receipt.quantityReceived);
    const totalCost = Number(receipt.totalCost);
    const poLine = receipt.poLine;

    // 4. Within a Prisma transaction: reverse data changes
    const txResult = await prisma.$transaction(
      async (tx) => {
        // a. Soft-void: Update notes to indicate voided/reversed status
        await tx.pOLineReceipt.update({
          where: { id: receiptId },
          data: {
            status: "REVERSED", // B5-7: Set ReceiptStatus field
            notes: `[VOIDED] ${reason} (Reversed by ${ctx.userName} at ${new Date().toISOString()})${receipt.notes ? ` | Original notes: ${receipt.notes}` : ""}`,
          },
        });

        // b. Decrease PO line receivedQuantity by receipt quantity
        const currentReceived = new Decimal(poLine.receivedQuantity);
        const voidQuantity = new Decimal(quantityReceived);
        const newReceivedRaw = currentReceived.sub(voidQuantity);
        const newReceived = newReceivedRaw.lessThan(0)
          ? new Decimal(0)
          : newReceivedRaw;

        // c. Reverse receivedAmount for ALL line types (not just SERVICE)
        //    receivedAmount tracks cumulative dollar amounts received on the PO line
        const currentReceivedAmount = new Decimal(poLine.receivedAmount);
        const newReceivedAmountRaw = currentReceivedAmount.sub(totalCost);
        const newReceivedAmount = newReceivedAmountRaw.lessThan(0)
          ? 0
          : newReceivedAmountRaw.toNumber();

        await tx.pOLine.update({
          where: { id: poLine.id },
          data: {
            receivedQuantity: newReceived,
            receivedAmount: newReceivedAmount,
          },
        });

        // d. If INVENTORY type: reverse inventory stock (deduct the quantity)
        let inventoryAdjusted = false;
        if (
          poLine.lineType === LineItemType.INVENTORY &&
          poLine.inventoryItemId &&
          receipt.storeId
        ) {
          const stock = await tx.inventoryStock.findUnique({
            where: {
              inventoryItemId_storeId_bin: {
                inventoryItemId: poLine.inventoryItemId,
                storeId: receipt.storeId,
                bin: receipt.bin ?? "MAIN",
              },
            },
          });

          if (stock) {
            const currentQty = Number(stock.quantityOnHand);
            const newQty = Math.max(0, currentQty - quantityReceived);
            await tx.inventoryStock.update({
              where: {
                inventoryItemId_storeId_bin: {
                  inventoryItemId: poLine.inventoryItemId,
                  storeId: receipt.storeId,
                  bin: receipt.bin ?? "MAIN",
                },
              },
              data: { quantityOnHand: newQty },
            });
            inventoryAdjusted = true;

            // Create InventoryTransaction audit record for the stock return.
            // Previously omitted — the inventory reduction was invisible in the transaction log.
            try {
              await tx.inventoryTransaction.create({
                data: {
                  inventoryItemId: poLine.inventoryItemId,
                  storeId: receipt.storeId,
                  transactionType: "RECEIVE", // negative qty = stock return
                  quantity: -quantityReceived,
                  unitCost: Number(receipt.unitCost),
                  referenceType: "PurchaseOrder",
                  referenceId: poLine.purchaseOrderId,
                  referenceNumber: receipt.receiptNumber,
                  notes: `[REVERSED] ${reason}`,
                  performedBy: ctx.userId,
                  performedByName: ctx.userName,
                  transactionDate: new Date(),
                  isReversed: false,
                },
              });
            } catch (_err) {
              // Non-fatal — audit gap is better than blocking the reversal
            }
          }
        }

        // ── Preserve repairable serials on reversal ─────────────────────────
        // A reversal is most often used to correct a price / packing-slip and then
        // re-receive — the physical serialized unit never leaves. So we DO NOT
        // delete the auto-generated serials here. They stay linked to this (now
        // REVERSED) receipt and remain AVAILABLE; when the line is re-received,
        // receiveInventoryItem REUSES them so the SAME serial number is kept
        // instead of minting a new one. Stock was decremented above and is
        // restored on re-receive, so this nets out once the correction completes.
        if (
          poLine.lineType === LineItemType.INVENTORY &&
          poLine.inventoryItemId
        ) {
          const receiptSerials = await tx.repairableItem.findMany({
            where: { sourcePOLineReceiptId: receiptId },
            select: { id: true, serialNumber: true },
          });
          if (receiptSerials.length > 0) {
            logger.info(
              `[LineItemReceiving] reverseReceipt: preserved ${receiptSerials.length} serial(s) ` +
                `from reversed receipt ${receipt.receiptNumber} ` +
                `(${receiptSerials.map((s) => s.serialNumber).join(", ")}) — ` +
                `they will be reused if the line is re-received.`,
            );
          }
        }

        // â"€â"€â"€ B0-6: Invoice Cleanup on Receipt Reversal â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
        let invoiceUnlinked = false;
        const linkedInvoiceId: string | null = receipt.invoiceId;
        let invoiceMatchStatusUpdated: string | null = null;

        if (receipt.invoiceId) {
          logger.info(
            `[LineItemReceiving] reverseReceipt: Receipt ${receiptId} is linked to invoice ${receipt.invoiceId}. ` +
              `Performing invoice cleanup.`,
            {
              receiptId,
              receiptNumber: receipt.receiptNumber,
              invoiceId: receipt.invoiceId,
              poLineId: poLine.id,
            },
          );

          // e-i. Unlink the receipt from the invoice
          await tx.pOLineReceipt.update({
            where: { id: receiptId },
            data: { invoiceId: null },
          });
          invoiceUnlinked = true;

          // e-ii. Recalculate the invoice's match status based on remaining receipts
          const remainingReceipts = await tx.pOLineReceipt.findMany({
            where: {
              invoiceId: receipt.invoiceId,
              id: { not: receiptId }, // Exclude the current receipt being reversed
              isReturn: false, // Only count original receipts, not returns
              status: "ACTIVE", // B5-7: Only count active receipts
            },
            select: {
              id: true,
              totalCost: true,
            },
          });

          // Also check the receipt is not already [VOIDED] in notes
          const nonVoidedRemainingReceipts = remainingReceipts.filter(
            (r) => r.id !== receiptId,
          );

          // Load the invoice to get its total amount for comparison
          const invoice = await tx.invoice.findUnique({
            where: { id: receipt.invoiceId },
            select: {
              id: true,
              totalAmount: true,
              matchStatus: true,
              internalNumber: true,
            },
          });

          if (invoice) {
            let newMatchStatus: string;

            if (nonVoidedRemainingReceipts.length === 0) {
              // No receipts remain linked â†’ UNMATCHED
              newMatchStatus = "UNMATCHED";
            } else {
              // Some receipts remain â€” recalculate based on dollar amounts
              const totalReceiptAmount = nonVoidedRemainingReceipts.reduce(
                (sum, r) => sum + Number(r.totalCost),
                0,
              );
              const invoiceTotal = Number(invoice.totalAmount);

              if (invoiceTotal <= 0) {
                newMatchStatus = "UNMATCHED";
              } else if (totalReceiptAmount >= invoiceTotal) {
                newMatchStatus = "FULLY_MATCHED";
              } else if (totalReceiptAmount > 0) {
                newMatchStatus = "PARTIALLY_MATCHED";
              } else {
                newMatchStatus = "UNMATCHED";
              }
            }

            // Update invoice match status if it changed
            if (newMatchStatus !== invoice.matchStatus) {
              await tx.invoice.update({
                where: { id: receipt.invoiceId },
                data: {
                  matchStatus: newMatchStatus as
                    | "UNMATCHED"
                    | "PARTIALLY_MATCHED"
                    | "FULLY_MATCHED"
                    | "MATCH_APPROVED"
                    | "OVER_MATCHED",
                },
              });
              invoiceMatchStatusUpdated = newMatchStatus;

              logger.info(
                `[LineItemReceiving] reverseReceipt: Invoice ${invoice.internalNumber} match status updated ` +
                  `from ${invoice.matchStatus} to ${newMatchStatus} after receipt reversal.`,
                {
                  invoiceId: receipt.invoiceId,
                  internalNumber: invoice.internalNumber,
                  previousMatchStatus: invoice.matchStatus,
                  newMatchStatus,
                  remainingReceiptCount: nonVoidedRemainingReceipts.length,
                  receiptId,
                },
              );
            }
          }

          // f. Recalculate PO-level invoice match flags AND -- for the reversed line --
          //    decrement approvedInvoiceAmount so future receipts on that line are not blocked.
          //
          //    Root cause fix: when a full-PO invoice is approved it sets approvedInvoiceAmount
          //    on every line. If a receipt is later reversed the approvedInvoiceAmount on that
          //    line must be decremented so:
          //      1. availableAmount (approvedInvoiceAmount - receivedAmount) is recalculated correctly
          //      2. canReceive is reset to reflect remaining approved budget
          const allPoLines = await tx.pOLine.findMany({
            where: { purchaseOrderId: po.id },
            select: {
              id: true,
              invoiceMatched: true,
              canReceive: true,
              requiresInvoiceMatch: true,
              approvedInvoiceAmount: true,
              receivedAmount: true,
            },
          });

          for (const line of allPoLines) {
            if (!line.requiresInvoiceMatch) continue;

            // For the reversed line: decrement approvedInvoiceAmount by the reversed
            // receipt cost so the available-to-receive budget is restored.
            let lineApproved = new Decimal(line.approvedInvoiceAmount);
            if (line.id === poLine.id) {
              const decrementAmount = new Decimal(totalCost);
              const newApproved = Decimal.max(
                new Decimal(0),
                lineApproved.minus(decrementAmount),
              );
              if (!newApproved.equals(lineApproved)) {
                await tx.pOLine.update({
                  where: { id: line.id },
                  data: { approvedInvoiceAmount: newApproved },
                });
                logger.info(
                  `[LineItemReceiving] reverseReceipt: PO line ${line.id} approvedInvoiceAmount ` +
                    `decremented ${lineApproved.toNumber()} -> ${newApproved.toNumber()} ` +
                    `(reversed receipt cost: ${totalCost})`,
                  {
                    poLineId: line.id,
                    purchaseOrderId: po.id,
                    previousApprovedAmount: lineApproved.toNumber(),
                    newApprovedAmount: newApproved.toNumber(),
                    reversedReceiptCost: totalCost,
                  },
                );
                lineApproved = newApproved;
              }
            }

            // Re-read receivedAmount since we may have just updated it above
            const lineReceived =
              line.id === poLine.id
                ? new Decimal(newReceivedAmount)
                : new Decimal(line.receivedAmount);

            // invoiceMatched: true only when approved > 0 AND received >= approved
            const isStillMatched =
              lineApproved.greaterThan(0) &&
              lineReceived.greaterThanOrEqualTo(lineApproved);

            // canReceive: true as long as there is still approved invoice budget on this line
            const shouldCanReceive = lineApproved.greaterThan(0);

            const needsUpdate =
              line.invoiceMatched !== isStillMatched ||
              (line.id === poLine.id && line.canReceive !== shouldCanReceive);

            if (needsUpdate) {
              const updatePayload: {
                invoiceMatched: boolean;
                canReceive?: boolean;
              } = {
                invoiceMatched: isStillMatched,
              };
              // Only update canReceive on the specific line that was reversed
              if (line.id === poLine.id) {
                updatePayload.canReceive = shouldCanReceive;
              }
              await tx.pOLine.update({
                where: { id: line.id },
                data: updatePayload,
              });

              logger.info(
                `[LineItemReceiving] reverseReceipt: PO line ${line.id} updated -- ` +
                  `invoiceMatched=${isStillMatched}, canReceive=${updatePayload.canReceive ?? "(unchanged)"}`,
                {
                  poLineId: line.id,
                  purchaseOrderId: po.id,
                  invoiceMatched: isStillMatched,
                  canReceive: updatePayload.canReceive,
                  approvedInvoiceAmount: lineApproved.toNumber(),
                  receivedAmount: lineReceived.toNumber(),
                },
              );
            }
          }
        }

        // g. Recalculate PO status based on updated received quantities
        const updatedLines = await tx.pOLine.findMany({
          where: { purchaseOrderId: po.id },
          select: {
            quantity: true,
            receivedQuantity: true,
          },
        });

        const allFullyReceived = updatedLines.every((line) =>
          new Decimal(line.receivedQuantity).greaterThanOrEqualTo(
            new Decimal(line.quantity),
          ),
        );

        const anyReceived = updatedLines.some((line) =>
          new Decimal(line.receivedQuantity).greaterThan(0),
        );

        let newStatus = po.status;
        if (allFullyReceived) {
          newStatus = "Received";
        } else if (anyReceived) {
          newStatus = "PartiallyReceived";
        } else {
          // All receivedQuantity === 0: back to pre-receipt state
          newStatus = "Ordered";
        }

        // B2-5: Normalize PO status after receipt reversal
        // If PO was Closed and we're reversing a receipt, reopen to PartiallyReceived
        // so the receiving discrepancy is visible
        if (po.status === "Closed") {
          // Override the calculated status â€” Closed POs reopened after reversal should
          // become PartiallyReceived (or Ordered if no qty remains)
          const closedOverrideStatus = anyReceived
            ? "PartiallyReceived"
            : "Ordered";
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              status: closedOverrideStatus,
              receivedDate: null,
            },
          });
          newStatus = closedOverrideStatus;
          logger.info(
            `[B2-5] PO ${po.poNumber}: Reopened from Closed to ${closedOverrideStatus} after receipt reversal`,
          );
        } else if (newStatus !== po.status) {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              status: newStatus,
              receivedDate: newStatus === "Received" ? po.receivedDate : null,
            },
          });
        }

        // B0-7: GL reversals now run inside the transaction for atomicity.
        // If any GL reversal fails, the entire transaction (data changes + GL) rolls back.
        let glReversalsAttempted = 0;
        let glReversalsSucceeded = 0;

        try {
          // Find POSTED GL transactions for this receipt
          // Receipt GL transactions use referenceType: 'POLineReceipt', referenceId: receiptId
          const glTransactions = await tx.gLTransaction.findMany({
            where: {
              referenceType: "POLineReceipt",
              referenceId: receiptId,
              status: "POSTED",
              reversedAt: null,
            },
            select: { id: true },
          });

          glReversalsAttempted = glTransactions.length;

          for (const glTx of glTransactions) {
            try {
              await glReversalService.reverseTransaction(
                glTx.id,
                `Receipt reversal: ${reason} (Receipt ${receipt.receiptNumber})`,
                ctx.userId,
              );
              glReversalsSucceeded++;
            } catch (glError) {
              logger.error(
                `[LineItemReceiving] GL reversal failed for GL transaction ${glTx.id}, rolling back`,
                {
                  error:
                    glError instanceof Error
                      ? glError.message
                      : String(glError),
                  receiptId,
                },
              );
              throw glError; // B0-7: Re-throw to roll back entire transaction
            }
          }
        } catch (glError) {
          logger.error(
            `[LineItemReceiving] GL reversal lookup/execution failed, rolling back transaction`,
            {
              error:
                glError instanceof Error ? glError.message : String(glError),
              receiptId,
            },
          );
          throw glError; // B0-7: Re-throw to roll back entire transaction
        }

        return {
          inventoryAdjusted,
          newStatus,
          invoiceUnlinked,
          invoiceId: linkedInvoiceId,
          invoiceMatchStatusUpdated,
          glReversalsAttempted,
          glReversalsSucceeded,
        };
      },
      { timeout: 30000 },
    );

    // B2-6: Reverse requisition sync after receipt reversal
    try {
      const { requisitionStatusSyncService } =
        await import("@/services/purchasing/requisition/requisition-status-sync.service");
      await requisitionStatusSyncService.syncRequisitionsForPO(po.id);
      logger.info(
        `[B2-6] Requisition sync updated after receipt reversal on PO ${po.poNumber}`,
      );
    } catch (syncError) {
      logger.error(
        `[B2-6] Requisition sync failed after receipt reversal on PO ${po.poNumber}`,
        syncError,
      );
      // Non-fatal â€” don't block the reversal
    }

    // 5. Audit trail
    await auditLogService.logCrudOperation(
      ctx,
      AuditAction.VOID,
      "POLineReceipt",
      receiptId,
      receipt.receiptNumber,
      {
        quantityReceived,
        totalCost,
        poStatus: po.status,
        poNumber: po.poNumber,
      },
      {
        action: "REVERSE_RECEIPT",
        reason,
        glReversalsAttempted: txResult.glReversalsAttempted,
        glReversalsSucceeded: txResult.glReversalsSucceeded,
        inventoryAdjusted: txResult.inventoryAdjusted,
        newPOStatus: txResult.newStatus,
        invoiceUnlinked: txResult.invoiceUnlinked,
        invoiceId: txResult.invoiceId,
        invoiceMatchStatusUpdated: txResult.invoiceMatchStatusUpdated,
      },
    );

    // B3-8: Receipt reversed notification
    try {
      await notificationService.sendNotification(ctx, {
        userId: po.createdBy ?? ctx.userId,
        type: PURCHASING_NOTIFICATIONS.RECEIPT_REVERSED.type,
        category: NotificationCategory.PURCHASING,
        title: `Receipt ${receipt.receiptNumber} Reversed`,
        message: `Receipt ${receipt.receiptNumber} for PO ${po.poNumber} has been reversed. Reason: ${reason}`,
        priority: NotificationPriority.HIGH,
        actionUrl: `/purchasing/purchase-orders/${po.id}`,
        actionLabel: "View Purchase Order",
        data: { poNumber: po.poNumber, poId: po.id, receiptId, reason },
      });
    } catch (notifError) {
      logger.error(
        "[B3-8] Failed to send receipt reversed notification",
        notifError,
      );
    }

    // 7. Return the reversal result
    return {
      receiptId,
      receiptNumber: receipt.receiptNumber,
      quantityReversed: quantityReceived,
      totalCostReversed: totalCost,
      glReversalsAttempted: txResult.glReversalsAttempted,
      glReversalsSucceeded: txResult.glReversalsSucceeded,
      inventoryAdjusted: txResult.inventoryAdjusted,
      poStatusUpdated: txResult.newStatus,
      invoiceUnlinked: txResult.invoiceUnlinked,
      invoiceId: txResult.invoiceId,
      invoiceMatchStatusUpdated: txResult.invoiceMatchStatusUpdated,
    };
  }

  /**
   * @deprecated Use reverseReceipt() instead. This method delegates to reverseReceipt()
   * and exists only for backward compatibility.
   *
   * Voids a receipt by delegating to the unified reverseReceipt() method.
   *
   * @param ctx - Service context
   * @param receiptId - The POLineReceipt ID to void
   * @param reason - Reason for voiding
   * @returns The void result with reversal details
   */
  async voidReceipt(
    ctx: ServiceContext,
    receiptId: string,
    reason: string,
  ): Promise<VoidReceiptResult> {
    logger.warn(
      "[DEPRECATED] voidReceipt() is deprecated. Use reverseReceipt() instead.",
    );
    logger.warn(
      `[LineItemReceiving] DEPRECATED voidReceipt() called for receipt ${receiptId}. Use reverseReceipt() instead.`,
      { receiptId, reason, calledBy: ctx.userName },
    );
    // B5-7: Delegate to reverseReceipt, then override status to VOIDED
    // (reverseReceipt sets REVERSED; voidReceipt should use VOIDED for distinction)
    const result = await this.reverseReceipt(ctx, receiptId, reason);
    try {
      await prisma.pOLineReceipt.update({
        where: { id: receiptId },
        data: { status: "VOIDED" },
      });
    } catch (statusError) {
      logger.error(
        `[LineItemReceiving] Failed to set VOIDED status on receipt ${receiptId} after reversal`,
        {
          error:
            statusError instanceof Error
              ? statusError.message
              : String(statusError),
        },
      );
    }
    return result;
  }
}

// Export singleton instance
// In development, always create a fresh instance so HMR picks up code changes.
// In production, cache via globalThis to avoid creating multiple instances.
const globalForLineItemReceiving = globalThis as unknown as {
  lineItemReceivingService: LineItemReceivingService | undefined;
};
if (process.env.NODE_ENV !== "production") {
  globalForLineItemReceiving.lineItemReceivingService =
    new LineItemReceivingService();
} else {
  globalForLineItemReceiving.lineItemReceivingService =
    globalForLineItemReceiving.lineItemReceivingService ??
    new LineItemReceivingService();
}
export const lineItemReceivingService =
  globalForLineItemReceiving.lineItemReceivingService;
