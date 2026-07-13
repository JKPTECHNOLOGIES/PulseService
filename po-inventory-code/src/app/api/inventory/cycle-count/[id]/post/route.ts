/**
 * Master Cycle Count Post API Route
 *
 * Endpoint for posting cycle count adjustments to inventory.
 * POST - Post adjustments to inventory
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/inventory/cycle-count/:id/post
 * Post cycle count adjustments to inventory
 *
 * This is the final step that creates inventory adjustments and transactions
 * for all items with variances. Updates actual inventory quantities.
 * Only allowed when status is APPROVED.
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const cycleCount = await masterCycleCountService.postCycleCount(
      context.params.id,
      userId
    );

    return success(
      cycleCount,
      "Cycle count posted successfully. Adjustments applied to inventory."
    );
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
