/**
 * Master Cycle Count Item Verify API Route
 *
 * Endpoint for verifying and finalizing a count item.
 * POST - Verify/finalize count for an item
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
 * Params type for this route
 */
type VerifyRouteParams = {
  id: string;
  itemId: string;
};

/**
 * Request body schema
 */
const verifySchema = z.object({
  finalQuantity: z.number().min(0, "Final quantity must be non-negative"),
  notes: z.string().optional(),
  varianceReason: z.string().optional(),
});

type VerifyDTO = z.infer<typeof verifySchema>;

/**
 * POST /api/inventory/cycle-count/:id/items/:itemId/verify
 * Verify and finalize count for an item
 *
 * Used when variance is accepted or resolved. Sets the final quantity
 * and marks the item as VERIFIED.
 */
export const POST = createApiHandler(
  { hasParams: true, bodySchema: verifySchema },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<VerifyRouteParams, VerifyDTO>,
  ) => {
    try {
    const userId = context.serviceContext.userId;
    const { id, itemId } = await context.params;

    // For now, we'll use enterCount with the final quantity
    // The service will handle marking it as verified
    const item = await masterCycleCountService.enterCount(
      id,
      itemId,
      {
        countedQuantity: context.data.finalQuantity,
        notes: context.data.notes ?? null,
      },
      userId
    );

    return success(item, "Count item verified successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
