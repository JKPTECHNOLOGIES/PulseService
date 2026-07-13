/**
 * Inventory Stock Count API Route
 *
 * POST /api/inventory/:id/count - Perform physical stock count
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory/inventory.service";
import { InternalServerError } from "@/lib/api-errors";
import {
  stockCountSchema,
  StockCountDTO,
} from "@/services/inventory/inventory.types";

/**
 * POST /api/inventory/:id/count
 * Perform physical stock count
 */
export const POST = createApiHandler(
  {
    bodySchema: stockCountSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, StockCountDTO>,
  ) => {
    try {
    // Perform stock count
    const item = await inventoryService.performStockCount(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(item, "Stock count completed successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
