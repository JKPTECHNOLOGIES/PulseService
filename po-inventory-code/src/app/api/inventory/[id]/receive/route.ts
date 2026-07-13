/**
 * Inventory Stock Receive API Route
 *
 * POST /api/inventory/:id/receive - Receive stock from purchase order
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
  stockReceiveSchema,
  StockReceiveDTO,
} from "@/services/inventory/inventory.types";

/**
 * POST /api/inventory/:id/receive
 * Receive stock from purchase order
 */
export const POST = createApiHandler(
  {
    bodySchema: stockReceiveSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, StockReceiveDTO>,
  ) => {
    try {
    // Receive stock
    const item = await inventoryService.receiveStock(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(item, "Stock received successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
