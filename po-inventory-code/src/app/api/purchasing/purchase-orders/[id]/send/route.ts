/**
 * Purchase Order Send API Route
 *
 * Send a purchase order to the supplier.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
/**
 * POST /api/purchasing/purchase-orders/[id]/send
 * Send a purchase order to supplier
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    const purchaseOrder = await purchaseOrderWorkflowService.send(
      context.serviceContext,
      context.params.id
    );

    return success(
      purchaseOrder,
      "Purchase order sent to supplier successfully"
    );
  }
);
