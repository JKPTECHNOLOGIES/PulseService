/**
 * Purchase Order Receive Items API Route
 *
 * Receive items from a purchase order.
 *
 * UPDATED: Now uses lineItemReceivingService to properly create POLineReceipt records
 * required by the RMA system.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { lineItemReceivingService } from "@/services/purchasing/purchase-order";
import { batchReceiveItemsSchema } from "@/services/purchasing/purchase-order/line-item.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/purchase-orders/[id]/receive
 * Receive items from a purchase order
 */
export const POST = createApiHandler(
  { hasParams: true, bodySchema: batchReceiveItemsSchema },
  async (_req, context) => {
    try {
    // Body is already parsed and validated by createApiHandler middleware
    // Available in context.data - do NOT call req.json() again
    const body = context.data;

    // Use the new lineItemReceivingService which creates POLineReceipt records
    const result = await lineItemReceivingService.batchReceive(
      context.serviceContext,
      context.params.id,
      body
    );

    return success(result, "Items received successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
