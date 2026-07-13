/**
 * Master Cycle Count Approve API Route
 *
 * Endpoint for final approval of a cycle count.
 * POST - Approve cycle count for posting
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
  approveCycleCountSchema,
  ApproveCycleCountDTO,
} from "@/services/inventory/cycle-count/master-cycle-count.types";

/**
 * POST /api/inventory/cycle-count/:id/approve
 * Final approval of cycle count
 *
 * Approves the cycle count and transitions status to APPROVED, making it ready to post.
 * Only allowed when status is COUNT_COMPLETE or UNDER_REVIEW.
 */
export const POST = createApiHandler(
  {
    bodySchema: approveCycleCountSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, ApproveCycleCountDTO>,
  ) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const cycleCount = await masterCycleCountService.approveCycleCount(
      context.params.id,
      context.data,
      userId
    );

    return success(cycleCount, "Cycle count approved successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
