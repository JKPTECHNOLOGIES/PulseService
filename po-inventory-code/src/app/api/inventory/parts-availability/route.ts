/**
 * Parts Availability API Endpoint
 *
 * GET /api/inventory/parts-availability
 * Returns inventory parts availability and low stock items
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { inventoryAnalyticsService } from "@/services/analytics/inventory-analytics.service";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/inventory/parts-availability
 *
 * Get parts availability including low stock items
 *
 * Returns:
 * - 200: Parts availability data
 * - 401: Unauthorized
 * - 403: Forbidden (insufficient permissions)
 * - 500: Internal server error
 */
export const GET = createApiHandler(
  {
    permission: "dashboard:read",
  },
  async (_req: NextRequest, context: BaseApiContext) => {
    try {
    // Get low stock items and inventory levels
    const [lowStockItems, inventoryValue] = await Promise.all([
      inventoryAnalyticsService.getLowStockItems(context.serviceContext),
      inventoryAnalyticsService.getInventoryValue(context.serviceContext),
    ]);

    // Combine results
    const partsAvailability = {
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 20), // Top 20 most critical
      totalValue: inventoryValue.totalValue,
      totalItems: inventoryValue.totalItems,
    };

    // Return response with cache headers (5 minutes)
    const response = success(
      partsAvailability,
      "Parts availability retrieved successfully"
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
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
