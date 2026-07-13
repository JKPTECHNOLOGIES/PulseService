/**
 * Purchase Order Reject API Route
 *
 * Reject a purchase order and return it to draft status.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";

/**
 * POST /api/purchasing/purchase-orders/[id]/reject
 * Reject a purchase order
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = await req.json() as Record<string, unknown>;
    const { reason } = body;

    if (!reason || typeof reason !== "string") {
      throw new BadRequestError("Rejection reason is required");
    }

    const purchaseOrder = await purchaseOrderWorkflowService.reject(
      context.serviceContext,
      context.params.id,
      reason
    );

    return success(purchaseOrder, "Purchase order rejected successfully");
  }
);
