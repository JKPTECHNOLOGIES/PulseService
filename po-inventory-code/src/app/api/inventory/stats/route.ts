/**
 * Inventory Statistics API Route
 *
 * Endpoint for retrieving inventory statistics and metrics.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { createGetHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { inventoryService } from "@/services/inventory";
/**
 * GET /api/inventory/stats
 * Get inventory statistics including totals, values, and category breakdown
 */
export const GET = createGetHandler(async (_req, context) => {
  const stats = await inventoryService.getStats(context.serviceContext);
  return success(stats, "Inventory statistics retrieved successfully");
});
