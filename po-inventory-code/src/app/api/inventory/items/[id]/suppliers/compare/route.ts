/**
 * Supplier Comparison API Route
 *
 * Endpoint for comparing all suppliers for an inventory item.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 300; // Cache for 300 seconds

import { success } from "@/lib/api-response";
import { createGetHandlerWithParams } from "@/lib/api-middleware-v2";
import { inventoryItemSupplierService } from "@/services/inventory";
import { DEFAULT_SCORING_WEIGHTS } from "@/services/inventory/inventory-item-supplier.types";
/**
 * Route params type
 */
type RouteParams = {
  id: string;
};

/**
 * GET /api/inventory/items/[id]/suppliers/compare
 * Compare all suppliers for an inventory item with scoring
 */
export const GET = createGetHandlerWithParams<RouteParams>(
  async (req, context) => {
    // Parse optional scoring weights from query params
    const url = new URL(req.url);
    const weights = {
      costWeight: parseFloat(
        url.searchParams.get("costWeight") ??
          String(DEFAULT_SCORING_WEIGHTS.costWeight),
      ),
      leadTimeWeight: parseFloat(
        url.searchParams.get("leadTimeWeight") ??
          String(DEFAULT_SCORING_WEIGHTS.leadTimeWeight),
      ),
      onTimeRateWeight: parseFloat(
        url.searchParams.get("onTimeRateWeight") ??
          String(DEFAULT_SCORING_WEIGHTS.onTimeRateWeight),
      ),
      qualityWeight: parseFloat(
        url.searchParams.get("qualityWeight") ??
          String(DEFAULT_SCORING_WEIGHTS.qualityWeight),
      ),
      recencyWeight: parseFloat(
        url.searchParams.get("recencyWeight") ??
          String(DEFAULT_SCORING_WEIGHTS.recencyWeight),
      ),
    };

    const comparison = await inventoryItemSupplierService.compareSuppliers(
      context.serviceContext,
      context.params.id,
      weights
    );

    return success(comparison, "Supplier comparison completed successfully");
  }
);
