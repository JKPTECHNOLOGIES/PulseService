/**
 * Stock-Out Items API
 *
 * Returns items that are currently out of stock (quantity = 0).
 * Used by Inventory Manager dashboard.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
const querySchema = z.object({
  categoryId: z.string().optional(),
  storeId: z.string().optional(),
});

export const GET = createApiHandler(
  { permission: "dashboard:read" },
  async (req: NextRequest, _context: BaseApiContext) => {
    try {
    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const params = querySchema.parse({
      categoryId: searchParams.get("categoryId") ?? undefined,
      storeId: searchParams.get("storeId") ?? undefined,
    });

    // Get stock-out items
    const items = await prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        category: params.categoryId ?? undefined,
        stock: {
          some: {
            storeId: params.storeId ?? undefined,
            quantityOnHand: {
              lte: 0,
            },
          },
        },
      },
      include: {
        stock: {
          where: {
            storeId: params.storeId ?? undefined,
            quantityOnHand: {
              lte: 0,
            },
          },
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: {
        sku: "asc",
      },
    });

    // Transform to response format
    const stockOutItems = items.map((item) => ({
      itemId: item.id,
      sku: item.sku,
      name: item.name ?? item.description,
      description: item.description,
      category: item.category,
      unit: item.unit,
      minQuantity: Number(item.minQuantity),
      maxQuantity: Number(item.maxQuantity),
      defaultSupplier: item.defaultSupplier
        ? {
            id: item.defaultSupplier.id,
            name: item.defaultSupplier.name,
            code: item.defaultSupplier.code,
          }
        : null,
      locations: item.stock.map((s) => ({
        storeId: s.storeId,
        storeName: s.store.name,
        storeCode: s.store.code,
        quantityOnHand: Number(s.quantityOnHand),
      })),
    }));

    const response = success(
      {
        items: stockOutItems,
        total: stockOutItems.length,
      },
      "Stock-out items retrieved successfully"
    );
    response.headers.set("Cache-Control", "public, s-maxage=60");
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
