/**
 * Purchase Order Workflow Service
 *
 * Handles all status transitions and workflow operations for purchase orders.
 * This service manages the lifecycle of purchase orders from submission through closure.
 */

import {
  PrismaClient,
  LineItemType,
  BudgetType,
  BudgetTransactionType,
} from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
  ExtendedPermissionAction,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import { NotFoundError, BadRequestError, isApiError } from "@/lib/api-errors";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";
import { BudgetTrackingService } from "@/services/budgets/budget-tracking.service";
import { budgetHelperService } from "@/services/budgets/budget-helpers.service";
import {
  SYNCABLE_REFERENCE_TYPES,
  COMMITMENT_ACCOUNT_NUMBERS,
} from "@/services/nav-sync/sync-scope";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { GLEventType, GLEntry } from "@/types/gl-rules";
import { purchaseOrderCancellationService } from "./purchase-order-cancellation.service";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import { poGLService } from "@/services/purchasing/po-gl.service";
import { getTaxConfig } from "@/services/tax";
import {
  calculatePOVariance,
  requiresReApproval,
} from "./purchase-order-change-detection";
import { financeSettingsService } from "@/services/finance/finance-settings.service";
import { requisitionStatusSyncService } from "@/services/purchasing/requisition/requisition-status-sync.service";
import { notificationService } from "@/services/notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { PURCHASING_NOTIFICATIONS } from "@/services/notifications/notification-types-registry";

import {
  PurchaseOrderWithRelations,
  PurchaseOrderStatus,
} from "./purchase-order.types";

import {
  canSubmit,
  canApprove,
  canSend,
  canClose,
  canCancel,
} from "./purchase-order-validation";

import { transformPurchaseOrder, buildPOInclude } from "./purchase-order-utils";

/**
 * Purchase Order Workflow Service
 *
 * Responsibilities:
 * - Submit purchase orders for approval (DRAFT → SUBMITTED)
 * - Approve purchase orders (SUBMITTED → APPROVED)
 * - Reject purchase orders (SUBMITTED → DRAFT)
 * - Send purchase orders to suppliers (APPROVED → ORDERED)
 * - Close purchase orders (RECEIVED → CLOSED)
 * - Cancel purchase orders (any status → CANCELLED)
 *
 * Each method validates permissions, status transitions, and logs audit trails.
 */
/** Result of a PO project reassignment (one GL-level reclass). */
interface ProjectReclassResult {
  success: boolean;
  message: string;
  /** GL transaction id of the net-zero project-reclass JE, or null when none was needed. */
  reclassJETransactionId: string | null;
  /** Total $ of reserved+consumed budget moved between project budgets. */
  budgetMoved: number;
  /** Number of NAV-posted cost GL lines whose project dimension was moved. */
  navCostLinesMoved: number;
}

