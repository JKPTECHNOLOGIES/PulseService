/**
 * Multi-Bin Stock Query API Route
 *
 * GET /api/inventory/[id]/bins?storeId=xxx - Get all bins for an item at a store
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success } from "@/lib/api-response";
import { createApiHandler, parseQueryParams } from "@/lib/api-middleware-v2";
import { inventoryStockService } from "@/services/inventory/stock";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
const querySchema = z.object({
  storeId: z.string().uuid("Store ID must be a valid UUID"),
});

/**
 * GET /api/inventory/[id]/bins
 * Get multi-bin stock breakdown for an inventory item at a specific store
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    try {
    const inventoryItemId = context.params.id;
    const { storeId } = parseQueryParams(_req, querySchema);

    const multiBinStock = await inventoryStockService.getMultiBinStock(
      inventoryItemId,
      storeId
    );

    return success(multiBinStock, "Multi-bin stock retrieved successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
