/**
 * Purchase Order Close API Route
 *
 * Close a purchase order.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";

/**
 * POST /api/purchasing/purchase-orders/[id]/close
 * Close a purchase order
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = await req.json().catch(() => ({})) as { reason?: string };
    const reason = body.reason;

    const purchaseOrder = await purchaseOrderWorkflowService.close(
      context.serviceContext,
      context.params.id,
      reason,
    );

    return success(purchaseOrder, "Purchase order closed successfully");
  },
);
