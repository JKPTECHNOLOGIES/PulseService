/**
 * Master Cycle Count Search API Route
 *
 * GET - Search items within a cycle count
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParams,
  parseQueryParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema
 */
const querySchema = z.object({
  q: z.string().min(1, "Search query is required"),
});

/**
 * GET /api/inventory/cycle-count/[id]/search
 * Search items by SKU, description, or bin location
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
    const id = context.params.id;
    const { q } = parseQueryParams(_req, querySchema);

    // Get all items and filter by search query
    const allItems = await masterCycleCountService.getCountItems(id);

    const searchLower = q.toLowerCase();
    const filteredItems = allItems.filter((item) => {
      return (
        item.inventoryItem.sku.toLowerCase().includes(searchLower) ||
        item.inventoryItem.description.toLowerCase().includes(searchLower) ||
        item.bin.toLowerCase().includes(searchLower)
      );
    });

    return success(
      filteredItems,
      `Found ${filteredItems.length} items matching "${q}"`
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
