/**
 * Master Cycle Count Submit API Route
 *
 * Endpoint for submitting a cycle count for review.
 * POST - Submit cycle count for manager review
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
 * POST /api/inventory/cycle-count/:id/submit
 * Submit cycle count for review
 *
 * Transitions status from COUNT_COMPLETE to UNDER_REVIEW.
 * Only allowed when status is COUNT_COMPLETE.
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const cycleCount = await masterCycleCountService.submitForReview(
      context.params.id,
      userId
    );

    return success(cycleCount, "Cycle count submitted for review successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
