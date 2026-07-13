/**
 * Purchase Order Approve API Route
 *
 * Approve a purchase order.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";

/**
 * POST /api/purchasing/purchase-orders/[id]/approve
 * Approve a purchase order
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    const purchaseOrder = await purchaseOrderWorkflowService.approve(
      context.serviceContext,
      context.params.id,
      context.serviceContext.userId
    );

    return success(purchaseOrder, "Purchase order approved successfully");
  }
);
