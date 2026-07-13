/**.
 * Purchase Order Cancellation Service
 *
 * Handles PO cancellation for edit scenarios, including:
 * - Cancelling the PO with proper tracking
 * - Reversing GL transactions and releasing budget
 * - Resetting linked requisitions back to DRAFT status
 * - Maintaining audit trail and supersession links
 *
 * This service is specifically for the "financial changes require re-approval" workflow.
 */

import { PrismaClient, LineItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import { logger } from "@/lib/logger";

/**
 * Input for cancelling a PO for edit
 */
export interface CancelPOForEditInput {
  reason: string;
  financialChanges: string[];
  supersededByPOId?: string;
  supersededByPONumber?: string;
  updatedLineItems?: Array<{
    id?: string;
    inventoryItemId?: string | null;
    supplierId?: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    estimatedPrice: number;
    lineType: string;
    // Consumable-specific fields
    consumableCategory?: string | null;
    manufacturer?: string | null;
    modelNumber?: string | null;
    packageSize?: string | null;
    monthlyUsageRate?: number | null;
    storageRequirements?: string | null;
    sdsRequired?: boolean;
    expirationTracking?: boolean;
  }>;
}

/**
 * Result of PO cancellation
 */
export interface CancelPOForEditResult {
  cancelledPOId: string;
  cancelledPONumber: string;
  resetRequisitions: Array<{
    id: string;
    reqNumber: string;
    previousStatus: string;
    newStatus: string;
  }>;
  message: string;
}

/**
 * Purchase Order Cancellation Service
 */
class PurchaseOrderCancellationService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.PURCHASING;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Cancel a PO for edit and reset linked requisitions
   *
   * This method implements a "reset to Draft" strategy instead of permanent cancellation:
   * 1. Validates the PO can be reset
   * 2. Resets PO to Draft status with updated line items
   * 3. Reverses GL transactions and releases budget
   * 4. Resets all linked requisitions to DRAFT for re-approval
   * 5. PRESERVES PO ↔ Requisition linkage (same PO number is reused)
   * 6. Logs complete audit trail
   *
   * This approach preserves the PO identity (important for SAP-imported POs)
   * and avoids the need to create a new PO after requisition re-approval.
   *
   * @param context - Service context with user and permissions
   * @param poId - Purchase Order ID to reset
   * @param input - Reset details including reason and updated line items
   * @returns Result with reset PO and reset requisitions
   */
  async cancelForEdit(
    context: ServiceContext,
    poId: string,
    input: CancelPOForEditInput,
  ): Promise<CancelPOForEditResult> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    validateRequired(poId, "poId");
    validateRequired(input.reason, "reason");

    // Get the PO with requisitions
    // IMPORTANT: lines must be ordered by lineNumber (then createdAt as tiebreaker) to
    // match the order the UI displays them. The cancelForEdit service applies
    // updatedLineItems positionally (lines[i] ↔ updatedLineItems[i]), so a mismatch in
    // line order would silently write the wrong price/description to the wrong DB line.
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        supplier: true,
        lines: {
          orderBy: [{ lineNumber: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!po) {
      throw new NotFoundError("PurchaseOrder", poId);
    }

    // Validate PO can be reset
    // B2-7: Also block PartiallyReceived and Received — goods already received, can't reset to Draft
    if (
      po.status === "Closed" ||
      po.status === "Cancelled" ||
      po.status === "PartiallyReceived" ||
      po.status === "Received"
    ) {
      throw new BadRequestError(
        `Cannot cancel PO for editing when status is ${po.status}. ` +
          `POs with received goods cannot be reset to Draft.`,
      );
    }

    // Get linked requisitions with their line items AND budget allocations
    const requisitionIds = po.requisitionIds;
    const requisitions = await this.prisma.requisition.findMany({
      where: {
        id: { in: requisitionIds },
      },
      include: {
        lines: {
          // RequisitionLine has no lineNumber column — order by createdAt only.
          // (POLine has lineNumber, but RequisitionLine does not.)
          orderBy: [{ createdAt: "asc" }],
        },
        budgetHeader: true,
        lineAllocations: {
          include: {
            accountCode: true,
            department: true,
            area: true,
            project: true,
          },
        },
      },
    });

    // Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Reset PO to Draft (NOT Cancelled) — preserves PO identity and number
      const resetPO = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: "Draft",
          // Clear approval/submission timestamps so PO goes through workflow again
          approvedAt: null,
          submittedAt: null,
          sentAt: null,
          // Clear any previous cancellation fields
          cancelledReason: null,
          cancelledBy: null,
          cancelledAt: null,
          supersededByPOId: null,
          supersededByPONumber: null,
        },
      });

      // 2. Update PO line items with new prices if provided
      if (input.updatedLineItems && input.updatedLineItems.length > 0) {
        // Update existing PO lines in place (preserves IDs and cross-references)
        const existingPOLineById = new Map(po.lines.map((l) => [l.id, l]));
        for (const updatedItem of input.updatedLineItems) {
          const existingLine = updatedItem.id
            ? existingPOLineById.get(updatedItem.id)
            : undefined;
          if (!existingLine) continue;

          await tx.pOLine.update({
            where: { id: existingLine.id },
            data: {
              description: updatedItem.description,
              quantity: updatedItem.quantity,
              unitPrice: updatedItem.unitPrice,
              totalPrice: updatedItem.quantity * updatedItem.unitPrice,
              lineType: updatedItem.lineType as LineItemType,
            },
          });
        }

        // Handle new lines (if more items were added)
        if (input.updatedLineItems.length > po.lines.length) {
          for (
            let i = po.lines.length;
            i < input.updatedLineItems.length;
            i++
          ) {
            const newItem = input.updatedLineItems[i];
            if (!newItem) continue;

            await tx.pOLine.create({
              data: {
                purchaseOrderId: poId,
                lineNumber: i + 1,
                description: newItem.description,
                quantity: newItem.quantity,
                unitPrice: newItem.unitPrice,
                totalPrice: newItem.quantity * newItem.unitPrice,
                lineType: newItem.lineType as LineItemType,
              },
            });
          }
        }

        // Recalculate PO total amount
        const newTotal = input.updatedLineItems.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0,
        );
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: { totalAmount: newTotal },
        });
      }

      // 3. Find and reverse ALL GL transactions for this PO
      // CRITICAL: Must reverse ALL GL entries and release budget
      // There may be multiple: EXPENDITURE (from approval) + ADJUSTMENT/PRICE_VAR (from send)
      const poGLTransactions = await tx.gLTransaction.findMany({
        where: {
          referenceType: "PurchaseOrder",
          referenceId: poId,
          status: "POSTED",
        },
      });

      for (const glTransaction of poGLTransactions) {
        // Reverse each GL transaction AND automatically correct budget
        // GLReversalService handles both GL reversal and budget correction in one call
        try {
          await glReversalService.reverseTransaction(
            glTransaction.id,
            `PO ${po.poNumber} reset to Draft: ${input.reason}`,
            context.userId,
          );
        } catch (glReversalError) {
          logger.warn(
            `[PO CancelForEdit] GL reversal failed for PO ${po.poNumber} transaction ${glTransaction.id} (non-fatal — reset will proceed). Manual GL correction may be required.`,
            {
              error:
                glReversalError instanceof Error
                  ? glReversalError.message
                  : String(glReversalError),
              purchaseOrderId: poId,
              poNumber: po.poNumber,
              glTransactionId: glTransaction.id,
              reason: input.reason,
            },
          );
        }
      }

      // 3b. Also reverse any late-added POLine EXPENDITURE entries.
      // Lines added after PO send (Ordered/PartiallyReceived) carry their
      // commitment in separate 'POLine' EXPENDITURE GL entries. Reverse them
      // here so budget is fully released when the PO is reset to Draft.
      const cancelForEditPOLineIds = await tx.pOLine.findMany({
        where: { purchaseOrderId: poId },
        select: { id: true },
      });
      if (cancelForEditPOLineIds.length > 0) {
        const poLineIdListForEdit = cancelForEditPOLineIds.map((l) => l.id);
        const lateAddedGLTxnsForEdit = await tx.gLTransaction.findMany({
          where: {
            referenceType: "POLine",
            referenceId: { in: poLineIdListForEdit },
            status: "POSTED",
          },
        });
        for (const lateGLTxn of lateAddedGLTxnsForEdit) {
          try {
            await glReversalService.reverseTransaction(
              lateGLTxn.id,
              `PO ${po.poNumber} reset to Draft: ${input.reason}`,
              context.userId,
            );
          } catch (lateRevErr) {
            logger.warn(
              `[PO CancelForEdit] GL reversal failed for late-added POLine ${lateGLTxn.referenceId} ` +
                `on PO ${po.poNumber} (non-fatal — reset will proceed). Manual GL correction may be required.`,
              {
                error:
                  lateRevErr instanceof Error
                    ? lateRevErr.message
                    : String(lateRevErr),
                purchaseOrderId: poId,
                poNumber: po.poNumber,
                glTransactionId: lateGLTxn.id,
              },
            );
          }
        }
      }

      // 4. Reset all linked requisitions (for budget re-approval)
      // CRITICAL: PO ↔ Req linkage is PRESERVED — purchaseOrderId stays on req
      const resetRequisitions: CancelPOForEditResult["resetRequisitions"] = [];

      for (const req of requisitions) {
        // Update requisition line items in place if provided (preserves IDs and PO refs)
        if (input.updatedLineItems && input.updatedLineItems.length > 0) {
          // Build map from PO line id → incoming update (id-based, not positional)
          const updateByPOLineId = new Map(
            input.updatedLineItems.filter((u) => u.id).map((u) => [u.id!, u]),
          );

          // V-2: Update REQ lines matched via their poLineId cross-link
          for (const existingLine of req.lines) {
            const updatedItem = existingLine.poLineId
              ? updateByPOLineId.get(existingLine.poLineId)
              : undefined;
            if (!updatedItem) continue;

            await tx.requisitionLine.update({
              where: { id: existingLine.id },
              data: {
                description: updatedItem.description,
                quantity: updatedItem.quantity,
                estimatedPrice: updatedItem.unitPrice,
                lineType: updatedItem.lineType as LineItemType,
                lineStatus: "PENDING",
                convertedToPOAt: null,
                convertedToPOBy: null,
                consumableCategory: updatedItem.consumableCategory ?? undefined,
                manufacturer: updatedItem.manufacturer ?? undefined,
                modelNumber: updatedItem.modelNumber ?? undefined,
                packageSize: updatedItem.packageSize ?? undefined,
                monthlyUsageRate: updatedItem.monthlyUsageRate ?? undefined,
                storageRequirements:
                  updatedItem.storageRequirements ?? undefined,
                sdsRequired: updatedItem.sdsRequired ?? false,
                expirationTracking: updatedItem.expirationTracking ?? false,
              },
            });
          }

          // V-3: Update allocation amounts using the same cross-link map
          let newBudgetTotal = 0;
          for (const existingLine of req.lines) {
            const updatedItem = existingLine.poLineId
              ? updateByPOLineId.get(existingLine.poLineId)
              : undefined;
            if (!updatedItem) continue;

            const lineTotal = updatedItem.quantity * updatedItem.unitPrice;
            newBudgetTotal += lineTotal;

            const lineAllocations = req.lineAllocations.filter(
              (a) => a.requisitionLineId === existingLine.id,
            );
            for (const alloc of lineAllocations) {
              await tx.requisitionLineAllocation.update({
                where: { id: alloc.id },
                data: {
                  amount: lineTotal * (Number(alloc.percentage) / 100),
                },
              });
            }
          }

          if (req.budgetHeader && newBudgetTotal > 0) {
            await tx.requisitionBudgetHeader.updateMany({
              where: { requisitionId: req.id },
              data: { totalAmount: newBudgetTotal },
            });
          }
        } else {
          // No updated line items — just reset line status for lines belonging to THIS PO.
          // CRITICAL multi-PO fix: when a requisition has lines split across multiple POs
          // (e.g. Grainger + ULINE), only reset lines belonging to the PO being cancelled.
          // Lines for other POs (already Ordered) must NOT be touched.
          //
          // We identify "this PO's lines" by their RequisitionLine.purchaseOrderId.
          // If no lines have purchaseOrderId set (old data without linkage), fall back
          // to resetting all lines (original behavior — safe for single-PO reqs).
          const linesForThisPO = req.lines.filter(
            (l) => l.purchaseOrderId === poId,
          );
          const lineFilter =
            linesForThisPO.length > 0
              ? {
                  requisitionId: req.id,
                  id: { in: linesForThisPO.map((l) => l.id) },
                }
              : { requisitionId: req.id }; // fallback: reset all (single-PO req)

          await tx.requisitionLine.updateMany({
            where: lineFilter,
            data: {
              lineStatus: "PENDING",
              convertedToPOAt: null,
              convertedToPOBy: null,
              // KEEP purchaseOrderId, purchaseOrderNumber, poLineId
            },
          });
        }

        // CRITICAL: Delete existing approval records when resetting requisition
        // This prevents unique constraint violations on re-submission
        await tx.requisitionApproval.deleteMany({
          where: { requisitionId: req.id },
        });

        // CRITICAL: Reverse ENCUMBRANCE GL transactions for this requisition
        // When a requisition was approved, ENCUMBRANCE GL entries were created to reserve budget.
        // On PO reset, these must also be reversed to release the reserved budget.
        const reqGLTransactions = await tx.gLTransaction.findMany({
          where: {
            referenceType: "Requisition",
            referenceId: req.id,
            status: "POSTED",
          },
        });

        for (const reqGLTxn of reqGLTransactions) {
          try {
            await glReversalService.reverseTransaction(
              reqGLTxn.id,
              `Requisition ${req.reqNumber} reset due to PO ${po.poNumber} price change: ${input.reason}`,
              context.userId,
            );
          } catch (reqGLReversalError) {
            logger.warn(
              `[PO CancelForEdit] REQ GL reversal failed for Requisition ${req.reqNumber} transaction ${reqGLTxn.id} (non-fatal — reset will proceed). Manual GL correction may be required.`,
              {
                error:
                  reqGLReversalError instanceof Error
                    ? reqGLReversalError.message
                    : String(reqGLReversalError),
                requisitionId: req.id,
                reqNumber: req.reqNumber,
                glTransactionId: reqGLTxn.id,
                relatedPOId: poId,
                poNumber: po.poNumber,
                reason: input.reason,
              },
            );
          }
        }

        // Multi-PO req: if the req has other lines already ORDERED (for a different PO),
        // we do NOT downgrade the req status to Draft — it should stay Ordered.
        // Only reset to Draft when ALL lines are now PENDING (single PO, or all POs edited).
        const hasOtherOrderedLines = req.lines.some(
          (l) => l.purchaseOrderId !== poId && l.lineStatus === "ORDERED",
        );

        const resetReq = await tx.requisition.update({
          where: { id: req.id },
          data: {
            // Only downgrade to Draft if no OTHER POs still have lines ORDERED.
            // If another PO's lines are still ORDERED, keep req Ordered but mark
            // the specific lines for this PO as PENDING.
            status: hasOtherOrderedLines ? req.status : "Draft",
            approvalStatus: hasOtherOrderedLines ? req.approvalStatus : "DRAFT",
            // Only clear approval timestamps if fully resetting to Draft
            currentApprovalLevel: hasOtherOrderedLines
              ? req.currentApprovalLevel
              : null,
            submittedForApprovalAt: hasOtherOrderedLines
              ? req.submittedForApprovalAt
              : null,
            finalApprovedAt: hasOtherOrderedLines ? req.finalApprovedAt : null,
            finalApprovedById: hasOtherOrderedLines
              ? req.finalApprovedById
              : null,
            // PRESERVE PO linkage — this is the key difference from the old approach
            // purchaseOrderId and purchaseOrderNumber are NOT cleared
            // Track reset history for audit trail
            resetCount: (req.resetCount || 0) + 1,
            lastResetAt: new Date(),
            lastResetReason: `PO ${po.poNumber} reset to Draft due to financial changes: ${input.financialChanges.join(", ")}`,
          },
        });

        resetRequisitions.push({
          id: resetReq.id,
          reqNumber: resetReq.reqNumber,
          previousStatus: req.status,
          newStatus: resetReq.status,
        });

        // Log requisition reset with cross-reference to reset PO
        await auditLogService.logCrudOperation(
          context,
          AuditAction.UPDATE,
          "Requisition",
          req.id,
          req.reqNumber,
          {
            status: req.status,
            approvalStatus: req.approvalStatus,
          },
          {
            status: "Draft",
            approvalStatus: "DRAFT",
          },
          {
            action: "requisition_reset_from_po_edit",
            resetPOId: po.id,
            resetPONumber: po.poNumber,
            reason: input.reason,
            financialChanges: input.financialChanges,
            resetCount: (req.resetCount || 0) + 1,
            poLinkagePreserved: true,
            relatedEntityType: "PurchaseOrder",
            relatedEntityId: po.id,
            relatedEntityNumber: po.poNumber,
          },
        );
      }

      // 5. Calculate detailed line item changes if updatedLineItems provided
      const lineItemChanges =
        input.updatedLineItems && input.updatedLineItems.length > 0
          ? input.updatedLineItems
              .map((updatedItem) => {
                const originalLine = updatedItem.id
                  ? po.lines.find((l) => l.id === updatedItem.id)
                  : undefined;
                if (!originalLine) return null;

                const changes: Record<string, { from: unknown; to: unknown }> =
                  {};

                // Check quantity change
                if (Number(originalLine.quantity) !== updatedItem.quantity) {
                  changes.quantity = {
                    from: Number(originalLine.quantity),
                    to: updatedItem.quantity,
                  };
                }

                // Check price change
                if (Number(originalLine.unitPrice) !== updatedItem.unitPrice) {
                  changes.unitPrice = {
                    from: Number(originalLine.unitPrice),
                    to: updatedItem.unitPrice,
                  };
                }

                // Check description change
                if (originalLine.description !== updatedItem.description) {
                  changes.description = {
                    from: originalLine.description,
                    to: updatedItem.description,
                  };
                }

                // Only return if there are actual changes
                if (Object.keys(changes).length > 0) {
                  return {
                    lineNumber: originalLine.lineNumber,
                    description: originalLine.description,
                    changes,
                  };
                }
                return null;
              })
              .filter(
                (change): change is NonNullable<typeof change> =>
                  change !== null,
              )
          : [];

      // 6. Log PO reset with cross-references to affected requisitions AND detailed changes
      await auditLogService.logCrudOperation(
        context,
        AuditAction.UPDATE,
        "PurchaseOrder",
        po.id,
        po.poNumber,
        {
          status: po.status,
          totalAmount: Number(po.totalAmount),
          supplierId: po.supplierId,
          lineItems: po.lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
          })),
        },
        {
          status: "Draft",
          reason: input.reason,
          updatedLineItems: input.updatedLineItems?.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
        {
          action: "po_reset_for_edit",
          reason: input.reason,
          financialChanges: input.financialChanges,
          lineItemChanges:
            lineItemChanges.length > 0 ? lineItemChanges : undefined,
          detailedChanges: lineItemChanges.map((change) => ({
            field: `Line ${change.lineNumber}: ${change.description}`,
            from: change.changes,
            to: change.changes,
            description: Object.entries(change.changes)
              .map(([field, values]) => {
                if (field === "quantity") {
                  return `Quantity changed from ${values.from} to ${values.to}`;
                } else if (field === "unitPrice") {
                  return `Unit price changed from $${values.from} to $${values.to}`;
                } else if (field === "description") {
                  return `Description changed from "${values.from}" to "${values.to}"`;
                }
                return `${field} changed`;
              })
              .join(", "),
          })),
          requisitionsReset: resetRequisitions.length,
          requisitionIds: requisitions.map((r) => r.id),
          requisitionNumbers: requisitions.map((r) => r.reqNumber),
          relatedEntityType: "Requisition",
          relatedEntityIds: requisitions.map((r) => r.id),
          relatedEntityNumbers: requisitions.map((r) => r.reqNumber),
        },
      );

      // 7. Create audit log entries for each requisition showing PO was reset
      for (const req of requisitions) {
        await auditLogService.logCrudOperation(
          context,
          AuditAction.UPDATE,
          "Requisition",
          req.id,
          req.reqNumber,
          {},
          {},
          {
            action: "related_po_reset_for_edit",
            resetPOId: po.id,
            resetPONumber: po.poNumber,
            reason: input.reason,
            financialChanges: input.financialChanges,
            message: `Purchase Order ${po.poNumber} was reset to Draft due to financial changes. Requisition reset to DRAFT for re-approval. PO linkage preserved.`,
            relatedEntityType: "PurchaseOrder",
            relatedEntityId: po.id,
            relatedEntityNumber: po.poNumber,
          },
        );
      }

      return {
        cancelledPOId: resetPO.id,
        cancelledPONumber: resetPO.poNumber,
        resetRequisitions,
        message: `PO ${resetPO.poNumber} reset to Draft and ${resetRequisitions.length} requisition(s) reset to DRAFT for re-approval`,
      };
    });

    return result;
  }

  /**
   * Check if a PO can be cancelled for edit
   *
   * @param context - Service context
   * @param poId - Purchase Order ID
   * @returns Boolean indicating if PO can be cancelled
   */
  async canCancelForEdit(
    context: ServiceContext,
    poId: string,
  ): Promise<{ canCancel: boolean; reason?: string }> {
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    validateRequired(poId, "poId");

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        status: true,
        poNumber: true,
      },
    });

    if (!po) {
      return {
        canCancel: false,
        reason: "Purchase order not found",
      };
    }

    // Cannot cancel if already closed, cancelled, or has received goods
    // B2-7: Also block PartiallyReceived and Received
    if (
      po.status === "Closed" ||
      po.status === "Cancelled" ||
      po.status === "PartiallyReceived" ||
      po.status === "Received"
    ) {
      return {
        canCancel: false,
        reason: `PO cannot be cancelled for edit when status is ${po.status}. POs with received goods cannot be reset to Draft.`,
      };
    }

    // Can cancel if in any other status
    return {
      canCancel: true,
    };
  }

  /**
   * Get PO cancellation history
   *
   * @param context - Service context
   * @param poId - Purchase Order ID
   * @returns Cancellation details if PO was cancelled
   */
  async getCancellationDetails(
    context: ServiceContext,
    poId: string,
  ): Promise<{
    isCancelled: boolean;
    cancelledReason?: string;
    cancelledBy?: string;
    cancelledAt?: Date;
    supersededByPOId?: string;
    supersededByPONumber?: string;
  } | null> {
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    validateRequired(poId, "poId");

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        status: true,
        cancelledReason: true,
        cancelledBy: true,
        cancelledAt: true,
        supersededByPOId: true,
        supersededByPONumber: true,
      },
    });

    if (!po) {
      return null;
    }

    return {
      isCancelled: po.status === "Cancelled",
      cancelledReason: po.cancelledReason ?? undefined,
      cancelledBy: po.cancelledBy ?? undefined,
      cancelledAt: po.cancelledAt ?? undefined,
      supersededByPOId: po.supersededByPOId ?? undefined,
      supersededByPONumber: po.supersededByPONumber ?? undefined,
    };
  }

  /**
   * Get requisitions that were reset from a cancelled PO
   *
   * @param context - Service context
   * @param poId - Purchase Order ID
   * @returns List of requisitions that were reset
   */
  async getResetRequisitions(
    context: ServiceContext,
    poId: string,
  ): Promise<
    Array<{
      id: string;
      reqNumber: string;
      status: string;
      resetCount: number;
      lastResetAt: Date | null;
      lastResetReason: string | null;
    }>
  > {
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    validateRequired(poId, "poId");

    // Find requisitions that have this PO in their previousPOIds
    const requisitions = await this.prisma.requisition.findMany({
      where: {
        previousPOIds: {
          has: poId,
        },
      },
      select: {
        id: true,
        reqNumber: true,
        status: true,
        resetCount: true,
        lastResetAt: true,
        lastResetReason: true,
      },
      orderBy: {
        lastResetAt: "desc",
      },
    });

    return requisitions;
  }
}

const globalForPOCancellation = globalThis as unknown as {
  purchaseOrderCancellationService:
    | PurchaseOrderCancellationService
    | undefined;
};
export const purchaseOrderCancellationService =
  globalForPOCancellation.purchaseOrderCancellationService ??
  (globalForPOCancellation.purchaseOrderCancellationService =
    new PurchaseOrderCancellationService(prisma));
