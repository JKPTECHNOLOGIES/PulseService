/**
 * Lead Time Calculation API Route
 *
 * Endpoint for calculating lead time for an inventory item.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

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
 * GET /api/inventory/items/[id]/lead-time
 * Calculate lead time for an inventory item
 * Optional query param: supplierId - to get lead time for specific supplier
 */
export const GET = createGetHandlerWithParams<RouteParams>(
  async (req, context) => {
    // Parse optional supplier ID from query params
    const url = new URL(req.url);
    const supplierId = url.searchParams.get("supplierId") ?? undefined;

    const leadTime = await inventoryItemSupplierService.calculateLeadTime(
      context.serviceContext,
      context.params.id,
      supplierId
    );

    return success(leadTime, "Lead time calculated successfully");
  }
);
