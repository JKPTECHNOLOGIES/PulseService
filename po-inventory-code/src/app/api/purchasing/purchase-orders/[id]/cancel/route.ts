/**
 * Purchase Order Cancel API Route
 *
 * Cancel a purchase order.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";

/**
 * POST /api/purchasing/purchase-orders/[id]/cancel
 * Cancel a purchase order
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = await req.json() as Record<string, unknown>;
    const { reason } = body;

    if (!reason || typeof reason !== "string") {
      throw new BadRequestError("Cancellation reason is required");
    }

    const purchaseOrder = await purchaseOrderWorkflowService.cancel(
      context.serviceContext,
      context.params.id,
      reason
    );

    return success(purchaseOrder, "Purchase order cancelled successfully");
  }
);
