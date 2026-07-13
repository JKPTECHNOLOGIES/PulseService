/**
 * Purchase Order Budget Type Update API Route
 *
 * Update a purchase order's budget type from Account Code to Project.
 * Changes all charge allocations, reverses/re-creates GL entries if needed,
 * and updates linked requisition budget headers.
 *
 * PATCH /api/purchasing/purchase-orders/[id]/budget-type
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";

/**
 * PATCH /api/purchasing/purchase-orders/[id]/budget-type
 * Update budget type from Account Code to Project
 *
 * Request body:
 *   { projectId: string, reason: string }
 */
export const PATCH = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = (await req.json()) as Record<string, unknown>;
    const { projectId, reason } = body;

    if (!projectId || typeof projectId !== "string") {
      throw new BadRequestError("projectId is required");
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new BadRequestError("Reason for budget type change is required");
    }

    const result =
      await purchaseOrderWorkflowService.updateBudgetTypeToProject(
        context.params.id,
        projectId,
        reason.trim(),
        context.serviceContext.userId,
        context.serviceContext,
      );

    return success(result, "Budget type updated to Project successfully");
  },
);
