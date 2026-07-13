/**
 * Purchase Order Link-to-Work-Order API Route
 *
 * Link a PO to a Work Order, flipping budgetType from CHARGE_TO_ACCOUNT
 * to CHARGE_TO_WORK_ORDER. Reverses + re-creates GL entries if posted.
 * Blocked for PartiallyReceived/Received/Closed.
 *
 * PATCH /api/purchasing/purchase-orders/[id]/link-work-order
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";

/**
 * PATCH /api/purchasing/purchase-orders/[id]/link-work-order
 * Request body: { workOrderId: string, reason: string }
 */
export const PATCH = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = (await req.json()) as Record<string, unknown>;
    const { workOrderId, reason } = body;

    if (!workOrderId || typeof workOrderId !== "string") {
      throw new BadRequestError("workOrderId is required");
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new BadRequestError("reason is required");
    }

    const result = await purchaseOrderWorkflowService.linkToWorkOrder(
      context.params.id,
      workOrderId,
      reason.trim(),
      context.serviceContext.userId,
      context.serviceContext,
    );

    return success(result, "PO linked to Work Order successfully");
  },
);
