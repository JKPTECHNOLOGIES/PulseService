// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandlerWithParams, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
// Helper to convert Prisma Decimal to number
const toNumber = (value: Prisma.Decimal | number): number => {
  if (typeof value === 'number') return value;
  return value.toNumber();
};

export const GET = createGetHandlerWithParams(
  async (_request: NextRequest, context: ApiContextWithParams) => {
    // Fetch all PO lines for this inventory item
    const poLines = await prisma.pOLine.findMany({
      where: {
        inventoryItemId: context.params.id,
      },
      include: {
        purchaseOrder: {
          include: {
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
        createdAt: "desc",
      },
    });


    // Convert Decimals to numbers for JSON serialization
    const serializedPoLines = poLines.map(line => ({
      ...line,
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPrice),
      totalPrice: toNumber(line.totalPrice),
      receivedQuantity: toNumber(line.receivedQuantity),
      purchaseOrder: {
        ...line.purchaseOrder,
        totalAmount: toNumber(line.purchaseOrder.totalAmount),
      },
    }));

    // Calculate statistics
    const stats = {
      totalOrdered: poLines.reduce((sum, line) => sum + toNumber(line.quantity), 0),
      totalReceived: poLines.reduce((sum, line) => sum + toNumber(line.receivedQuantity), 0),
      totalValue: poLines.reduce((sum, line) => sum + toNumber(line.totalPrice), 0),
      uniquePOs: new Set(poLines.map(line => line.purchaseOrderId)).size,
    };

    return success({
      poLines: serializedPoLines,
      stats,
    });
  }
);
