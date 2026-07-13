/**
 * Purchase Order Add Lines Service
 *
 * Handles adding approved requisition lines to an existing purchase order
 * that is in Draft or Submitted status. This enables consolidating
 * requisition lines from the same supplier onto an existing PO rather
 * than always creating new POs.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { RequisitionLineStatus } from "@/services/purchasing/requisition/requisition.types";
import { budgetResolutionService } from "@/services/budget";
import { financeSettingsService } from "@/services/finance/finance-settings.service";
import { ServiceContext } from "@/types/service-types";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import {
  GLEventType,
  type GLEntry,
  type TransactionContext,
} from "@/types/gl-rules";
import { BudgetTrackingService } from "@/services/budgets/budget-tracking.service";
import { logger } from "@/lib/logger";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for adding lines to an existing PO
 */
export interface AddLinesToPOInput {
  lines: Array<{
    requisitionId: string;
    requisitionLineIds: string[];
  }>;
}

/**
 * Result of adding lines to a PO
 */
export interface AddLinesToPOResult {
  addedLineCount: number;
  newPOLines: Array<{ id: string; requisitionLineId: string }>;
  updatedTotal: number;
}

// ============================================================================
// SERVICE
// ============================================================================

/**
 * Include shape for requisition lines fetched for the post-send GL commitment
 * pass. Defined once so the findMany query AND `createPostSendCommitmentGL`'s
 * parameter share the exact same payload type. (Previously the parameter was
 * typed as the bare `Awaited<ReturnType<typeof findMany>>`, which dropped the
 * `requisition`/`allocations` relations and produced type errors on every
 * relation access inside the method.)
 */
const POST_SEND_REQ_LINE_INCLUDE = {
  allocations: true,
  requisition: {
    include: {
      budgetHeader: {
        include: {
          accountCode: true,
          project: {
            select: { id: true, accountCodeId: true },
          },
        },
      },
      lineAllocations: {
        where: { requisitionLineId: null },
        select: {
          id: true,
          accountCodeId: true,
          departmentId: true,
          projectId: true,
          areaId: true,
          percentage: true,
          amount: true,
        },
      },
    },
  },
} satisfies Prisma.RequisitionLineInclude;

type PostSendReqLine = Prisma.RequisitionLineGetPayload<{
  include: typeof POST_SEND_REQ_LINE_INCLUDE;
}>;

