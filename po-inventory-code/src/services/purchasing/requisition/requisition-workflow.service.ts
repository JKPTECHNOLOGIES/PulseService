/**
 * Requisition Workflow Service
 *
 * Handles all status transitions and workflow operations for requisitions.
 * This service manages the lifecycle of requisitions from submission through conversion to PO.
 *
 * BATCH 5 (B5-5/B5-1): All status transitions now atomically set BOTH the `status`
 * (display string) and `approvalStatus` (enum) fields using the shared
 * `mapStatusToApprovalStatus()` mapping to prevent drift between the two columns.
 *
 * BATCH 5 (B5-8): The direct `approve()` method is deprecated for requisitions that
 * have approval levels configured. Callers should use `requisitionApprovalService`
 * instead. A runtime guard redirects through the approval service when levels exist.
 */

import { PrismaClient, RequisitionType, LineItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
  ExtendedPermissionAction,
} from "@/types/permissions";
import {
  checkPermission,
  checkAnyPermission,
} from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import { NotFoundError, BadRequestError, ApiError } from "@/lib/api-errors";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";
import { toNumber } from "@/lib/decimal-helpers";
import { notificationService } from "@/services/notifications/notification.service";
import { logger } from "@/lib/logger";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { purchaseOrderService } from "@/services/purchasing/purchase-order";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import { requisitionApprovalService } from "@/services/requisitions/approval/requisition-approval.service";
import { graphEmailService } from "@/lib/email/graph-email.service";
import { renderRequisitionResubmittedEmail } from "@/lib/email/templates/critical/requisition-resubmitted.template";
import { documentLinkingService } from "@/services/documents/document-linking.service";
import { budgetResolutionService } from "@/services/budget";
import { mapStatusToApprovalStatus } from "./requisition-status-sync.service";
import {
  getTaxConfig,
  calculateTaxAmount,
} from "@/services/tax/tax-config.service";
import { repairableItemNotificationService } from "@/services/repairable-items/repairable-item-notification.service";

import {
  RequisitionWithRelations,
  RequisitionStatus,
  RequisitionRejectDTO,
  RequisitionCancelDTO,
  RequisitionConvertToPODTO,
  calculateTotalValue,
} from "./requisition.types";

import { validateConvertToPO } from "./requisition-validation";

import {
  transformRequisition,
  buildRequisitionInclude,
} from "./requisition-utils";

/**
 * Requisition Workflow Service
 *
 * Responsibilities:
 * - Submit requisitions for approval (DRAFT → SUBMITTED)
 * - Approve requisitions (SUBMITTED → APPROVED)
 * - Reject requisitions (SUBMITTED → REJECTED)
 * - Cancel requisitions (any status → CANCELLED)
 * - Convert requisitions to purchase orders (APPROVED → ORDERED)
 *
 * Each method validates permissions, status transitions, and logs audit trails.
 */
class RequisitionWorkflowService {
  private prisma: PrismaClient;
  /** Legacy umbrella resource — kept for APPROVE / special actions */
  private readonly resource = PermissionResource.PURCHASING;
  /** Specific resource used in the permission matrix UI */
  private readonly specificResource = PermissionResource.REQUISITIONS;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Accept EITHER the specific requisitions permission OR the legacy purchasing permission.
   * Only for standard CRUD actions (CREATE, READ, UPDATE, DELETE).
   * APPROVE/special actions still use purchasing:* as there is no per-resource equivalent.
   */
  private async checkCrudPermission(
    context: ServiceContext,
    action: PermissionAction,
  ): Promise<void> {
    await checkAnyPermission(context, [
      buildPermissionString(this.specificResource, action),
      buildPermissionString(this.resource, action),
    ]);
  }

