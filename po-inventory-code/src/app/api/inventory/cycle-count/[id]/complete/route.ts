/**
 * Master Cycle Count Complete API Route
 *
 * Endpoint for marking a cycle count as complete.
 * POST - Complete the count phase
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
 * POST /api/inventory/cycle-count/:id/complete
 * Mark cycle count as complete
 *
 * Validates that all items are counted and transitions status to COUNT_COMPLETE.
 * Only allowed when status is IN_PROGRESS and all items have been counted.
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const cycleCount = await masterCycleCountService.completeCount(
      context.params.id,
      userId
    );

    return success(cycleCount, "Cycle count completed successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