class PurchaseOrderAddLinesService {
  /**
   * Add approved requisition lines to an existing purchase order.
   *
   * Validates that:
   * - The PO exists and is in Draft, Submitted, Approved, Ordered,
   *   PartiallyReceived, or Received status
   * - All requisitions are approved
   * - All requisition lines are approved and not already on a PO
   * - All requisition lines belong to the same supplier as the PO
   *
   * Then creates new PO lines, copies allocations, updates requisition
   * line statuses, and recalculates the PO total — all in a single
   * Prisma transaction.
   *
   * For POs that are already Ordered, PartiallyReceived, or Received (i.e.
   * already sent to supplier), a line-scoped PO_APPROVE GL commitment entry is
   * created for each new line AFTER the data transaction commits. This ensures
   * the new lines enter the GL at the same commitment stage as the original
   * lines, so that their receipt GL entries can correctly release the
   * commitment. The GL entry uses referenceType: 'POLine' / referenceId:
   * poLine.id to avoid the unique constraint on the main PO-level EXPENDITURE.
   *
   * RECEIVED POs (added 2026-06): a Received PO is fully received; adding a new
   * (unreceived) line means it is no longer fully received, so the PO is dropped
   * back to PartiallyReceived (receivedDate cleared) inside the transaction. The
   * subsequent receive of the new line re-promotes it to Received via
   * batchReceive's status recompute (the same Received↔PartiallyReceived
   * transition reverseReceipt already produces). Received is GL-eligible
   * (GL_ELIGIBLE_PO_STATUSES), so the commitment + receipt GL post normally; the
   * commitment (referenceType 'POLine') is Pulse-internal and NEVER syncs to NAV
   * (SYNCABLE_REFERENCE_TYPES excludes 'POLine') — only the receipt
   * (referenceType 'POLineReceipt') syncs, as a legitimate new GRNI. No existing
   * data is mutated; the change is purely additive plus the status step-down.
   *
   * @param poId - The purchase order to add lines to
   * @param input - The requisition lines to add
   * @param context - Full service context (required for GL commitment creation)
   * @returns Result with added line count, new PO line IDs, and updated total
   */
  async addLinesToPO(
    poId: string,
    input: AddLinesToPOInput,
    context: ServiceContext,
  ): Promise<AddLinesToPOResult> {
    // Adding approved requisition lines to a PO creates new committed
    // procurement records, so it is gated by the same dedicated PO-creation
    // permission as creating a PO outright (Admin, Finance Manager, Plant
    // Manager, Purchasing Manager). Enforced here at the service layer in
    // addition to the route gate.
    await checkPermission(
      context,
      buildPermissionString(
        PermissionResource.PURCHASE_ORDERS,
        PermissionAction.CREATE,
      ),
    );

    const userId = context.userId;
    // ── 1. Fetch the PO with existing lines ──────────────────────────────
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: true,
        supplier: { select: { name: true } },
      },
    });

    if (!purchaseOrder) {
      throw new NotFoundError("PurchaseOrder", poId);
    }

    // ── 2. Validate PO status ────────────────────────────────────────────
    // Allow adding lines to Draft, Submitted, Approved, Ordered, or PartiallyReceived POs.
    // - Approved: req-sourced POs start here; lines may be added before send.
    // - Ordered: already sent to supplier. New lines get a line-scoped GL
    //   commitment entry (PO_APPROVE) created after the data transaction so the
    //   receipt GL can release it correctly.
    // - PartiallyReceived: same GL treatment as Ordered. Receiving on existing
    //   lines is already in flight; new lines enter the same GL stage as if
    //   they had been on the PO at send time.
    // - Received: fully received but NOT closed. Adding a new (unreceived) line
    //   drops the PO back to PartiallyReceived (handled in the PO update below)
    //   and the new line gets the same line-scoped GL commitment as Ordered.
    //   Received is GL-eligible (GL_ELIGIBLE_PO_STATUSES) so all GL posts normally.
    // NOTE: Closed and Cancelled remain blocked — those POs have fully reversed/
    // closed GL cycles and must not accept new lines.
    const addableStatuses = [
      "Draft",
      "Submitted",
      "Approved",
      "Ordered",
      "PartiallyReceived",
      "Received",
    ];
    if (!addableStatuses.includes(purchaseOrder.status)) {
      throw new BadRequestError(
        `Cannot add lines to a purchase order in "${purchaseOrder.status}" status. ` +
          `Only Draft, Submitted, Approved, Ordered, PartiallyReceived, or Received purchase orders can have lines added.`,
      );
    }

    // ── 3. Collect all requisition IDs and line IDs ──────────────────────
    const allRequisitionIds = Array.from(
      new Set(input.lines.map((l) => l.requisitionId)),
    );
    const allLineIds = input.lines.flatMap((l) => l.requisitionLineIds);

    if (allLineIds.length === 0) {
      throw new BadRequestError("No requisition lines specified");
    }

    // ── 4. Fetch all requisitions ────────────────────────────────────────
    const requisitions = await prisma.requisition.findMany({
      where: { id: { in: allRequisitionIds } },
    });

    if (requisitions.length !== allRequisitionIds.length) {
      const foundIds = new Set(requisitions.map((r) => r.id));
      const missingIds = allRequisitionIds.filter((id) => !foundIds.has(id));
      throw new NotFoundError("Requisition", missingIds.join(", "));
    }

    // ── 5. Validate all requisitions are approved ────────────────────────
    for (const req of requisitions) {
      if (req.approvalStatus !== "APPROVED") {
        throw new BadRequestError(
          `Requisition ${req.reqNumber} is not approved (status: ${req.approvalStatus}). ` +
            `Only lines from approved requisitions can be added to a purchase order.`,
        );
      }
    }

    // ── 6. Validate supplier match ───────────────────────────────────────
    for (const req of requisitions) {
      if (req.supplierId && req.supplierId !== purchaseOrder.supplierId) {
        throw new BadRequestError(
          `Requisition ${req.reqNumber} has a different supplier than the purchase order. ` +
            `All requisition lines must be from the same supplier as the PO.`,
        );
      }
    }

    // ── 7. Fetch all requisition lines with allocations ──────────────────
    // Include requisition budget header and header-level allocations for fallback logic
    const reqLines = await prisma.requisitionLine.findMany({
      where: { id: { in: allLineIds } },
      include: POST_SEND_REQ_LINE_INCLUDE,
    });

    if (reqLines.length !== allLineIds.length) {
      const foundLineIds = new Set(reqLines.map((l) => l.id));
      const missingLineIds = allLineIds.filter((id) => !foundLineIds.has(id));
      throw new BadRequestError(
        `Some requisition lines were not found: ${missingLineIds.join(", ")}`,
      );
    }

    // ── 8. Validate each requisition line ────────────────────────────────
    // Build a map from input for quick lookup of requisitionId → lineIds
    const reqLineMap = new Map<string, Set<string>>();
    for (const entry of input.lines) {
      reqLineMap.set(entry.requisitionId, new Set(entry.requisitionLineIds));
    }

    // Build a fast lookup set of approved requisition IDs for line-level checks
    const approvedRequisitionIds = new Set(requisitions.map((r) => r.id));

    for (const line of reqLines) {
      // Verify line belongs to the claimed requisition
      const expectedLineIds = reqLineMap.get(line.requisitionId);
      if (!expectedLineIds?.has(line.id)) {
        throw new BadRequestError(
          `Requisition line ${line.id} does not belong to the specified requisition ${line.requisitionId}`,
        );
      }

      // Check line status is APPROVED, or PENDING when the parent requisition is approved.
      // The UI already allows selecting PENDING lines from fully-approved requisitions
      // (req.approvalStatus === "APPROVED"), so we mirror that same policy here.
      const lineIsApproved = line.lineStatus === RequisitionLineStatus.APPROVED;
      const lineIsPendingFromApprovedReq =
        line.lineStatus === RequisitionLineStatus.PENDING &&
        approvedRequisitionIds.has(line.requisitionId);

      if (!lineIsApproved && !lineIsPendingFromApprovedReq) {
        throw new BadRequestError(
          `Requisition line "${line.description}" has status "${line.lineStatus}". ` +
            `Only APPROVED lines, or PENDING lines from an approved requisition, can be added to a purchase order.`,
        );
      }

      // Check line is not already linked to a PO
      if (line.purchaseOrderId) {
        throw new BadRequestError(
          `Requisition line "${line.description}" is already linked to purchase order ${line.purchaseOrderNumber ?? line.purchaseOrderId}. ` +
            `Lines cannot be added to multiple purchase orders.`,
        );
      }

      // Validate supplier match at line level
      if (line.supplierId && line.supplierId !== purchaseOrder.supplierId) {
        throw new BadRequestError(
          `Requisition line "${line.description}" has a different supplier than the purchase order. ` +
            `All lines must be from the same supplier.`,
        );
      }
    }

    // ── 9. Execute all writes in a single transaction ────────────────────
    // Compute the highest existing lineNumber so new lines continue sequentially
    const maxExistingLineNumber = (
      purchaseOrder.lines as Array<{ id: string; lineNumber: number }>
    ).reduce((max, l) => Math.max(max, l.lineNumber), 0);

    // Capture PO status BEFORE the transaction — used after commit to decide
    // whether GL commitment entries are needed for the new lines.
    const poStatusBeforeAdd = purchaseOrder.status;

    const result = await prisma.$transaction(async (tx) => {
      const newPOLines: Array<{ id: string; requisitionLineId: string }> = [];
      let nextLineNumber = maxExistingLineNumber;

      // Create PO lines for each requisition line
      for (const line of reqLines) {
        const quantity =
          typeof line.quantity === "number"
            ? line.quantity
            : line.quantity.toNumber();
        const estimatedPrice =
          typeof line.estimatedPrice === "number"
            ? line.estimatedPrice
            : line.estimatedPrice.toNumber();

        // Get work order info from the requisition's budget header
        const reqBudgetHeader = await tx.requisitionBudgetHeader.findFirst({
          where: { requisitionId: line.requisitionId },
          include: {
            workOrder: {
              select: { id: true, woNumber: true },
            },
          },
        });
        const workOrder = reqBudgetHeader?.workOrder ?? null;

        // Create PO line — follows the exact same mapping as convertLinesToPO()
        const poLine = await tx.pOLine.create({
          data: {
            purchaseOrderId: poId,
            lineNumber: ++nextLineNumber,
            inventoryItemId: line.inventoryItemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.estimatedPrice,
            totalPrice: quantity * estimatedPrice,
            lineType: line.lineType,
            notes: line.notes,
            // Requisition tracking
            requisitionId: line.requisitionId,
            requisitionLineId: line.id,
            requisitionNumber: line.requisition.reqNumber,
            // Work order tracking
            workOrderId: workOrder?.id ?? null,
            workOrderNumber: workOrder?.woNumber ?? null,
            // Copy service/consumable fields if applicable
            consumableCategory: line.consumableCategory,
            contractNumber: line.contractNumber,
            deliverables: line.deliverables,
            estimatedHours: line.estimatedHours,
            expirationTracking: line.expirationTracking,
            hourlyRate: line.hourlyRate,
            manufacturer: line.manufacturer,
            modelNumber: line.modelNumber,
            monthlyUsageRate: line.monthlyUsageRate,
            packageSize: line.packageSize,
            sdsRequired: line.sdsRequired,
            serviceEndDate: line.serviceEndDate,
            serviceEquipmentId: line.serviceEquipmentId,
            serviceLocation: line.serviceLocation,
            serviceProvider: line.serviceProvider,
            serviceStartDate: line.serviceStartDate,
            serviceType: line.serviceType,
            serviceWorkOrderId: line.serviceWorkOrderId,
            slaDetails: line.slaDetails,
            storageRequirements: line.storageRequirements,
          },
        });

        newPOLines.push({
          id: poLine.id,
          requisitionLineId: line.id,
        });

        // Copy allocations from RequisitionLineAllocation → POLineChargeAllocation
        // Fallback priority for non-INVENTORY lines:
        //   1. Line-level allocations (most specific)
        //   2. Header-level allocations (requisitionLineId = null on parent requisition)
        //   3. Budget header account code (CHARGE_TO_ACCOUNT / CHARGE_TO_PROJECT / CHARGE_TO_WORK_ORDER)
        //   4. FinanceSettings default account code
        //   5. INVENTORY lines skip — GL rules handle them via fixed account sources
        const allocations = line.allocations;
        let copiedAllocCount = 0;

        // Path 1: Copy line-level allocations directly
        for (const alloc of allocations) {
          await tx.pOLineChargeAllocation.create({
            data: {
              poLineId: poLine.id,
              accountCodeId: alloc.accountCodeId,
              departmentId: alloc.departmentId,
              projectId: alloc.projectId,
              areaId: alloc.areaId,
              percentage: alloc.percentage,
              amount: alloc.amount,
              notes: null,
            },
          });
          copiedAllocCount++;
        }

        // Fallback tiers for non-INVENTORY lines when no line-level allocations exist
        if (copiedAllocCount === 0 && line.lineType !== "INVENTORY") {
          const lineAmount = quantity * estimatedPrice;

          // Access requisition's header-level allocations and budget header
          const reqData = line.requisition as typeof line.requisition & {
            budgetHeader?: {
              accountCodeId: string | null;
              projectId: string | null;
              budgetType: string;
              workOrderId?: string | null;
              project?: { id: string; accountCodeId: string | null } | null;
            } | null;
            lineAllocations?: Array<{
              accountCodeId: string | null;
              departmentId: string | null;
              projectId: string | null;
              areaId: string | null;
              percentage: number | { toNumber(): number };
              amount: number | { toNumber(): number };
            }>;
          };
          const headerAllocations = reqData.lineAllocations;

          if (headerAllocations.length > 0) {
            // Path 2: Header-level allocations (requisitionLineId = null)
            for (const alloc of headerAllocations) {
              await tx.pOLineChargeAllocation.create({
                data: {
                  poLineId: poLine.id,
                  accountCodeId: alloc.accountCodeId,
                  departmentId: alloc.departmentId,
                  projectId: alloc.projectId,
                  areaId: alloc.areaId,
                  percentage:
                    typeof alloc.percentage === "number"
                      ? alloc.percentage
                      : alloc.percentage.toNumber(),
                  amount: lineAmount * (Number(alloc.percentage) / 100),
                  notes: "Copied from requisition header allocation",
                },
              });
              copiedAllocCount++;
            }
          }

          if (copiedAllocCount === 0) {
            // Path 3: Fallback to budget header account code
            const budgetHeader = reqData.budgetHeader;
            let fallbackAccountCodeId: string | null =
              budgetHeader?.accountCodeId ?? null;
            let fallbackProjectId: string | null = null;

            // CHARGE_TO_PROJECT: resolve the project's default account code
            if (!fallbackAccountCodeId && budgetHeader?.projectId) {
              fallbackAccountCodeId =
                budgetHeader.project?.accountCodeId ?? null;
              if (!fallbackAccountCodeId) {
                const project = await tx.project.findUnique({
                  where: { id: budgetHeader.projectId },
                  select: { accountCodeId: true },
                });
                fallbackAccountCodeId = project?.accountCodeId ?? null;
              }
              fallbackProjectId = budgetHeader.projectId;
            }

            // CHARGE_TO_WORK_ORDER: resolve from WO's project or equipment
            if (
              !fallbackAccountCodeId &&
              budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER" &&
              budgetHeader.workOrderId
            ) {
              const woResolution =
                await budgetResolutionService.resolveFromWorkOrder(
                  budgetHeader.workOrderId,
                );
              fallbackAccountCodeId = woResolution.accountCodeId;
            }

            // Path 4: FinanceSettings WO defaults (account code + department)
            const woDefaults =
              await financeSettingsService.getWorkOrderDefaults();
            fallbackAccountCodeId ??=
              woDefaults.defaultWorkOrderAccountCodeId ?? null;

            if (fallbackAccountCodeId) {
              // Use the WO default department when the budget type is CHARGE_TO_WORK_ORDER
              const fallbackDepartmentId =
                budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER"
                  ? (woDefaults.defaultWorkOrderDepartmentId ?? null)
                  : null;

              await tx.pOLineChargeAllocation.create({
                data: {
                  poLineId: poLine.id,
                  accountCodeId: fallbackAccountCodeId,
                  departmentId: fallbackDepartmentId,
                  projectId: fallbackProjectId,
                  areaId: null,
                  percentage: 100,
                  amount: lineAmount,
                  notes: "Copied from requisition budget header",
                },
              });
            }
          }
        }
        // INVENTORY lines without allocations are handled by GL rules — skip

        // Update the requisition line to mark it as ordered
        await tx.requisitionLine.update({
          where: { id: line.id },
          data: {
            lineStatus: RequisitionLineStatus.ORDERED,
            purchaseOrderId: poId,
            purchaseOrderNumber: purchaseOrder.poNumber,
            poLineId: poLine.id,
            convertedToPOAt: new Date(),
            convertedToPOBy: userId,
          },
        });
      }

      // Recalculate PO total from ALL lines (existing + new)
      const allPOLines = await tx.pOLine.findMany({
        where: { purchaseOrderId: poId },
      });

      const updatedTotal = allPOLines.reduce((sum, line) => {
        const totalPrice =
          typeof line.totalPrice === "number"
            ? line.totalPrice
            : line.totalPrice.toNumber();
        return sum + totalPrice;
      }, 0);

      // Update requisitionIds and requisitionNumbers arrays (deduplicate)
      const existingReqIds = purchaseOrder.requisitionIds;
      const existingReqNumbers = purchaseOrder.requisitionNumbers;

      const reqNumberMap = new Map<string, string>();
      for (const req of requisitions) {
        reqNumberMap.set(req.id, req.reqNumber);
      }

      const mergedReqIds = Array.from(
        new Set([...existingReqIds, ...allRequisitionIds]),
      );
      const mergedReqNumbers = Array.from(
        new Set([
          ...existingReqNumbers,
          ...allRequisitionIds.map((id) => reqNumberMap.get(id) ?? ""),
        ]),
      ).filter(Boolean);

      // A Received PO is fully received; adding a new (unreceived) line means it
      // is no longer fully received, so drop it back to PartiallyReceived and
      // clear the fully-received timestamp. batchReceive re-promotes it to
      // Received once the new line is received. All other source statuses
      // (Draft/Submitted/Approved/Ordered/PartiallyReceived) are left unchanged.
      const statusOverride =
        poStatusBeforeAdd === "Received"
          ? { status: "PartiallyReceived", receivedDate: null }
          : {};

      // Update the PO
      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          totalAmount: updatedTotal,
          requisitionIds: mergedReqIds,
          requisitionNumbers: mergedReqNumbers,
          ...statusOverride,
        },
      });

      // Check each source requisition — update line counts and status
      for (const reqId of allRequisitionIds) {
        const requisition = await tx.requisition.findUnique({
          where: { id: reqId },
          include: { lines: true },
        });

        if (!requisition) continue;

        const totalCount = requisition.lines.length;
        const orderedCount = requisition.lines.filter(
          (l) => l.lineStatus === RequisitionLineStatus.ORDERED,
        ).length;
        const pendingCount = requisition.lines.filter(
          (l) => l.lineStatus === "PENDING",
        ).length;
        const approvedCount = requisition.lines.filter(
          (l) => l.lineStatus === "APPROVED",
        ).length;
        const fulfilledCount = requisition.lines.filter(
          (l) =>
            l.lineStatus === "FULFILLED" ||
            l.lineStatus === "PARTIALLY_FULFILLED",
        ).length;
        const cancelledCount = requisition.lines.filter(
          (l) => l.lineStatus === "CANCELLED",
        ).length;

        const allLinesOrdered = orderedCount === totalCount && totalCount > 0;

        // ALWAYS set purchaseOrderId when any line is converted to this PO.
        // For partial conversions (not all lines ordered), set it to the first PO
        // that converted any line. For full conversions, set it to this PO.
        // Use previousPOIds to track all POs that have lines from this req.
        const existingPOId = requisition.purchaseOrderId;
        const newPurchaseOrderId = existingPOId ?? poId;
        const newPurchaseOrderNumber = existingPOId
          ? requisition.purchaseOrderNumber
          : purchaseOrder.poNumber;

        // Track all POs in previousPOIds (deduplicated)
        const existingPrevIds = requisition.previousPOIds;
        const existingPrevNumbers = requisition.previousPONumbers;
        const updatedPrevIds = existingPrevIds.includes(poId)
          ? existingPrevIds
          : [...existingPrevIds, poId];
        const updatedPrevNumbers = existingPrevNumbers.includes(
          purchaseOrder.poNumber,
        )
          ? existingPrevNumbers
          : [...existingPrevNumbers, purchaseOrder.poNumber];

        await tx.requisition.update({
          where: { id: reqId },
          data: {
            // Always update line counts
            totalLines: totalCount,
            orderedLines: orderedCount,
            pendingLines: pendingCount,
            approvedLines: approvedCount,
            fulfilledLines: fulfilledCount,
            cancelledLines: cancelledCount,
            // Always set purchaseOrderId (first PO wins for primary link)
            purchaseOrderId: newPurchaseOrderId,
            purchaseOrderNumber: newPurchaseOrderNumber,
            // Track all POs in previousPOIds
            previousPOIds: updatedPrevIds,
            previousPONumbers: updatedPrevNumbers,
            // Set convertedToPOAt if not already set
            convertedToPOAt: requisition.convertedToPOAt ?? new Date(),
            convertedToPOBy: requisition.convertedToPOBy ?? userId,
            // Update status to Ordered only when ALL lines are ordered
            ...(allLinesOrdered ? { status: "Ordered" } : {}),
          },
        });
      }

      // Create audit log entry
      await tx.auditLog.create({
        data: {
          userId,
          userName: userId,
          action: "ADD_LINES_TO_PO",
          entityType: "PurchaseOrder",
          entityId: poId,
          changes: {
            poNumber: purchaseOrder.poNumber,
            poId,
            addedLineCount: newPOLines.length,
            requisitionIds: allRequisitionIds,
            requisitionLineIds: allLineIds,
            previousTotal: Number(purchaseOrder.totalAmount),
            updatedTotal,
          },
          timestamp: new Date(),
        },
      });

      return {
        addedLineCount: newPOLines.length,
        newPOLines,
        updatedTotal,
      };
    });

    // ── 10. GL commitment entries for post-send POs ──────────────────────
    // If the PO was already sent (Ordered or PartiallyReceived) when lines were
    // added, create a line-scoped PO_APPROVE GL commitment entry for each new
    // line. This runs AFTER the data transaction commits so the PO line IDs
    // are available in the database. If GL creation fails we throw so the
    // caller is notified — the data is committed but the GL is missing, which
    // is logged prominently for admin remediation.
    // "Received" is included here (alongside Ordered/PartiallyReceived): a
    // Received PO has been sent and fully received, so a newly-added line needs
    // the same line-scoped PO_APPROVE commitment. Without it, the new line's
    // receipt GL would post a commitment-release with nothing to release — an
    // orphaned credit on the commitment account (GL/budget drift). We key off
    // the PRE-add status captured before the transaction (the PO row was just
    // flipped to PartiallyReceived above).
    const alreadySent = ["Ordered", "PartiallyReceived", "Received"].includes(
      poStatusBeforeAdd,
    );
    if (alreadySent && result.newPOLines.length > 0) {
      const supplierName = purchaseOrder.supplier.name;
      await this.createPostSendCommitmentGL(
        context,
        poId,
        purchaseOrder.poNumber,
        supplierName,
        result.newPOLines,
        reqLines,
      );
    }

    return result;
  }

  /**
   * Create line-scoped PO_APPROVE GL commitment entries for lines added to
   * an already-sent PO (Ordered, PartiallyReceived, or Received).
   *
   * Each new PO line gets its own EXPENDITURE GL transaction with:
   *   referenceType: 'POLine'
   *   referenceId:   poLine.id
   *
   * This avoids the @@unique([referenceType, referenceId, transactionType])
   * constraint on the main PO-level EXPENDITURE while keeping the new line's
   * commitment in the GL so that receipt GL entries can release it correctly.
   *
   * The close/cancel paths in purchase-order-workflow.service.ts also look for
   * these 'POLine' EXPENDITURE entries when reversing unreceived commitments.
   */
  private async createPostSendCommitmentGL(
    context: ServiceContext,
    poId: string,
    poNumber: string,
    supplierName: string,
    newPOLines: Array<{ id: string; requisitionLineId: string }>,
    reqLines: PostSendReqLine[],
  ): Promise<void> {
    const budgetPeriod = await getCurrentBudgetPeriod(prisma);
    const budgetTracker = new BudgetTrackingService(prisma);

    for (const newLineRef of newPOLines) {
      const reqLine = reqLines.find(
        (l) => l.id === newLineRef.requisitionLineId,
      );
      if (!reqLine) {
        logger.warn(
          `[AddLines GL] Cannot find reqLine for new POLine ${newLineRef.id} on PO ${poNumber} — ` +
            `skipping GL commitment entry. Manual GL entry may be required.`,
        );
        continue;
      }

      const qty =
        typeof reqLine.quantity === "number"
          ? reqLine.quantity
          : (reqLine.quantity as { toNumber(): number }).toNumber();
      const price =
        typeof reqLine.estimatedPrice === "number"
          ? reqLine.estimatedPrice
          : (reqLine.estimatedPrice as { toNumber(): number }).toNumber();
      const lineAmount = qty * price;
      const lineType = reqLine.lineType;

      // Detect work-order PO from the requisition's budget header
      const budgetHeader = reqLine.requisition.budgetHeader;
      const isWorkOrderLine =
        budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER";
      const woWorkOrderId = budgetHeader?.workOrderId ?? null;

      const allGLEntries: GLEntry[] = [];
      let matchedRuleId: string | undefined;

      // INVENTORY lines added to already-sent POs do NOT need a post-send GL
      // commitment entry. Their GL activity is recorded at receive time (WAC /
      // direct-issue rules). Trying to evaluate PO_APPROVE GL rules for them
      // here fails with "No GL rule matched" — throwing that error after the
      // data transaction commits produces a false-negative: the UI shows a red
      // error but the PO line and REQ link are already saved correctly.
      // Skip the GL step entirely for INVENTORY lines on sent POs.
      if (lineType === "INVENTORY") {
        logger.info(
          `[AddLines GL] Skipping post-send GL commitment for INVENTORY line ` +
            `"${reqLine.description}" (${newLineRef.id}) on PO ${poNumber} — ` +
            `GL entries are created at receive time for inventory lines.`,
        );
        continue;
      }

      try {
        if (isWorkOrderLine) {
          // ── Work-order PO path ─────────────────────────────────────────
          const allocations = reqLine.allocations;
          let woAccountCodeId: string | null =
            allocations[0]?.accountCodeId ?? null;

          if (!woAccountCodeId && woWorkOrderId) {
            const workOrder = await prisma.workOrder.findUnique({
              where: { id: woWorkOrderId },
              select: {
                project: { select: { accountCodeId: true } },
                equipment: { select: { defaultAccountCodeId: true } },
              },
            });
            woAccountCodeId =
              workOrder?.project?.accountCodeId ??
              workOrder?.equipment?.defaultAccountCodeId ??
              null;
          }

          if (!woAccountCodeId) {
            throw new BadRequestError(
              `No account code for WO PO line "${reqLine.description}" on PO ${poNumber}. ` +
                `Equipment or project must have a default account code.`,
            );
          }

          const ruleResult = await glRuleEngineService.evaluateRules(
            context,
            GLEventType.PO_APPROVE,
            {
              amount: lineAmount,
              accountCodeId: woAccountCodeId,
              departmentId: allocations[0]?.departmentId ?? undefined,
              transactionDate: new Date(),
              referenceType: "POLine",
              referenceId: newLineRef.id,
              referenceNumber: poNumber,
              poNumber,
              lineType: lineType as TransactionContext["lineType"],
              sourceType: "WORK_ORDER",
            },
          );

          if (!ruleResult.success || !ruleResult.matched) {
            throw new BadRequestError(
              `No GL rule matched PO_APPROVE for WO line "${reqLine.description}" on PO ${poNumber}.`,
            );
          }
          if (!ruleResult.isBalanced) {
            throw new BadRequestError(
              `GL entries not balanced for WO line "${reqLine.description}": ` +
                `Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
            );
          }
          matchedRuleId = ruleResult.rule?.id;
          allGLEntries.push(...ruleResult.entries);
        } else {
          // ── Regular PO path ────────────────────────────────────────────
          // INVENTORY lines are skipped earlier via the unconditional
          // `continue`, so `lineType` here is always a non-INVENTORY type. The
          // line either carries its own allocations or falls back to the
          // requisition's header-level allocations.
          const lineAllocations = reqLine.allocations;

          if (lineAllocations.length > 0) {
            // Has allocations — evaluate per allocation (any line type)
            const projectIds = lineAllocations
              .map((a) => a.projectId)
              .filter((id): id is string => id !== null);
            const projectCodeMap = new Map<string, string>();
            if (projectIds.length > 0) {
              const projects = await prisma.project.findMany({
                where: { id: { in: projectIds } },
                select: { id: true, code: true },
              });
              for (const p of projects) projectCodeMap.set(p.id, p.code);
            }

            for (const alloc of lineAllocations) {
              if (!alloc.accountCodeId) continue;
              const allocPct =
                typeof alloc.percentage === "number"
                  ? alloc.percentage
                  : alloc.percentage.toNumber();
              const allocationAmount = lineAmount * (allocPct / 100);

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
                  referenceId: newLineRef.id,
                  referenceNumber: poNumber,
                  poNumber,
                  projectCode: alloc.projectId
                    ? projectCodeMap.get(alloc.projectId)
                    : undefined,
                  lineType: lineType as TransactionContext["lineType"],
                  sourceType: "MANUAL",
                },
              );
              if (!ruleResult.success || !ruleResult.matched) {
                throw new BadRequestError(
                  `No GL rule matched PO_APPROVE for allocation on line "${reqLine.description}" on PO ${poNumber}.`,
                );
              }
              if (!ruleResult.isBalanced) {
                throw new BadRequestError(
                  `GL entries not balanced for allocation on line "${reqLine.description}": ` +
                    `Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
                );
              }
              matchedRuleId ??= ruleResult.rule?.id;
              allGLEntries.push(...ruleResult.entries);
              // Force-stamp projectId if rule engine didn't set it
              for (const entry of ruleResult.entries) {
                if (!entry.projectId && alloc.projectId) {
                  entry.projectId = alloc.projectId;
                }
              }
            }
          } else {
            // Non-INVENTORY without PO-level allocations — try req header allocations
            const headerAllocations = reqLine.requisition.lineAllocations;

            if (headerAllocations.length === 0) {
              throw new BadRequestError(
                `PO line "${reqLine.description}" (${newLineRef.id}) has no charge allocations. ` +
                  `Non-inventory lines require charge allocations with account codes.`,
              );
            }

            for (const alloc of headerAllocations) {
              if (!alloc.accountCodeId) continue;
              const allocPct =
                typeof alloc.percentage === "number"
                  ? alloc.percentage
                  : alloc.percentage.toNumber();
              const allocationAmount = lineAmount * (allocPct / 100);

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
                  referenceId: newLineRef.id,
                  referenceNumber: poNumber,
                  poNumber,
                  lineType: lineType as TransactionContext["lineType"],
                  sourceType: "MANUAL",
                },
              );
              if (!ruleResult.success || !ruleResult.matched) {
                throw new BadRequestError(
                  `No GL rule matched PO_APPROVE for header allocation on line "${reqLine.description}" on PO ${poNumber}.`,
                );
              }
              if (!ruleResult.isBalanced) {
                throw new BadRequestError(
                  `GL entries not balanced for header allocation on line "${reqLine.description}": ` +
                    `Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
                );
              }
              matchedRuleId ??= ruleResult.rule?.id;
              allGLEntries.push(...ruleResult.entries);
            }
          }
        }

        if (allGLEntries.length === 0) {
          throw new Error(
            `No GL entries generated for new POLine ${newLineRef.id} ("${reqLine.description}") on PO ${poNumber}.`,
          );
        }

        const totalDebitAmount = allGLEntries
          .filter((e) => e.entryType === "DEBIT")
          .reduce((sum, e) => sum + e.amount, 0);

        const glDesc =
          `Late-addition commitment - ${supplierName} - ${poNumber} - ${reqLine.description}`.substring(
            0,
            255,
          );

        const glTxnId = await glTransactionService.createTransaction(context, {
          transactionDate: new Date(),
          fiscalPeriodId: budgetPeriod.id,
          transactionType: "EXPENDITURE",
          referenceType: "POLine",
          referenceId: newLineRef.id,
          referenceNumber: poNumber,
          description: glDesc,
          glTransactionRuleId: matchedRuleId,
          lines: allGLEntries.map((entry) => ({
            entryType: entry.entryType,
            glAccountId: entry.glAccountId,
            amount: entry.amount,
            accountCodeId: entry.accountCodeId,
            departmentId: entry.departmentId,
            projectId: entry.projectId,
            areaId: entry.areaId,
            description: entry.description,
          })),
        });

        await glTransactionService.postTransaction(context, glTxnId);

        // Consume budget — non-fatal if the budget module rejects it
        try {
          await budgetTracker.consumeBudgetFromGL(context, {
            periodId: budgetPeriod.id,
            glTransactionId: glTxnId,
            referenceType: "POLine",
            referenceId: newLineRef.id,
            referenceNumber: poNumber,
            totalAmount: totalDebitAmount,
          });
        } catch (budgetErr) {
          logger.warn(
            `[AddLines GL] Budget consumption failed for POLine ${newLineRef.id} on PO ${poNumber} ` +
              `(non-fatal — GL entry was created): ` +
              `${budgetErr instanceof Error ? budgetErr.message : String(budgetErr)}`,
          );
        }

        logger.info(
          `[AddLines GL] Created commitment GL entry for new POLine ${newLineRef.id} ` +
            `("${reqLine.description}") on PO ${poNumber}. glTxnId=${glTxnId}, amount=${lineAmount}`,
          { poId, poNumber, poLineId: newLineRef.id, glTxnId, lineAmount },
        );
      } catch (glErr) {
        // Re-throw — data is committed but GL is missing.
        // The caller receives the error and the PO line exists without a
        // commitment GL entry. This is logged so admins can manually create
        // the entry via the GL management interface.
        logger.error(
          `[AddLines GL] CRITICAL: GL commitment creation FAILED for POLine ${newLineRef.id} ` +
            `("${reqLine.description}") on PO ${poNumber}. The PO line was created but has no ` +
            `commitment GL entry. Manual GL remediation required.`,
          {
            poId,
            poNumber,
            poLineId: newLineRef.id,
            error: glErr instanceof Error ? glErr.message : String(glErr),
          },
        );
        throw glErr;
      }
    }
  }
}

const globalForPOAddLines = globalThis as unknown as {
  purchaseOrderAddLinesService: PurchaseOrderAddLinesService | undefined;
};
export const purchaseOrderAddLinesService =
  globalForPOAddLines.purchaseOrderAddLinesService ??
  (globalForPOAddLines.purchaseOrderAddLinesService =
    new PurchaseOrderAddLinesService());
