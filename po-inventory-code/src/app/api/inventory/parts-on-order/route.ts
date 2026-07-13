/**
 * Parts On Order API
 *
 * Returns inventory items that are currently on order (in pending purchase orders).
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
});

export const GET = createApiHandler(
  { permission: "dashboard:read" },
  async (req: NextRequest, _context: BaseApiContext) => {
    try {
    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const params = querySchema.parse({
      categoryId: searchParams.get("categoryId") ?? undefined,
    });

    // Get PO lines for pending/approved purchase orders
    const poLines = await prisma.pOLine.findMany({
      where: {
        inventoryItemId: {
          not: null,
        },
        purchaseOrder: {
          status: {
            in: ["Submitted", "Approved", "Ordered", "PartiallyReceived"],
          },
        },
        inventoryItem: params.categoryId
          ? {
              category: params.categoryId,
            }
          : undefined,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            category: true,
            unit: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            status: true,
            orderDate: true,
            expectedDate: true,
            supplier: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
      },
      orderBy: {
        purchaseOrder: {
          expectedDate: "asc",
        },
      },
    });

    // Group by inventory item
    const itemsMap = new Map<
      string,
      {
        itemId: string;
        sku: string;
        name: string;
        description: string;
        category: string | null;
        unit: string;
        totalOrdered: number;
        totalReceived: number;
        totalPending: number;
        orders: Array<{
          poId: string;
          poNumber: string;
          status: string;
          orderDate: Date;
          expectedDate: Date | null;
          quantity: number;
          receivedQuantity: number;
          pendingQuantity: number;
          supplier: {
            id: string;
            name: string;
            code: string | null;
          };
        }>;
      }
    >();

    for (const line of poLines) {
      if (!line.inventoryItem) continue;

      const itemId = line.inventoryItem.id;
      const quantity = Number(line.quantity);
      const receivedQuantity = Number(line.receivedQuantity);
      const pendingQuantity = quantity - receivedQuantity;

      if (!itemsMap.has(itemId)) {
        itemsMap.set(itemId, {
          itemId: line.inventoryItem.id,
          sku: line.inventoryItem.sku,
          name: line.inventoryItem.name ?? line.inventoryItem.description,
          description: line.inventoryItem.description,
          category: line.inventoryItem.category,
          unit: line.inventoryItem.unit,
          totalOrdered: 0,
          totalReceived: 0,
          totalPending: 0,
          orders: [],
        });
      }

      const item = itemsMap.get(itemId);
      if (!item) continue;
      item.totalOrdered += quantity;
      item.totalReceived += receivedQuantity;
      item.totalPending += pendingQuantity;

      item.orders.push({
        poId: line.purchaseOrder.id,
        poNumber: line.purchaseOrder.poNumber,
        status: line.purchaseOrder.status,
        orderDate: line.purchaseOrder.orderDate,
        expectedDate: line.purchaseOrder.expectedDate,
        quantity,
        receivedQuantity,
        pendingQuantity,
        supplier: line.purchaseOrder.supplier,
      });
    }

    const partsOnOrder = Array.from(itemsMap.values());

    const response = success(
      {
        items: partsOnOrder,
        total: partsOnOrder.length,
      },
      "Parts on order retrieved successfully"
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
