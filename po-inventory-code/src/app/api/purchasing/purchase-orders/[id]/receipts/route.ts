/**
 * Purchase Order Receipts API Route
 *
 * Get all receipts for a purchase order
 */

// Disable all caching — receipts change when items are received, reversed, or invoiced
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { lineItemReceivingService } from "@/services/purchasing/purchase-order";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/purchasing/purchase-orders/[id]/receipts
 * Get all receipts for a purchase order
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    try {
      const receipts = await lineItemReceivingService.getReceipts(
        context.serviceContext,
        context.params.id
      );

      return success(receipts, "Receipts retrieved successfully");
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
