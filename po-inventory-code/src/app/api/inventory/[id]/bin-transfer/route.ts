/**
 * Bin Transfer API Route
 *
 * POST /api/inventory/[id]/bin-transfer - Transfer inventory between bins
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { inventoryStockService } from "@/services/inventory/stock";
import {
  binTransferRequestSchema,
  BinTransferRequestDTO,
} from "@/services/inventory/stock/bin-transfer.types";

/**
 * POST /api/inventory/[id]/bin-transfer
 * Transfer inventory between bins within the same store
 */
export const POST = createApiHandler<BinTransferRequestDTO>(
  { bodySchema: binTransferRequestSchema, hasParams: true },
  async (_req, context) => {
    const inventoryItemId = context.params.id;
    const { storeId, fromBin, toBin, quantity, notes } = context.data;

    const result = await inventoryStockService.transferBin({
      context: context.serviceContext,
      inventoryItemId,
      storeId,
      fromBin,
      toBin,
      quantity,
      userId: context.serviceContext.userId,
      userName: context.serviceContext.userName,
      notes: notes ?? undefined,
    });

    return success(result, "Inventory transferred between bins successfully");
  }
);
