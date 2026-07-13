/**
 * Master Cycle Count Item Count API Route
 *
 * Endpoint for entering or updating a count for a specific item.
 * POST - Enter/update count for an item
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
  countItemInputSchema,
  CountItemInputDTO,
} from "@/services/inventory/cycle-count/master-cycle-count.types";

/**
 * POST /api/inventory/cycle-count/:id/items/:itemId/count
 * Enter or update count for a specific item
 *
 * This records the first count, calculates variance, and determines if recount is needed.
 */
export const POST = createApiHandler(
  {
    bodySchema: countItemInputSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<
      { id: string; itemId: string },
      CountItemInputDTO
    >,
  ) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const item = await masterCycleCountService.enterCount(
      context.params.id,
      context.params.itemId,
      context.data,
      userId
    );

    return success(item, "Count entered successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
