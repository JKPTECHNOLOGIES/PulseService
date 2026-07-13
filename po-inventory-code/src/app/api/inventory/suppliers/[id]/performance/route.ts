/**
 * Supplier Performance Metrics API Route
 *
 * Endpoint for getting performance metrics for a supplier across all items.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 300; // Cache for 300 seconds

import { success } from "@/lib/api-response";
import { createGetHandlerWithParams } from "@/lib/api-middleware-v2";
import { inventoryItemSupplierService } from "@/services/inventory";
/**
 * Route params type
 */
type RouteParams = {
  id: string;
};

/**
 * GET /api/inventory/suppliers/[id]/performance
 * Get performance metrics for a supplier
 */
export const GET = createGetHandlerWithParams<RouteParams>(
  async (_req, context) => {
    const performance =
      await inventoryItemSupplierService.getSupplierPerformance(
        context.serviceContext,
        context.params.id
      );

    return success(
      performance,
      "Supplier performance metrics retrieved successfully"
    );
  }
);
