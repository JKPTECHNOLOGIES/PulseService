/**
 * Purchase Order Receiving History API Route
 *
 * Get receiving history for a purchase order.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderReceivingService } from "@/services/purchasing/purchase-order";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/purchasing/purchase-orders/[id]/receiving-history
 * Get receiving history for a purchase order
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    try {
    const history = await purchaseOrderReceivingService.getReceivingHistory(
      context.serviceContext,
      context.params.id
    );

    return success(history, "Receiving history retrieved successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
