/**
 * Inventory Stock Adjustment API Route
 *
 * POST /api/inventory/:id/adjust - Adjust stock levels
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory/inventory.service";
import {
  stockAdjustmentSchema,
  StockAdjustmentDTO,
} from "@/services/inventory/inventory.types";

/**
 * POST /api/inventory/:id/adjust
 * Adjust stock levels (increase or decrease)
 */
export const POST = createApiHandler(
  {
    bodySchema: stockAdjustmentSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, StockAdjustmentDTO>,
  ) => {
    // Adjust stock - let errors bubble up naturally
    const item = await inventoryService.adjustStock(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(item, "Stock adjusted successfully");
  }
);
