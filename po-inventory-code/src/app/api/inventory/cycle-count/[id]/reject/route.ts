/**
 * Master Cycle Count Reject API Route
 *
 * Endpoint for rejecting a cycle count (manager action).
 * POST - Reject the count and send back for recount
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Request body schema
 */
const rejectSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required"),
  itemsToRecount: z.array(z.string().uuid()).optional(),
});

type RejectDTO = z.infer<typeof rejectSchema>;

/**
 * POST /api/inventory/cycle-count/:id/reject
 * Reject cycle count and send back for recount
 *
 * Manager can reject a count that is under review, sending it back to IN_PROGRESS
 * status with specific items flagged for recount.
 */
export const POST = createApiHandler(
  { hasParams: true, bodySchema: rejectSchema },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, RejectDTO>,
  ) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service to reject the count
    const cycleCount = await masterCycleCountService.reviewCycleCount(
      context.params.id,
      {
        approved: false,
        notes: context.data.reason,
      },
      userId
    );

    return success(
      cycleCount,
      "Cycle count rejected and sent back for recount"
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
