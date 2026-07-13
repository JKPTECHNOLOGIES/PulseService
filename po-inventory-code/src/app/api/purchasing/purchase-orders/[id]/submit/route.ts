/**
 * Purchase Order Submit API Route
 *
 * Submit a purchase order for approval.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { ApiError, InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/purchase-orders/[id]/submit
 * Submit a purchase order for approval
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    try {
      const purchaseOrder = await purchaseOrderWorkflowService.submit(
        context.serviceContext,
        context.params.id
      );

      return success(purchaseOrder, "Purchase order submitted successfully");
    } catch (error) {
      // Re-throw known API errors (business logic, validation, etc.) as-is
      if (error instanceof ApiError) {
        throw error;
      }
      // Wrap truly unexpected errors as InternalServerError
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
