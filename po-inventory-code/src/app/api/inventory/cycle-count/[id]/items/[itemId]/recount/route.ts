/**
 * Master Cycle Count Item Recount API Route
 *
 * Endpoint for re-counting an item that has variance.
 * POST - Re-count an item with variance
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
  recountItemSchema,
  RecountItemDTO,
} from "@/services/inventory/cycle-count/master-cycle-count.types";

/**
 * POST /api/inventory/cycle-count/:id/items/:itemId/recount
 * Re-count an item with variance
 *
 * This records the second count and determines the final quantity.
 * Only allowed for items with VARIANCE_DETECTED status.
 */
export const POST = createApiHandler(
  {
    bodySchema: recountItemSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<
      { id: string; itemId: string },
      RecountItemDTO
    >,
  ) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const item = await masterCycleCountService.recountItem(
      context.params.id,
      context.params.itemId,
      context.data,
      userId
    );

    return success(item, "Item recounted successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