  /**
   * Submit requisition for approval
   * Transition: DRAFT → SUBMITTED
   *
   * IMPORTANT: This method now properly initializes the approval workflow
   * by calling requisitionApprovalService.submitForApproval() which:
   * - Determines required approval levels based on requisition amount
   * - Sets currentApprovalLevel to the first required level
   * - Creates approval records for each level
   * - Auto-approves if no approval levels are configured
   *
   * @param context - Service context with user and permissions
   * @param id - Requisition ID
   * @returns Updated requisition
   * @throws NotFoundError if requisition not found
   * @throws BadRequestError if requisition cannot be submitted
   */
  async submit(
    context: ServiceContext,
    id: string,
  ): Promise<RequisitionWithRelations> {
    try {
      // Check permission
      await this.checkCrudPermission(context, PermissionAction.UPDATE);

      validateRequired(id, "id");

      // Get current requisition
      const currentReq = await this.prisma.requisition.findUnique({
        where: { id },
        include: buildRequisitionInclude(),
      });

      if (!currentReq) {
        throw new NotFoundError("Requisition", id);
      }

      // ── Budget-type pre-submit validation ──────────────────────────────────
      // Ensures the requisition has valid charge information before entering
      // the approval queue.  Prevents POs from being issued to suppliers
      // without a resolvable GL debit target.
      const budgetHeader = currentReq.budgetHeader;
      if (budgetHeader) {
        switch (budgetHeader.budgetType) {
          case RequisitionType.CHARGE_TO_ACCOUNT:
            if (!budgetHeader.accountCodeId) {
              throw new BadRequestError(
                "This requisition requires an account code before it can be submitted. Please select a charge account and resubmit.",
              );
            }
            break;

          case RequisitionType.CHARGE_TO_PROJECT:
            if (!budgetHeader.projectId) {
              throw new BadRequestError(
                "A project must be selected before this requisition can be submitted.",
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            const budgetProject = (budgetHeader as any)?.project as
              | { id: string; accountCodeId: string | null; name: string }
              | null
              | undefined;
            if (budgetProject && !budgetProject.accountCodeId) {
              throw new BadRequestError(
                "The selected project does not have a default GL account code configured. Contact Finance to set up the project account code before submitting.",
              );
            }
            break;

          case RequisitionType.CHARGE_TO_WORK_ORDER:
            if (!budgetHeader.workOrderId) {
              throw new BadRequestError(
                "A work order must be selected before this requisition can be submitted.",
              );
            }
            // Do NOT block if WO has no resolvable account code — resolved at PO conversion
            break;

          case RequisitionType.ADD_TO_REORDER:
            // No account code needed for reorder requisitions
            break;
        }
      }
      // ── End budget-type validation ─────────────────────────────────────────

      // CRITICAL: Initialize approval workflow using the approval service
      // This properly sets up approval levels, creates approval records, and handles auto-approval.
      // NOTE: submitForApproval() may auto-approve the requisition (setting approvalStatus="APPROVED"
      // and status="Approved") when no approval levels cover the total amount (e.g. total < $2,500).
      // We must NOT overwrite that auto-approved status with PENDING after the fact.
      await requisitionApprovalService.submitForApproval(
        {
          requisitionId: id,
          comments: "Auto-submitted by system",
        },
        context.userId,
      );

      // Re-fetch the requisition to see what status submitForApproval() set.
      // If it auto-approved (approvalStatus="APPROVED"), skip the PENDING overwrite.
      const afterSubmit = await this.prisma.requisition.findUnique({
        where: { id },
        select: { approvalStatus: true },
      });

      // B5-1: Only overwrite status to SUBMITTED/PENDING when the requisition was NOT auto-approved.
      // If submitForApproval() already set approvalStatus=APPROVED (auto-approve path),
      // overwriting it here would stick the requisition in the approval queue indefinitely (Bug 2).
      const wasAutoApproved = afterSubmit?.approvalStatus === "APPROVED";

      const updated = wasAutoApproved
        ? // Auto-approved — re-fetch with full includes; do NOT alter status fields
          await this.prisma.requisition.findUniqueOrThrow({
            where: { id },
            include: buildRequisitionInclude(),
          })
        : // Needs manual approval — set both status and approvalStatus to SUBMITTED/PENDING
          await this.prisma.requisition.update({
            where: { id },
            data: {
              status: RequisitionStatus.SUBMITTED,
              approvalStatus: mapStatusToApprovalStatus(
                RequisitionStatus.SUBMITTED,
              ), // "PENDING"
            },
            include: buildRequisitionInclude(),
          });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.SUBMIT,
        "Requisition",
        id,
        currentReq.reqNumber,
        { status: currentReq.status },
        { status: updated.status },
        {
          submittedBy: context.userId,
          itemCount: updated.lines.length,
        },
      );

      // Send notification to approvers
      try {
        const approvers = await this.prisma.user.findMany({
          where: {
            isActive: true,
            role: {
              permissions: {
                some: {
                  permission: {
                    resource: "PURCHASING",
                    action: "approve",
                  },
                },
              },
            },
          },
          select: { id: true },
        });

        for (const approver of approvers) {
          await notificationService.sendNotification(context, {
            userId: approver.id,
            type: "requisition.submitted",
            category: NotificationCategory.PURCHASING,
            title: `Requisition Submitted: ${currentReq.reqNumber}`,
            message: `Requisition ${currentReq.reqNumber} has been submitted for approval`,
            priority: NotificationPriority.NORMAL,
            actionUrl: `/purchasing/requisitions/${id}`,
            actionLabel: "Review Requisition",
            data: {
              requisitionId: id,
              requisitionNumber: currentReq.reqNumber,
              description: currentReq.description,
              totalValue: calculateTotalValue(
                updated.lines.map((l) => ({
                  ...l,
                  quantity: toNumber(l.quantity) ?? 0,
                  estimatedPrice: toNumber(l.estimatedPrice) ?? 0,
                  workOrderId:
                    (l as { workOrderId?: string | null }).workOrderId ?? null,
                })),
              ),
              itemCount: updated.lines.length,
              requestedBy:
                currentReq.requestedBy.firstName +
                " " +
                currentReq.requestedBy.lastName,
            },
          });
        }
      } catch (_error) {
        // Notification errors are non-critical
      }

      // Send Purchasing Manager email notification when this is a resubmission
      // (resetCount > 0 means the req was kicked back at least once and is now being resubmitted)
      if (currentReq.resetCount > 0) {
        try {
          const purchasingManagers = await this.prisma.user.findMany({
            where: {
              isActive: true,
              role: { name: "Purchasing Manager" },
            },
            select: { id: true, email: true, firstName: true, lastName: true },
          });

          const totalValue = calculateTotalValue(
            updated.lines.map((l) => ({
              ...l,
              quantity: toNumber(l.quantity) ?? 0,
              estimatedPrice: toNumber(l.estimatedPrice) ?? 0,
              workOrderId:
                (l as { workOrderId?: string | null }).workOrderId ?? null,
            })),
          );

          const formattedTotal = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(totalValue);

          const resubmittedAt = new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });

          const requesterName =
            currentReq.requestedBy.firstName +
            " " +
            currentReq.requestedBy.lastName;

          for (const manager of purchasingManagers) {
            if (!manager.email) continue;
            const recipientName =
              (manager.firstName + " " + manager.lastName).trim() ||
              manager.email;

            const html = renderRequisitionResubmittedEmail({
              reqNumber: currentReq.reqNumber,
              requesterName,
              resubmittedAt,
              description: currentReq.description ?? "",
              totalValue: formattedTotal,
              poNumber: currentReq.purchaseOrderNumber ?? null,
              requisitionId: id,
              purchaseOrderId: currentReq.purchaseOrderId ?? null,
              recipientName,
              // No line-level diff data is stored at submit time — reviewer directed to req
              changes: undefined,
            });

            await graphEmailService.sendEmail({
              to: manager.email,
              subject:
                "Requisition " +
                currentReq.reqNumber +
                " Resubmitted for Approval \u2014 Action Required",
              body: html,
              isHtml: true,
              importance: "high",
            });
          }
        } catch (_emailError) {
          // Email notification is non-critical — do not block the submission
          logger.warn(
            "[REQ Submit] Failed to send Purchasing Manager resubmit notification for " +
              currentReq.reqNumber,
            {
              error:
                _emailError instanceof Error
                  ? _emailError.message
                  : String(_emailError),
            },
          );
        }
      }

      // If this is a repair REQ, send a dedicated high-priority notification to
      // Purchasing Managers so they know it's time-sensitive (equipment is waiting).
      if (currentReq.isRepairRequisition && currentReq.repairableItemId) {
        try {
          // Fetch the serial + inventory item details for context
          const repairSerial = await this.prisma.repairableItem.findUnique({
            where: { id: currentReq.repairableItemId },
            select: {
              serialNumber: true,
              inventoryItem: { select: { sku: true, description: true } },
            },
          });
          // Find the linked repair WO for context
          const repairWo = await this.prisma.workOrder.findFirst({
            where: {
              repairableItemId: currentReq.repairableItemId,
              isRepairWorkOrder: true,
            },
            select: { id: true, woNumber: true },
            orderBy: { createdAt: "desc" },
          });
          if (repairSerial) {
            const estimatedCost = toNumber(
              updated.lines.reduce(
                (sum, l) =>
                  sum +
                  (toNumber(l.estimatedPrice) ?? 0) *
                    (toNumber(l.quantity) ?? 1),
                0,
              ),
            );
            void repairableItemNotificationService.notifyRepairReqSubmitted(
              context,
              {
                requisitionId: id,
                reqNumber: currentReq.reqNumber,
                serialNumber: repairSerial.serialNumber,
                inventoryItemSku: repairSerial.inventoryItem.sku,
                inventoryItemDescription:
                  repairSerial.inventoryItem.description,
                workOrderId: repairWo?.id ?? null,
                workOrderNumber: repairWo?.woNumber ?? null,
                estimatedCost: estimatedCost,
                requestedBy: context.userName,
              },
            );
          }
        } catch (_repairNotifError) {
          // Non-fatal — do not block the submission
        }
      }

      // Return transformed result
      return transformRequisition(updated);
    } catch (error) {
      // Re-throw all known API errors (ForbiddenError/AuthorizationError, NotFoundError,
      // BadRequestError, etc.) so the route layer can return the correct HTTP status
      // and the client gets a meaningful error message instead of a generic 500.
      if (error instanceof ApiError) throw error;
      throw new Error(
        `Failed to submit requisition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Approve requisition (direct path)
   * Transition: SUBMITTED → APPROVED
   *
   * @deprecated B5-8: This direct approval method bypasses the level-based approval
   * chain managed by `requisitionApprovalService`. Callers should use
   * `requisitionApprovalService.approveRequisition()` instead, which respects
   * configured approval levels, creates proper audit trails, and handles GL entries.
   *
   * This method is ONLY appropriate when NO approval levels are configured
   * (simple/direct approval). When approval levels exist, it automatically
   * delegates to the approval service to prevent bypassing the approval chain.
   *
   * @param context - Service context with user and permissions
   * @param id - Requisition ID
   * @returns Updated requisition
   * @throws NotFoundError if requisition not found
   * @throws BadRequestError if requisition cannot be approved
   */
  async approve(
    context: ServiceContext,
    id: string,
  ): Promise<RequisitionWithRelations> {
    try {
      // Check approval permission
      const permission = buildPermissionString(
        this.resource,
        ExtendedPermissionAction.APPROVE,
      );
      await checkPermission(context, permission);

      validateRequired(id, "id");

      // Get current requisition
      const currentReq = await this.prisma.requisition.findUnique({
        where: { id },
        include: buildRequisitionInclude(),
      });

      if (!currentReq) {
        throw new NotFoundError("Requisition", id);
      }

      // Prevent self-approval — amount-aware (except for Admin role)
      // This closes a gap where the direct-approve fallback path (no pending approvals)
      // could allow users to approve their own requisitions.
      if (currentReq.requestedById === context.userId) {
        const approver = await this.prisma.user.findUnique({
          where: { id: context.userId },
          include: { role: true },
        });
        const isAdmin = approver?.role.name === "Admin";

        if (!isAdmin) {
          // Compute totalAmount from requisition lines
          const totalAmount = currentReq.lines.reduce((sum, line) => {
            return sum + Number(line.quantity) * Number(line.estimatedPrice);
          }, 0);

          // Look up the user's approval authority for any active level with maxAmount >= totalAmount
          const selfApprovalAuthority =
            await this.prisma.userApprovalAuthority.findFirst({
              where: {
                userId: context.userId,
                isActive: true,
                maxAmount: { gte: totalAmount },
              },
            });

          if (!selfApprovalAuthority) {
            throw new BadRequestError(
              `You cannot approve your own requisition when the total ($${totalAmount.toFixed(2)}) exceeds your approval authority. A different approver with sufficient authority must review and approve this request.`,
            );
          }
          // If authority covers the amount, allow self-approval to proceed
        }
        // Admin can self-approve — continue with approval process
      }

      // B5-8: Guard — If approval levels are configured for this requisition's amount,
      // route through the approval service instead of bypassing the approval chain.
      // This prevents the direct approve path from short-circuiting level-based approvals.
      const hasApprovalLevels =
        await this.prisma.requisitionApprovalLevel.count({
          where: { isActive: true },
        });

      if (hasApprovalLevels > 0) {
        // Check if this requisition already has pending approval records
        const pendingApprovals = await this.prisma.requisitionApproval.count({
          where: {
            requisitionId: id,
            status: "PENDING",
          },
        });

        if (pendingApprovals > 0) {
          // Route through the approval service — this is the correct path
          logger.warn(
            `[REQ Workflow] B5-8: Direct approve() called for REQ ${currentReq.reqNumber} which has ${pendingApprovals} pending approval(s). ` +
              `Routing through requisitionApprovalService.approveRequisition() instead.`,
          );
          await requisitionApprovalService.approveRequisition(
            {
              requisitionId: id,
              comments: "Approved via direct workflow path (auto-routed)",
            },
            context.userId,
          );

          // Re-fetch and return the updated requisition
          const refetched = await this.prisma.requisition.findUnique({
            where: { id },
            include: buildRequisitionInclude(),
          });
          if (!refetched) throw new NotFoundError("Requisition", id);
          return transformRequisition(refetched);
        }
      }

      // No approval levels configured or no pending approvals — proceed with direct approval.
      // B5-1: Set both status and approvalStatus atomically
      const updated = await this.prisma.requisition.update({
        where: { id },
        data: {
          status: RequisitionStatus.APPROVED,
          approvalStatus: mapStatusToApprovalStatus(RequisitionStatus.APPROVED), // "APPROVED"
          approvedAt: new Date(),
          approvedBy: context.userId,
        },
        include: buildRequisitionInclude(),
      });

      // NOTE: GL entries and budget reservation are NOT created here.
      // They are handled exclusively by the approval service path
      // (requisition-approval.service.ts → createGLEntriesForApprovedRequisition)
      // to avoid duplicate GL transaction creation when both paths run for the same requisition.

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.APPROVE,
        "Requisition",
        id,
        currentReq.reqNumber,
        { status: currentReq.status },
        { status: updated.status },
        {
          approvedBy: context.userId,
          approvedAt: updated.approvedAt?.toISOString(),
        },
      );

      // Send notification to requester
      try {
        await notificationService.sendNotification(context, {
          userId: currentReq.requestedById,
          type: "requisition.approved",
          category: NotificationCategory.PURCHASING,
          title: `Requisition Approved: ${currentReq.reqNumber}`,
          message: `Your requisition ${currentReq.reqNumber} has been approved`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/requisitions/${id}`,
          actionLabel: "View Requisition",
          data: {
            requisitionId: id,
            requisitionNumber: currentReq.reqNumber,
            description: currentReq.description,
            approvedBy: context.userName,
            approvedAt: updated.approvedAt?.toISOString(),
            totalValue: calculateTotalValue(
              updated.lines.map((l) => ({
                ...l,
                quantity: toNumber(l.quantity) ?? 0,
                estimatedPrice: toNumber(l.estimatedPrice) ?? 0,
                workOrderId:
                  (l as { workOrderId?: string | null }).workOrderId ?? null,
              })),
            ),
          },
        });
      } catch (_error) {
        // Notification errors are non-critical
      }

      // Return transformed result
      return transformRequisition(updated);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(
        `Failed to approve requisition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Reject requisition
   * Transition: SUBMITTED → REJECTED
   *
   * @param context - Service context with user and permissions
   * @param id - Requisition ID
   * @param data - Rejection data with reason
   * @returns Updated requisition
   * @throws NotFoundError if requisition not found
   * @throws BadRequestError if requisition cannot be rejected
   */
  async reject(
    context: ServiceContext,
    id: string,
    data: RequisitionRejectDTO,
  ): Promise<RequisitionWithRelations> {
    try {
      // Check approval permission (required to reject)
      const permission = buildPermissionString(
        this.resource,
        ExtendedPermissionAction.APPROVE,
      );
      await checkPermission(context, permission);

      validateRequired(id, "id");
      validateRequired(data.reason, "reason");

      // Get current requisition
      const currentReq = await this.prisma.requisition.findUnique({
        where: { id },
        include: buildRequisitionInclude(),
      });

      if (!currentReq) {
        throw new NotFoundError("Requisition", id);
      }

      // B5-1: Set both status and approvalStatus atomically
      const updated = await this.prisma.requisition.update({
        where: { id },
        data: {
          status: RequisitionStatus.REJECTED,
          approvalStatus: mapStatusToApprovalStatus(RequisitionStatus.REJECTED), // "REJECTED"
          rejectedAt: new Date(),
          rejectionReason: data.reason,
        },
        include: buildRequisitionInclude(),
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.REJECT,
        "Requisition",
        id,
        currentReq.reqNumber,
        { status: currentReq.status },
        { status: updated.status },
        {
          rejectedBy: context.userId,
          rejectedAt: updated.rejectedAt?.toISOString(),
          reason: data.reason,
        },
      );

      // Send notification to requester
      try {
        await notificationService.sendNotification(context, {
          userId: currentReq.requestedById,
          type: "requisition.rejected",
          category: NotificationCategory.PURCHASING,
          title: `Requisition Rejected: ${currentReq.reqNumber}`,
          message: `Your requisition ${currentReq.reqNumber} has been rejected`,
          priority: NotificationPriority.HIGH,
          actionUrl: `/purchasing/requisitions/${id}`,
          actionLabel: "View Requisition",
          data: {
            requisitionId: id,
            requisitionNumber: currentReq.reqNumber,
            description: currentReq.description,
            rejectedBy: context.userName,
            rejectedAt: updated.rejectedAt?.toISOString(),
            reason: data.reason,
            totalValue: calculateTotalValue(
              updated.lines.map((l) => ({
                ...l,
                quantity: toNumber(l.quantity) ?? 0,
                estimatedPrice: toNumber(l.estimatedPrice) ?? 0,
                workOrderId:
                  (l as { workOrderId?: string | null }).workOrderId ?? null,
              })),
            ),
          },
        });
      } catch (_error) {
        // Notification errors are non-critical
      }

      // Return transformed result
      return transformRequisition(updated);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(
        `Failed to reject requisition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Cancel requisition
   * Transition: DRAFT/SUBMITTED/APPROVED → CANCELLED
   *
   * CRITICAL: When cancelling an approved requisition, must:
   * 1. Reverse the GL transaction
   * 2. Release the reserved budget
   *
   * @param context - Service context with user and permissions
   * @param id - Requisition ID
   * @param data - Cancellation data with reason
   * @returns Updated requisition
   * @throws NotFoundError if requisition not found
   * @throws BadRequestError if requisition cannot be cancelled
   */
  async cancel(
    context: ServiceContext,
    id: string,
    data: RequisitionCancelDTO,
  ): Promise<RequisitionWithRelations> {
    try {
      // Check permission
      await this.checkCrudPermission(context, PermissionAction.UPDATE);

      validateRequired(id, "id");
      validateRequired(data.reason, "reason");

      // Get current requisition
      const currentReq = await this.prisma.requisition.findUnique({
        where: { id },
        include: buildRequisitionInclude(),
      });

      if (!currentReq) {
        throw new NotFoundError("Requisition", id);
      }

      // CRITICAL: If requisition was approved, must reverse GL and release budget
      if (currentReq.status === RequisitionStatus.APPROVED) {
        // Find GL transaction for this requisition
        const glTransaction = await this.prisma.gLTransaction.findFirst({
          where: {
            referenceType: "Requisition",
            referenceId: id,
            status: "POSTED",
          },
        });

        if (glTransaction) {
          // Reverse the GL transaction AND automatically correct budget
          // GLReversalService handles both GL reversal and budget correction in one call
          try {
            await glReversalService.reverseTransaction(
              glTransaction.id,
              `Requisition ${currentReq.reqNumber} cancelled: ${data.reason}`,
              context.userId,
            );
          } catch (glReversalError) {
            logger.warn(
              `[REQ Cancel] GL reversal failed for Requisition ${currentReq.reqNumber} transaction ${glTransaction.id} (non-fatal — cancellation will proceed). Manual GL correction may be required.`,
              {
                error:
                  glReversalError instanceof Error
                    ? glReversalError.message
                    : String(glReversalError),
                requisitionId: id,
                reqNumber: currentReq.reqNumber,
                glTransactionId: glTransaction.id,
                reason: data.reason,
              },
            );
          }
        }
      }

      // B5-1: Set both status and approvalStatus atomically
      const updated = await this.prisma.requisition.update({
        where: { id },
        data: {
          status: RequisitionStatus.CANCELLED,
          approvalStatus: mapStatusToApprovalStatus(
            RequisitionStatus.CANCELLED,
          ), // "CANCELLED"
          rejectionReason: data.reason,
        },
        include: buildRequisitionInclude(),
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CANCEL,
        "Requisition",
        id,
        currentReq.reqNumber,
        { status: currentReq.status },
        { status: updated.status },
        {
          cancelledBy: context.userId,
          reason: data.reason,
        },
      );

      // Return transformed result
      return transformRequisition(updated);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(
        `Failed to cancel requisition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Convert requisition to purchase order
   * Transition: APPROVED → ORDERED
   *
   * @param context - Service context with user and permissions
   * @param id - Requisition ID
   * @param data - Conversion data with optional supplier ID (uses requisition supplier if not provided)
   * @returns Purchase order ID
   * @throws NotFoundError if requisition or supplier not found
   * @throws BadRequestError if requisition cannot be converted
   */
  async convertToPO(
    context: ServiceContext,
    id: string,
    data: RequisitionConvertToPODTO,
  ): Promise<string> {
    try {
      // Check permission
      await this.checkCrudPermission(context, PermissionAction.CREATE);

      // CRITICAL: Converting a requisition to a PO *creates a purchase order*,
      // which is restricted to dedicated PO-creator roles (Admin, Finance
      // Manager, Plant Manager, Purchasing Manager). The checkCrudPermission
      // above only verified requisition/purchasing create; this additional
      // check enforces the dedicated `purchase_orders:create` permission so the
      // PO-creation restriction holds at the service layer, matching the route.
      const user = await this.prisma.user.findUnique({
        where: { id: context.userId },
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundError("User", context.userId);
      }

      // Require the dedicated PO-creation permission. Note the stored resource
      // value is "purchase_orders"; compare case-insensitively and require the
      // permission to be active.
      const hasConvertPermission = user.role.permissions.some(
        (rp) =>
          rp.permission.resource.toUpperCase() === "PURCHASE_ORDERS" &&
          rp.permission.action === "create" &&
          rp.permission.isActive,
      );

      if (!hasConvertPermission) {
        throw new BadRequestError(
          "You do not have permission to convert requisitions to Purchase Orders. " +
            "Please contact your system administrator to request the 'Purchase Orders: Create' permission for your role.",
        );
      }

      validateRequired(id, "id");

      // Get requisition with supplier, line-level allocations, header-level allocations, and budget header
      const requisition = await this.prisma.requisition.findUnique({
        where: { id },
        include: {
          lines: {
            include: {
              // Line-level allocations (requisitionLineId = this line's ID)
              allocations: true,
            },
          },
          supplier: true,
          budgetHeader: {
            include: {
              accountCode: true,
              // Include project so we can get its accountCodeId
              project: {
                select: {
                  id: true,
                  accountCodeId: true,
                },
              },
              // Include the linked work order so we can stamp the PO-header
              // workOrderIds/workOrderNumbers arrays for reporting (Phase 1).
              workOrder: {
                select: {
                  id: true,
                  woNumber: true,
                },
              },
            },
          },
          // Header-level allocations (requisitionLineId IS NULL) — these are
          // the allocations created at the requisition level, not tied to a specific line.
          // We use these as a fallback when a line has no line-level allocations.
          lineAllocations: {
            where: {
              requisitionLineId: null,
            },
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
      });

      if (!requisition) {
        throw new NotFoundError("Requisition", id);
      }

      // CRITICAL: Prevent duplicate PO creation if requisition is already linked to a PO
      // This can happen after cancel-for-edit resets PO to Draft but preserves the linkage
      if (requisition.purchaseOrderId) {
        throw new BadRequestError(
          `Requisition ${requisition.reqNumber} is already linked to Purchase Order ${requisition.purchaseOrderNumber ?? requisition.purchaseOrderId}. ` +
            `Navigate to the existing PO to advance it through the workflow instead of creating a new one.`,
        );
      }

      // Log each line's details

      // Use requisition supplier if not provided in DTO
      // If requisition has no supplier, try to use the supplier from the lines (if all lines have the same supplier)
      let supplierId = data.supplierId || requisition.supplierId;

      if (!supplierId) {
        // Check if all lines have the same supplier
        const lineSuppliers = requisition.lines
          .map((line) => (line as { supplierId?: string | null }).supplierId)
          .filter(Boolean);

        if (lineSuppliers.length > 0) {
          const uniqueSuppliers = [...new Set(lineSuppliers)];

          if (uniqueSuppliers.length === 1 && uniqueSuppliers[0]) {
            // All lines have the same supplier, use it
            supplierId = uniqueSuppliers[0];
          } else {
            throw new BadRequestError(
              "Requisition lines have multiple suppliers. Please convert lines to separate POs by supplier.",
            );
          }
        } else {
          throw new BadRequestError(
            "Supplier is required. Please specify a supplier for this requisition before converting to a purchase order.",
          );
        }
      }

      // Validate can convert (with resolved supplier ID)
      await validateConvertToPO(id, { supplierId }, this.prisma);

      // Map requisition lines to PO items
      const items = requisition.lines.map((line) => {
        // Type assertion for line with all possible fields
        type ReqLineWithFields = typeof line & {
          lineType?: string;
          consumableCategory?: string | null;
          manufacturer?: string | null;
          modelNumber?: string | null;
          packageSize?: string | null;
          monthlyUsageRate?: number | null;
          storageRequirements?: string | null;
          sdsRequired?: boolean;
          expirationTracking?: boolean;
        };
        const typedLine = line as ReqLineWithFields;
        const lineType = typedLine.lineType;

        const baseItem = {
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.estimatedPrice),
          unitOfMeasure: line.unit,
          notes: line.notes,
        };

        // CRITICAL: INVENTORY line items REQUIRE inventoryItemId per Zod schema
        // If a line is marked as INVENTORY but has no inventoryItemId, treat it as CONSUMABLE
        let item;
        if (lineType === "INVENTORY" && line.inventoryItemId) {
          // Only create INVENTORY item if we have an inventoryItemId
          item = {
            ...baseItem,
            lineType: "INVENTORY" as const,
            inventoryItemId: line.inventoryItemId,
          };
        } else if (lineType === "SERVICE") {
          item = {
            ...baseItem,
            lineType: "SERVICE" as const,
          };
        } else if (lineType === LineItemType.REPAIRABLE_RETURN) {
          item = {
            ...baseItem,
            lineType: LineItemType.REPAIRABLE_RETURN,
            inventoryItemId: line.inventoryItemId ?? undefined,
          };
        } else {
          // CONSUMABLE - includes lines marked as INVENTORY but without inventoryItemId
          // Transfer all consumable-specific fields from requisition
          item = {
            ...baseItem,
            lineType: "CONSUMABLE" as const,
            consumableCategory: typedLine.consumableCategory ?? undefined,
            manufacturer: typedLine.manufacturer ?? undefined,
            modelNumber: typedLine.modelNumber ?? undefined,
            packageSize: typedLine.packageSize ?? undefined,
            monthlyUsageRate: typedLine.monthlyUsageRate
              ? Number(typedLine.monthlyUsageRate)
              : undefined,
            storageRequirements: typedLine.storageRequirements ?? undefined,
            sdsRequired: typedLine.sdsRequired,
            expirationTracking: typedLine.expirationTracking,
          };
        }

        return item;
      });

      // Compute tax from the configured rate.
      // getTaxConfig() is cached; this is a lightweight call.
      const taxConfig = await getTaxConfig();
      const reqSubtotal = requisition.lines.reduce(
        (sum, line) =>
          sum + Number(line.quantity) * Number(line.estimatedPrice),
        0,
      );
      const reqTaxAmount = calculateTaxAmount(reqSubtotal, taxConfig);

      // Create PO — pass computed tax so totalAmount is correctly calculated
      const purchaseOrder = await purchaseOrderService.create(context, {
        supplierId: supplierId,
        orderDate: new Date().toISOString(),
        shippingCost: 0,
        tax: reqTaxAmount,
        items,
      });

      // Backfill repairableItemId on REPAIRABLE_RETURN lines.
      // The DTO doesn't carry repairableItemId (it's set from the REQ header),
      // so we patch it after creation.
      if (requisition.repairableItemId) {
        await this.prisma.pOLine.updateMany({
          where: {
            purchaseOrderId: purchaseOrder.id,
            lineType: LineItemType.REPAIRABLE_RETURN,
          },
          data: {
            repairableItemId: requisition.repairableItemId,
          },
        });
      }

      // CRITICAL: Copy allocations from requisition lines to PO lines.
      // SERVICE and CONSUMABLE lines require charge allocations with account codes
      // for GL entry generation at "Send to Supplier" time.
      //
      // Fallback priority for missing line-level allocations:
      //   1. Line-level RequisitionLineAllocation records (most specific)
      //   2. Header-level accountCodeId from RequisitionBudgetHeader (CHARGE_TO_ACCOUNT)
      //   3. Project accountCodeId from RequisitionBudgetHeader (CHARGE_TO_PROJECT)
      await this.prisma.$transaction(async (tx) => {
        // Get PO lines in order
        const poLines = await tx.pOLine.findMany({
          where: { purchaseOrderId: purchaseOrder.id },
          orderBy: { createdAt: "asc" }, // Use createdAt to match insertion order
        });

        // Resolve header-level fallback account code once for all lines
        const budgetHeader = (
          requisition as typeof requisition & {
            budgetHeader?: {
              accountCodeId: string | null;
              projectId: string | null;
              budgetType: string;
              project?: { id: string; accountCodeId: string | null } | null;
            } | null;
          }
        ).budgetHeader;

        // For CHARGE_TO_PROJECT: resolve the project's accountCodeId.
        // We now include the project relation on budgetHeader, so use it directly.
        let projectAccountCodeId: string | null =
          budgetHeader?.project?.accountCodeId ?? null;

        // If project wasn't included (or has no accountCodeId), look it up
        if (
          !projectAccountCodeId &&
          budgetHeader?.budgetType === "CHARGE_TO_PROJECT" &&
          budgetHeader.projectId
        ) {
          const project = await tx.project.findUnique({
            where: { id: budgetHeader.projectId },
            select: { accountCodeId: true },
          });
          projectAccountCodeId = project?.accountCodeId ?? null;
        }

        // Determine the header-level fallback account code
        // Priority: CHARGE_TO_ACCOUNT (direct account code) → CHARGE_TO_PROJECT (project's account code)
        // Must be `let` because the CHARGE_TO_WORK_ORDER block below may update it.
        let headerAccountCodeId: string | null =
          budgetHeader?.accountCodeId !== undefined
            ? budgetHeader.accountCodeId // CHARGE_TO_ACCOUNT (string | null)
            : projectAccountCodeId; // CHARGE_TO_PROJECT (string | null)

        // G7: When budgetType is CHARGE_TO_WORK_ORDER and no account code is on the header,
        // resolve it from the work order's project or equipment so that PO line charge
        // allocations can be created for SERVICE/CONSUMABLE lines.
        const workOrderIdForResolution = (
          budgetHeader as { workOrderId?: string | null }
        ).workOrderId;
        if (
          !headerAccountCodeId &&
          budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER" &&
          workOrderIdForResolution
        ) {
          const woResolution =
            await budgetResolutionService.resolveFromWorkOrder(
              workOrderIdForResolution,
            );
          headerAccountCodeId = woResolution.accountCodeId;
        }

        // Header-level allocations (requisitionLineId = null) — stored on the requisition
        // but not tied to any specific line. These are used as fallback for all lines.
        // lineAllocations is always an array when included via Prisma (never undefined).
        const headerLevelAllocations = (
          requisition as typeof requisition & {
            lineAllocations: Array<{
              id: string;
              accountCodeId: string | null;
              departmentId: string | null;
              projectId: string | null;
              areaId: string | null;
              percentage: number | { toNumber(): number };
              amount: number | { toNumber(): number };
            }>;
          }
        ).lineAllocations;

        // Copy allocations for each line and update RequisitionLine.poLineId
        // Match by requisitionLineId on the PO line for accuracy, fall back to array index.
        // Build a map: reqLineId → poLine for accurate matching.
        const poLineByReqLineId = new Map<string, (typeof poLines)[0]>();
        for (const poLine of poLines) {
          const reqLineId = (
            poLine as typeof poLine & { requisitionLineId?: string | null }
          ).requisitionLineId;
          if (reqLineId) {
            poLineByReqLineId.set(reqLineId, poLine);
          }
        }

        for (let i = 0; i < requisition.lines.length; i++) {
          const reqLine = requisition.lines[i];

          // TypeScript guard: lines[i] is always defined when i < lines.length,
          // but strict array indexing may report it as T | undefined.
          if (!reqLine) continue;

          // For fresh conversions all PO lines have requisitionLineId=null (not set yet),
          // so poLineByReqLineId is always empty and positional match is the primary strategy.
          // Guard: only use positional when counts match exactly — mismatch means a creation error.
          const poLine =
            poLineByReqLineId.get(reqLine.id) ??
            (poLines.length === requisition.lines.length
              ? poLines[i]
              : undefined);

          if (!poLine) {
            logger.error(
              `[convertToPO] Cannot match PO line for REQ line ${reqLine.id}: ` +
                `PO has ${poLines.length} line(s) but REQ has ${requisition.lines.length} line(s). ` +
                `Skipping allocation copy for this line.`,
            );
            continue;
          }

          // CRITICAL: Update RequisitionLine.poLineId AND POLine.requisitionLineId so the
          // GL fallback path in createApprovalGLEntries() can find the req line by poLineId
          // (not just description), and future conversions can match lines precisely.
          await tx.requisitionLine.update({
            where: { id: reqLine.id },
            data: { poLineId: poLine.id },
          });
          await tx.pOLine.update({
            where: { id: poLine.id },
            data: { requisitionLineId: reqLine.id },
          });

          // Get line-level allocations for this requisition line
          const lineLevelAllocations = reqLine.allocations;

          if (lineLevelAllocations.length > 0) {
            // Path 1: Line has explicit line-level allocations — copy them directly
            for (const alloc of lineLevelAllocations) {
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
            }
          } else if (
            reqLine.lineType !== "INVENTORY" &&
            headerLevelAllocations.length > 0
          ) {
            // Path 2: No line-level allocations, but there are header-level allocations
            // (RequisitionLineAllocation records with requisitionLineId = null).
            // These represent the account coding at the requisition level.
            // For non-INVENTORY lines, copy each header allocation and scale the amount
            // to this line's proportion of the requisition total.
            const lineAmount =
              Number(reqLine.quantity) * Number(reqLine.estimatedPrice);
            for (const alloc of headerLevelAllocations) {
              await tx.pOLineChargeAllocation.create({
                data: {
                  poLineId: poLine.id,
                  accountCodeId: alloc.accountCodeId,
                  departmentId: alloc.departmentId,
                  projectId: alloc.projectId,
                  areaId: alloc.areaId,
                  percentage: Number(alloc.percentage),
                  // Scale: use percentage of this line's amount (not the header total amount)
                  amount: lineAmount * (Number(alloc.percentage) / 100),
                  notes: "Copied from requisition header allocation",
                },
              });
            }
          } else if (reqLine.lineType !== "INVENTORY" && headerAccountCodeId) {
            // Path 3: No line-level or header-level allocations, but budget header has an
            // account code (CHARGE_TO_ACCOUNT / CHARGE_TO_PROJECT / CHARGE_TO_WORK_ORDER).
            // Create a single 100% allocation using the resolved header account code.
            const lineAmount =
              Number(reqLine.quantity) * Number(reqLine.estimatedPrice);
            await tx.pOLineChargeAllocation.create({
              data: {
                poLineId: poLine.id,
                accountCodeId: headerAccountCodeId,
                departmentId: null,
                projectId: budgetHeader?.projectId ?? null,
                areaId: null,
                percentage: 100,
                amount: lineAmount,
                notes: "Copied from requisition budget header",
              },
            });
          }
          // Path 4: INVENTORY lines without allocations are handled by GL rules
          // using FIXED account sources — no allocation needed.
        }
      });

      // Update the PO to link it to the requisition AND set status to Approved
      // POs created from approved requisitions skip the Draft→Submitted→Approved workflow
      // since the requisition already went through its own approval process.
      // GL entries and budget consumption happen at Send to Supplier time.
      // Stamp the denormalized PO-header work-order arrays so reports that key
      // off PurchaseOrder.workOrderIds (e.g. the maintenance cost report) surface
      // POs created from work-order requisitions. This is metadata only — no GL,
      // send, or receive guard reads these arrays, so it is behaviourally safe.
      // (We deliberately do NOT stamp the per-line POLine.workOrderId here: that
      // field is read by the send/receive charge-allocation guards for INVENTORY
      // lines and changing it would alter GL routing.)
      const linkedWorkOrder = requisition.budgetHeader?.workOrder ?? null;

      await this.prisma.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          status: "Approved",
          approvedAt: new Date(),
          requisitionIds: [requisition.id],
          requisitionNumbers: [requisition.reqNumber],
          workOrderIds: linkedWorkOrder ? [linkedWorkOrder.id] : [],
          workOrderNumbers: linkedWorkOrder ? [linkedWorkOrder.woNumber] : [],
        },
      });

      // E2: Atomic conditional update — only link the PO if purchaseOrderId is still null.
      // Prevents a ghost PO when two concurrent convertToPO() calls both pass the guard above.
      const linkResult = await this.prisma.requisition.updateMany({
        where: {
          id,
          purchaseOrderId: null, // only update if not already linked
        },
        data: {
          status: RequisitionStatus.ORDERED,
          approvalStatus: mapStatusToApprovalStatus(RequisitionStatus.ORDERED), // "ORDERED"
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber: purchaseOrder.poNumber,
          convertedToPOAt: new Date(),
          convertedToPOBy: context.userId,
        },
      });

      if (linkResult.count === 0) {
        // Another concurrent request already converted this requisition — clean up our PO
        await this.prisma.purchaseOrder.delete({
          where: { id: purchaseOrder.id },
        });
        throw new BadRequestError(
          `Requisition was already converted to a Purchase Order by a concurrent request.`,
        );
      }

      // Propagate documents from requisition to the new PO
      try {
        const { propagatedCount } =
          await documentLinkingService.propagateDocumentsOnPOCreation({
            requisitionId: requisition.id,
            purchaseOrderId: purchaseOrder.id,
            userId: context.userId,
          });
        if (propagatedCount > 0) {
          logger.info(
            `[REQ->PO] Propagated ${propagatedCount} documents from REQ ${requisition.reqNumber} to PO ${purchaseOrder.poNumber}`,
          );
        }
      } catch (docError) {
        // Don't fail the conversion if document propagation fails
        logger.error(
          `[REQ->PO] Document propagation failed (non-fatal): ${docError instanceof Error ? docError.message : String(docError)}`,
        );
      }

      // Log audit trail for requisition conversion
      // Note: PO creation is already logged by purchaseOrderService.create()
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CREATE,
        "Requisition",
        id,
        requisition.reqNumber,
        { status: requisition.status },
        { status: RequisitionStatus.ORDERED },
        {
          action: "requisition_converted_to_po",
          convertedBy: context.userId,
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber: purchaseOrder.poNumber,
          supplierId: supplierId,
          totalAmount: Number(purchaseOrder.totalAmount),
          relatedEntityType: "PurchaseOrder",
          relatedEntityId: purchaseOrder.id,
          relatedEntityNumber: purchaseOrder.poNumber,
        },
      );

      // CRITICAL: Also log the conversion from the PO perspective
      // This creates a cross-linked audit trail so PO history shows its origin
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CREATE,
        "PurchaseOrder",
        purchaseOrder.id,
        purchaseOrder.poNumber,
        {},
        {
          status: "Approved",
          totalAmount: Number(purchaseOrder.totalAmount),
        },
        {
          action: "po_created_from_requisition",
          createdBy: context.userId,
          requisitionId: id,
          requisitionNumber: requisition.reqNumber,
          supplierId: supplierId,
          totalAmount: Number(purchaseOrder.totalAmount),
          itemCount: requisition.lines.length,
          relatedEntityType: "Requisition",
          relatedEntityId: id,
          relatedEntityNumber: requisition.reqNumber,
          skippedApproval: true,
          reason:
            "PO created from approved requisition — approval workflow skipped",
        },
      );

      // Send notification to requester about PO creation
      // Note: Notifications are sent on a best-effort basis and won't fail the conversion
      // The try-catch ensures that notification failures don't prevent PO creation
      try {
        await notificationService.sendNotification(context, {
          userId: requisition.requestedById,
          type: "po.created",
          category: NotificationCategory.PURCHASING,
          title: `Purchase Order Created: ${purchaseOrder.poNumber}`,
          message: `Purchase order ${purchaseOrder.poNumber} has been created from your requisition ${requisition.reqNumber}`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/purchase-orders/${purchaseOrder.id}`,
          actionLabel: "View Purchase Order",
          data: {
            purchaseOrderId: purchaseOrder.id,
            purchaseOrderNumber: purchaseOrder.poNumber,
            requisitionId: id,
            requisitionNumber: requisition.reqNumber,
            supplierId: supplierId,
            totalAmount: Number(purchaseOrder.totalAmount),
            itemCount: requisition.lines.length,
            createdBy: context.userName,
          },
        });
      } catch (_error) {
        // Notifications are non-critical - don't fail the conversion
      }

      return purchaseOrder.id;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(
        `Failed to convert requisition to PO: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Force-approve a Draft requisition that is stuck in workflow because a PO
   * was created from it (fields approvedAt/approvedBy are already populated)
   * but the status never advanced past "Draft". This is a data-repair method,
   * NOT a normal workflow action.
   *
   * Added 2026-04-20 for the Maintenance PO audit — see
   * plans/MAINT_PO_RECLASS_CHANGELOG.md for the six affected reqs.
   *
   * Preconditions (enforced):
   *   - status === 'Draft'
   *   - approvedAt IS NOT NULL  (already implicitly approved)
   *   - purchaseOrderId IS NOT NULL  (has a PO downstream)
   *   - cancelledAt IS NULL
   *
   * Effect:
   *   - status -> 'Approved'
   *   - approvalStatus -> 'APPROVED'
   *   - If submittedAt is null, set submittedAt = approvedAt, submittedBy = approvedBy
   *   - AuditLog entry
   *
   * Does NOT touch GL, budgets, or the downstream PO. The PO already had its
   * GL entries created at approval time — this method only fixes the display
   * status on the requisition record.
   */
  async forceApproveDraftWithPO(
    context: ServiceContext,
    requisitionId: string,
    reason: string,
  ): Promise<{
    success: boolean;
    message: string;
    requisition: { id: string; reqNumber: string };
  }> {
    const LOG_PREFIX = "[forceApproveDraftWithPO]";
    try {
      logger.info(`${LOG_PREFIX} Start req=${requisitionId}`);

      const req = await this.prisma.requisition.findUnique({
        where: { id: requisitionId },
        select: {
          id: true,
          reqNumber: true,
          status: true,
          approvalStatus: true,
          approvedAt: true,
          approvedBy: true,
          submittedAt: true,
          submittedBy: true,
          cancelledAt: true,
          purchaseOrderId: true,
          purchaseOrderNumber: true,
        },
      });
      if (!req) throw new NotFoundError("Requisition", requisitionId);

      // Preconditions
      if (req.status !== "Draft") {
        throw new BadRequestError(
          `Req ${req.reqNumber} is not Draft (status=${req.status}). Nothing to do.`,
        );
      }
      if (!req.approvedAt) {
        throw new BadRequestError(
          `Req ${req.reqNumber} has no approvedAt — not eligible for force-approve.`,
        );
      }
      if (!req.purchaseOrderId) {
        throw new BadRequestError(
          `Req ${req.reqNumber} has no linked PO — not eligible for force-approve.`,
        );
      }
      if (req.cancelledAt) {
        throw new BadRequestError(
          `Req ${req.reqNumber} is cancelled — not eligible for force-approve.`,
        );
      }

      const submittedAtToSet = req.submittedAt ?? req.approvedAt;
      const submittedByToSet = req.submittedBy ?? req.approvedBy;

      await this.prisma.requisition.update({
        where: { id: requisitionId },
        data: {
          status: "Approved",
          approvalStatus: mapStatusToApprovalStatus("Approved"),
          submittedAt: submittedAtToSet,
          submittedBy: submittedByToSet,
        },
      });

      try {
        await auditLogService.logCrudOperation(
          context,
          AuditAction.APPROVE,
          "Requisition",
          requisitionId,
          req.reqNumber,
          {
            status: "Draft",
            submittedAt: req.submittedAt,
            submittedBy: req.submittedBy,
          },
          {
            status: "Approved",
            submittedAt: submittedAtToSet,
            submittedBy: submittedByToSet,
          },
          {
            action: "force_approve_draft_with_po",
            reason,
            linkedPO: req.purchaseOrderNumber,
            note: "Data repair — fixing stuck-in-Draft state on already-approved req",
          },
        );
      } catch (auditErr) {
        logger.error(`${LOG_PREFIX} Audit log failed`, auditErr);
      }

      return {
        success: true,
        message: `Req ${req.reqNumber} force-approved. Linked to ${req.purchaseOrderNumber}.`,
        requisition: { id: req.id, reqNumber: req.reqNumber },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(
        `Failed to force-approve req: ${(error as Error).message}`,
      );
    }
  }
}

const globalForReqWorkflow = globalThis as unknown as {
  requisitionWorkflowService: RequisitionWorkflowService | undefined;
};
export const requisitionWorkflowService =
  globalForReqWorkflow.requisitionWorkflowService ??
  (globalForReqWorkflow.requisitionWorkflowService =
    new RequisitionWorkflowService(prisma));
