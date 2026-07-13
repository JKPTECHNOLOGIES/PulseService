/**
 * Purchase Order Detail API Routes
 *
 * Individual purchase order CRUD endpoints.
 */

// Always run dynamically — PO line IDs change on every edit and must be fresh
export const dynamic = "force-dynamic";

import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
} from "@/lib/api-middleware-v2";
import { purchaseOrderService , purchaseOrderUpdateSchema } from "@/services/purchasing/purchase-order";
/**
 * GET /api/purchasing/purchase-orders/[id]
 * Get a single purchase order by ID
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  const purchaseOrder = await purchaseOrderService.getById(
    context.serviceContext,
    context.params.id
  );

  return success(purchaseOrder, "Purchase order retrieved successfully");
});

/**
 * PUT /api/purchasing/purchase-orders/[id]
 * Update a purchase order
 */
export const PUT = createPutHandler(
  purchaseOrderUpdateSchema,
  async (_req, context) => {
    const purchaseOrder = await purchaseOrderService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(purchaseOrder, "Purchase order updated successfully");
  }
);

/**
 * DELETE /api/purchasing/purchase-orders/[id]
 * Delete a purchase order
 */
export const DELETE = createDeleteHandler(async (_req, context) => {
  await purchaseOrderService.delete(context.serviceContext, context.params.id);

  return noContent();
});
