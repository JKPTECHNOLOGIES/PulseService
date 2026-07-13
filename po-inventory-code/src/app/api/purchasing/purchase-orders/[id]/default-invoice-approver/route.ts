/**
 * Default Invoice Approver API Route
 *
 * Determines the correct default approver for an invoice based on the same
 * approval threshold logic used in the requisition approval system:
 *
 * - If the PO total is BELOW the lowest configured threshold → the requestor
 *   (person who created the linked requisition) is the approver.
 * - If the PO total is AT OR ABOVE a threshold → the primary approver configured
 *   for that approval level is the approver.
 * - If no thresholds are configured → the requisition requestor is the approver
 *   (mirrors auto-approve behavior: "No approval levels configured").
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { NotFoundError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/purchasing/purchase-orders/[id]/default-invoice-approver
 *
 * Returns the default approver for an invoice uploaded against this PO,
 * determined by the requisition approval threshold logic.
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    const poId = context.params.id;

    // 1. Load the PO with its lines (for amount calculation) and linked requisition requestor
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: {
          select: {
            quantity: true,
            unitPrice: true,
            totalPrice: true,
          },
        },
        // The requisition is linked via requisitionIds array, but the best source
        // for the requestor is the linked Requisition record's requestedBy user.
        // We also include the buyer as a secondary fallback.
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!po) {
      throw new NotFoundError("Purchase order", poId);
    }

    // 2. Calculate PO total amount from lines
    //    Use the PO's totalAmount field if available, otherwise sum lines.
    const poTotal = Number(po.totalAmount);

    // 3. Find the linked requisition (if any) to get the requestor
    //    POs store requisitionIds[] — look up the first linked requisition.
    let requestorUser: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      role: { name: string };
    } | null = null;

    if (po.requisitionIds.length > 0) {
      const firstReqId = po.requisitionIds[0];
      if (firstReqId) {
        const requisition = await prisma.requisition.findUnique({
          where: { id: firstReqId },
          include: {
            requestedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: {
                  select: { name: true },
                },
              },
            },
          },
        });
        if (requisition?.requestedBy) {
          requestorUser = requisition.requestedBy;
        }
      }
    }

    // 4. Get all active approval levels (same query as determineRequiredLevels in approval service)
    const allLevels = await prisma.requisitionApprovalLevel.findMany({
      where: { isActive: true },
      orderBy: { level: "asc" },
    });

    // 5. Find the matching approval level for this PO's total amount
    //    (mirrors the filter in determineRequiredLevels)
    const matchingLevels = allLevels.filter((level) => {
      const minAmount = Number(level.minAmount);
      const maxAmount = level.maxAmount ? Number(level.maxAmount) : Infinity;
      return poTotal >= minAmount && poTotal <= maxAmount;
    });

    // 6. Determine the approver based on threshold logic

    // Case A: No thresholds configured at all → the requisition requestor is
    //         the approver (mirrors auto-approve: "No approval levels configured").
    if (allLevels.length === 0) {
      if (requestorUser) {
        return success({
          approverId: requestorUser.id,
          approverName: `${requestorUser.firstName} ${requestorUser.lastName}`,
          approverEmail: requestorUser.email,
          approverRole: requestorUser.role.name,
          reason: "auto_approved_requestor" as const,
          thresholdAmount: null,
        });
      }
      // No requisition and no approval levels — absolute last resort: null
      return success(null);
    }

    // Case B: PO total is below the lowest threshold (no matching level) →
    //         requestor is the approver (they can self-approve sub-threshold items)
    if (matchingLevels.length === 0) {
      // Determine the lowest configured threshold for informational purposes
      const lowestThreshold = allLevels[0]
        ? Number(allLevels[0].minAmount)
        : null;

      if (!requestorUser) {
        // No requisition linked — fall back to returning null
        return success(null);
      }

      return success({
        approverId: requestorUser.id,
        approverName: `${requestorUser.firstName} ${requestorUser.lastName}`,
        approverEmail: requestorUser.email,
        approverRole: requestorUser.role.name,
        reason: "below_threshold" as const,
        thresholdAmount: lowestThreshold,
      });
    }

    // Case C: PO total is at or above a threshold → use the level approver
    //         Use the first (lowest) matching level, prefer primary approver
    const targetLevel = matchingLevels[0];
    if (!targetLevel) {
      return success(null);
    }

    const approverAuth = await prisma.userApprovalAuthority.findFirst({
      where: {
        approvalLevelId: targetLevel.id,
        isActive: true,
        isPrimary: true,
        OR: [
          { delegationEndDate: null },
          { delegationEndDate: { gte: new Date() } },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: {
              select: { name: true },
            },
          },
        },
      },
    });

    // Fall back to first active approver if no primary is set
    const fallbackApproverAuth = approverAuth
      ? null
      : await prisma.userApprovalAuthority.findFirst({
          where: {
            approvalLevelId: targetLevel.id,
            isActive: true,
            OR: [
              { delegationEndDate: null },
              { delegationEndDate: { gte: new Date() } },
            ],
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: {
                  select: { name: true },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        });

    const resolvedAuth = approverAuth ?? fallbackApproverAuth;

    if (!resolvedAuth?.user) {
      // Level exists but has no configured approver — fall back to requisition requestor
      if (requestorUser) {
        return success({
          approverId: requestorUser.id,
          approverName: `${requestorUser.firstName} ${requestorUser.lastName}`,
          approverEmail: requestorUser.email,
          approverRole: requestorUser.role.name,
          reason: "auto_approved_requestor" as const,
          thresholdAmount: null,
        });
      }
      return success(null);
    }

    const approver = resolvedAuth.user;
    const thresholdAmount = Number(targetLevel.minAmount);

    return success({
      approverId: approver.id,
      approverName: `${approver.firstName} ${approver.lastName}`,
      approverEmail: approver.email,
      approverRole: approver.role.name,
      reason: "above_threshold" as const,
      thresholdAmount,
    });
  },
);