class PurchaseOrderWorkflowService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.PURCHASING;
  private budgetTrackingService: BudgetTrackingService;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
    this.budgetTrackingService = new BudgetTrackingService(prismaClient);
  }

  /**
   * Submit purchase order for approval
   * Transition: DRAFT → SUBMITTED
   *
   * @param context - Service context with user and permissions
   * @param id - Purchase order ID
   * @returns Updated purchase order
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if PO cannot be submitted
   */
  async submit(
    context: ServiceContext,
    id: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      // Check permission
      const permission = buildPermissionString(
        this.resource,
        PermissionAction.UPDATE,
      );
      await checkPermission(context, permission);

      validateRequired(id, "id");

      // Get current PO
      const currentPO = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: buildPOInclude(),
      });

      if (!currentPO) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // Validate transition
      if (!canSubmit(currentPO.status as PurchaseOrderStatus)) {
        throw new BadRequestError(
          `Cannot submit purchase order in ${currentPO.status} status`,
        );
      }

      // Validate has items
      if (currentPO.lines.length === 0) {
        throw new BadRequestError("Purchase order must have at least one item");
      }

      // CRITICAL: Validate charge allocations on non-INVENTORY lines.
      // Without charge allocations, GL pre-validation will block receiving later.
      // Only SERVICE, CONSUMABLE, and NON_STOCK lines require explicit allocations;
      // INVENTORY lines use GL rules with FIXED account sources and don't need them.
      const linesWithAllocations = currentPO.lines as Array<{
        id: string;
        description: string;
        lineType: string;
        chargeAllocations?: Array<{ id: string; accountCodeId: string | null }>;
      }>;
      const linesMissingAllocations: string[] = [];
      let lineIndex = 0;
      for (const line of linesWithAllocations) {
        lineIndex++;
        if (line.lineType === "INVENTORY") continue;
        // SERVICE, CONSUMABLE, NON_STOCK lines must have at least one allocation with an accountCodeId
        const allocations = line.chargeAllocations ?? [];
        const hasValidAllocation = allocations.some(
          (a) => a.accountCodeId != null && a.accountCodeId !== "",
        );
        if (!hasValidAllocation) {
          linesMissingAllocations.push(
            `Line ${lineIndex} ("${line.description}")`,
          );
        }
      }
      if (linesMissingAllocations.length > 0) {
        throw new BadRequestError(
          `Cannot submit PO: ${linesMissingAllocations.join(", ")} ${linesMissingAllocations.length === 1 ? "is" : "are"} missing charge allocations. ` +
            `Please add account code allocations to all service, consumable, and non-stock lines before submitting.`,
        );
      }

      // CRITICAL: Check if linked requisitions are still pending re-approval
      // After cancel-for-edit resets PO to Draft, linked reqs must be re-approved
      // before the PO can be submitted again
      if (currentPO.requisitionIds.length > 0) {
        const linkedReqs = await this.prisma.requisition.findMany({
          where: { id: { in: currentPO.requisitionIds } },
          select: {
            id: true,
            reqNumber: true,
            status: true,
            approvalStatus: true,
          },
        });

        const pendingReqs = linkedReqs.filter(
          (req) =>
            req.status === "Draft" ||
            req.status === "Submitted" ||
            req.approvalStatus === "DRAFT" ||
            req.approvalStatus === "PENDING",
        );

        if (pendingReqs.length > 0) {
          const reqNumbers = pendingReqs.map((r) => r.reqNumber).join(", ");
          throw new BadRequestError(
            `Cannot submit PO — linked requisition(s) ${reqNumbers} are pending re-approval. ` +
              `Please approve the requisition(s) first, then submit the PO.`,
          );
        }
      }

      // Perform update
      const updated = await this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.SUBMITTED,
          submittedAt: new Date(),
        },
        include: buildPOInclude(),
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.SUBMIT,
        "PurchaseOrder",
        id,
        currentPO.poNumber,
        { status: currentPO.status },
        { status: updated.status },
        {
          itemCount: updated.lines.length,
          totalAmount: Number(updated.totalAmount),
        },
      );

      // B3-1: PO Submit notification
      try {
        await notificationService.sendNotification(context, {
          userId: currentPO.createdBy ?? context.userId,
          type: PURCHASING_NOTIFICATIONS.PO_SUBMITTED.type,
          category: NotificationCategory.PURCHASING,
          title: `PO ${currentPO.poNumber} Submitted for Approval`,
          message: `Purchase order ${currentPO.poNumber} has been submitted for approval.`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/purchase-orders/${currentPO.id}`,
          actionLabel: "View Purchase Order",
          data: {
            poNumber: currentPO.poNumber,
            poId: currentPO.id,
            submittedBy: context.userId,
          },
        });
      } catch (notifError) {
        logger.error(
          "[B3-1] Failed to send PO submit notification",
          notifError,
        );
      }

      // Return transformed result
      return transformPurchaseOrder(updated);
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(
        `Failed to submit purchase order: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Approve purchase order
   * Transition: SUBMITTED → APPROVED
   *
   * @param context - Service context with user and permissions
   * @param id - Purchase order ID
   * @param approvedBy - User ID of approver
   * @returns Updated purchase order
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if PO cannot be approved
   */
  async approve(
    context: ServiceContext,
    id: string,
    approvedBy: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      // Check permission - requires approve permission
      const permission = buildPermissionString(
        this.resource,
        "approve" as PermissionAction,
      );

      await checkPermission(context, permission);

      validateRequired(id, "id");
      validateRequired(approvedBy, "approvedBy");

      // Get current PO
      const currentPO = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: buildPOInclude(),
      });

      if (!currentPO) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // B2-9: Block self-approval — creator cannot approve their own PO.
      //
      // EXCEPTION: POs sourced from an approved requisition carry the REQ's
      // approval. The REQ approval chain (requisition-approval.service.ts) is
      // the authoritative self-approval / authority control for that path, and
      // it is amount-aware with Admin override. Re-enforcing an unconditional
      // equality check here would contradict the already-approved REQ and has
      // no compensating safety value (a PO that reaches `approve()` after a
      // REQ-kickback is still gated by the REQ re-approval workflow).
      //
      // This block therefore applies ONLY to direct-create POs (no linked
      // requisitions), where REQ approval never occurred and the self-approval
      // control must live here.
      const isReqSourced = currentPO.requisitionIds.length > 0;
      if (!isReqSourced && currentPO.createdBy === approvedBy) {
        throw new BadRequestError(
          "You cannot approve a purchase order that you created. Please have another authorized user approve this PO.",
        );
      }

      // Validate transition
      if (!canApprove(currentPO.status as PurchaseOrderStatus)) {
        throw new BadRequestError(
          `Cannot approve purchase order in ${currentPO.status} status`,
        );
      }

      // Perform update
      const updated = await this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.APPROVED,
          approvedAt: new Date(),
        },
        include: buildPOInclude(),
      });

      // CRITICAL: GL-first workflow - Create GL transaction, then consume budget from GL
      // Uses extracted reusable methods so send() can call them too for req-sourced POs
      try {
        await this.createApprovalGLEntries(context, updated);
        await this.snapshotApprovedPrices(updated);
      } catch (error) {
        // Fail the approval if GL or budget operations fail
        throw error;
      }

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.APPROVE,
        "PurchaseOrder",
        id,
        currentPO.poNumber,
        { status: currentPO.status },
        { status: updated.status },
        {
          approvedBy,
          totalAmount: Number(updated.totalAmount),
        },
      );

      // B3-2: PO Approved notification
      try {
        await notificationService.sendNotification(context, {
          userId: currentPO.createdBy ?? context.userId,
          type: PURCHASING_NOTIFICATIONS.PO_APPROVED.type,
          category: NotificationCategory.PURCHASING,
          title: `PO ${currentPO.poNumber} Approved`,
          message: `Purchase order ${currentPO.poNumber} has been approved.`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/purchase-orders/${currentPO.id}`,
          actionLabel: "View Purchase Order",
          data: {
            poNumber: currentPO.poNumber,
            poId: currentPO.id,
            approvedBy: approvedBy,
          },
        });
      } catch (notifError) {
        logger.error(
          "[B3-2] Failed to send PO approved notification",
          notifError,
        );
      }

      // Return transformed result
      return transformPurchaseOrder(updated);
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(
        `Failed to approve purchase order: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Reject purchase order
   * Transition: SUBMITTED → DRAFT
   *
   * @param context - Service context with user and permissions
   * @param id - Purchase order ID
   * @param reason - Rejection reason
   * @returns Updated purchase order
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if PO cannot be rejected
   */
  async reject(
    context: ServiceContext,
    id: string,
    reason: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      // Check permission - requires approve permission to reject
      const permission = buildPermissionString(
        this.resource,
        "approve" as PermissionAction,
      );
      await checkPermission(context, permission);

      validateRequired(id, "id");
      validateRequired(reason, "reason");

      // Get current PO
      const currentPO = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: buildPOInclude(),
      });

      if (!currentPO) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // Validate can reject (must be in SUBMITTED status)
      if (currentPO.status !== PurchaseOrderStatus.SUBMITTED) {
        throw new BadRequestError(
          `Cannot reject purchase order in ${currentPO.status} status`,
        );
      }

      // Perform update - return to DRAFT with rejection note
      const updated = await this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.DRAFT,
          notes: currentPO.notes
            ? `${currentPO.notes}\n\nREJECTED: ${reason}`
            : `REJECTED: ${reason}`,
        },
        include: buildPOInclude(),
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.REJECT,
        "PurchaseOrder",
        id,
        currentPO.poNumber,
        { status: currentPO.status },
        { status: updated.status },
        {
          rejectedBy: context.userId,
          reason,
        },
      );

      // B3-2: PO Rejected notification
      try {
        await notificationService.sendNotification(context, {
          userId: currentPO.createdBy ?? context.userId,
          type: PURCHASING_NOTIFICATIONS.PO_REJECTED.type,
          category: NotificationCategory.PURCHASING,
          title: `PO ${currentPO.poNumber} Rejected`,
          message: `Purchase order ${currentPO.poNumber} has been rejected. Reason: ${reason}`,
          priority: NotificationPriority.HIGH,
          actionUrl: `/purchasing/purchase-orders/${currentPO.id}`,
          actionLabel: "View Purchase Order",
          data: {
            poNumber: currentPO.poNumber,
            poId: currentPO.id,
            rejectedBy: context.userId,
            reason,
          },
        });
      } catch (notifError) {
        logger.error(
          "[B3-2] Failed to send PO rejected notification",
          notifError,
        );
      }

      // Return transformed result
      return transformPurchaseOrder(updated);
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(
        `Failed to reject purchase order: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Send purchase order to supplier
   * Transition: APPROVED → ORDERED
   *
   * Handles TWO paths:
   * 1. PO from approved requisition (skipped approval): No GL entries exist yet.
   *    → Creates EXPENDITURE GL entries, consumes budget, snapshots prices, then sends.
   * 2. PO through normal workflow (has existing GL entries from approve()):
   *    → Does variance detection, posts PRICE_VAR if needed, then sends.
   *
   * @param context - Service context with user and permissions
   * @param id - Purchase order ID
   * @returns Updated purchase order
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if PO cannot be sent or if variance exceeds threshold
   */
  async send(
    context: ServiceContext,
    id: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      // Check permission - B6-1: granular purchasing:send permission
      const permission = buildPermissionString(
        this.resource,
        ExtendedPermissionAction.SEND,
      );
      await checkPermission(context, permission);

      validateRequired(id, "id");

      // Get current PO with lines and allocations
      // NOTE: We spread buildPOInclude() and explicitly override `lines` so
      // TypeScript can statically infer `chargeAllocations` on each line
      // (the broad Prisma.PurchaseOrderInclude return type of buildPOInclude()
      // prevents that inference when passed directly).
      const currentPO = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          ...buildPOInclude(),
          lines: {
            orderBy: [{ lineNumber: "asc" }, { createdAt: "asc" }],
            include: {
              inventoryItem: {
                include: {
                  stock: {
                    select: {
                      quantityOnHand: true,
                      quantityReserved: true,
                    },
                  },
                },
              },
              chargeAllocations: {
                include: {
                  accountCode: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                      glAccountId: true,
                    },
                  },
                  department: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                  project: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                  area: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!currentPO) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // Validate transition
      if (!canSend(currentPO.status as PurchaseOrderStatus)) {
        throw new BadRequestError(
          `Cannot send purchase order in ${currentPO.status} status`,
        );
      }

      // ── Pre-send charge allocation validation ─────────────────────────────
      // Ensures every line that requires a charge allocation has one before the
      // PO is sent to the supplier.  This prevents silent GL posting failures
      // (e.g. GLR-0027 not firing for INVENTORY-with-project lines).
      for (const line of currentPO.lines) {
        const lineType = line.lineType;
        const allocations = line.chargeAllocations;

        if (
          lineType === LineItemType.SERVICE ||
          lineType === LineItemType.CONSUMABLE ||
          lineType === LineItemType.NON_STOCK
        ) {
          // These types always need an accountCodeId to determine the GL debit
          if (allocations.length === 0 || !allocations[0]?.accountCodeId) {
            throw new BadRequestError(
              `Cannot send PO ${currentPO.poNumber}: line '${line.description}' (${line.lineType}) requires a charge account allocation. Please add a charge allocation to this line before sending the PO to the supplier.`,
            );
          }
        } else {
          // INVENTORY lines linked to a work order may carry project context and need an allocation
          // so GLR-0027 fires and posts to CIP account 1580 instead of the default 1535.
          // If no work order is linked there is no project context — GLR-0003 (FIXED 1535/2111) handles it.
          if (line.workOrderId && allocations.length === 0) {
            throw new BadRequestError(
              `Cannot send PO ${currentPO.poNumber}: line '${line.description}' is an inventory item linked to a work order and requires a charge allocation carrying the project ID.`,
            );
          }
          // INVENTORY with no work order is fine — GLR-0003 (FIXED 1535/2111) handles it
        }
      }
      // ── End pre-send validation ────────────────────────────────────────────

      // ========================================================================
      // CHECK IF GL ENTRIES ALREADY EXIST (determines which path to take)
      // ========================================================================
      const existingGLTransaction = await this.prisma.gLTransaction.findFirst({
        where: {
          referenceType: "PurchaseOrder",
          referenceId: id,
          transactionType: "EXPENDITURE",
          status: "POSTED",
        },
      });

      // Track variance info for audit log
      let varianceInfo: {
        approvedTotal: number;
        currentTotal: number;
        varianceAmount: number;
        variancePercent: number;
      } | null = null;

      if (!existingGLTransaction) {
        // ====================================================================
        // PATH 1: REQ-SOURCED PO — No GL entries yet (skipped approval)
        // Create EXPENDITURE GL entries, consume budget, snapshot prices
        // ====================================================================
        await this.createApprovalGLEntries(context, currentPO);
        await this.snapshotApprovedPrices(currentPO);
      } else {
        // ====================================================================
        // PATH 2: NORMAL WORKFLOW PO — GL entries exist from approve()
        // Do price variance detection
        // ====================================================================

        // Query approved total from database using typed Prisma (post-migration, approvedTotal is generated)
        const approvedTotalResult = await this.prisma.purchaseOrder.findUnique({
          where: { id: currentPO.id },
          select: { approvedTotal: true, totalAmount: true },
        });
        const approvedTotal = approvedTotalResult?.approvedTotal
          ? Number(approvedTotalResult.approvedTotal)
          : Number(currentPO.totalAmount);
        const currentTotal = currentPO.lines.reduce(
          (sum, line) => sum + Number(line.totalPrice),
          0,
        );
        const variance = calculatePOVariance(currentTotal, approvedTotal);

        // Get variance threshold and auto-approval threshold from FinanceSettings service
        const thresholdPercent =
          await financeSettingsService.getPoVarianceThreshold();
        const autoApprovalThreshold =
          await financeSettingsService.getAutoApprovalThreshold();

        // Check if increase requires re-approval — compound condition:
        //   1. Variance percentage exceeds the configured threshold (e.g. > 10%), AND
        //   2. The new total exceeds the auto-approval threshold (i.e. a human approver
        //      would actually be required for this amount).
        // If the new total is below the auto-approval threshold, the requisition would
        // auto-approve anyway, so kicking it back for re-approval adds no value.
        if (
          variance.isIncrease &&
          requiresReApproval(
            variance.variancePercent,
            currentTotal,
            thresholdPercent,
            autoApprovalThreshold,
          )
        ) {
          // EXCEEDS THRESHOLD: Auto-cancel PO and reset requisitions to Draft
          await this.handleExcessiveVariance(
            context,
            currentPO,
            variance.variancePercent,
            thresholdPercent,
          );
          // Throw error to inform caller — the PO was cancelled, not sent
          throw new BadRequestError(
            `PO ${currentPO.poNumber} auto-cancelled: price variance of ${variance.variancePercent.toFixed(1)}% exceeds ${thresholdPercent}% threshold. Linked requisitions have been reset to Draft.`,
          );
        }

        // If there IS a variance (even small or decrease), post PRICE_VAR GL entry
        if (Math.abs(variance.varianceAmount) > 0.01) {
          try {
            await this.postPriceVarianceGL(
              context,
              currentPO,
              variance.varianceAmount,
            );
          } catch (glVarError) {
            // GL price variance posting failed (non-fatal) — don't fail the send.
            // Log with full context so it can be identified and retried.
            logger.error(
              `[PO Workflow] PRICE VARIANCE GL FAILED for PO ${currentPO.poNumber} (${id}). ` +
                `Send will proceed WITHOUT variance GL entry. varianceAmount=$${variance.varianceAmount.toFixed(6)}`,
              {
                error:
                  glVarError instanceof Error
                    ? glVarError.message
                    : String(glVarError),
                stack:
                  glVarError instanceof Error ? glVarError.stack : undefined,
                purchaseOrderId: id,
                poNumber: currentPO.poNumber,
                varianceAmount: variance.varianceAmount,
                approvedTotal,
                currentTotal,
              },
            );
          }

          // Populate CostVariance records for tracking
          try {
            await this.populateCostVariance(
              currentPO,
              approvedTotal,
              currentTotal,
            );
          } catch (costVarError) {
            // Cost variance tracking failed (non-fatal) — don't fail the send.
            logger.error(
              `[PO Workflow] COST VARIANCE TRACKING FAILED for PO ${currentPO.poNumber} (${id}). ` +
                `Send will proceed WITHOUT cost variance records.`,
              {
                error:
                  costVarError instanceof Error
                    ? costVarError.message
                    : String(costVarError),
                stack:
                  costVarError instanceof Error
                    ? costVarError.stack
                    : undefined,
                purchaseOrderId: id,
                poNumber: currentPO.poNumber,
                approvedTotal,
                currentTotal,
              },
            );
          }

          varianceInfo = {
            approvedTotal,
            currentTotal,
            varianceAmount: variance.varianceAmount,
            variancePercent: variance.variancePercent,
          };
        }
      }

      // ========================================================================
      // SEND TO SUPPLIER — transition to Ordered
      // ========================================================================

      // Calculate current total for the update
      const finalTotal = currentPO.lines.reduce(
        (sum, line) => sum + Number(line.totalPrice),
        0,
      );

      // Perform update — transition to Ordered
      const updated = await this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.ORDERED,
          sentAt: new Date(),
          // Update totalAmount to reflect current line prices
          totalAmount: finalTotal,
        },
        include: buildPOInclude(),
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.SEND,
        "PurchaseOrder",
        id,
        currentPO.poNumber,
        { status: currentPO.status },
        { status: updated.status },
        {
          sentBy: context.userId,
          sentDate: new Date().toISOString(),
          skippedApproval: !existingGLTransaction,
          ...(varianceInfo ? { priceVariance: varianceInfo } : {}),
        },
      );

      // Sync linked requisition statuses → Ordered
      try {
        await requisitionStatusSyncService.syncRequisitionsForPO(id);
      } catch (syncError) {
        logger.error(
          `[PO Workflow] Failed to sync requisition statuses after send: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
        );
      }

      // B3-3: PO Sent notification
      try {
        await notificationService.sendNotification(context, {
          userId: currentPO.createdBy ?? context.userId,
          type: PURCHASING_NOTIFICATIONS.PO_SENT.type,
          category: NotificationCategory.PURCHASING,
          title: `PO ${currentPO.poNumber} Sent to Supplier`,
          message: `Purchase order ${currentPO.poNumber} has been sent to ${currentPO.supplier.name}.`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/purchase-orders/${currentPO.id}`,
          actionLabel: "View Purchase Order",
          data: {
            poNumber: currentPO.poNumber,
            poId: currentPO.id,
            supplierName: currentPO.supplier.name,
          },
        });
      } catch (notifError) {
        logger.error("[B3-3] Failed to send PO sent notification", notifError);
      }

      // Return transformed result
      return transformPurchaseOrder(updated);
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(
        `Failed to send purchase order: ${(error as Error).message}`,
      );
    }
  }

  // ============================================================================
  // PRICE VARIANCE PRIVATE METHODS (Phase 2)
  // ============================================================================

  /**
   * Handle excessive price variance by auto-cancelling the PO
   * and resetting linked requisitions to Draft via cancelForEdit.
   *
   * @param context - Service context
   * @param po - The PO with lines
   * @param variancePercent - The calculated variance percentage
   * @param thresholdPercent - The configured threshold percentage
   */
  private async handleExcessiveVariance(
    context: ServiceContext,
    po: {
      id: string;
      poNumber: string;
      lines: Array<{
        id: string;
        description: string;
        quantity: unknown;
        unitPrice: unknown;
        totalPrice: unknown;
      }>;
    },
    variancePercent: number,
    thresholdPercent: number,
  ): Promise<void> {
    const reason = `Price variance of ${variancePercent.toFixed(1)}% exceeds ${thresholdPercent}% threshold. PO auto-cancelled and requisitions reset to draft for re-approval.`;
    const financialChanges = [
      `Total price variance: ${variancePercent.toFixed(1)}% (threshold: ${thresholdPercent}%)`,
    ];

    // Query approved unit prices using typed Prisma (post-migration, approvedUnitPrice is generated)
    const approvedPriceData = await this.prisma.pOLine.findMany({
      where: { purchaseOrderId: po.id },
      select: { id: true, approvedUnitPrice: true },
    });
    const approvedPriceMap = new Map(
      approvedPriceData.map((p) => [
        p.id,
        p.approvedUnitPrice ? Number(p.approvedUnitPrice) : null,
      ]),
    );

    // Build line-level change details for the cancellation audit
    for (const line of po.lines) {
      const approvedPrice =
        approvedPriceMap.get(line.id) ?? Number(line.unitPrice);
      const currentPrice = Number(line.unitPrice);
      if (Math.abs(currentPrice - approvedPrice) > 0.01) {
        financialChanges.push(
          `Line "${line.description}": unit price $${approvedPrice.toFixed(6)} → $${currentPrice.toFixed(6)}`,
        );
      }
    }

    // Use existing cancelForEdit infrastructure which handles:
    // - GL reversal (via glReversalService)
    // - Budget release (automatic from GL reversal)
    // - Requisition reset to Draft
    // - Audit trail
    await purchaseOrderCancellationService.cancelForEdit(context, po.id, {
      reason,
      financialChanges,
    });
  }

  /**
   * Post a PRICE_VAR GL entry for the price variance amount.
   * Follows the same pattern as approve() GL entry creation but uses
   * PRICE_VAR event type and ADJUSTMENT transaction type.
   *
   * @param context - Service context
   * @param po - The PO with lines and allocations
   * @param varianceAmount - Total variance amount (positive = increase, negative = decrease)
   */
  private async postPriceVarianceGL(
    context: ServiceContext,
    po: {
      id: string;
      poNumber: string;
      totalAmount: unknown;
      requisitionIds: string[];
      lines: Array<{
        id: string;
        description: string;
        quantity: unknown;
        unitPrice: unknown;
        totalPrice: unknown;
        chargeAllocations?: Array<{
          id: string;
          accountCodeId: string | null;
          departmentId: string | null;
          projectId: string | null;
          areaId: string | null;
          percentage: unknown;
          amount: unknown;
        }>;
        lineType?: string;
      }>;
    },
    varianceAmount: number,
  ): Promise<void> {
    // Get budget period
    const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);

    // Fetch WO dimension defaults for fallback dept stamping on WO PO variance GL entries
    const { defaultWorkOrderDepartmentId: varianceWoDefaultDeptId } =
      await financeSettingsService.getWorkOrderDefaults();

    // Check if this PO is a work order PO
    let isWorkOrderPO = false;
    let varWoWorkOrderId: string | undefined;
    if (po.requisitionIds.length > 0) {
      const requisition = await this.prisma.requisition.findFirst({
        where: { id: { in: po.requisitionIds } },
        include: {
          budgetHeader: {
            select: { budgetType: true, workOrderId: true },
          },
        },
      });
      const budgetHeader = requisition?.budgetHeader as {
        budgetType: string;
        workOrderId: string | null;
      } | null;
      isWorkOrderPO = budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER";
      varWoWorkOrderId = budgetHeader?.workOrderId ?? undefined;
    }

    // Query approved total prices using typed Prisma (post-migration, approvedTotalPrice is generated)
    const approvedLinePriceData = await this.prisma.pOLine.findMany({
      where: { purchaseOrderId: po.id },
      select: { id: true, approvedTotalPrice: true },
    });
    const approvedLinePriceMap = new Map(
      approvedLinePriceData.map((p) => [
        p.id,
        p.approvedTotalPrice ? Number(p.approvedTotalPrice) : null,
      ]),
    );

    // Collect GL entries for lines with variance
    const allGLEntries: GLEntry[] = [];
    let totalVarianceAmount = 0;
    let matchedVarianceRuleId: string | undefined;

    // Build projectId → projectCode lookup for allocations that have projectId
    const allProjectIds = po.lines
      .flatMap((l) => l.chargeAllocations ?? [])
      .map((a) => a.projectId)
      .filter((id): id is string => id !== null);
    const uniqueProjectIds = [...new Set(allProjectIds)];
    const projectCodeMap = new Map<string, string>();
    if (uniqueProjectIds.length > 0) {
      const projects = await this.prisma.project.findMany({
        where: { id: { in: uniqueProjectIds } },
        select: { id: true, code: true },
      });
      for (const p of projects) {
        projectCodeMap.set(p.id, p.code);
      }
    }

    for (const line of po.lines) {
      const approvedLineTotal =
        approvedLinePriceMap.get(line.id) ?? Number(line.totalPrice);
      const currentLineTotal = Number(line.totalPrice);
      const lineVariance = currentLineTotal - approvedLineTotal;

      // Skip lines with no variance
      if (Math.abs(lineVariance) <= 0.01) continue;

      totalVarianceAmount += Math.abs(lineVariance);
      const lineType = (line.lineType ?? "INVENTORY") as
        | "INVENTORY"
        | "SERVICE"
        | "CONSUMABLE"
        | "NON_STOCK";

      if (isWorkOrderPO) {
        // Work order POs: Equipment always provides account codes.
        // Use the first allocation's dimensions if available, with fallback resolution.
        const lineAllocations = line.chargeAllocations ?? [];
        const firstAlloc = lineAllocations[0];
        let woAccountCodeId = firstAlloc?.accountCodeId;

        // Fallback: resolve account code from work order's project or equipment
        // (Work order POs from requisitions may not have charge allocations)
        if (!woAccountCodeId && varWoWorkOrderId) {
          const workOrder = await this.prisma.workOrder.findUnique({
            where: { id: varWoWorkOrderId },
            select: {
              projectId: true,
              project: {
                select: { accountCodeId: true },
              },
              equipment: {
                select: { defaultAccountCodeId: true },
              },
            },
          });

          // Priority 1: Project default account code (project overrides equipment)
          if (workOrder?.project?.accountCodeId) {
            woAccountCodeId = workOrder.project.accountCodeId;
          }
          // Priority 2: Equipment default account code
          else if (workOrder?.equipment?.defaultAccountCodeId) {
            woAccountCodeId = workOrder.equipment.defaultAccountCodeId;
          }
        }

        if (woAccountCodeId) {
          const ruleResult = await glRuleEngineService.evaluateRules(
            context,
            GLEventType.PRICE_VAR,
            {
              amount: Math.abs(lineVariance),
              accountCodeId: woAccountCodeId,
              // Department priority: allocation dept → FinanceSettings WO default → undefined
              departmentId:
                firstAlloc?.departmentId ??
                varianceWoDefaultDeptId ??
                undefined,
              transactionDate: new Date(),
              referenceType: "PurchaseOrder",
              referenceId: po.id,
              referenceNumber: po.poNumber,
              poNumber: po.poNumber,
              lineType,
              sourceType: "WORK_ORDER",
            },
          );

          if (
            ruleResult.success &&
            ruleResult.matched &&
            ruleResult.isBalanced
          ) {
            matchedVarianceRuleId ??= ruleResult.rule?.id;
            allGLEntries.push(...ruleResult.entries);
          }
        }
      } else {
        // Regular POs: iterate each allocation on this line
        const allocations = line.chargeAllocations ?? [];
        for (const allocation of allocations) {
          if (!allocation.accountCodeId) continue;

          // Calculate allocation's share of the variance
          const allocationPercent = Number(allocation.percentage) / 100;
          const allocationVariance = Math.abs(lineVariance) * allocationPercent;

          if (allocationVariance <= 0.01) continue;

          const ruleResult = await glRuleEngineService.evaluateRules(
            context,
            GLEventType.PRICE_VAR,
            {
              amount: allocationVariance,
              accountCodeId: allocation.accountCodeId,
              departmentId: allocation.departmentId ?? undefined,
              areaId: allocation.areaId ?? undefined,
              projectId: allocation.projectId ?? undefined,
              transactionDate: new Date(),
              referenceType: "PurchaseOrder",
              referenceId: po.id,
              referenceNumber: po.poNumber,
              poNumber: po.poNumber,
              projectCode: allocation.projectId
                ? projectCodeMap.get(allocation.projectId)
                : undefined,
              lineType,
              sourceType: "MANUAL",
            },
          );

          if (
            ruleResult.success &&
            ruleResult.matched &&
            ruleResult.isBalanced
          ) {
            matchedVarianceRuleId ??= ruleResult.rule?.id;
            allGLEntries.push(...ruleResult.entries);
          }
        }
      }
    }

    // If no GL entries were generated, skip
    if (allGLEntries.length === 0) return;

    // Create GL transaction with ADJUSTMENT type to avoid unique constraint conflict
    // (EXPENDITURE already exists for this PO from approval)
    const varianceDirection = varianceAmount > 0 ? "increase" : "decrease";
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "ADJUSTMENT",
        referenceType: "PurchaseOrder",
        referenceId: po.id,
        referenceNumber: po.poNumber,
        description: `Price variance ${varianceDirection} for PO ${po.poNumber}: $${Math.abs(varianceAmount).toFixed(6)}`,
        glTransactionRuleId: matchedVarianceRuleId,
        lines: allGLEntries.map((entry) => ({
          entryType: entry.entryType,
          glAccountId: entry.glAccountId,
          amount: entry.amount,
          description: entry.description,
          accountCodeId: entry.accountCodeId,
          departmentId: entry.departmentId,
          projectId: entry.projectId,
          areaId: entry.areaId,
        })),
      },
    );

    // Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    // Adjust budget: INCREASE for unfavorable (price went up), DECREASE for favorable
    if (!isWorkOrderPO) {
      const adjustmentType = varianceAmount > 0 ? "INCREASE" : "DECREASE";
      await this.budgetTrackingService.adjustBudgetFromGL(context, {
        periodId: budgetPeriod.id,
        glTransactionId,
        referenceType: "PurchaseOrder",
        referenceId: po.id,
        referenceNumber: po.poNumber,
        totalAmount: totalVarianceAmount,
        adjustmentType,
      });
    }
  }

  /**
   * Populate CostVariance records for PO-level and line-level variance tracking.
   * Uses findFirst + create/update pattern since CostVariance has no unique constraint.
   *
   * @param po - The PO with lines
   * @param approvedTotal - The approved total amount
   * @param currentTotal - The current total amount
   */
  private async populateCostVariance(
    po: {
      id: string;
      poNumber: string;
      lines: Array<{
        id: string;
        description: string;
        totalPrice: unknown;
      }>;
    },
    approvedTotal: number,
    currentTotal: number,
  ): Promise<void> {
    const totalVariance = currentTotal - approvedTotal;
    const variancePct =
      approvedTotal > 0 ? (totalVariance / approvedTotal) * 100 : 0;

    // PO-level CostVariance record
    const existingPOVariance = await this.prisma.costVariance.findFirst({
      where: {
        referenceType: "PurchaseOrder",
        referenceId: po.id,
        lineItemId: null,
      },
    });

    const poVarianceData = {
      committedCost: currentTotal,
      estimatedVsCommitted: totalVariance,
      totalVariance: totalVariance,
      variancePercent: variancePct,
      varianceReason: `Price variance detected at send time`,
      isSignificant: Math.abs(variancePct) > 10,
    };

    if (existingPOVariance) {
      await this.prisma.costVariance.update({
        where: { id: existingPOVariance.id },
        data: poVarianceData,
      });
    } else {
      await this.prisma.costVariance.create({
        data: {
          referenceType: "PurchaseOrder",
          referenceId: po.id,
          referenceNumber: po.poNumber,
          description: `PO ${po.poNumber} price variance`,
          estimatedCost: approvedTotal,
          ...poVarianceData,
        },
      });
    }

    // Query approved total prices using typed Prisma (post-migration, approvedTotalPrice is generated)
    const approvedLinePriceData = await this.prisma.pOLine.findMany({
      where: { purchaseOrderId: po.id },
      select: { id: true, approvedTotalPrice: true },
    });
    const approvedLinePriceMap = new Map(
      approvedLinePriceData.map((p) => [
        p.id,
        p.approvedTotalPrice ? Number(p.approvedTotalPrice) : null,
      ]),
    );

    // Line-level CostVariance records for each line with variance
    for (const line of po.lines) {
      const lineApproved =
        approvedLinePriceMap.get(line.id) ?? Number(line.totalPrice);
      const lineCurrent = Number(line.totalPrice);
      const lineVariance = lineCurrent - lineApproved;

      if (Math.abs(lineVariance) <= 0.01) continue;

      const lineVariancePct =
        lineApproved > 0 ? (lineVariance / lineApproved) * 100 : 0;

      const existingLineVariance = await this.prisma.costVariance.findFirst({
        where: {
          referenceType: "PurchaseOrderLine",
          referenceId: po.id,
          lineItemId: line.id,
        },
      });

      const lineVarianceData = {
        committedCost: lineCurrent,
        estimatedVsCommitted: lineVariance,
        totalVariance: lineVariance,
        variancePercent: lineVariancePct,
        varianceReason: `Line price variance at send time`,
        isSignificant: Math.abs(lineVariancePct) > 10,
      };

      if (existingLineVariance) {
        await this.prisma.costVariance.update({
          where: { id: existingLineVariance.id },
          data: lineVarianceData,
        });
      } else {
        await this.prisma.costVariance.create({
          data: {
            referenceType: "PurchaseOrderLine",
            referenceId: po.id,
            referenceNumber: po.poNumber,
            lineItemId: line.id,
            description: `Line "${line.description}" price variance`,
            estimatedCost: lineApproved,
            ...lineVarianceData,
          },
        });
      }
    }
  }

  // ============================================================================
  // EXTRACTED GL & SNAPSHOT METHODS (used by both approve() and send())
  // ============================================================================

  /**
   * Create EXPENDITURE GL entries and consume budget for a purchase order.
   *
   * This is the core GL logic extracted from approve() so it can be reused by send()
   * for POs created from approved requisitions (which skip the approval workflow).
   *
   * Steps:
   * 1. Iterate ALL PO lines and their allocations to generate GL entries
   * 2. Create ONE GL transaction with ALL entries
   * 3. Post the GL transaction
   * 4. Consume budget from the GL transaction (non-work-order POs only)
   *
   * @param context - Service context
   * @param po - The purchase order (must have id, poNumber, totalAmount, requisitionIds)
   */
  private async createApprovalGLEntries(
    context: ServiceContext,
    po: { id: string; poNumber: string; requisitionIds: string[] },
  ): Promise<void> {
    // Fetch inventory dimension defaults once — used to stamp INVENTORY lines
    // that carry no explicit charge allocations (storeroom replenishment POs).
    // Null when not configured (no stamping, existing behaviour preserved).
    const { defaultInventoryAccountCodeId, defaultInventoryDepartmentId } =
      await financeSettingsService.getInventoryDefaults();
    // Fetch WO dimension defaults — used to stamp WORK ORDER PO lines when the
    // charge allocation carries no departmentId (e.g. legacy or auto-generated allocs).
    const { defaultWorkOrderDepartmentId } =
      await financeSettingsService.getWorkOrderDefaults();
    // Guard: Only open POs can generate GL entries (prevents Closed/Cancelled POs from hitting GL)
    const currentPOStatus = await this.prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      select: { status: true },
    });
    const CLOSED_STATUSES = ["Closed", "Cancelled"];
    if (currentPOStatus && CLOSED_STATUSES.includes(currentPOStatus.status)) {
      throw new BadRequestError(
        `Cannot create GL entries for PO ${po.poNumber} — status is "${currentPOStatus.status}". Only open POs are eligible for GL transactions.`,
      );
    }

    // Get budget period
    const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);

    // Get PO lines with allocations and supplier for description building
    const poWithLines = await this.prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      include: {
        supplier: {
          select: { name: true },
        },
        lines: {
          include: {
            chargeAllocations: true,
          },
        },
      },
    });

    if (!poWithLines || poWithLines.lines.length === 0) {
      throw new Error("No PO lines found");
    }

    // Check if this PO is linked to work order requisitions
    let isWorkOrderPO = false;
    let woWorkOrderId: string | undefined;
    if (po.requisitionIds.length > 0) {
      const requisition = await this.prisma.requisition.findFirst({
        where: { id: { in: po.requisitionIds } },
        include: {
          budgetHeader: {
            select: {
              budgetType: true,
              workOrderId: true,
            },
          },
        },
      });
      const budgetHeader = requisition?.budgetHeader as {
        budgetType: string;
        workOrderId: string | null;
      } | null;
      isWorkOrderPO = budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER";
      woWorkOrderId = budgetHeader?.workOrderId ?? undefined;
    }

    // Define the allocation type we expect from the database
    type AllocationFromDB = {
      id: string;
      accountCodeId: string | null;
      departmentId: string | null;
      projectId: string | null;
      areaId: string | null;
      percentage: number;
      amount: number;
    };

    // Type guard for lines with allocations
    const hasAllocations = (
      line: (typeof poWithLines.lines)[0],
    ): line is typeof line & {
      chargeAllocations: AllocationFromDB[];
    } => {
      const lineWithAlloc = line as typeof line & {
        chargeAllocations?: unknown;
      };
      return (
        Array.isArray(lineWithAlloc.chargeAllocations) &&
        lineWithAlloc.chargeAllocations.length > 0
      );
    };

    // Build projectId → projectCode lookup for allocations that have projectId
    const allAllocProjectIds = poWithLines.lines
      .flatMap((l) => {
        const lineWithAlloc = l as typeof l & {
          chargeAllocations?: Array<{ projectId: string | null }>;
        };
        return lineWithAlloc.chargeAllocations;
      })
      .map((a) => a.projectId)
      .filter((id): id is string => id !== null);
    const uniqueAllocProjectIds = [...new Set(allAllocProjectIds)];
    const projectCodeMap = new Map<string, string>();
    if (uniqueAllocProjectIds.length > 0) {
      const projects = await this.prisma.project.findMany({
        where: { id: { in: uniqueAllocProjectIds } },
        select: { id: true, code: true },
      });
      for (const p of projects) {
        projectCodeMap.set(p.id, p.code);
      }
    }

    // Collect ALL GL entries from ALL lines and ALL allocations
    const allGLEntries: GLEntry[] = [];
    let matchedApprovalRuleId: string | undefined;

    // Iterate each line and each allocation to create GL entries
    for (const line of poWithLines.lines) {
      const lineAmount = Number(line.quantity) * Number(line.unitPrice);

      // Get line type for tracking
      const lineType = line.lineType;
      // For GL rule evaluation, REPAIRABLE_RETURN uses NON_STOCK accounting treatment
      // (vendor repair is an operating expense — same GL rules as non-stock purchases).
      const glLineType: "INVENTORY" | "SERVICE" | "CONSUMABLE" | "NON_STOCK" =
        lineType === LineItemType.REPAIRABLE_RETURN
          ? "NON_STOCK"
          : // REPAIRABLE_RETURN is handled above, so TypeScript narrows lineType
            // to the four remaining LineItemType members here — no cast needed.
            // (Leaving the cast off also means TS will flag it if a new
            // LineItemType member is ever added, instead of silently
            // mis-assigning it to this 4-member union.)
            lineType;

      if (isWorkOrderPO) {
        // Work order POs: Equipment always provides account codes.
        // Use the first allocation's dimensions if available, with fallback resolution.
        const lineAllocations = (
          line as typeof line & {
            chargeAllocations: Array<{
              accountCodeId: string | null;
              departmentId: string | null;
            }>;
          }
        ).chargeAllocations;
        const firstAlloc = lineAllocations[0];
        let woAccountCodeId = firstAlloc?.accountCodeId;

        // Fallback: resolve account code from work order's project or equipment
        // (Work order POs from requisitions may not have charge allocations)
        if (!woAccountCodeId && woWorkOrderId) {
          const workOrder = await this.prisma.workOrder.findUnique({
            where: { id: woWorkOrderId },
            select: {
              projectId: true,
              project: {
                select: { accountCodeId: true },
              },
              equipment: {
                select: { defaultAccountCodeId: true },
              },
            },
          });

          // Priority 1: Project default account code (project overrides equipment)
          if (workOrder?.project?.accountCodeId) {
            woAccountCodeId = workOrder.project.accountCodeId;
          }
          // Priority 2: Equipment default account code
          else if (workOrder?.equipment?.defaultAccountCodeId) {
            woAccountCodeId = workOrder.equipment.defaultAccountCodeId;
          }
        }

        if (!woAccountCodeId) {
          throw new Error(
            "No account code configured for work order PO line. Equipment must have a default account code.",
          );
        }

        // Evaluate GL rules for this line with work order dimensions.
        // Department priority: allocation dept → FinanceSettings WO default → undefined
        const ruleResult = await glRuleEngineService.evaluateRules(
          context,
          GLEventType.PO_APPROVE,
          {
            amount: lineAmount,
            accountCodeId: woAccountCodeId,
            departmentId:
              firstAlloc?.departmentId ??
              defaultWorkOrderDepartmentId ??
              undefined,
            transactionDate: new Date(),
            referenceType: "PurchaseOrder",
            referenceId: po.id,
            referenceNumber: po.poNumber,
            poNumber: po.poNumber,
            lineType: glLineType,
            sourceType: "WORK_ORDER",
          },
        );

        // Validate rule match
        if (!ruleResult.success || !ruleResult.matched) {
          throw new BadRequestError(
            `No GL rule matched for PO_APPROVE event. Please configure GL rules for PO approval transactions.`,
          );
        }

        // Validate balanced entries
        if (!ruleResult.isBalanced) {
          throw new BadRequestError(
            `GL entries not balanced for PO approval: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
          );
        }

        // Collect entries from this line
        matchedApprovalRuleId ??= ruleResult.rule?.id;
        allGLEntries.push(...ruleResult.entries);
      } else {
        // ================================================================
        // INVENTORY vs NON-STOCK (SERVICE/CONSUMABLE/NON_STOCK) GL HANDLING
        // ================================================================
        // INVENTORY lines: GL accounts are determined 100% by GL rules
        //   using FIXED account sources. They do NOT require manual
        //   account code / department charge allocations. We pass
        //   itemType: 'INVENTORY' and let the rule engine resolve
        //   accounts from FIXED sources.
        //
        // SERVICE / CONSUMABLE / NON_STOCK lines: GL rules use
        //   ACCOUNT_CODE_LINK to resolve expense accounts from the
        //   user-supplied account codes. These REQUIRE charge allocations
        //   with accountCodeId / departmentId — either on the PO line
        //   directly (POLineChargeAllocation) or via the linked requisition
        //   line (RequisitionLineAllocation, for req-sourced POs).
        // ================================================================

        const isInventoryLine = lineType === "INVENTORY";

        if (isInventoryLine && !hasAllocations(line)) {
          // INVENTORY line without allocations — evaluate GL rules with
          // itemType only. The rule engine uses FIXED account sources for
          // the GL posting accounts (e.g. debit 1535, credit 2111).
          //
          // We also inject the finance-settings inventory defaults so that
          // GL rule actions with trackAccountCode / trackDepartment = true
          // will stamp the correct Dept Code and Department on the
          // GLTransactionLine — critical for NAV CSV export accuracy.
          // If no defaults are configured the context fields are undefined
          // and behaviour is identical to before this change.
          const ruleResult = await glRuleEngineService.evaluateRules(
            context,
            GLEventType.PO_APPROVE,
            {
              amount: lineAmount,
              itemType: "INVENTORY",
              transactionDate: new Date(),
              referenceType: "PurchaseOrder",
              referenceId: po.id,
              referenceNumber: po.poNumber,
              poNumber: po.poNumber,
              lineType: "INVENTORY",
              sourceType: "MANUAL",
              // Storeroom cost-centre defaults (null = not configured, no-op)
              accountCodeId: defaultInventoryAccountCodeId ?? undefined,
              departmentId: defaultInventoryDepartmentId ?? undefined,
            },
          );

          // Validate rule match
          if (!ruleResult.success || !ruleResult.matched) {
            throw new BadRequestError(
              `No GL rule matched for PO_APPROVE event (INVENTORY line "${line.description}"). ` +
                `Please configure GL rules with FIXED account sources for inventory PO approval transactions.`,
            );
          }

          // Validate balanced entries
          if (!ruleResult.isBalanced) {
            throw new BadRequestError(
              `GL entries not balanced for PO approval (INVENTORY): Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
            );
          }

          // Collect entries from this inventory line
          matchedApprovalRuleId ??= ruleResult.rule?.id;
          allGLEntries.push(...ruleResult.entries);
        } else if (hasAllocations(line)) {
          // Line has allocations — iterate them (works for all line types,
          // including INVENTORY lines that happen to have allocations).
          for (const allocation of line.chargeAllocations) {
            if (!allocation.accountCodeId) {
              throw new Error(
                `Allocation ${allocation.id} has no account code`,
              );
            }

            // Calculate allocation amount based on percentage
            const allocationAmount = lineAmount * (allocation.percentage / 100);

            // Evaluate GL rules for THIS allocation with its specific dimensions
            const ruleResult = await glRuleEngineService.evaluateRules(
              context,
              GLEventType.PO_APPROVE,
              {
                amount: allocationAmount,
                accountCodeId: allocation.accountCodeId,
                departmentId: allocation.departmentId ?? undefined,
                areaId: allocation.areaId ?? undefined,
                projectId: allocation.projectId ?? undefined,
                transactionDate: new Date(),
                referenceType: "PurchaseOrder",
                referenceId: po.id,
                referenceNumber: po.poNumber,
                poNumber: po.poNumber,
                projectCode: allocation.projectId
                  ? projectCodeMap.get(allocation.projectId)
                  : undefined,
                lineType: glLineType,
                sourceType: "MANUAL",
              },
            );

            // Validate rule match
            if (!ruleResult.success || !ruleResult.matched) {
              throw new BadRequestError(
                `No GL rule matched for PO_APPROVE event. Please configure GL rules for PO approval transactions.`,
              );
            }

            // Validate balanced entries
            if (!ruleResult.isBalanced) {
              throw new BadRequestError(
                `GL entries not balanced for PO approval: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
              );
            }

            // Collect entries from this allocation
            matchedApprovalRuleId ??= ruleResult.rule?.id;
            allGLEntries.push(...ruleResult.entries);

            // Force-stamp projectId from allocation if rule engine didn't set it
            // This ensures project dimensions flow through regardless of rule trackProject settings
            for (const entry of ruleResult.entries) {
              if (!entry.projectId && allocation.projectId) {
                entry.projectId = allocation.projectId;
              }
            }
          }
        } else {
          // Non-stock line without PO-level charge allocations.
          // For req-sourced POs (CONSUMABLE/SERVICE/NON_STOCK), the charge allocations
          // live on the linked RequisitionLine, not on the POLine.
          // Look up the requisition line allocation(s) for this PO line using a
          // three-tier fallback strategy to handle description mismatches and
          // missing poLineId back-references (both common for legacy POs).
          let reqLineAllocations: Array<{
            accountCodeId: string | null;
            departmentId: string | null;
            projectId: string | null;
            areaId: string | null;
            percentage: number;
          }> = [];

          if (po.requisitionIds.length > 0) {
            // ---------------------------------------------------------------
            // TIER 1: Exact poLineId match (most reliable — set on new POs)
            // ---------------------------------------------------------------
            let reqLine = await this.prisma.requisitionLine.findFirst({
              where: { poLineId: line.id },
              include: { allocations: true },
            });

            // ---------------------------------------------------------------
            // TIER 2: purchaseOrderId + exact description match (legacy POs
            //         where poLineId was not written back but description
            //         was preserved verbatim)
            // ---------------------------------------------------------------
            reqLine ??= await this.prisma.requisitionLine.findFirst({
              where: {
                purchaseOrderId: po.id,
                description: line.description,
              },
              include: { allocations: true },
            });

            // ---------------------------------------------------------------
            // TIER 3: Fetch ALL req lines for linked reqs that reference this
            //         PO (purchaseOrderId set), then match by SKU prefix
            //         (the portion before the first '-' or space) against the
            //         PO line description.  This handles the common case where
            //         the PO description is an enriched version of the short
            //         req description (e.g. "CLS3022P100-1EA" → "CLS3022P100-
            //         Corning reusable graduated cylinder 100mL").
            //
            //         Also covers the positional-match case: if only one
            //         unmatched req line remains for this PO, use it directly.
            // ---------------------------------------------------------------
            if (!reqLine) {
              const candidateReqLines =
                await this.prisma.requisitionLine.findMany({
                  where: {
                    requisitionId: { in: po.requisitionIds },
                    purchaseOrderId: po.id,
                  },
                  include: { allocations: true },
                  orderBy: { createdAt: "asc" },
                });

              if (candidateReqLines.length > 0) {
                // Extract the SKU prefix from the PO line description:
                // e.g. "CLS3022P100-Corning reusable..." → "CLS3022P100"
                // e.g. "CLS5640P50-Corning..."           → "CLS5640P50"
                const poDescUpper = line.description.toUpperCase();
                const skuPrefix = poDescUpper.split(/[-\s]/)[0] ?? ""; // part before first dash or space

                // Try SKU-prefix match first
                const skuMatch = candidateReqLines.find((rl) => {
                  const rlDescUpper = rl.description.toUpperCase();
                  return rlDescUpper.startsWith(skuPrefix);
                });

                if (skuMatch) {
                  reqLine = skuMatch;
                } else if (candidateReqLines.length === 1) {
                  // Only one candidate — use it positionally
                  reqLine = candidateReqLines[0] ?? null;
                }
              }
            }

            if (reqLine) {
              const reqLineWithAlloc = reqLine as typeof reqLine & {
                allocations: Array<{
                  accountCodeId: string | null;
                  departmentId: string | null;
                  projectId: string | null;
                  areaId: string | null;
                  percentage: unknown;
                }>;
              };
              reqLineAllocations = reqLineWithAlloc.allocations.map((a) => ({
                accountCodeId: a.accountCodeId,
                departmentId: a.departmentId,
                projectId: a.projectId,
                areaId: a.areaId,
                percentage: Number(a.percentage),
              }));
            }
          }

          if (reqLineAllocations.length === 0) {
            // Truly no allocations anywhere — error
            throw new BadRequestError(
              `PO line "${line.description}" (${line.id}) has no budget allocations. ` +
                `Non-stock (SERVICE/CONSUMABLE/NON_STOCK) lines require charge allocations with account codes.`,
            );
          }

          // Use req-line allocations to drive GL entries
          for (const allocation of reqLineAllocations) {
            if (!allocation.accountCodeId) continue;

            const allocationAmount = lineAmount * (allocation.percentage / 100);

            const ruleResult = await glRuleEngineService.evaluateRules(
              context,
              GLEventType.PO_APPROVE,
              {
                amount: allocationAmount,
                accountCodeId: allocation.accountCodeId,
                departmentId: allocation.departmentId ?? undefined,
                areaId: allocation.areaId ?? undefined,
                projectId: allocation.projectId ?? undefined,
                transactionDate: new Date(),
                referenceType: "PurchaseOrder",
                referenceId: po.id,
                referenceNumber: po.poNumber,
                poNumber: po.poNumber,
                projectCode: allocation.projectId
                  ? projectCodeMap.get(allocation.projectId)
                  : undefined,
                lineType: glLineType,
                sourceType: "MANUAL",
              },
            );

            // Validate rule match
            if (!ruleResult.success || !ruleResult.matched) {
              throw new BadRequestError(
                `No GL rule matched for PO_APPROVE event. Please configure GL rules for PO approval transactions.`,
              );
            }

            // Validate balanced entries
            if (!ruleResult.isBalanced) {
              throw new BadRequestError(
                `GL entries not balanced for PO approval: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
              );
            }

            matchedApprovalRuleId ??= ruleResult.rule?.id;
            allGLEntries.push(...ruleResult.entries);

            // Force-stamp projectId from allocation if rule engine didn't set it
            for (const entry of ruleResult.entries) {
              if (!entry.projectId && allocation.projectId) {
                entry.projectId = allocation.projectId;
              }
            }
          }
        }
      }
    }

    if (allGLEntries.length === 0) {
      // Distinguish two cases:
      //
      // CASE 1 — Pure-inventory PO (all lines are INVENTORY):
      //   GLR-0034 "PO Approve - Inventory Commitment" intentionally intercepts
      //   INVENTORY lines and returns zero actions. Inventory is a balance-sheet
      //   asset, not an operating expense — no commitment GL is created at PO
      //   approval. The GL "in and out" (DR 1535 Store Room Inventory /
      //   CR 2111 AP-RNI) is generated at receipt time via the PO_RECEIPT_INV
      //   event ("PO Receipt - Inventory Items (No Prior Commitment)").
      //   → Return without creating a GL transaction; receipt handles the entries.
      //
      // CASE 2 — Non-inventory or mixed PO with no entries:
      //   A GL rule should have matched and produced entries but didn't.
      //   This is a configuration problem that must surface as a clear error.
      const allInventoryLines = poWithLines.lines.every(
        (l) => l.lineType === "INVENTORY",
      );

      if (allInventoryLines) {
        logger.info(
          `[PO Workflow] PO ${po.poNumber}: pure-inventory PO — GLR-0034 ` +
            `correctly produced zero commitment entries. GL "in and out" will ` +
            `be created at receipt via PO_RECEIPT_INV.`,
        );
        return;
      }

      throw new BadRequestError(
        `No GL entries were generated for PO ${po.poNumber}. ` +
          `One or more non-inventory lines have no charge allocations or matching GL rules. ` +
          `Please add charge allocations to all SERVICE, CONSUMABLE, and NON_STOCK lines before sending.`,
      );
    }

    // Compute the debit total from GL entries — this is what the budget tracking
    // service will extract via extractDimensionsFromGL('DEBIT') and validate against.
    // Must match to avoid "Total amount mismatch" errors.
    const totalDebitAmount = allGLEntries
      .filter((e) => e.entryType === "DEBIT")
      .reduce((sum, e) => sum + e.amount, 0);

    // Build a finance-meaningful description: "Encumbrance - {supplier} - {poNumber} - {lineDescs}"
    const supplierName =
      (poWithLines as { supplier?: { name: string } | null }).supplier?.name ??
      "Unknown Supplier";
    const lineDescriptions = [
      ...new Set(poWithLines.lines.map((l) => l.description).filter(Boolean)),
    ];
    const lineDescSummary = lineDescriptions.join("; ");
    const baseDesc = `Encumbrance - ${supplierName} - ${po.poNumber}`;
    const fullDesc = lineDescSummary
      ? `${baseDesc} - ${lineDescSummary}`.substring(0, 255)
      : baseDesc;

    // Create ONE GL transaction with ALL entries from all lines/allocations
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE",
        referenceType: "PurchaseOrder",
        referenceId: po.id,
        referenceNumber: po.poNumber,
        description: fullDesc,
        glTransactionRuleId: matchedApprovalRuleId,
        lines: allGLEntries.map((entry) => ({
          entryType: entry.entryType,
          glAccountId: entry.glAccountId,
          amount: entry.amount,
          description: entry.description,
          accountCodeId: entry.accountCodeId,
          departmentId: entry.departmentId,
          projectId: entry.projectId,
          areaId: entry.areaId,
        })),
      },
    );

    // Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    // Consume budget using GL transaction as single source of truth
    // Only consume budget for regular (charge-to-account) POs, NOT work order POs
    // (Work order PO budget was already consumed during requisition creation)
    if (!isWorkOrderPO) {
      await this.budgetTrackingService.consumeBudgetFromGL(context, {
        periodId: budgetPeriod.id,
        glTransactionId,
        referenceType: "PurchaseOrder",
        referenceId: po.id,
        referenceNumber: po.poNumber,
        totalAmount: totalDebitAmount,
      });
    }

    // ========================================================================
    // TAX GL ENTRY (NON-FATAL)
    // Post a separate PO_TAX GL transaction when the tax module is enabled,
    // taxAmount > 0, and a taxGLAccountId is configured.
    // Uses typed Prisma access (post-migration, taxAmount column is generated).
    // ========================================================================
    try {
      const taxConfig = await getTaxConfig();
      if (taxConfig.enabled && taxConfig.taxGLAccountId) {
        // Read stored taxAmount using typed Prisma call (post-migration)
        const poForTax = await this.prisma.purchaseOrder.findUnique({
          where: { id: po.id },
          select: { taxAmount: true },
        });
        const storedTaxAmount = poForTax?.taxAmount
          ? Number(poForTax.taxAmount)
          : 0;

        if (storedTaxAmount > 0) {
          await poGLService.createTaxGLEntry(context, {
            purchaseOrderId: po.id,
            poNumber: po.poNumber,
            taxGLAccountId: taxConfig.taxGLAccountId,
            taxAmount: storedTaxAmount,
            taxLabel: taxConfig.taxLabel,
          });
        }
      }
    } catch (taxGLError) {
      // Non-fatal — log with full context for retry; do NOT fail the PO approval.
      logger.error(
        `[PO Workflow] TAX GL ENTRY FAILED for PO ${po.poNumber} (${po.id}). ` +
          `Approval will proceed WITHOUT tax GL entry. Retry by re-running the GL post.`,
        {
          error:
            taxGLError instanceof Error
              ? taxGLError.message
              : String(taxGLError),
          stack: taxGLError instanceof Error ? taxGLError.stack : undefined,
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
        },
      );
    }
  }

  /**
   * Snapshot the current unit/total prices into approvedUnitPrice/approvedTotalPrice
   * on each PO line, and the PO-level approvedTotal.
   *
   * Called at approval time (or first send for req-sourced POs) to capture the
   * "baseline" prices for later variance detection.
   *
   * Uses typed Prisma calls (post-migration — approvedUnitPrice, approvedTotalPrice,
   * and approvedTotal are all generated in the Prisma client after prisma generate).
   *
   * @param po - The purchase order (must have id and totalAmount)
   */
  private async snapshotApprovedPrices(po: {
    id: string;
    totalAmount: unknown;
  }): Promise<void> {
    // Get PO with lines for snapshotting
    const poWithLines = await this.prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      include: {
        lines: true,
      },
    });

    if (!poWithLines) return;

    // Snapshot each PO line with typed Prisma update (approvedUnitPrice + approvedTotalPrice are generated)
    await this.prisma.$transaction(
      poWithLines.lines.map((line) =>
        this.prisma.pOLine.update({
          where: { id: line.id },
          data: {
            approvedUnitPrice: Number(line.unitPrice),
            approvedTotalPrice: Number(line.totalPrice),
          },
        }),
      ),
    );

    // Snapshot PO-level approved total using typed Prisma update (approvedTotal is generated)
    await this.prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { approvedTotal: Number(po.totalAmount) },
    });
  }

  /**
   * Close purchase order
   * Transition: RECEIVED → CLOSED
   *
   * @param context - Service context with user and permissions
   * @param id - Purchase order ID
   * @returns Updated purchase order
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if PO cannot be closed
   */
  async close(
    context: ServiceContext,
    id: string,
    reason?: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      // Check permission - B6-1: granular purchasing:close permission
      const permission = buildPermissionString(
        this.resource,
        ExtendedPermissionAction.CLOSE,
      );
      await checkPermission(context, permission);

      validateRequired(id, "id");

      // Get current PO
      const currentPO = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: buildPOInclude(),
      });

      if (!currentPO) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // Validate transition
      if (!canClose(currentPO.status as PurchaseOrderStatus)) {
        throw new BadRequestError(
          `Cannot close purchase order in ${currentPO.status} status`,
        );
      }

      // Check for pending invoices (warn but don't block)
      const pendingInvoices = await this.prisma.invoice.findMany({
        where: {
          purchaseOrderId: id,
          approvalStatus: {
            notIn: ["FULLY_APPROVED", "REQUESTOR_APPROVED"],
          },
          voidedAt: null,
        },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          approvalStatus: true,
        },
      });

      if (pendingInvoices.length > 0) {
        logger.warn(
          `[PO Close] PO ${currentPO.poNumber} has ${pendingInvoices.length} pending invoice(s). Closing anyway.`,
        );
      }

      // Perform update
      const updated = await this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.CLOSED,
          closedAt: new Date(),
          closedBy: context.userId,
          closedReason: reason ?? null,
        },
        include: buildPOInclude(),
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CLOSE,
        "PurchaseOrder",
        id,
        currentPO.poNumber,
        { status: currentPO.status },
        { status: updated.status },
        {
          closedBy: context.userId,
          closeReason: reason ?? undefined,
          totalAmount: Number(updated.totalAmount),
          receivedAmount: updated.lines.reduce(
            (sum, line) => sum + Number(line.receivedAmount),
            0,
          ),
          pendingInvoiceCount: pendingInvoices.length,
        },
      );

      // ========================================================================
      // GL REVERSAL FOR SHORT-CLOSE SCENARIOS
      // ========================================================================
      // If PO was not fully received (Ordered or PartiallyReceived), reverse
      // the unreceived portion of the original EXPENDITURE commitment GL entry.
      // Fully received POs (Received status) have balanced books and need no reversal.
      //
      // LATE-ADDED LINES: Lines added to this PO after it was already sent
      // (Ordered/PartiallyReceived) have their own 'POLine' EXPENDITURE GL entries
      // rather than being bundled in the main 'PurchaseOrder' EXPENDITURE. These
      // are handled separately below to:
      //   a) Exclude their amounts from the main PO reversal ratio calculation
      //      (avoids over-reversing the original commitment)
      //   b) Reverse their own POLine commitment entries if they are unreceived
      const currentStatus = currentPO.status as PurchaseOrderStatus;
      if (currentStatus !== PurchaseOrderStatus.RECEIVED) {
        try {
          // ── Detect late-added lines (POLine-level EXPENDITURE entries) ──
          const poLineIds = currentPO.lines.map((l) => l.id);
          const lateAddedGLTxns =
            poLineIds.length > 0
              ? await this.prisma.gLTransaction.findMany({
                  where: {
                    referenceType: "POLine",
                    referenceId: { in: poLineIds },
                    transactionType: "EXPENDITURE",
                    status: "POSTED",
                  },
                  include: { lines: { include: { glAccount: true } } },
                })
              : [];
          const lateAddedLineIdSet = new Set(
            lateAddedGLTxns.map((t) => t.referenceId),
          );

          // ── Calculate unreceived amount for ORIGINAL lines only ──────────
          // Exclude late-added lines — their amounts are handled by the
          // POLine EXPENDITURE reversal block below.
          const unreceivedAmount = currentPO.lines.reduce((sum, line) => {
            if (lateAddedLineIdSet.has(line.id)) return sum;
            const ordered = Number(line.quantity) * Number(line.unitPrice);
            const received =
              Number(line.receivedQuantity) * Number(line.unitPrice);
            return sum + Math.max(0, ordered - received);
          }, 0);

          if (unreceivedAmount > 0) {
            // Find the original PO approval EXPENDITURE GL transaction
            const approvalGLTxn = await this.prisma.gLTransaction.findFirst({
              where: {
                referenceType: "PurchaseOrder",
                referenceId: id,
                transactionType: "EXPENDITURE",
                status: "POSTED",
              },
              include: { lines: { include: { glAccount: true } } },
            });

            if (approvalGLTxn) {
              // Idempotency guard: check if a reversal GL transaction already exists
              // (e.g., from a previous close attempt that partially completed)
              const existingReversal =
                await this.prisma.gLTransaction.findFirst({
                  where: {
                    referenceType: "PurchaseOrder",
                    referenceId: id,
                    transactionType: "REVERSAL",
                    status: "POSTED",
                  },
                });

              if (!existingReversal) {
                // Calculate ratio of unreceived to total to scale down each GL line proportionally
                const totalOriginalAmount = approvalGLTxn.lines
                  .filter((l) => l.entryType === "DEBIT")
                  .reduce((s, l) => s + Number(l.amount), 0);

                const ratio =
                  totalOriginalAmount > 0
                    ? unreceivedAmount / totalOriginalAmount
                    : 0;

                if (ratio > 0) {
                  // Create partial reversal GL transaction (flip DEBIT↔CREDIT, scaled amounts)
                  const reversalLines = approvalGLTxn.lines.map((line) => ({
                    entryType:
                      line.entryType === "DEBIT"
                        ? ("CREDIT" as const)
                        : ("DEBIT" as const),
                    glAccountId: line.glAccountId,
                    amount:
                      Math.round(Number(line.amount) * ratio * 1000000) /
                      1000000,
                    accountCodeId: line.accountCodeId ?? undefined,
                    departmentId: line.departmentId ?? undefined,
                    projectId: line.projectId ?? undefined,
                    areaId: line.areaId ?? undefined,
                    description: `PO ${currentPO.poNumber} closure - reverse unreceived commitment`,
                  }));

                  const budgetPeriod = await getCurrentBudgetPeriod(
                    this.prisma,
                  );

                  const reversalTxnId =
                    await glTransactionService.createTransaction(context, {
                      transactionDate: new Date(),
                      fiscalPeriodId: budgetPeriod.id,
                      transactionType: "REVERSAL",
                      referenceType: "PurchaseOrder",
                      referenceId: id,
                      referenceNumber: currentPO.poNumber,
                      description: `PO ${currentPO.poNumber} closure - reverse unreceived commitment ($${unreceivedAmount.toFixed(6)})`,
                      lines: reversalLines,
                      originalGLTransactionId: approvalGLTxn.id,
                      reversalReason: `PO closed with unreceived amount of $${unreceivedAmount.toFixed(6)}`,
                    });

                  await glTransactionService.postTransaction(
                    context,
                    reversalTxnId,
                  );

                  // Release budget for the unreceived portion using the REVERSAL transaction.
                  // unconsumeBudgetFromGL calls extractDimensionsFromGL WITHOUT an entryType filter,
                  // so it sums ALL lines (both DEBIT and CREDIT) from the reversal transaction.
                  // totalAmount must match that sum for the validation check to pass.
                  const reversalTotal = reversalLines.reduce(
                    (s, l) => s + l.amount,
                    0,
                  );
                  await this.budgetTrackingService.unconsumeBudgetFromGL(
                    context,
                    {
                      periodId: budgetPeriod.id,
                      glTransactionId: reversalTxnId,
                      referenceType: "PurchaseOrder",
                      referenceId: id,
                      referenceNumber: currentPO.poNumber,
                      totalAmount: reversalTotal,
                    },
                  );
                }
              } else {
                logger.info(
                  `[PO Close] GL reversal already exists for PO ${currentPO.poNumber}, skipping`,
                );
              }
            }
          }

          // ── Reverse unreceived late-added line commitments ───────────────
          // For each late-added line (added after PO was sent) that has not
          // been fully received, reverse its POLine EXPENDITURE commitment.
          for (const lateGLTxn of lateAddedGLTxns) {
            const poLine = currentPO.lines.find(
              (l) => l.id === lateGLTxn.referenceId,
            );
            if (!poLine) continue;

            const orderedQty = Number(poLine.quantity);
            const receivedQty = Number(poLine.receivedQuantity);
            if (receivedQty >= orderedQty) continue; // fully received — commitment already released by receipt GL

            const ratio =
              orderedQty > 0
                ? Math.max(0, (orderedQty - receivedQty) / orderedQty)
                : 0;
            if (ratio <= 0) continue;

            try {
              // Idempotency guard for this specific POLine reversal
              const existingLineReversal =
                await this.prisma.gLTransaction.findFirst({
                  where: {
                    referenceType: "POLine",
                    referenceId: lateGLTxn.referenceId,
                    transactionType: "REVERSAL",
                    status: "POSTED",
                  },
                });
              if (existingLineReversal) {
                logger.info(
                  `[PO Close] POLine GL reversal already exists for line ${lateGLTxn.referenceId}, skipping`,
                );
                continue;
              }

              const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);
              const reversalLines = lateGLTxn.lines.map((line) => ({
                entryType:
                  line.entryType === "DEBIT"
                    ? ("CREDIT" as const)
                    : ("DEBIT" as const),
                glAccountId: line.glAccountId,
                amount:
                  Math.round(Number(line.amount) * ratio * 1000000) / 1000000,
                accountCodeId: line.accountCodeId ?? undefined,
                departmentId: line.departmentId ?? undefined,
                projectId: line.projectId ?? undefined,
                areaId: line.areaId ?? undefined,
                description: `PO ${currentPO.poNumber} closure - reverse late-added line commitment`,
              }));

              const lineReversalTxnId =
                await glTransactionService.createTransaction(context, {
                  transactionDate: new Date(),
                  fiscalPeriodId: budgetPeriod.id,
                  transactionType: "REVERSAL",
                  referenceType: "POLine",
                  referenceId: lateGLTxn.referenceId,
                  referenceNumber: currentPO.poNumber,
                  description: `PO ${currentPO.poNumber} closure - reverse late-added line commitment`,
                  lines: reversalLines,
                  originalGLTransactionId: lateGLTxn.id,
                  reversalReason: `PO ${currentPO.poNumber} closed with unreceived late-added line`,
                });

              await glTransactionService.postTransaction(
                context,
                lineReversalTxnId,
              );

              const reversalTotal = reversalLines.reduce(
                (s, l) => s + l.amount,
                0,
              );
              await this.budgetTrackingService.unconsumeBudgetFromGL(context, {
                periodId: budgetPeriod.id,
                glTransactionId: lineReversalTxnId,
                referenceType: "PurchaseOrder",
                referenceId: id,
                referenceNumber: currentPO.poNumber,
                totalAmount: reversalTotal,
              });

              logger.info(
                `[PO Close] Reversed POLine commitment for late-added line ${lateGLTxn.referenceId} ` +
                  `on PO ${currentPO.poNumber} (ratio=${ratio.toFixed(4)})`,
              );
            } catch (lateLineGLError) {
              logger.error(
                `[PO Close] GL reversal failed for late-added POLine ${lateGLTxn.referenceId} ` +
                  `on PO ${currentPO.poNumber} (non-fatal — close will proceed): ` +
                  `${lateLineGLError instanceof Error ? lateLineGLError.message : String(lateLineGLError)}`,
              );
              // Non-fatal — close proceeds even if this specific line reversal fails
            }
          }
        } catch (glError) {
          logger.error(
            `[PO Close] GL reversal failed for PO ${id}: ${glError instanceof Error ? glError.message : String(glError)}`,
          );
          // Non-fatal — don't fail the close operation
        }
      }

      // ========================================================================
      // SYNC LINKED REQUISITION STATUSES
      // ========================================================================
      try {
        await requisitionStatusSyncService.syncRequisitionsForPO(id);
      } catch (syncError) {
        logger.error(
          `[PO Close] Requisition sync failed for PO ${id}: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
        );
        // Non-fatal
      }

      // B3-5: PO Closed notification — notify every party who worked on the PO
      // (creator, assigned buyer, and the requester of each linked requisition).
      await this.notifyPOClosedParties(context, currentPO, {
        auto: false,
        reason: reason ?? null,
        pendingInvoiceCount: pendingInvoices.length,
      });

      // Return transformed result
      return transformPurchaseOrder(updated);
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(
        `Failed to close purchase order: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Check if a PO can be automatically closed based on receiving and invoice match status.
   * Called after batch receive, invoice approval, and invoice payment.
   *
   * Auto-close conditions:
   * 1. PO status is 'Received' (all lines fully received)
   * 2. All lines that require invoice match have invoiceMatched = true
   *
   * IMPORTANT: This method bypasses permission checks because it is a system-triggered
   * action (not user-initiated). The calling user (e.g., finance uploading an invoice)
   * may not have 'purchasing:update' permission, but the auto-close should still proceed.
   *
   * @param context - Service context (used for audit logging only)
   * @param purchaseOrderId - Purchase order ID to check
   * @returns true if PO was auto-closed, false otherwise
   */
  async checkAndAutoClosePO(
    context: ServiceContext,
    purchaseOrderId: string,
  ): Promise<boolean> {
    try {
      // Load PO with lines
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
          lines: {
            select: {
              id: true,
              requiresInvoiceMatch: true,
              invoiceMatched: true,
              receivedQuantity: true,
              receivedAmount: true,
            },
          },
        },
      });

      if (!po) {
        return false;
      }

      // Only auto-close fully received POs
      if (po.status !== PurchaseOrderStatus.RECEIVED) {
        return false;
      }

      // ========================================================================
      // AMOUNT-BASED GUARD: Ensure approved invoices cover the PO total
      // Prevents premature auto-close when only a fraction of the PO is invoiced
      // (e.g., PO P000001356 at $46,615 was auto-closed with only $9,323 invoiced)
      // ========================================================================
      const AUTO_CLOSE_INVOICE_TOLERANCE = 0.1; // 10% tolerance

      const approvedInvoices = await this.prisma.invoice.aggregate({
        where: {
          purchaseOrderId: po.id,
          approvalStatus: { in: ["FULLY_APPROVED", "REQUESTOR_APPROVED"] },
          voidedAt: null, // exclude voided invoices
          status: { notIn: ["VOIDED", "CANCELLED", "Voided", "Cancelled"] },
        },
        _sum: { totalAmount: true },
      });

      const totalInvoiced = approvedInvoices._sum.totalAmount?.toNumber() ?? 0;
      const poTotal = po.totalAmount.toNumber();

      if (
        poTotal > 0 &&
        totalInvoiced < poTotal * (1 - AUTO_CLOSE_INVOICE_TOLERANCE)
      ) {
        logger.warn(
          `[PO Auto-Close Guard] PO ${po.poNumber} NOT auto-closed: ` +
            `total invoiced $${totalInvoiced.toFixed(2)} < PO total $${poTotal.toFixed(2)} ` +
            `(minimum required: $${(poTotal * (1 - AUTO_CLOSE_INVOICE_TOLERANCE)).toFixed(2)} with ${AUTO_CLOSE_INVOICE_TOLERANCE * 100}% tolerance)`,
        );
        return false;
      }

      // Check all lines requiring invoice match have invoiceMatched = true
      const unmatchedLines = po.lines.filter(
        (line) => line.requiresInvoiceMatch && !line.invoiceMatched,
      );

      if (unmatchedLines.length > 0) {
        return false;
      }

      // B2-1: Per-line minimum received check
      // Prevent auto-close if any line has less than 50% received
      const poLines = await this.prisma.pOLine.findMany({
        where: { purchaseOrderId: po.id },
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          lineType: true,
          description: true,
        },
      });

      const PER_LINE_MIN_THRESHOLD = 0.5; // 50% minimum per line
      const underReceivedLines = poLines.filter((line) => {
        const ordered = Number(line.quantity);
        const received = Number(line.receivedQuantity);
        // Skip lines with 0 ordered (free/bonus items)
        if (ordered <= 0) return false;
        return received / ordered < PER_LINE_MIN_THRESHOLD;
      });

      if (underReceivedLines.length > 0) {
        logger.info(
          `[checkAndAutoClosePO] PO ${po.poNumber}: Cannot auto-close — ${underReceivedLines.length} line(s) below ${PER_LINE_MIN_THRESHOLD * 100}% received threshold`,
          {
            underReceivedLines: underReceivedLines.map((l) => ({
              id: l.id,
              description: l.description,
              ordered: l.quantity,
              received: l.receivedQuantity,
            })),
          },
        );
        return false; // Don't auto-close
      }

      // All conditions met — auto-close the PO directly (bypassing permission checks)
      // This is a system-triggered action, not user-initiated, so we don't require
      // the calling user to have 'purchasing:update' permission.
      logger.info(
        `[PO Auto-Close] PO ${po.poNumber} automatically closed - all lines received and invoices matched. ` +
          `Total invoiced: $${totalInvoiced.toFixed(2)}, PO total: $${poTotal.toFixed(2)}`,
      );

      const updated = await this.prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: PurchaseOrderStatus.CLOSED,
          closedAt: new Date(),
        },
        include: buildPOInclude(),
      });

      // Audit trail for auto-close
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CLOSE,
        "PurchaseOrder",
        purchaseOrderId,
        po.poNumber,
        { status: po.status },
        { status: updated.status },
        {
          closedBy: "SYSTEM_AUTO_CLOSE",
          triggeredBy: context.userId,
          totalAmount: Number(updated.totalAmount),
          totalInvoiced,
          invoiceCoveragePercent:
            poTotal > 0 ? Math.round((totalInvoiced / poTotal) * 100) : 100,
          receivedAmount: po.lines.reduce(
            (sum, line) => sum + Number(line.receivedAmount),
            0,
          ),
          autoCloseReason: "All lines fully received and invoices matched",
        },
      );

      // Sync linked requisition statuses
      try {
        await requisitionStatusSyncService.syncRequisitionsForPO(
          purchaseOrderId,
        );
      } catch (syncError) {
        logger.error(
          `[PO Auto-Close] Requisition sync failed for PO ${purchaseOrderId}: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
        );
        // Non-fatal
      }

      // B3-5: PO Closed notification (auto-close) — notify every party who worked
      // on the PO (creator, assigned buyer, and the requester of each linked requisition).
      await this.notifyPOClosedParties(context, po, { auto: true });

      return true;
    } catch (error) {
      logger.error(
        `[PO Auto-Close] Failed to auto-close PO ${purchaseOrderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Notify every party who worked on a PO that it has been closed.
   *
   * Recipients (de-duplicated):
   *   - The PO creator (createdBy)
   *   - The assigned buyer (buyerId)
   *   - The requester of every requisition linked to the PO
   *     (via PurchaseOrder.requisitionIds and POLine.requisitionId)
   *
   * Used by both the manual close() path and the auto-close (90-day sweep /
   * checkAndAutoClosePO) path so the same audience is reached either way.
   *
   * Failures are swallowed per-recipient so a notification problem never blocks
   * or reverses the close itself.
   */
  private async notifyPOClosedParties(
    context: ServiceContext,
    po: {
      id: string;
      poNumber: string;
      createdBy: string | null;
      buyerId: string | null;
    },
    options: {
      auto: boolean;
      reason?: string | null;
      pendingInvoiceCount?: number;
    },
  ): Promise<void> {
    const recipientIds = new Set<string>();
    if (po.createdBy) recipientIds.add(po.createdBy);
    if (po.buyerId) recipientIds.add(po.buyerId);

    // Resolve the requester of every linked requisition. Requisitions link to a
    // PO both via the PurchaseOrder.requisitionIds array and per-line via
    // POLine.requisitionId, so we gather from both sources.
    try {
      const linked = await this.prisma.purchaseOrder.findUnique({
        where: { id: po.id },
        select: {
          requisitionIds: true,
          lines: { select: { requisitionId: true } },
        },
      });

      const reqIds = new Set<string>();
      for (const id of linked?.requisitionIds ?? []) {
        if (id) reqIds.add(id);
      }
      for (const line of linked?.lines ?? []) {
        if (line.requisitionId) reqIds.add(line.requisitionId);
      }

      if (reqIds.size > 0) {
        const requisitions = await this.prisma.requisition.findMany({
          where: { id: { in: Array.from(reqIds) } },
          select: { requestedById: true },
        });
        for (const req of requisitions) {
          if (req.requestedById) recipientIds.add(req.requestedById);
        }
      }
    } catch (resolveError) {
      logger.error(
        `[B3-5] Failed to resolve requisition requesters for PO ${po.poNumber}: ${resolveError instanceof Error ? resolveError.message : String(resolveError)}`,
      );
      // Non-fatal — fall back to whatever recipients we already have.
    }

    // Always reach at least the triggering user (mirrors prior behaviour where
    // createdBy fell back to context.userId).
    if (recipientIds.size === 0) {
      recipientIds.add(context.userId);
    }

    const title = options.auto
      ? `PO ${po.poNumber} Automatically Closed`
      : `PO ${po.poNumber} Closed`;
    const message = options.auto
      ? `Purchase order ${po.poNumber} has been automatically closed — all lines received and invoices matched.`
      : `Purchase order ${po.poNumber} has been closed.`;

    for (const userId of recipientIds) {
      try {
        await notificationService.sendNotification(context, {
          userId,
          type: PURCHASING_NOTIFICATIONS.PO_CLOSED.type,
          category: NotificationCategory.PURCHASING,
          title,
          message,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/purchase-orders/${po.id}`,
          actionLabel: "View Purchase Order",
          data: {
            poNumber: po.poNumber,
            poId: po.id,
            autoClose: options.auto,
            closedBy: options.auto ? "SYSTEM_AUTO_CLOSE" : context.userId,
            closedByName: options.auto
              ? "System (auto-close)"
              : context.userName || context.userId,
            ...(options.reason ? { closeReason: options.reason } : {}),
            ...(typeof options.pendingInvoiceCount === "number"
              ? { pendingInvoiceCount: options.pendingInvoiceCount }
              : {}),
          },
        });
      } catch (notifError) {
        logger.error(
          `[B3-5] Failed to send PO closed notification to user ${userId} for PO ${po.poNumber}`,
          notifError,
        );
      }
    }
  }

  /**
   * Cancel purchase order (permanent cancellation)
   * Transition: any status → CANCELLED
   *
   * NOTE: This is different from cancelForEdit() which resets to Draft.
   * This method permanently cancels the PO and clears requisition linkage.
   *
   * @param context - Service context with user and permissions
   * @param id - Purchase order ID
   * @param reason - Cancellation reason
   * @returns Updated purchase order
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if PO cannot be cancelled
   */
  async cancel(
    context: ServiceContext,
    id: string,
    reason: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      // Check permission - B6-1: granular purchasing:cancel permission
      const permission = buildPermissionString(
        this.resource,
        ExtendedPermissionAction.CANCEL,
      );
      await checkPermission(context, permission);

      validateRequired(id, "id");
      validateRequired(reason, "reason");

      // Get current PO
      const currentPO = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          ...buildPOInclude(),
          lines: true,
        },
      });

      if (!currentPO) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // Validate transition
      if (!canCancel(currentPO.status as PurchaseOrderStatus)) {
        throw new BadRequestError(
          `Cannot cancel purchase order in ${currentPO.status} status`,
        );
      }

      // Perform permanent cancellation in a transaction
      await this.prisma.$transaction(async (tx) => {
        // 1. Set PO to Cancelled status
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: PurchaseOrderStatus.CANCELLED,
            cancelledReason: reason,
            cancelledBy: context.userId,
            cancelledAt: new Date(),
          },
        });

        // 2. Reverse GL transactions for this PO
        const poGLTransactions = await tx.gLTransaction.findMany({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: id,
            status: "POSTED",
          },
        });

        await Promise.all(
          poGLTransactions.map(async (glTransaction) => {
            try {
              await glReversalService.reverseTransaction(
                glTransaction.id,
                `PO ${currentPO.poNumber} cancelled: ${reason}`,
                context.userId,
              );
            } catch (glRevError) {
              // GL reversal failed (non-fatal) — log with full context for retry.
              logger.error(
                `[PO Cancel] GL REVERSAL FAILED for PO ${currentPO.poNumber} (${id}), glTransactionId=${glTransaction.id}. ` +
                  `Cancellation will proceed WITHOUT this GL reversal.`,
                {
                  error:
                    glRevError instanceof Error
                      ? glRevError.message
                      : String(glRevError),
                  stack:
                    glRevError instanceof Error ? glRevError.stack : undefined,
                  purchaseOrderId: id,
                  poNumber: currentPO.poNumber,
                  glTransactionId: glTransaction.id,
                  reason,
                },
              );
            }
          }),
        );

        // 2b. Also reverse any late-added POLine EXPENDITURE entries.
        // Lines added to this PO after it was sent (Ordered/PartiallyReceived)
        // carry their commitment in 'POLine' EXPENDITURE GL entries rather than
        // the main 'PurchaseOrder' EXPENDITURE. These must be reversed on cancel
        // to release the budget commitment.
        const cancelledPOLineIds = await tx.pOLine.findMany({
          where: { purchaseOrderId: id },
          select: { id: true },
        });
        if (cancelledPOLineIds.length > 0) {
          const poLineIdList = cancelledPOLineIds.map((l) => l.id);
          const lateAddedGLTxnsForCancel = await tx.gLTransaction.findMany({
            where: {
              referenceType: "POLine",
              referenceId: { in: poLineIdList },
              status: "POSTED",
            },
          });
          await Promise.all(
            lateAddedGLTxnsForCancel.map(async (lateGLTxn) => {
              try {
                await glReversalService.reverseTransaction(
                  lateGLTxn.id,
                  `PO ${currentPO.poNumber} cancelled: ${reason}`,
                  context.userId,
                );
              } catch (lateRevErr) {
                logger.error(
                  `[PO Cancel] GL REVERSAL FAILED for late-added POLine ${lateGLTxn.referenceId} ` +
                    `on PO ${currentPO.poNumber} (non-fatal — cancel will proceed).`,
                  {
                    error:
                      lateRevErr instanceof Error
                        ? lateRevErr.message
                        : String(lateRevErr),
                    purchaseOrderId: id,
                    poNumber: currentPO.poNumber,
                    glTransactionId: lateGLTxn.id,
                  },
                );
              }
            }),
          );
        }

        // 3. Clear PO references on linked requisitions and reset them to Draft
        const linkedReqs = await tx.requisition.findMany({
          where: { id: { in: currentPO.requisitionIds } },
          select: {
            id: true,
            reqNumber: true,
            status: true,
            previousPOIds: true,
            previousPONumbers: true,
            resetCount: true,
          },
        });

        // Batch-fetch all req GL transactions in parallel, then reverse all in parallel
        const allReqGLTxnsArrays = await Promise.all(
          linkedReqs.map((req) =>
            tx.gLTransaction
              .findMany({
                where: {
                  referenceType: "Requisition",
                  referenceId: req.id,
                  status: "POSTED",
                },
              })
              .then((txns) => txns.map((txn) => ({ txn, req }))),
          ),
        );
        const allReqGLTxns = allReqGLTxnsArrays.flat();
        await Promise.all(
          allReqGLTxns.map(async ({ txn: glTxn, req }) => {
            try {
              await glReversalService.reverseTransaction(
                glTxn.id,
                `Requisition ${req.reqNumber} reset due to PO ${currentPO.poNumber} cancellation`,
                context.userId,
              );
            } catch (reqGlError) {
              // Requisition GL reversal failed (non-fatal) — log for retry.
              logger.error(
                `[PO Cancel] REQ GL REVERSAL FAILED for requisition ${req.reqNumber} (${req.id}), ` +
                  `glTransactionId=${glTxn.id}, triggered by PO ${currentPO.poNumber} cancellation.`,
                {
                  error:
                    reqGlError instanceof Error
                      ? reqGlError.message
                      : String(reqGlError),
                  stack:
                    reqGlError instanceof Error ? reqGlError.stack : undefined,
                  requisitionId: req.id,
                  reqNumber: req.reqNumber,
                  purchaseOrderId: id,
                  poNumber: currentPO.poNumber,
                  glTransactionId: glTxn.id,
                },
              );
            }
          }),
        );

        for (const req of linkedReqs) {
          // Delete approval records
          await tx.requisitionApproval.deleteMany({
            where: { requisitionId: req.id },
          });

          // Clear PO references and reset to Draft
          await tx.requisition.update({
            where: { id: req.id },
            data: {
              status: "Draft",
              approvalStatus: "DRAFT",
              currentApprovalLevel: null,
              submittedForApprovalAt: null,
              finalApprovedAt: null,
              finalApprovedById: null,
              purchaseOrderId: null,
              purchaseOrderNumber: null,
              previousPOIds: [...req.previousPOIds, currentPO.id],
              previousPONumbers: [...req.previousPONumbers, currentPO.poNumber],
              resetCount: (req.resetCount || 0) + 1,
              lastResetAt: new Date(),
              lastResetReason: `PO ${currentPO.poNumber} permanently cancelled: ${reason}`,
            },
          });

          // Clear PO refs on req lines
          await tx.requisitionLine.updateMany({
            where: { requisitionId: req.id },
            data: {
              purchaseOrderId: null,
              purchaseOrderNumber: null,
              poLineId: null,
              convertedToPOAt: null,
              convertedToPOBy: null,
              lineStatus: "PENDING",
            },
          });
        }
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CANCEL,
        "PurchaseOrder",
        id,
        currentPO.poNumber,
        { status: currentPO.status },
        { status: PurchaseOrderStatus.CANCELLED },
        {
          cancelledBy: context.userId,
          reason,
          totalAmount: Number(currentPO.totalAmount),
        },
      );

      // Get the updated PO after cancellation
      const updated = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: buildPOInclude(),
      });

      if (!updated) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // B3-6: PO Cancelled notification
      try {
        await notificationService.sendNotification(context, {
          userId: currentPO.createdBy ?? context.userId,
          type: PURCHASING_NOTIFICATIONS.PO_CANCELLED.type,
          category: NotificationCategory.PURCHASING,
          title: `PO ${currentPO.poNumber} Cancelled`,
          message: `Purchase order ${currentPO.poNumber} has been cancelled. Reason: ${reason}`,
          priority: NotificationPriority.HIGH,
          actionUrl: `/purchasing/purchase-orders/${currentPO.id}`,
          actionLabel: "View Purchase Order",
          data: {
            poNumber: currentPO.poNumber,
            poId: currentPO.id,
            cancelledBy: context.userId,
            reason,
          },
        });
      } catch (notifError) {
        logger.error(
          "[B3-6] Failed to send PO cancelled notification",
          notifError,
        );
      }

      // Return transformed result
      return transformPurchaseOrder(updated);
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(
        `Failed to cancel purchase order: ${(error as Error).message}`,
      );
    }
  }
  /**
   * Admin-only: Force-change the status of a purchase order to any valid status.
   *
   * This is an escape-hatch for administrators to correct stuck or invalid PO states.
   * It bypasses normal workflow validation and directly sets the status.
   *
   * @param context - Service context (must be Admin role)
   * @param id - Purchase order ID
   * @param newStatus - The target status to set
   * @param reason - Required reason for the status change (for audit trail)
   * @returns Updated purchase order
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if caller is not an Admin
   */
  async adminChangeStatus(
    context: ServiceContext,
    id: string,
    newStatus: PurchaseOrderStatus,
    reason: string,
  ): Promise<PurchaseOrderWithRelations> {
    // Enforce admin-only access
    if (context.userRole !== "Admin") {
      throw new BadRequestError(
        "Only administrators can force-change a purchase order status.",
      );
    }

    validateRequired(id, "id");
    validateRequired(newStatus, "newStatus");
    validateRequired(reason, "reason");

    // Validate newStatus is a known PurchaseOrderStatus value
    const validStatuses = Object.values(PurchaseOrderStatus);
    if (!validStatuses.includes(newStatus)) {
      throw new BadRequestError(
        `Invalid status "${newStatus}". Valid statuses are: ${validStatuses.join(", ")}`,
      );
    }

    // Get current PO
    const currentPO = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: buildPOInclude(),
    });

    if (!currentPO) {
      throw new NotFoundError("PurchaseOrder", id);
    }

    const previousStatus = currentPO.status;

    // INTENTIONAL: no workflow transition matrix is enforced here. This is the
    // admin FORCE-change escape-hatch (admin-only, reason required, fully
    // audit-logged) whose entire purpose is to bypass normal workflow
    // validation — see the dialog copy "bypasses normal workflow validation".
    // The earlier B5-6 isValidPOTransition() guard was removed 2026-06 because
    // it blocked legitimate admin corrections (e.g. Closed → Received) and
    // contradicted this method's documented purpose. The status VALUE is still
    // validated above against PurchaseOrderStatus, and the GL side effects below
    // still fire for the Approved/Cancelled/Closed transitions to keep
    // GL/budget consistent — those are deliberately NOT bypassed.

    // Perform the status update directly
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
      },
      include: buildPOInclude(),
    });

    // Log audit trail
    await auditLogService.logCrudOperation(
      context,
      AuditAction.UPDATE,
      "PurchaseOrder",
      id,
      currentPO.poNumber,
      { status: previousStatus },
      { status: newStatus },
      {
        action: "admin_status_change",
        changedBy: context.userId,
        reason,
        previousStatus,
        newStatus,
      },
    );

    logger.info(
      `[PO Admin Status Change] PO ${currentPO.poNumber} status changed from "${previousStatus}" to "${newStatus}" by admin ${context.userId}. Reason: ${reason}`,
    );

    // ========================================================================
    // HIGH FIX 8: GL SIDE EFFECTS FOR ADMIN STATUS CHANGES
    // Without these, admins can move POs between states without triggering GL.
    // All GL actions are NON-FATAL: failures are logged but do not fail the status change.
    // ========================================================================
    const prevStatus = previousStatus as PurchaseOrderStatus;
    const nextStatus = newStatus;

    // DRAFT/SUBMITTED/REJECTED → APPROVED: Create encumbrance GL entries
    const wasPreApproval =
      prevStatus === PurchaseOrderStatus.DRAFT ||
      prevStatus === PurchaseOrderStatus.SUBMITTED;
    if (wasPreApproval && nextStatus === PurchaseOrderStatus.APPROVED) {
      try {
        // Only create GL entries if none exist yet for this PO
        const existingGLTxn = await this.prisma.gLTransaction.findFirst({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: id,
            transactionType: "EXPENDITURE",
            status: { not: "REVERSED" },
          },
        });
        if (!existingGLTxn) {
          await this.createApprovalGLEntries(context, updated);
          await this.snapshotApprovedPrices(updated);
          logger.info(
            `[PO Admin Status Change] Created approval GL entries for PO ${currentPO.poNumber} on admin APPROVED transition`,
          );
        } else {
          logger.info(
            `[PO Admin Status Change] Skipping GL creation for PO ${currentPO.poNumber} — EXPENDITURE GL entry already exists (${existingGLTxn.id})`,
          );
        }
      } catch (glError) {
        logger.warn(
          `[PO Admin Status Change] GL ENTRY CREATION FAILED for PO ${currentPO.poNumber} (${id}) on admin transition ${prevStatus} → APPROVED. ` +
            `Status change will stand. GL can be created manually.`,
          {
            error: glError instanceof Error ? glError.message : String(glError),
            stack: glError instanceof Error ? glError.stack : undefined,
            purchaseOrderId: id,
            poNumber: currentPO.poNumber,
            previousStatus: prevStatus,
            newStatus: nextStatus,
            reason,
          },
        );
      }
    }

    // * → CANCELLED: Reverse all posted GL transactions for this PO
    if (nextStatus === PurchaseOrderStatus.CANCELLED) {
      try {
        const postedGLTxns = await this.prisma.gLTransaction.findMany({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: id,
            status: "POSTED",
          },
        });
        for (const glTxn of postedGLTxns) {
          try {
            await glReversalService.reverseTransaction(
              glTxn.id,
              `PO ${currentPO.poNumber} admin-cancelled: ${reason}`,
              context.userId,
            );
          } catch (reversalError) {
            logger.warn(
              `[PO Admin Status Change] GL REVERSAL FAILED for PO ${currentPO.poNumber} (${id}), glTransactionId=${glTxn.id} on admin CANCELLED transition.`,
              {
                error:
                  reversalError instanceof Error
                    ? reversalError.message
                    : String(reversalError),
                purchaseOrderId: id,
                poNumber: currentPO.poNumber,
                glTransactionId: glTxn.id,
                reason,
              },
            );
          }
        }
        if (postedGLTxns.length > 0) {
          logger.info(
            `[PO Admin Status Change] Reversed ${postedGLTxns.length} GL transaction(s) for admin-cancelled PO ${currentPO.poNumber}`,
          );
        }
      } catch (glError) {
        logger.warn(
          `[PO Admin Status Change] Failed to reverse GL transactions for PO ${currentPO.poNumber} (${id}) on admin CANCELLED transition.`,
          {
            error: glError instanceof Error ? glError.message : String(glError),
            purchaseOrderId: id,
            poNumber: currentPO.poNumber,
            reason,
          },
        );
      }
    }

    // APPROVED/ORDERED/PARTIALLY_RECEIVED/RECEIVED → CLOSED: Run short-close GL reversal
    // B2-8: Replicate the GL reversal logic from close() so admin status changes also
    // reverse unreceived commitment encumbrances.
    if (
      nextStatus === PurchaseOrderStatus.CLOSED &&
      (prevStatus === PurchaseOrderStatus.APPROVED ||
        prevStatus === PurchaseOrderStatus.ORDERED ||
        prevStatus === PurchaseOrderStatus.PARTIALLY_RECEIVED ||
        prevStatus === PurchaseOrderStatus.RECEIVED)
    ) {
      try {
        // Only run GL reversal if PO was not fully received (short-close scenario)
        // Fully received POs (Received status) have balanced books and need no reversal.
        if (prevStatus !== PurchaseOrderStatus.RECEIVED) {
          // Calculate unreceived amount from PO lines
          const unreceivedAmount = currentPO.lines.reduce((sum, line) => {
            const ordered = Number(line.quantity) * Number(line.unitPrice);
            const received =
              Number(line.receivedQuantity) * Number(line.unitPrice);
            return sum + Math.max(0, ordered - received);
          }, 0);

          if (unreceivedAmount > 0) {
            // Find the original PO approval EXPENDITURE GL transaction
            const approvalGLTxn = await this.prisma.gLTransaction.findFirst({
              where: {
                referenceType: "PurchaseOrder",
                referenceId: id,
                transactionType: "EXPENDITURE",
                status: "POSTED",
              },
              include: { lines: { include: { glAccount: true } } },
            });

            if (approvalGLTxn) {
              // Idempotency guard: check if a reversal GL transaction already exists
              const existingReversal =
                await this.prisma.gLTransaction.findFirst({
                  where: {
                    referenceType: "PurchaseOrder",
                    referenceId: id,
                    transactionType: "REVERSAL",
                    status: "POSTED",
                  },
                });

              if (!existingReversal) {
                // Calculate ratio of unreceived to total to scale down each GL line proportionally
                const totalOriginalAmount = approvalGLTxn.lines
                  .filter((l) => l.entryType === "DEBIT")
                  .reduce((s, l) => s + Number(l.amount), 0);

                const ratio =
                  totalOriginalAmount > 0
                    ? unreceivedAmount / totalOriginalAmount
                    : 0;

                if (ratio > 0) {
                  // Create partial reversal GL transaction (flip DEBIT↔CREDIT, scaled amounts)
                  const reversalLines = approvalGLTxn.lines.map((line) => ({
                    entryType:
                      line.entryType === "DEBIT"
                        ? ("CREDIT" as const)
                        : ("DEBIT" as const),
                    glAccountId: line.glAccountId,
                    amount:
                      Math.round(Number(line.amount) * ratio * 1000000) /
                      1000000,
                    accountCodeId: line.accountCodeId ?? undefined,
                    departmentId: line.departmentId ?? undefined,
                    projectId: line.projectId ?? undefined,
                    areaId: line.areaId ?? undefined,
                    description: `PO ${currentPO.poNumber} admin-closure - reverse unreceived commitment`,
                  }));

                  const budgetPeriod = await getCurrentBudgetPeriod(
                    this.prisma,
                  );

                  const reversalTxnId =
                    await glTransactionService.createTransaction(context, {
                      transactionDate: new Date(),
                      fiscalPeriodId: budgetPeriod.id,
                      transactionType: "REVERSAL",
                      referenceType: "PurchaseOrder",
                      referenceId: id,
                      referenceNumber: currentPO.poNumber,
                      description: `PO ${currentPO.poNumber} admin-closure - reverse unreceived commitment ($${unreceivedAmount.toFixed(6)})`,
                      lines: reversalLines,
                      originalGLTransactionId: approvalGLTxn.id,
                      reversalReason: `PO admin-closed with unreceived amount of $${unreceivedAmount.toFixed(6)}`,
                    });

                  await glTransactionService.postTransaction(
                    context,
                    reversalTxnId,
                  );

                  // Release budget for the unreceived portion
                  const reversalTotal = reversalLines.reduce(
                    (s, l) => s + l.amount,
                    0,
                  );
                  await this.budgetTrackingService.unconsumeBudgetFromGL(
                    context,
                    {
                      periodId: budgetPeriod.id,
                      glTransactionId: reversalTxnId,
                      referenceType: "PurchaseOrder",
                      referenceId: id,
                      referenceNumber: currentPO.poNumber,
                      totalAmount: reversalTotal,
                    },
                  );

                  logger.info(
                    `[adminChangeStatus] GL short-close reversal completed for PO ${currentPO.poNumber} — reversed $${unreceivedAmount.toFixed(6)} unreceived commitment`,
                  );
                }
              } else {
                logger.info(
                  `[adminChangeStatus] GL reversal already exists for PO ${currentPO.poNumber}, skipping`,
                );
              }
            } else {
              logger.info(
                `[adminChangeStatus] No EXPENDITURE GL transaction found for PO ${currentPO.poNumber}, skipping short-close reversal`,
              );
            }
          } else {
            logger.info(
              `[adminChangeStatus] PO ${currentPO.poNumber} has no unreceived amount, no GL reversal needed`,
            );
          }
        } else {
          logger.info(
            `[adminChangeStatus] PO ${currentPO.poNumber} was fully received (status: ${prevStatus}), no short-close GL reversal needed`,
          );
        }
      } catch (glError) {
        logger.error(
          `[adminChangeStatus] GL short-close reversal failed for PO ${currentPO.poNumber}`,
          {
            error: glError instanceof Error ? glError.message : String(glError),
            stack: glError instanceof Error ? glError.stack : undefined,
            purchaseOrderId: id,
            poNumber: currentPO.poNumber,
            previousStatus: prevStatus,
            reason,
          },
        );
        // Don't block the status change, but log the GL failure
      }
    }

    return transformPurchaseOrder(updated);
  }

  // ============================================================================
  // BUDGET TYPE UPDATE — Account Code → Project
  // ============================================================================

  /**
   * Update purchase order budget type from Account Code to Project.
   *
   * Changes all charge allocations on every PO line to include a projectId,
   * triggers the GL rule engine to use priority-150 project rules, and
   * correctly re-routes budget consumption from account-code budgets to
   * project budgets.
   *
   * For Approved/Ordered POs, this method:
   * 1. Reverses all existing posted GL transactions
   * 2. Updates allocations with the target projectId
   * 3. Re-creates EXPENDITURE GL entries with project dimensions
   *
   * For Draft/Submitted POs, only allocation updates are needed (no GL exists).
   *
   * BLOCKED for PartiallyReceived/Received/Closed/Cancelled POs because
   * receipt GL entries exist with old dimensions and cannot be safely reversed.
   *
   * @param purchaseOrderId - ID of the purchase order to update
   * @param projectId - ID of the target project
   * @param reason - Reason for the budget type change (logged in audit trail)
   * @param performedBy - User ID performing the change
   * @returns Result indicating success/failure, GL reversal, and GL re-creation status
   */
  async updateBudgetTypeToProject(
    purchaseOrderId: string,
    projectId: string,
    reason: string,
    performedBy: string,
    serviceContext?: ServiceContext,
  ): Promise<{
    success: boolean;
    message: string;
    glReversed: boolean;
    glRecreated: boolean;
  }> {
    const LOG_PREFIX = "[updateBudgetTypeToProject]";

    try {
      logger.info(
        `${LOG_PREFIX} Starting budget type update for PO ${purchaseOrderId} to project ${projectId}`,
      );

      // Use provided service context if available; otherwise fabricate one
      // for internal calls that require ServiceContext
      const context: ServiceContext = serviceContext ?? {
        userId: performedBy,
        userName: "",
        userEmail: "",
        userRole: "Admin",
        roleId: "",
        permissions: [
          { resource: "purchasing", action: "update", isActive: true },
          { resource: "budget", action: "create", isActive: true },
          { resource: "budget", action: "update", isActive: true },
          { resource: "budget", action: "read", isActive: true },
        ],
      };

      // ====================================================================
      // STEP 1: Fetch PO with lines, allocations, and linked requisitions
      // ====================================================================
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
          lines: {
            include: {
              chargeAllocations: true,
            },
          },
          supplier: { select: { name: true } },
        },
      });

      if (!po) {
        throw new NotFoundError("PurchaseOrder", purchaseOrderId);
      }

      logger.info(
        `${LOG_PREFIX} PO ${po.poNumber} found — status: ${po.status}, lines: ${po.lines.length}`,
      );

      // ====================================================================
      // STEP 2: Validate PO status
      // Only allow: Draft, Submitted, Approved, Ordered
      // Block: PartiallyReceived, Received, Closed, Cancelled
      // ====================================================================
      const BLOCKED_STATUSES = [
        "PartiallyReceived",
        "Received",
        "Invoiced",
        "Closed",
        "Cancelled",
      ];
      if (BLOCKED_STATUSES.includes(po.status)) {
        const detail =
          po.status === "PartiallyReceived"
            ? "Receipt GL entries exist with the current dimensions and cannot be reversed without corrupting inventory valuation."
            : `PO is in "${po.status}" status and is locked.`;
        throw new BadRequestError(
          `Cannot update budget type for PO ${po.poNumber} — ${detail}`,
        );
      }

      // ====================================================================
      // STEP 3: Validate the target project exists and is Active
      // ====================================================================
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          accountCodeId: true,
        },
      });

      if (!project) {
        throw new NotFoundError("Project", projectId);
      }

      if (project.status !== "ACTIVE") {
        throw new BadRequestError(
          `Project "${project.name}" is not active (status: ${project.status}). Only active projects can be assigned to purchase orders.`,
        );
      }

      // ====================================================================
      // STEP 4: Check if PO already has all allocations set to this project
      // ====================================================================
      const allAllocations = po.lines.flatMap((l) => l.chargeAllocations);
      const allHaveThisProject =
        allAllocations.length > 0 &&
        allAllocations.every((a) => a.projectId === projectId);

      if (allHaveThisProject) {
        return {
          success: true,
          message: `PO ${po.poNumber} already has all allocations set to project "${project.name}" (${project.code}). No changes needed.`,
          glReversed: false,
          glRecreated: false,
        };
      }

      // ====================================================================
      // STEP 5: Determine if GL reversal is needed
      // GL entries exist if status is Approved or Ordered
      // ====================================================================
      // Query the database for actual posted GL transactions instead of
      // relying on status-based inference (which misses edge cases like
      // Invoiced POs that had GL entries created at approval time).
      const postedGLCount = await this.prisma.gLTransaction.count({
        where: {
          referenceType: "PurchaseOrder",
          referenceId: purchaseOrderId,
          status: "POSTED",
        },
      });
      const hasGLEntries = postedGLCount > 0;
      let glReversed = false;
      let glRecreated = false;

      // ====================================================================
      // STEP 6: If GL reversal needed (Approved/Ordered status)
      // Reverse ALL posted GL transactions for this PO.
      // glReversalService.reverseTransaction() handles:
      //   - Creating reversal GL transaction with flipped entries
      //   - Posting the reversal
      //   - Budget correction (unconsume for EXPENDITURE, release for ENCUMBRANCE)
      // ====================================================================
      if (hasGLEntries) {
        logger.info(
          `${LOG_PREFIX} PO ${po.poNumber} has GL entries (status: ${po.status}) — reversing...`,
        );

        const postedGLTxns = await this.prisma.gLTransaction.findMany({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: purchaseOrderId,
            status: "POSTED",
          },
        });

        logger.info(
          `${LOG_PREFIX} Found ${postedGLTxns.length} posted GL transaction(s) to reverse`,
        );

        for (const glTxn of postedGLTxns) {
          try {
            await glReversalService.reverseTransaction(
              glTxn.id,
              `Budget type change to Project for PO ${po.poNumber}: ${reason}`,
              performedBy,
            );
            logger.info(
              `${LOG_PREFIX} Reversed GL transaction ${glTxn.id} (type: ${glTxn.transactionType})`,
            );
          } catch (glRevError) {
            logger.error(
              `${LOG_PREFIX} GL REVERSAL FAILED for PO ${po.poNumber}, glTransactionId=${glTxn.id}`,
              {
                error:
                  glRevError instanceof Error
                    ? glRevError.message
                    : String(glRevError),
                stack:
                  glRevError instanceof Error ? glRevError.stack : undefined,
                purchaseOrderId,
                poNumber: po.poNumber,
                glTransactionId: glTxn.id,
              },
            );
            throw new Error(
              `Failed to reverse GL transaction ${glTxn.id} for PO ${po.poNumber}: ${glRevError instanceof Error ? glRevError.message : String(glRevError)}`,
            );
          }
        }

        glReversed = postedGLTxns.length > 0;

        // ====================================================================
        // VALIDATION GUARD: Verify all GL entries for this PO are now REVERSED
        // before attempting to re-create them in Step 9.
        //
        // Without this check, if reverseTransaction() silently no-ops due to
        // the duplicate-guard in createTransaction() (returning an existing
        // REVERSAL ID without marking the original POSTED), the EXPENDITURE
        // GL transaction would remain POSTED. Step 9 would then call
        // createApprovalGLEntries() → createTransaction(EXPENDITURE), which
        // hits the duplicate guard again, returns the stale EXPENDITURE ID,
        // posts it, and calls consumeBudgetFromGL() a second time — causing
        // a double-consume of the wrong amount.
        //
        // Throwing here converts the silent false-positive into a hard error
        // that surfaces immediately in the PM2 logs.
        // ====================================================================
        const remainingPostedGLs = await this.prisma.gLTransaction.findMany({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: purchaseOrderId,
            status: "POSTED",
            transactionType: { in: ["ENCUMBRANCE", "EXPENDITURE"] },
          },
        });
        if (remainingPostedGLs.length > 0) {
          throw new Error(
            `Cannot re-create GL entries: ${remainingPostedGLs.length} existing POSTED GL transaction(s) still exist after reversal. ` +
              `IDs: ${remainingPostedGLs.map((g) => g.id).join(", ")}`,
          );
        }
      }

      // ====================================================================
      // STEP 7: Update all POLineChargeAllocation records
      // - SET projectId to the target project
      // - If project has a default accountCodeId, update it
      // - CRITICAL: accountCodeId must NEVER be set to null
      // ====================================================================
      logger.info(
        `${LOG_PREFIX} Updating ${allAllocations.length} charge allocation(s) with projectId=${projectId}`,
      );

      for (const line of po.lines) {
        for (const allocation of line.chargeAllocations) {
          const updateData: Record<string, unknown> = {
            projectId: projectId,
          };

          // If the project has a default accountCodeId, update the allocation's accountCodeId
          if (project.accountCodeId) {
            updateData.accountCodeId = project.accountCodeId;
          }
          // If project has NO default accountCodeId, KEEP the existing one
          // (it's still needed for ACCOUNT_CODE_LINK GL resolution)

          await this.prisma.pOLineChargeAllocation.update({
            where: { id: allocation.id },
            data: updateData,
          });
        }
      }

      // ====================================================================
      // STEP 8: Update linked RequisitionBudgetHeader records
      // - budgetType: CHARGE_TO_ACCOUNT → CHARGE_TO_PROJECT
      // - SET projectId to the target project
      // - Also update RequisitionLineAllocation records
      // ====================================================================
      if (po.requisitionIds.length > 0) {
        logger.info(
          `${LOG_PREFIX} Updating ${po.requisitionIds.length} linked requisition(s)`,
        );

        for (const reqId of po.requisitionIds) {
          // Update budget header
          const budgetHeader =
            await this.prisma.requisitionBudgetHeader.findFirst({
              where: { requisitionId: reqId },
            });

          if (budgetHeader) {
            await this.prisma.requisitionBudgetHeader.update({
              where: { id: budgetHeader.id },
              data: {
                budgetType: "CHARGE_TO_PROJECT",
                projectId: projectId,
              },
            });
          }

          // Update requisition line allocations with projectId
          await this.prisma.requisitionLineAllocation.updateMany({
            where: {
              requisitionId: reqId,
            },
            data: {
              projectId: projectId,
            },
          });
        }
      }

      // ====================================================================
      // STEP 9: If GL re-creation needed (was Approved/Ordered)
      // Re-create EXPENDITURE GL entries using createApprovalGLEntries().
      // Allocations now have projectId set, so the GL rule engine will
      // match priority-150 project rules because projectId is non-null.
      // Note: Only EXPENDITURE is re-created; ADJUSTMENT is not (see design doc).
      // ====================================================================
      if (hasGLEntries && glReversed) {
        logger.info(
          `${LOG_PREFIX} Re-creating GL entries with project dimensions for PO ${po.poNumber}`,
        );

        try {
          await this.createApprovalGLEntries(context, {
            id: purchaseOrderId,
            poNumber: po.poNumber,
            requisitionIds: po.requisitionIds,
          });

          // Re-snapshot approved prices (prices haven't changed, but GL reference has)
          await this.snapshotApprovedPrices({
            id: purchaseOrderId,
            totalAmount: po.totalAmount,
          });

          glRecreated = true;
          logger.info(
            `${LOG_PREFIX} GL entries re-created successfully for PO ${po.poNumber}`,
          );
        } catch (glCreateError) {
          // GL re-creation failed — allocations are correct but GL needs manual retry.
          // Don't throw: the allocation updates and GL reversal are committed.
          // Admin can trigger GL re-creation by re-approving the PO.
          logger.error(
            `${LOG_PREFIX} GL RE-CREATION FAILED for PO ${po.poNumber}. ` +
              `Allocations are updated but GL entries need to be re-created manually.`,
            {
              error:
                glCreateError instanceof Error
                  ? glCreateError.message
                  : String(glCreateError),
              stack:
                glCreateError instanceof Error
                  ? glCreateError.stack
                  : undefined,
              purchaseOrderId,
              poNumber: po.poNumber,
            },
          );
        }
      }

      // ====================================================================
      // STEP 10: Create audit trail
      // ====================================================================
      try {
        await auditLogService.logCrudOperation(
          context,
          AuditAction.UPDATE,
          "PurchaseOrder",
          purchaseOrderId,
          po.poNumber,
          {
            budgetType: "CHARGE_TO_ACCOUNT",
            allocations: po.lines.flatMap((l) =>
              l.chargeAllocations.map((a) => ({
                id: a.id,
                projectId: null,
                accountCodeId: a.accountCodeId,
              })),
            ),
          },
          {
            budgetType: "CHARGE_TO_PROJECT",
            projectId: projectId,
            projectCode: project.code,
            projectName: project.name,
            glReversed,
            glRecreated,
          },
          {
            action: "budget_type_update_to_project",
            reason,
          },
        );
      } catch (auditError) {
        logger.error(
          `${LOG_PREFIX} Audit log failed for PO ${po.poNumber}`,
          auditError,
        );
        // Non-fatal — don't fail the operation for audit logging failures
      }

      // Build result message
      const actionDesc = hasGLEntries
        ? `GL entries reversed${glRecreated ? " and re-created with project dimensions" : " (GL re-creation pending — see logs)"}.`
        : `Allocations updated (no GL changes needed — PO is in ${po.status} status).`;

      logger.info(
        `${LOG_PREFIX} Budget type update complete for PO ${po.poNumber}: ${actionDesc}`,
      );

      return {
        success: true,
        message: `Budget type updated to Project "${project.name}" (${project.code}) for PO ${po.poNumber}. ${actionDesc}`,
        glReversed,
        glRecreated,
      };
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(
        `Failed to update budget type to project: ${(error as Error).message}`,
      );
    }
  }

  // ==========================================================================
  // Data-repair methods added 2026-04-20 for the Maintenance PO reclass audit.
  // See plans/MAINT_PO_RECLASS_PLAN.md and plans/MAINT_PO_RECLASS_CHANGELOG.md
  // These mirror the pattern of updateBudgetTypeToProject() but target
  // different fields. They all follow the same 10-step flow:
  //   1 Fetch PO + allocations     6 Guard: no POSTED GL remains
  //   2 Validate status            7 Update allocations
  //   3 Validate target            8 Update linked requisitions
  //   4 Check idempotency          9 Re-create GL via rule engine
  //   5 Reverse all POSTED GL     10 Audit log
  // ==========================================================================

  /**
   * Reclassify the AccountCode on every POLineChargeAllocation for a PO.
   * Used to move lines from a wrong expense account (e.g. 6520 Maint Labor)
   * to the correct one (e.g. 1535 Store Room Inventory, 6511 Maint Material
   * Inventory, 6512 Maint Material Non-Inventory) when the original PO was
   * coded incorrectly.
   *
   * BLOCKED for PartiallyReceived/Received/Invoiced/Closed/Cancelled POs
   * because POLineReceipt GL entries exist with old dimensions. Use
   * createReclassAdjustmentJE() instead for those.
   */
  async updateAccountCodeOnAllocations(
    purchaseOrderId: string,
    newAccountCodeId: string,
    reason: string,
    performedBy: string,
    serviceContext?: ServiceContext,
    newDepartmentId?: string | null,
  ): Promise<{
    success: boolean;
    message: string;
    glReversed: boolean;
    glRecreated: boolean;
  }> {
    const LOG_PREFIX = "[updateAccountCodeOnAllocations]";
    try {
      logger.info(
        `${LOG_PREFIX} Start PO=${purchaseOrderId} newAccountCodeId=${newAccountCodeId}`,
      );

      const context: ServiceContext = serviceContext ?? {
        userId: performedBy,
        userName: "",
        userEmail: "",
        userRole: "Admin",
        roleId: "",
        permissions: [
          { resource: "purchasing", action: "update", isActive: true },
          { resource: "budget", action: "create", isActive: true },
          { resource: "budget", action: "update", isActive: true },
          { resource: "budget", action: "read", isActive: true },
        ],
      };

      // STEP 1 fetch PO
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { lines: { include: { chargeAllocations: true } } },
      });
      if (!po) throw new NotFoundError("PurchaseOrder", purchaseOrderId);

      // STEP 2 validate status
      const BLOCKED = [
        "PartiallyReceived",
        "Received",
        "Invoiced",
        "Closed",
        "Cancelled",
      ];
      if (BLOCKED.includes(po.status)) {
        throw new BadRequestError(
          `Cannot reclass account code for PO ${po.poNumber} (status=${po.status}). ` +
            `Use createReclassAdjustmentJE() instead — receipt GL exists and cannot be safely reversed.`,
        );
      }

      // STEP 3 validate target
      const newAcct = await this.prisma.accountCode.findUnique({
        where: { id: newAccountCodeId },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          glAccountId: true,
        },
      });
      if (!newAcct) throw new NotFoundError("AccountCode", newAccountCodeId);
      if (!newAcct.isActive)
        throw new BadRequestError(`AccountCode ${newAcct.code} is inactive`);
      if (!newAcct.glAccountId)
        throw new BadRequestError(
          `AccountCode ${newAcct.code} has no glAccountId — cannot post GL`,
        );

      const allAllocs = po.lines.flatMap((l) => l.chargeAllocations);

      // STEP 4 idempotency
      const deptAlreadyCorrect =
        newDepartmentId === undefined ||
        allAllocs.every((a) => a.departmentId === newDepartmentId);
      if (
        allAllocs.length > 0 &&
        allAllocs.every((a) => a.accountCodeId === newAccountCodeId) &&
        deptAlreadyCorrect
      ) {
        return {
          success: true,
          message: `PO ${po.poNumber} already uses AccountCode ${newAcct.code}${newDepartmentId !== undefined ? " and the specified department" : ""} on all allocations. No change.`,
          glReversed: false,
          glRecreated: false,
        };
      }

      // capture before-state for audit
      const allocBefore = allAllocs.map((a) => ({
        id: a.id,
        accountCodeId: a.accountCodeId,
      }));

      // STEP 5 reverse all POSTED GL
      const postedGLs = await this.prisma.gLTransaction.findMany({
        where: {
          referenceType: "PurchaseOrder",
          referenceId: purchaseOrderId,
          status: "POSTED",
        },
      });
      let glReversed = false;
      if (postedGLs.length > 0) {
        logger.info(
          `${LOG_PREFIX} Reversing ${postedGLs.length} posted GL tx(s) for PO ${po.poNumber}`,
        );
        for (const glTxn of postedGLs) {
          await glReversalService.reverseTransaction(
            glTxn.id,
            `AccountCode reclass on PO ${po.poNumber} → ${newAcct.code}: ${reason}`,
            performedBy,
          );
        }
        glReversed = true;

        // STEP 6 guard
        const remaining = await this.prisma.gLTransaction.findMany({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: purchaseOrderId,
            status: "POSTED",
            transactionType: { in: ["ENCUMBRANCE", "EXPENDITURE"] },
          },
        });
        if (remaining.length > 0) {
          throw new Error(
            `Cannot re-create GL: ${remaining.length} POSTED tx(s) still exist after reversal. ` +
              `IDs: ${remaining.map((g) => g.id).join(", ")}`,
          );
        }
      }

      // STEP 7 update allocations
      for (const line of po.lines) {
        for (const a of line.chargeAllocations) {
          await this.prisma.pOLineChargeAllocation.update({
            where: { id: a.id },
            data: {
              accountCodeId: newAccountCodeId,
              ...(newDepartmentId !== undefined && {
                departmentId: newDepartmentId,
              }),
            },
          });
        }
      }

      // STEP 8 update linked reqs
      if (po.requisitionIds.length > 0) {
        for (const reqId of po.requisitionIds) {
          const bh = await this.prisma.requisitionBudgetHeader.findFirst({
            where: { requisitionId: reqId },
          });
          if (bh) {
            await this.prisma.requisitionBudgetHeader.update({
              where: { id: bh.id },
              data: { accountCodeId: newAccountCodeId },
            });
          }
          await this.prisma.requisitionLineAllocation.updateMany({
            where: { requisitionId: reqId },
            data: {
              accountCodeId: newAccountCodeId,
              ...(newDepartmentId !== undefined && {
                departmentId: newDepartmentId,
              }),
            },
          });
        }
      }

      // STEP 9 re-create GL
      let glRecreated = false;
      if (glReversed) {
        try {
          await this.createApprovalGLEntries(context, {
            id: purchaseOrderId,
            poNumber: po.poNumber,
            requisitionIds: po.requisitionIds,
          });
          await this.snapshotApprovedPrices({
            id: purchaseOrderId,
            totalAmount: po.totalAmount,
          });
          glRecreated = true;
        } catch (e) {
          logger.error(
            `${LOG_PREFIX} GL RE-CREATION FAILED for PO ${po.poNumber}`,
            e,
          );
          // allocations are committed; GL can be re-run by re-approving
        }
      }

      // STEP 10 audit
      try {
        await auditLogService.logCrudOperation(
          context,
          AuditAction.UPDATE,
          "PurchaseOrder",
          purchaseOrderId,
          po.poNumber,
          { allocations: allocBefore },
          {
            allocations: allAllocs.map((a) => ({
              id: a.id,
              accountCodeId: newAccountCodeId,
              ...(newDepartmentId !== undefined && {
                departmentId: newDepartmentId,
              }),
            })),
            newAccountCode: { code: newAcct.code, name: newAcct.name },
            ...(newDepartmentId !== undefined && { newDepartmentId }),
            glReversed,
            glRecreated,
          },
          { action: "accountCode_reclass", reason },
        );
      } catch (auditErr) {
        logger.error(`${LOG_PREFIX} Audit log failed`, auditErr);
      }

      const deptDesc =
        newDepartmentId !== undefined
          ? newDepartmentId
            ? ` + dept updated`
            : ` + dept cleared`
          : "";
      const actionDesc =
        postedGLs.length > 0
          ? `GL entries reversed${glRecreated ? " and re-created" : " (re-creation pending — check logs)"}`
          : `Allocations updated (no GL changes needed — status=${po.status})`;
      return {
        success: true,
        message: `AccountCode reclassified to ${newAcct.code} (${newAcct.name})${deptDesc} on PO ${po.poNumber}. ${actionDesc}.`,
        glReversed,
        glRecreated,
      };
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new Error(
        `Failed to update account code: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Link a purchase order to a Work Order, flipping the requisition's
   * budgetType from CHARGE_TO_ACCOUNT to CHARGE_TO_WORK_ORDER. Used for
   * POs that were coded against a cost-center account when they should
   * settle to a specific WO (e.g. PO-001001 should hit WO-2026-00392).
   *
   * This sets POLine.workOrderId + denormalized PO.workOrderIds/Numbers,
   * updates RequisitionBudgetHeader.budgetType + workOrderId, and if the
   * WO has a Project, also sets projectId on allocations.
   *
   * BLOCKED for Received/Closed POs (same reason as updateAccountCodeOnAllocations).
   */
  async linkToWorkOrder(
    purchaseOrderId: string,
    workOrderId: string,
    reason: string,
    performedBy: string,
    serviceContext?: ServiceContext,
  ): Promise<{
    success: boolean;
    message: string;
    glReversed: boolean;
    glRecreated: boolean;
  }> {
    const LOG_PREFIX = "[linkToWorkOrder]";
    try {
      logger.info(
        `${LOG_PREFIX} Start PO=${purchaseOrderId} WO=${workOrderId}`,
      );

      const context: ServiceContext = serviceContext ?? {
        userId: performedBy,
        userName: "",
        userEmail: "",
        userRole: "Admin",
        roleId: "",
        permissions: [
          { resource: "purchasing", action: "update", isActive: true },
          { resource: "budget", action: "create", isActive: true },
          { resource: "budget", action: "update", isActive: true },
          { resource: "budget", action: "read", isActive: true },
        ],
      };

      // STEP 1 fetch
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { lines: { include: { chargeAllocations: true } } },
      });
      if (!po) throw new NotFoundError("PurchaseOrder", purchaseOrderId);

      // STEP 2 validate
      const BLOCKED = [
        "PartiallyReceived",
        "Received",
        "Invoiced",
        "Closed",
        "Cancelled",
      ];
      if (BLOCKED.includes(po.status)) {
        throw new BadRequestError(
          `Cannot link WO to PO ${po.poNumber} (status=${po.status}). Use reclass JE instead.`,
        );
      }

      // STEP 3 validate WO
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: {
          id: true,
          woNumber: true,
          status: true,
          projectId: true,
          project: {
            select: { id: true, code: true, name: true, accountCodeId: true },
          },
        },
      });
      if (!wo) throw new NotFoundError("WorkOrder", workOrderId);
      // NOTE: we do NOT block on WO.status — the audit plan calls out that
      // WO-2026-00392 is Closed and the customer explicitly wants this link.
      // A warning is emitted in the response message instead.

      // STEP 4 idempotency
      const allLinesHaveWO =
        po.lines.length > 0 &&
        po.lines.every((l) => l.workOrderId === workOrderId);
      if (allLinesHaveWO) {
        return {
          success: true,
          message: `PO ${po.poNumber} is already linked to WO ${wo.woNumber}. No change.`,
          glReversed: false,
          glRecreated: false,
        };
      }

      // capture before-state
      const poLinesBefore = po.lines.map((l) => ({
        id: l.id,
        workOrderId: l.workOrderId,
        workOrderNumber: l.workOrderNumber,
      }));

      // STEP 5 reverse posted GL (if any — usually none for Approved/Ordered)
      const postedGLs = await this.prisma.gLTransaction.findMany({
        where: {
          referenceType: "PurchaseOrder",
          referenceId: purchaseOrderId,
          status: "POSTED",
        },
      });
      let glReversed = false;
      if (postedGLs.length > 0) {
        for (const glTxn of postedGLs) {
          await glReversalService.reverseTransaction(
            glTxn.id,
            `WO link on PO ${po.poNumber} → ${wo.woNumber}: ${reason}`,
            performedBy,
          );
        }
        glReversed = true;
        const remaining = await this.prisma.gLTransaction.findMany({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: purchaseOrderId,
            status: "POSTED",
            transactionType: { in: ["ENCUMBRANCE", "EXPENDITURE"] },
          },
        });
        if (remaining.length > 0) {
          throw new Error(
            `Cannot re-create GL: ${remaining.length} POSTED tx(s) remain`,
          );
        }
      }

      // STEP 7 (we'll do 7 before 8 so PO/line data is right when reqs re-reference)
      // Update POLine.workOrderId/Number on every line
      for (const line of po.lines) {
        await this.prisma.pOLine.update({
          where: { id: line.id },
          data: { workOrderId: workOrderId, workOrderNumber: wo.woNumber },
        });
        // Also set projectId on allocations if WO has a project
        if (wo.projectId) {
          for (const a of line.chargeAllocations) {
            await this.prisma.pOLineChargeAllocation.update({
              where: { id: a.id },
              data: { projectId: wo.projectId },
            });
          }
        }
      }

      // Update PO denormalized arrays
      const newWoIds = Array.from(new Set([...po.workOrderIds, workOrderId]));
      const newWoNumbers = Array.from(
        new Set([...po.workOrderNumbers, wo.woNumber]),
      );
      await this.prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { workOrderIds: newWoIds, workOrderNumbers: newWoNumbers },
      });

      // STEP 8 update linked reqs
      if (po.requisitionIds.length > 0) {
        for (const reqId of po.requisitionIds) {
          const bh = await this.prisma.requisitionBudgetHeader.findFirst({
            where: { requisitionId: reqId },
          });
          if (bh) {
            await this.prisma.requisitionBudgetHeader.update({
              where: { id: bh.id },
              data: {
                budgetType: "CHARGE_TO_WORK_ORDER",
                workOrderId: workOrderId,
                projectId: wo.projectId ?? bh.projectId,
              },
            });
          }
          if (wo.projectId) {
            await this.prisma.requisitionLineAllocation.updateMany({
              where: { requisitionId: reqId },
              data: { projectId: wo.projectId },
            });
          }
        }
      }

      // STEP 9 re-create GL
      let glRecreated = false;
      if (glReversed) {
        try {
          await this.createApprovalGLEntries(context, {
            id: purchaseOrderId,
            poNumber: po.poNumber,
            requisitionIds: po.requisitionIds,
          });
          await this.snapshotApprovedPrices({
            id: purchaseOrderId,
            totalAmount: po.totalAmount,
          });
          glRecreated = true;
        } catch (e) {
          logger.error(
            `${LOG_PREFIX} GL RE-CREATION FAILED for PO ${po.poNumber}`,
            e,
          );
        }
      }

      // STEP 10 audit
      try {
        await auditLogService.logCrudOperation(
          context,
          AuditAction.UPDATE,
          "PurchaseOrder",
          purchaseOrderId,
          po.poNumber,
          {
            workOrderIds: po.workOrderIds,
            workOrderNumbers: po.workOrderNumbers,
            lines: poLinesBefore,
          },
          {
            workOrderIds: newWoIds,
            workOrderNumbers: newWoNumbers,
            linkedWO: {
              id: wo.id,
              woNumber: wo.woNumber,
              status: wo.status,
              projectId: wo.projectId,
            },
            glReversed,
            glRecreated,
          },
          { action: "link_to_work_order", reason },
        );
      } catch (auditErr) {
        logger.error(`${LOG_PREFIX} Audit log failed`, auditErr);
      }

      const woClosedWarning =
        wo.status === "Closed" || wo.status === "Cancelled"
          ? ` ⚠️ WARNING: WO ${wo.woNumber} is in ${wo.status} status.`
          : "";
      return {
        success: true,
        message: `PO ${po.poNumber} linked to WO ${wo.woNumber}.${woClosedWarning}`,
        glReversed,
        glRecreated,
      };
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new Error(`Failed to link PO to WO: ${(error as Error).message}`);
    }
  }

  /**
   * Post a stand-alone ADJUSTMENT journal entry to reclassify an expense
   * from one AccountCode to another WITHOUT touching receipts, inventory,
   * invoices, or the original PO GL entries. Used for PartiallyReceived /
   * Received / Closed POs where the normal reclass flow is blocked.
   *
   * Effect:
   *   DEBIT  GLAccount(newAccountCode.glAccountId)  $amount  accountCodeId=new
   *   CREDIT GLAccount(oldAccountCode.glAccountId)  $amount  accountCodeId=old
   *
   * This produces a clean GAAP reclass trail. NAV receives it as a standard
   * journal entry. Budget tracking is updated via adjustBudgetFromGL().
   *
   * The POLineChargeAllocation.accountCodeId is also updated so future
   * reporting shows the correct dimension, but existing receipt GL entries
   * remain posted with the old dimension (as the true historical record).
   */
  async createReclassAdjustmentJE(
    purchaseOrderId: string,
    newAccountCodeId: string,
    reason: string,
    performedBy: string,
    serviceContext?: ServiceContext,
    newDepartmentId?: string | null,
  ): Promise<{
    success: boolean;
    message: string;
    glTransactionId: string | null;
    amount: number;
  }> {
    const LOG_PREFIX = "[createReclassAdjustmentJE]";
    try {
      logger.info(
        `${LOG_PREFIX} Start PO=${purchaseOrderId} newAccountCodeId=${newAccountCodeId}`,
      );

      const context: ServiceContext = serviceContext ?? {
        userId: performedBy,
        userName: "",
        userEmail: "",
        userRole: "Admin",
        roleId: "",
        permissions: [
          { resource: "purchasing", action: "update", isActive: true },
          { resource: "gl", action: "create", isActive: true },
          { resource: "gl", action: "update", isActive: true },
          { resource: "budget", action: "update", isActive: true },
        ],
      };

      // STEP 1 load
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { lines: { include: { chargeAllocations: true } } },
      });
      if (!po) throw new NotFoundError("PurchaseOrder", purchaseOrderId);

      const newAcct = await this.prisma.accountCode.findUnique({
        where: { id: newAccountCodeId },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          glAccountId: true,
        },
      });
      if (!newAcct) throw new NotFoundError("AccountCode", newAccountCodeId);
      if (!newAcct.isActive)
        throw new BadRequestError(`AccountCode ${newAcct.code} is inactive`);
      if (!newAcct.glAccountId)
        throw new BadRequestError(
          `AccountCode ${newAcct.code} has no glAccountId`,
        );

      // STEP 2 compute reclass amounts per distinct old accountCode
      // Group allocations by (oldAccountCodeId, departmentId, projectId, areaId)
      // and sum the already-received dollars that need moving.
      const allocs = po.lines.flatMap((l) =>
        l.chargeAllocations.map((a) => ({ ...a, line: l })),
      );
      type Group = {
        oldAccountCodeId: string;
        departmentId: string | null;
        projectId: string | null;
        areaId: string | null;
        amount: number;
      };
      const groups = new Map<string, Group>();
      for (const a of allocs) {
        if (!a.accountCodeId) continue;
        if (a.accountCodeId === newAccountCodeId) continue; // already correct
        // Use the allocation's declared amount — this represents the full
        // line value that was (or will be) booked to the old account code.
        const amt = Number(a.amount);
        if (amt === 0) continue;
        const key = `${a.accountCodeId}|${a.departmentId ?? ""}|${a.projectId ?? ""}|${a.areaId ?? ""}`;
        const g = groups.get(key);
        if (g) g.amount += amt;
        else
          groups.set(key, {
            oldAccountCodeId: a.accountCodeId,
            departmentId: a.departmentId,
            projectId: a.projectId,
            areaId: a.areaId,
            amount: amt,
          });
      }

      if (groups.size === 0) {
        // Account code is already correct on all allocs.
        // If newDepartmentId was also provided, still update the dept dimension on
        // allocations (no financial GL impact — just pointer update for reporting).
        if (newDepartmentId !== undefined) {
          for (const a of allocs) {
            if (a.departmentId === newDepartmentId) continue;
            await this.prisma.pOLineChargeAllocation.update({
              where: { id: a.id },
              data: { departmentId: newDepartmentId },
            });
          }
          if (po.requisitionIds.length > 0) {
            for (const reqId of po.requisitionIds) {
              await this.prisma.requisitionLineAllocation.updateMany({
                where: { requisitionId: reqId },
                data: { departmentId: newDepartmentId },
              });
            }
          }
          const deptOnlyDesc = newDepartmentId
            ? ` + dept updated`
            : ` + dept cleared`;
          return {
            success: true,
            message: `PO ${po.poNumber} already on ${newAcct.code}${deptOnlyDesc}. No JE needed (dept-only change).`,
            glTransactionId: null,
            amount: 0,
          };
        }
        return {
          success: true,
          message: `PO ${po.poNumber} already has all allocations on ${newAcct.code}. No JE needed.`,
          glTransactionId: null,
          amount: 0,
        };
      }

      // STEP 3 resolve old AccountCode → GLAccount
      const oldAcctIds = Array.from(
        new Set(Array.from(groups.values()).map((g) => g.oldAccountCodeId)),
      );
      const oldAccts = await this.prisma.accountCode.findMany({
        where: { id: { in: oldAcctIds } },
        select: { id: true, code: true, name: true, glAccountId: true },
      });
      const oldAcctById = new Map(oldAccts.map((a) => [a.id, a]));
      for (const g of groups.values()) {
        const oa = oldAcctById.get(g.oldAccountCodeId);
        if (!oa?.glAccountId) {
          throw new BadRequestError(
            `Old AccountCode ${oa?.code ?? g.oldAccountCodeId} has no glAccountId — cannot build JE`,
          );
        }
      }

      // STEP 4 build GL lines (one DEBIT+CREDIT pair per group)
      // When newDepartmentId is provided: DEBIT uses the new dept, CREDIT keeps the old dept.
      // This correctly moves the cost from (oldAcct/oldDept) to (newAcct/newDept).
      type GLLine = {
        entryType: "DEBIT" | "CREDIT";
        glAccountId: string;
        amount: number;
        accountCodeId?: string;
        departmentId?: string;
        projectId?: string;
        areaId?: string;
        description?: string;
      };
      const lines: GLLine[] = [];
      let total = 0;
      for (const g of groups.values()) {
        const oa = oldAcctById.get(g.oldAccountCodeId);
        if (!oa?.glAccountId) continue; // Already validated above — this guard only satisfies TypeScript's type narrowing
        // Resolved department for the DEBIT (new) leg:
        //   - if newDepartmentId was explicitly provided (even null), use it
        //   - otherwise fall back to the old dept (no dept change)
        const debitDeptId =
          newDepartmentId !== undefined
            ? (newDepartmentId ?? undefined)
            : (g.departmentId ?? undefined);
        // DEBIT new account (move expense TO correct bucket)
        lines.push({
          glAccountId: newAcct.glAccountId,
          entryType: "DEBIT",
          amount: g.amount,
          description: `Reclass to ${newAcct.code} (${newAcct.name}): ${reason}`,
          accountCodeId: newAccountCodeId,
          departmentId: debitDeptId,
          projectId: g.projectId ?? undefined,
          areaId: g.areaId ?? undefined,
        });
        // CREDIT old account (move expense FROM wrong bucket — always old dimensions)
        lines.push({
          glAccountId: oa.glAccountId,
          entryType: "CREDIT",
          amount: g.amount,
          description: `Reclass from ${oa.code} (${oa.name}): ${reason}`,
          accountCodeId: g.oldAccountCodeId,
          departmentId: g.departmentId ?? undefined,
          projectId: g.projectId ?? undefined,
          areaId: g.areaId ?? undefined,
        });
        total += g.amount;
      }

      // STEP 5 create + post GL transaction
      const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);
      const txDate = new Date();
      const glTxnId = await glTransactionService.createTransaction(context, {
        transactionDate: txDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "ADJUSTMENT",
        referenceType: "PurchaseOrder",
        referenceId: purchaseOrderId,
        referenceNumber: `RECLASS-${po.poNumber}`,
        description: `AccountCode reclass on PO ${po.poNumber} → ${newAcct.code}: ${reason}`,
        lines,
      });
      await glTransactionService.postTransaction(context, glTxnId);
      logger.info(
        `${LOG_PREFIX} Posted ADJUSTMENT GL ${glTxnId} total=$${total}`,
      );

      // STEP 6 NOTE on budget tracking:
      // adjustBudgetFromGL() extracts dimensions from the GL transaction lines
      // using DEBIT filter (so it would only see the new-account side of our
      // reclass JE). Because the JE has DEBIT(new) + CREDIT(old) pairs that
      // NET to zero financially, the correct budget impact is simultaneously:
      //   - DECREASE consumedAmount on old accountCode budget (amount)
      //   - INCREASE consumedAmount on new accountCode budget (amount)
      // The existing helper doesn't support this two-sided pattern cleanly,
      // so the operator should run `scripts/gl-budget-fix.js` after applying
      // reclass JEs to rebuild budget consumedAmount figures from the GL.
      // This is documented in plans/MAINT_PO_RECLASS_CHANGELOG.md.
      logger.info(
        `${LOG_PREFIX} Skipping automatic budget adjustment — run scripts/gl-budget-fix.js ` +
          `after all reclass JEs are posted to reconcile consumedAmount figures.`,
      );
      // NOTE: previously this block was wrapped in try/catch with a
      // `adjustBudgetFromGL` call. The automatic path was removed in favour of
      // the manual `scripts/gl-budget-fix.js` reconciliation, so no try block
      // is needed here. (Removing the orphan `} catch (budgetErr) {` that was
      // left behind and caused a syntax parse error at EOF.)

      // STEP 7 update allocations so future reporting is correct
      // (historical receipt GL lines keep the old dimensions — that's their true record.
      // The allocation is a forward-looking pointer.)
      for (const a of allocs) {
        const needsAcctUpdate = a.accountCodeId !== newAccountCodeId;
        const needsDeptUpdate =
          newDepartmentId !== undefined && a.departmentId !== newDepartmentId;
        if (!needsAcctUpdate && !needsDeptUpdate) continue;
        await this.prisma.pOLineChargeAllocation.update({
          where: { id: a.id },
          data: {
            ...(needsAcctUpdate && { accountCodeId: newAccountCodeId }),
            ...(newDepartmentId !== undefined && {
              departmentId: newDepartmentId,
            }),
          },
        });
      }
      // Also update linked req budget header and line allocations
      if (po.requisitionIds.length > 0) {
        for (const reqId of po.requisitionIds) {
          const bh = await this.prisma.requisitionBudgetHeader.findFirst({
            where: { requisitionId: reqId },
          });
          if (bh && bh.accountCodeId !== newAccountCodeId) {
            await this.prisma.requisitionBudgetHeader.update({
              where: { id: bh.id },
              data: { accountCodeId: newAccountCodeId },
            });
          }
          await this.prisma.requisitionLineAllocation.updateMany({
            where: {
              requisitionId: reqId,
              accountCodeId: { not: newAccountCodeId },
            },
            data: {
              accountCodeId: newAccountCodeId,
              ...(newDepartmentId !== undefined && {
                departmentId: newDepartmentId,
              }),
            },
          });
          // If only dept changes (acct was already correct), update those rows too
          if (newDepartmentId !== undefined) {
            await this.prisma.requisitionLineAllocation.updateMany({
              where: { requisitionId: reqId, accountCodeId: newAccountCodeId },
              data: { departmentId: newDepartmentId },
            });
          }
        }
      }

      // STEP 8 audit
      try {
        await auditLogService.logCrudOperation(
          context,
          AuditAction.UPDATE,
          "PurchaseOrder",
          purchaseOrderId,
          po.poNumber,
          {
            allocations: allocs.map((a) => ({
              id: a.id,
              accountCodeId: a.accountCodeId,
            })),
          },
          {
            allocations: allocs.map((a) => ({
              id: a.id,
              accountCodeId: newAccountCodeId,
            })),
            reclassJE: {
              glTransactionId: glTxnId,
              amount: total,
              code: newAcct.code,
            },
          },
          {
            action: "reclass_adjustment_je",
            reason,
            poStatus: po.status,
            reclassGroups: Array.from(groups.values()).map((g) => ({
              from:
                oldAcctById.get(g.oldAccountCodeId)?.code ?? g.oldAccountCodeId,
              to: newAcct.code,
              amount: g.amount,
            })),
          },
        );
      } catch (auditErr) {
        logger.error(`${LOG_PREFIX} Audit log failed`, auditErr);
      }

      const deptJEDesc =
        newDepartmentId !== undefined
          ? newDepartmentId
            ? ` + dept updated`
            : ` + dept cleared`
          : "";
      return {
        success: true,
        message: `Reclass JE posted ($${total.toFixed(2)}) for PO ${po.poNumber} → ${newAcct.code}${deptJEDesc}. GL txn ${glTxnId}.`,
        glTransactionId: glTxnId,
        amount: total,
      };
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new Error(`Failed to post reclass JE: ${(error as Error).message}`);
    }
  }

  // ==========================================================================
  // PROJECT REASSIGNMENT (Finance) — ONE GL-level reclass, all statuses.
  // ==========================================================================
  // Changing a PO's project is a pure dimension move at the GL level. We do it
  // the same way for every status — no physical reversal, no re-receiving:
  //
  //   1. Post ONE net-zero reclass journal that moves the project dimension on
  //      the cost that actually reached NAV — i.e. the PO's POSTED receipt/cost
  //      GL lines carrying the old project (DEBIT new / CREDIT old on the SAME
  //      account). Commitment GL and commitment accounts are EXCLUDED (they were
  //      never sent to NAV). This JE rides the existing GL-batch channel to NAV.
  //   2. Transfer the PO's reserved/consumed budget from the old project budget
  //      to the new one (computed from the actual BudgetTransaction history).
  //   3. Repoint POLineChargeAllocation + linked requisition allocations forward
  //      (the allocation is the forward source of truth).
  //
  // Invoices are irrelevant: a purchase invoice clears GRNI against the vendor
  // with a blank project (verified in invoice-sync.service.ts), so it carries no
  // project to NAV. Inventory stock, WAC, invoices and payments are NEVER
  // touched. For a pre-receipt PO there is no cost in NAV yet, so step 1 posts
  // nothing and the new project simply flows in when the PO is later received.
  //
  // Clearing the project (null) is NOT supported. Cancelled POs are rejected.
  // A PO may be project-reclassed once (the PROJECT_RECLASS GL unique key).
  // ==========================================================================

  private buildProjectChangeContext(
    performedBy: string,
    serviceContext?: ServiceContext,
  ): ServiceContext {
    return (
      serviceContext ?? {
        userId: performedBy,
        userName: "",
        userEmail: "",
        userRole: "Admin",
        roleId: "",
        permissions: [
          { resource: "purchasing", action: "update", isActive: true },
          { resource: "gl", action: "create", isActive: true },
          { resource: "gl", action: "update", isActive: true },
          { resource: "budget", action: "create", isActive: true },
          { resource: "budget", action: "update", isActive: true },
          { resource: "budget", action: "read", isActive: true },
        ],
      }
    );
  }

  /**
   * Change the Project on EVERY POLineChargeAllocation of a purchase order,
   * moving all GL + budget data from the current project to `newProjectId`.
   *
   * PO-wide (all lines move together). A target project is always required —
   * removing the project (null) is intentionally not supported.
   *
   * @param purchaseOrderId - PO to reassign
   * @param newProjectId    - target project (must exist, be ACTIVE, and have a
   *                          budget in the current period)
   * @param reason          - audit reason
   * @param performedBy     - acting user id
   * @param serviceContext  - optional caller context (permissions reused)
   */
  async changeProjectOnPO(
    purchaseOrderId: string,
    newProjectId: string,
    reason: string,
    performedBy: string,
    serviceContext?: ServiceContext,
  ): Promise<ProjectReclassResult> {
    const LOG_PREFIX = "[changeProjectOnPO]";
    try {
      if (!newProjectId || typeof newProjectId !== "string") {
        throw new BadRequestError(
          "A target projectId is required — clearing the project (null) is not allowed.",
        );
      }
      if (!reason || reason.trim().length === 0) {
        throw new BadRequestError("A reason is required for a project change.");
      }

      const context = this.buildProjectChangeContext(
        performedBy,
        serviceContext,
      );

      // STEP 1 — load PO + allocations
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { lines: { include: { chargeAllocations: true } } },
      });
      if (!po) throw new NotFoundError("PurchaseOrder", purchaseOrderId);

      logger.info(
        `${LOG_PREFIX} PO ${po.poNumber} status=${po.status} → project ${newProjectId}`,
      );

      // STEP 2 — validate target project
      const project = await this.prisma.project.findUnique({
        where: { id: newProjectId },
        select: { id: true, name: true, code: true, status: true },
      });
      if (!project) throw new NotFoundError("Project", newProjectId);
      if (project.status !== "ACTIVE") {
        throw new BadRequestError(
          `Project "${project.name}" (${project.code}) is not active (status=${project.status}). Only active projects can be assigned.`,
        );
      }

      // STEP 2b — the target project MUST have a budget in the current period,
      // otherwise moved dollars would vanish from budget tracking. Fail fast.
      const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);
      const newProjectBudget = await this.prisma.projectBudget.findFirst({
        where: { projectId: project.id, budgetPeriodId: budgetPeriod.id },
        select: { id: true },
      });
      if (!newProjectBudget) {
        throw new BadRequestError(
          `Project "${project.name}" (${project.code}) has no budget in the current period. ` +
            `Create a project budget for the current period before reassigning PO ${po.poNumber}.`,
        );
      }

      // STEP 3 — must have allocations to move; idempotency check
      const allAllocations = po.lines.flatMap((l) => l.chargeAllocations);
      if (allAllocations.length === 0) {
        throw new BadRequestError(
          `PO ${po.poNumber} has no charge allocations — nothing to reassign.`,
        );
      }
      if (allAllocations.every((a) => a.projectId === project.id)) {
        return {
          success: true,
          message: `PO ${po.poNumber} is already assigned to project "${project.name}" (${project.code}). No changes needed.`,
          reclassJETransactionId: null,
          budgetMoved: 0,
          navCostLinesMoved: 0,
        };
      }

      // STEP 4 — one GL-level reclass for every status
      if (po.status === "Cancelled") {
        throw new BadRequestError(
          `Cannot change the project on cancelled PO ${po.poNumber}.`,
        );
      }
      return await this.applyProjectReclass(
        context,
        po,
        project,
        reason.trim(),
        budgetPeriod.id,
      );
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new Error(
        `Failed to change project on PO: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Apply the project reassignment as a TRUE GL move (all open statuses):
   *   A. REVERSE the PO's commitment GL and C. RE-POST it on the new project —
   *      real GL "in and out" that also moves the commitment budget
   *      (reverse → unconsume old project; re-post → consume new project).
   *   D. RECLASS already-received cost GL (1580/inventory) that cannot be
   *      reversed, via a net-zero PROJECT_RECLASS JE that rides the GL batch to
   *      NAV; E. move any receipt-consumed budget to the new project.
   *   B. Repoint allocations + linked requisitions forward.
   * Receipts, inventory stock, WAC, invoices and payments are never touched.
   */
  private async applyProjectReclass(
    context: ServiceContext,
    po: {
      id: string;
      poNumber: string;
      status: string;
      totalAmount: unknown;
      requisitionIds: string[];
      lines: Array<{
        id: string;
        chargeAllocations: Array<{ id: string; projectId: string | null }>;
      }>;
    },
    project: { id: string; name: string; code: string },
    reason: string,
    budgetPeriodId: string,
  ): Promise<ProjectReclassResult> {
    const LOG_PREFIX = "[changeProjectOnPO:reclass]";
    const poLineIds = po.lines.map((l) => l.id);
    const commitmentAccounts = new Set<string>(COMMITMENT_ACCOUNT_NUMBERS);

    // Guard: only one received-cost reclass JE per PO (unique GL key).
    const existingReclass = await this.prisma.gLTransaction.findFirst({
      where: {
        referenceType: "PROJECT_RECLASS",
        referenceId: po.id,
        transactionType: "ADJUSTMENT",
        status: { not: "REVERSED" },
      },
      select: { id: true },
    });
    if (existingReclass) {
      throw new BadRequestError(
        `PO ${po.poNumber} already has a project-reclass journal entry (${existingReclass.id}). ` +
          `Re-assigning the project of this PO again is not supported — contact Finance.`,
      );
    }

    // Capture the allocations' OLD projects before repointing (for the audit
    // trail and the receipt-budget transfer below).
    const allocBefore = po.lines
      .flatMap((l) => l.chargeAllocations)
      .map((a) => ({ id: a.id, projectId: a.projectId }));
    const oldProjectIds = new Set<string>(
      allocBefore
        .map((a) => a.projectId)
        .filter((p): p is string => !!p && p !== project.id),
    );

    // ── A. Move the commitment GL (PurchaseOrder EXPENDITURE/ENCUMBRANCE) off
    //    the OLD project. We do NOT post a standalone REVERSAL entry — that would
    //    leave a stranded reversal leg on the old project once the original is
    //    deleted by the re-post (GL unique constraint). Instead we (1) mark the
    //    original reversed so createApprovalGLEntries below deletes it and
    //    re-posts the commitment fresh on the NEW project, and (2) explicitly
    //    unconsume the OLD project budget. Net result: old project encumbrance =
    //    exactly $0, new project carries the full commitment. Skipped for
    //    Closed/Cancelled (commitment already settled / not re-postable).
    const canRepostCommitment =
      po.status !== "Closed" && po.status !== "Cancelled";
    const commitmentTxns = canRepostCommitment
      ? await this.prisma.gLTransaction.findMany({
          where: {
            referenceType: "PurchaseOrder",
            referenceId: po.id,
            status: "POSTED",
          },
        })
      : [];
    let commitmentReversed = false;
    for (const glTxn of commitmentTxns) {
      // Unconsume the OLD project budget FIRST (while the GL lines still exist),
      // then mark the transaction reversed so the re-post can delete it.
      try {
        await this.budgetTrackingService.unconsumeBudgetFromGL(context, {
          periodId: budgetPeriodId,
          glTransactionId: glTxn.id,
          referenceType: "PurchaseOrder",
          referenceId: po.id,
          referenceNumber: po.poNumber,
          totalAmount: Number(glTxn.totalAmount),
        });
      } catch (budgetErr) {
        logger.error(
          `${LOG_PREFIX} commitment budget unconsume failed for GL ${glTxn.id}`,
          budgetErr,
        );
      }
      await glTransactionService.markAsReversed(
        context,
        glTxn.id,
        `Project change to ${project.code} for PO ${po.poNumber}: ${reason}`,
      );
      commitmentReversed = true;
    }
    if (commitmentReversed) {
      const remaining = await this.prisma.gLTransaction.findMany({
        where: {
          referenceType: "PurchaseOrder",
          referenceId: po.id,
          status: "POSTED",
          transactionType: { in: ["ENCUMBRANCE", "EXPENDITURE"] },
        },
      });
      if (remaining.length > 0) {
        throw new Error(
          `Cannot re-post commitment GL for PO ${po.poNumber}: ${remaining.length} POSTED commitment transaction(s) remain after reversal ` +
            `(IDs: ${remaining.map((g) => g.id).join(", ")}).`,
        );
      }
    }

    // ── B. Repoint allocations + linked requisitions to the new project BEFORE
    //    re-posting, so the commitment re-derives on the new project.
    for (const line of po.lines) {
      for (const a of line.chargeAllocations) {
        if (a.projectId === project.id) continue;
        await this.prisma.pOLineChargeAllocation.update({
          where: { id: a.id },
          data: { projectId: project.id },
        });
      }
    }
    await this.repointRequisitionProject(poLineIds, project.id);

    // ── C. RE-POST the commitment on the NEW project — consumes the new project
    //    budget (mirror of the reverse). Real GL in/out for the commitment.
    let commitmentReposted = false;
    if (commitmentReversed) {
      await this.createApprovalGLEntries(context, {
        id: po.id,
        poNumber: po.poNumber,
        requisitionIds: po.requisitionIds,
      });
      await this.snapshotApprovedPrices({
        id: po.id,
        totalAmount: po.totalAmount,
      });
      commitmentReposted = true;
    }

    // ── D. RECLASS already-received cost GL (cannot be reversed — inventory).
    // Reference ids whose received cost belongs to this PO.
    const receipts = await this.prisma.pOLineReceipt.findMany({
      where: { poLineId: { in: poLineIds } },
      select: { id: true },
    });
    const receiptIds = receipts.map((r) => r.id);
    const returns = await this.prisma.pOLineReturn.findMany({
      where: { poLineId: { in: poLineIds } },
      select: { id: true },
    });
    const returnIds = returns.map((r) => r.id);

    // Gather ONLY the NAV-posted COST GL for this PO — receipts and their
    // returns (referenceType in the GL-batch syncable set). The PO commitment
    // GL (referenceType "PurchaseOrder") and invoices are deliberately EXCLUDED:
    // the commitment never reaches NAV, and a purchase invoice clears GRNI
    // against the vendor with a blank project. Reclassing either would post
    // phantom dimension entries into NAV that have no original to offset.
    const navCostRefIds = [...receiptIds, ...returnIds];
    const glTxns =
      navCostRefIds.length > 0
        ? await this.prisma.gLTransaction.findMany({
            where: {
              status: "POSTED",
              referenceType: { in: [...SYNCABLE_REFERENCE_TYPES] },
              referenceId: { in: navCostRefIds },
            },
            include: {
              lines: {
                include: { glAccount: { select: { accountNumber: true } } },
              },
            },
          })
        : [];

    // Build the net-zero reclass JE: for every line carrying an OLD (non-target)
    // project, emit an offsetting pair (flip the old leg, re-book on new project)
    // on the SAME GL account — moving the project dimension, nothing else.
    type JLine = {
      entryType: "DEBIT" | "CREDIT";
      glAccountId: string;
      amount: number;
      accountCodeId?: string;
      departmentId?: string;
      projectId?: string;
      areaId?: string;
      description?: string;
    };
    const jeLines: JLine[] = [];
    let movedGLTotal = 0;
    let navCostLinesMoved = 0;
    for (const t of glTxns) {
      if (t.transactionType === "REVERSAL") continue;
      for (const l of t.lines) {
        if (!l.projectId || l.projectId === project.id) continue;
        // Never reclass a commitment/encumbrance account — it never went to NAV.
        if (commitmentAccounts.has(l.glAccount.accountNumber)) continue;
        oldProjectIds.add(l.projectId);
        navCostLinesMoved += 1;
        const amt = Number(l.amount);
        const isDebit = l.entryType === "DEBIT";
        // Cancel the old-project leg
        jeLines.push({
          entryType: isDebit ? "CREDIT" : "DEBIT",
          glAccountId: l.glAccountId,
          amount: amt,
          accountCodeId: l.accountCodeId ?? undefined,
          departmentId: l.departmentId ?? undefined,
          projectId: l.projectId,
          areaId: l.areaId ?? undefined,
          description: `Project reclass out (PO ${po.poNumber}): ${reason}`,
        });
        // Re-book on the new project
        jeLines.push({
          entryType: isDebit ? "DEBIT" : "CREDIT",
          glAccountId: l.glAccountId,
          amount: amt,
          accountCodeId: l.accountCodeId ?? undefined,
          departmentId: l.departmentId ?? undefined,
          projectId: project.id,
          areaId: l.areaId ?? undefined,
          description: `Project reclass in → ${project.code} (PO ${po.poNumber}): ${reason}`,
        });
        if (isDebit) movedGLTotal += amt;
      }
    }

    // STEP 1 — post the reclass JE (skip if no GL line carries an old project)
    let reclassJETransactionId: string | null = null;
    if (jeLines.length > 0) {
      reclassJETransactionId = await glTransactionService.createTransaction(
        context,
        {
          transactionDate: new Date(),
          fiscalPeriodId: budgetPeriodId,
          // referenceType PROJECT_RECLASS is registered in the NAV sync
          // allowlists (erp-sync SYNCABLE_REFERENCE_TYPES + gl-sync
          // QUALIFYING_REF_TYPES) so this ADJUSTMENT is pushed to NAV, moving
          // the project dimension on the already-synced cost there too.
          transactionType: "ADJUSTMENT",
          referenceType: "PROJECT_RECLASS",
          referenceId: po.id,
          referenceNumber: `PROJ-RECLASS-${po.poNumber}`,
          description: `Project reclass on PO ${po.poNumber} → ${project.code} (${project.name}): ${reason}`,
          lines: jeLines,
        },
      );
      await glTransactionService.postTransaction(
        context,
        reclassJETransactionId,
      );
      logger.info(
        `${LOG_PREFIX} Posted project-reclass JE ${reclassJETransactionId} (${jeLines.length} lines, $${movedGLTotal.toFixed(2)} debit-side moved)`,
      );
    }

    // ── E. Move any RECEIPT-consumed budget (inventory POs whose budget was
    //    consumed at receipt rather than at commitment) to the new project. The
    //    commitment-consumed budget already moved in A/C, so we net ONLY the
    //    receipt-type budget transactions here to avoid double-counting.
    let budgetMoved = 0;
    const refIds = [...receiptIds, ...returnIds];
    if (refIds.length > 0 && oldProjectIds.size > 0) {
      await this.prisma.$transaction(async (tx) => {
        const newMatches = await budgetHelperService.findBudgetForAllocation(
          tx,
          { projectId: project.id },
          budgetPeriodId,
        );
        const newBudgetId = newMatches[0]?.budgetId;
        if (!newBudgetId) return;
        for (const oldProjectId of oldProjectIds) {
          const oldMatches = await budgetHelperService.findBudgetForAllocation(
            tx,
            { projectId: oldProjectId },
            budgetPeriodId,
          );
          const oldBudgetId = oldMatches[0]?.budgetId;
          if (!oldBudgetId) continue;
          const rows = await tx.budgetTransaction.findMany({
            where: {
              projectBudgetId: oldBudgetId,
              referenceId: { in: refIds },
            },
            select: { transactionType: true, amount: true },
          });
          let consumedNet = 0;
          for (const r of rows) {
            if (
              r.transactionType === BudgetTransactionType.INVENTORY_RECEIPT ||
              r.transactionType === BudgetTransactionType.SERVICE_RECEIPT ||
              r.transactionType === BudgetTransactionType.CONSUMABLE_RECEIPT
            ) {
              consumedNet += Number(r.amount);
            }
            // CONSUME/UNCONSUME (commitment) are moved by the reverse/re-post.
          }
          const consumedMove = Math.max(0, consumedNet);
          if (consumedMove === 0) continue;
          const ob = await budgetHelperService.getBudgetById(
            tx,
            BudgetType.PROJECT,
            oldBudgetId,
          );
          const nb = await budgetHelperService.getBudgetById(
            tx,
            BudgetType.PROJECT,
            newBudgetId,
          );
          if (!ob || !nb) continue;
          const obNew = Math.max(0, ob.consumedAmount - consumedMove);
          await budgetHelperService.updateBudgetAmount(
            tx,
            BudgetType.PROJECT,
            oldBudgetId,
            "consumedAmount",
            obNew,
          );
          await budgetHelperService.createBudgetTransaction(tx, {
            budgetType: BudgetType.PROJECT,
            budgetId: oldBudgetId,
            transactionType: BudgetTransactionType.TRANSFER,
            amount: consumedMove,
            glTransactionId: reclassJETransactionId ?? undefined,
            referenceType: "PROJECT_RECLASS",
            referenceId: po.id,
            referenceNumber: `PROJ-RECLASS-${po.poNumber}`,
            description: `Transfer received-cost budget out to ${project.code}: ${reason}`,
            previousBalance: ob.consumedAmount,
            newBalance: obNew,
            createdBy: context.userId,
          });
          const nbNew = nb.consumedAmount + consumedMove;
          await budgetHelperService.updateBudgetAmount(
            tx,
            BudgetType.PROJECT,
            newBudgetId,
            "consumedAmount",
            nbNew,
          );
          await budgetHelperService.createBudgetTransaction(tx, {
            budgetType: BudgetType.PROJECT,
            budgetId: newBudgetId,
            transactionType: BudgetTransactionType.TRANSFER,
            amount: consumedMove,
            glTransactionId: reclassJETransactionId ?? undefined,
            referenceType: "PROJECT_RECLASS",
            referenceId: po.id,
            referenceNumber: `PROJ-RECLASS-${po.poNumber}`,
            description: `Transfer received-cost budget in from prior project: ${reason}`,
            previousBalance: nb.consumedAmount,
            newBalance: nbNew,
            createdBy: context.userId,
          });
          budgetMoved += consumedMove;
        }
      });
    }

    // ── F. audit
    try {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.UPDATE,
        "PurchaseOrder",
        po.id,
        po.poNumber,
        { allocations: allocBefore },
        {
          allocations: allocBefore.map((a) => ({
            id: a.id,
            projectId: project.id,
          })),
          newProject: { code: project.code, name: project.name },
          commitmentReversed,
          commitmentReposted,
          reclassJE: {
            glTransactionId: reclassJETransactionId,
            glLines: jeLines.length,
          },
          receiptBudgetMoved: budgetMoved,
        },
        {
          action: "project_change",
          reason,
          poStatus: po.status,
          fromProjects: Array.from(oldProjectIds),
        },
      );
    } catch (auditErr) {
      logger.error(`${LOG_PREFIX} Audit log failed`, auditErr);
    }

    const commitDesc = commitmentReversed
      ? `commitment GL reversed & re-posted on ${project.code}`
      : `no open commitment to move`;
    const reclassDesc = reclassJETransactionId
      ? `; received-cost reclass JE ${reclassJETransactionId} (${navCostLinesMoved} line(s))`
      : ``;
    const budgetDesc =
      budgetMoved > 0
        ? `; $${budgetMoved.toFixed(2)} receipt-budget moved`
        : ``;
    return {
      success: true,
      message:
        `PO ${po.poNumber} reassigned to project "${project.name}" (${project.code}): ` +
        `${commitDesc}${reclassDesc}${budgetDesc}. ` +
        `Receipts, inventory, invoices and payments untouched.`,
      reclassJETransactionId,
      budgetMoved,
      navCostLinesMoved,
    };
  }

  /**
   * Repoint the projectId on a PO's linked requisition allocations + budget
   * headers, SCOPED strictly to the requisition lines that belong to THIS PO
   * (via RequisitionLine.poLineId). This prevents corrupting allocations that
   * belong to other POs sharing the same requisition (M-026).
   */
  private async repointRequisitionProject(
    poLineIds: string[],
    newProjectId: string,
  ): Promise<void> {
    if (poLineIds.length === 0) return;
    const reqLines = await this.prisma.requisitionLine.findMany({
      where: { poLineId: { in: poLineIds } },
      select: { id: true, requisitionId: true },
    });
    const reqLineIds = reqLines.map((r) => r.id);
    if (reqLineIds.length > 0) {
      await this.prisma.requisitionLineAllocation.updateMany({
        where: { requisitionLineId: { in: reqLineIds } },
        data: { projectId: newProjectId },
      });
    }
    const involvedReqIds = [...new Set(reqLines.map((r) => r.requisitionId))];
    for (const reqId of involvedReqIds) {
      const bh = await this.prisma.requisitionBudgetHeader.findFirst({
        where: { requisitionId: reqId },
        select: { id: true, projectId: true },
      });
      if (bh && bh.projectId !== newProjectId) {
        await this.prisma.requisitionBudgetHeader.update({
          where: { id: bh.id },
          data: { projectId: newProjectId },
        });
      }
    }
  }
}

const globalForPOWorkflow = globalThis as unknown as {
  purchaseOrderWorkflowServiceV2: PurchaseOrderWorkflowService | undefined;
};
export const purchaseOrderWorkflowService =
  globalForPOWorkflow.purchaseOrderWorkflowServiceV2 ??
  (globalForPOWorkflow.purchaseOrderWorkflowServiceV2 =
    new PurchaseOrderWorkflowService(prisma));
