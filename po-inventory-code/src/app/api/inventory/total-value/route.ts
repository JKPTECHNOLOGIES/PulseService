/**
 * Total Inventory Value API
 *
 * Returns total inventory value and breakdown by category/location.
 * Used by Inventory Manager dashboard.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { inventoryAnalyticsService } from "@/services/analytics/inventory-analytics.service";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
const querySchema = z.object({
  categoryId: z.string().optional(),
  storeId: z.string().optional(),
});

export const GET = createApiHandler(
  { permission: "dashboard:read" },
  async (req: NextRequest, context: BaseApiContext) => {
    try {
    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const params = querySchema.parse({
      categoryId: searchParams.get("categoryId") ?? undefined,
      storeId: searchParams.get("storeId") ?? undefined,
    });

    // Get inventory value
    const value = await inventoryAnalyticsService.getInventoryValue(
      context.serviceContext,
      params
    );

    const response = success(value, "Inventory value retrieved successfully");
    response.headers.set("Cache-Control", "public, s-maxage=300");
    return response;
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
