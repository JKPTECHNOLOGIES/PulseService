/**
 * Master Cycle Count Review API Route
 *
 * Endpoint for manager review of a cycle count.
 * POST - Review and approve/reject cycle count
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
import {
  reviewCycleCountSchema,
  ReviewCycleCountDTO,
} from "@/services/inventory/cycle-count/master-cycle-count.types";

/**
 * POST /api/inventory/cycle-count/:id/review
 * Manager review of cycle count
 *
 * Reviews the cycle count and either approves (transitions to APPROVED) or
 * rejects (returns to IN_PROGRESS for corrections).
 * Only allowed when status is UNDER_REVIEW.
 */
export const POST = createApiHandler(
  {
    bodySchema: reviewCycleCountSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, ReviewCycleCountDTO>,
  ) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const cycleCount = await masterCycleCountService.reviewCycleCount(
      context.params.id,
      context.data,
      userId
    );

    const message = context.data.approved
      ? "Cycle count approved successfully"
      : "Cycle count rejected and returned for corrections";

    return success(cycleCount, message);
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
