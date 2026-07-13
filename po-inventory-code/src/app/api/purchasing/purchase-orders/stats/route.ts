/**
 * Purchase Order Statistics API Route
 *
 * GET /api/purchasing/purchase-orders/stats - Get comprehensive PO statistics
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success } from "@/lib/api-response";
import { createGetHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderStatisticsService } from "@/services/purchasing/purchase-order";
/**
 * GET /api/purchasing/purchase-orders/stats
 * Get comprehensive purchase order statistics
 */
export const GET = createGetHandler(async (req, context) => {
  const url = new URL(req.url);

  const startDateParam = url.searchParams.get("startDate");
  const endDateParam = url.searchParams.get("endDate");
  const supplierIdParam = url.searchParams.get("supplierId");

  const filters = {
    startDate: startDateParam ? new Date(startDateParam) : undefined,
    endDate: endDateParam ? new Date(endDateParam) : undefined,
    supplierId: supplierIdParam ?? undefined,
  };

  const stats = await purchaseOrderStatisticsService.getStats(
    context.serviceContext,
    filters
  );

  return success(stats, "Purchase order statistics retrieved successfully");
});
