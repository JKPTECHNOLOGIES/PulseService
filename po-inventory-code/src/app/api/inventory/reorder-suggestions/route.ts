/**
 * Reorder Suggestions API
 *
 * Returns intelligent reorder suggestions based on stock levels and usage patterns.
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

    // Get low stock items (which need reordering)
    const lowStockItems = await inventoryAnalyticsService.getLowStockItems(
      context.serviceContext,
      params
    );

    // Transform to reorder suggestions format
    const suggestions = lowStockItems.map((item) => ({
      itemId: item.itemId,
      sku: item.sku,
      name: item.name,
      description: item.description,
      category: item.category,
      unit: item.unit,
      currentStock: item.totalOnHand,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      suggestedQuantity: item.maxQuantity, // Order enough to reach maxQuantity
      urgency:
        item.percentageOfMinQuantity < 50
          ? "high"
          : item.percentageOfMinQuantity < 75
            ? "medium"
            : "low",
      daysUntilStockout: item.daysUntilStockout,
      defaultSupplier: item.defaultSupplier,
      estimatedCost:
        item.maxQuantity *
        (item.totalOnHand > 0 ? item.totalOnHand / item.maxQuantity : 0), // Rough estimate
      locations: item.locations,
    }));

    // Sort by urgency (most urgent first)
    suggestions.sort((a, b) => {
      const urgencyOrder = { high: 0, medium: 1, low: 2 };
      return (
        urgencyOrder[a.urgency as keyof typeof urgencyOrder] -
        urgencyOrder[b.urgency as keyof typeof urgencyOrder]
      );
    });

    const response = success(
      {
        suggestions,
        total: suggestions.length,
        summary: {
          highUrgency: suggestions.filter((s) => s.urgency === "high").length,
          mediumUrgency: suggestions.filter((s) => s.urgency === "medium")
            .length,
          lowUrgency: suggestions.filter((s) => s.urgency === "low").length,
        },
      },
      "Reorder suggestions retrieved successfully"
    );
    response.headers.set("Cache-Control", "public, s-maxage=120");
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
