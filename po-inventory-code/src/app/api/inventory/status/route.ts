/**
 * Inventory Status API
 *
 * Returns inventory status summary with counts and metrics.
 * Used by Inventory Manager dashboard.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { InternalServerError } from "@/lib/api-errors";
export const GET = createApiHandler(
  { permission: "dashboard:read" },
  async (_req: NextRequest, _context: BaseApiContext) => {
    try {
    // PERFORMANCE: Use count for total, then limited batch for value/status calculations.
    // Loading ALL inventory items with ALL stock records causes OOM with large databases.
    const totalItems = await prisma.inventoryItem.count({ where: { isActive: true } });

    const items = await prisma.inventoryItem.findMany({
      where: {
        isActive: true,
      },
      select: {
        minQuantity: true,
        unitCost: true,
        stock: {
          select: {
            quantityOnHand: true,
            quantityReserved: true,
          },
        },
      },
      take: 20000,
    });

    // Calculate status metrics from the sample
    let inStockItems = 0;
    let lowStockItems = 0;
    let outOfStockItems = 0;
    let totalValue = 0;

    for (const item of items) {
      const totalOnHand = item.stock.reduce(
        (sum, s) => sum + Number(s.quantityOnHand),
        0
      );
      const totalReserved = item.stock.reduce(
        (sum, s) => sum + Number(s.quantityReserved),
        0
      );
      const totalAvailable = totalOnHand - totalReserved;
      const minQuantity = Number(item.minQuantity);
      const unitCost = Number(item.unitCost);

      // Calculate value
      totalValue += totalOnHand * unitCost;

      // Categorize status
      if (totalAvailable <= 0) {
        outOfStockItems++;
      } else if (totalAvailable <= minQuantity) {
        lowStockItems++;
      } else {
        inStockItems++;
      }
    }

    const response = success(
      {
        totalItems,
        inStockItems,
        lowStockItems,
        outOfStockItems,
        totalValue,
        statusBreakdown: {
          inStock: {
            count: inStockItems,
            percentage: totalItems > 0 ? (inStockItems / totalItems) * 100 : 0,
          },
          lowStock: {
            count: lowStockItems,
            percentage: totalItems > 0 ? (lowStockItems / totalItems) * 100 : 0,
          },
          outOfStock: {
            count: outOfStockItems,
            percentage:
              totalItems > 0 ? (outOfStockItems / totalItems) * 100 : 0,
          },
        },
      },
      "Inventory status retrieved successfully"
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
