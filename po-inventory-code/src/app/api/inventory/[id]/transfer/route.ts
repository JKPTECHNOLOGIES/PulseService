/**
 * Inventory Stock Transfer API Route
 *
 * POST /api/inventory/:id/transfer - Transfer stock between stores
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory/inventory.service";
import {
  stockTransferSchema,
  StockTransferDTO,
} from "@/services/inventory/inventory.types";

/**
 * POST /api/inventory/:id/transfer
 * Transfer stock between stores
 */
export const POST = createApiHandler(
  {
    bodySchema: stockTransferSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, StockTransferDTO>,
  ) => {
    // Transfer stock
    const item = await inventoryService.transferStock(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(item, "Stock transferred successfully");
  }
);
