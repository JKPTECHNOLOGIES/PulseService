/**
 * PATCH /api/inventory/stock/[id]
 * Update a stock record (e.g., rename the bin)
 *
 * DELETE /api/inventory/stock/[id]
 * Delete a stock record (bin location)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiHandler, ApiContextWithParams, ApiContextWithParamsAndData } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { BadRequestError, NotFoundError } from "@/lib/api-errors";
import { CommonPermissions } from "@/types/permissions";

const stockUpdateSchema = z.object({
  bin: z.string().min(1, "Bin name is required").max(50),
});

export const PATCH = createApiHandler(
  {
    hasParams: true,
    permission: CommonPermissions.UPDATE_INVENTORY,
    bodySchema: stockUpdateSchema,
  },
  async (_req: NextRequest, context: ApiContextWithParamsAndData<{ id: string }, z.infer<typeof stockUpdateSchema>>) => {
    const stockId = context.params.id;

    if (!stockId) {
      throw new BadRequestError("Stock ID is required");
    }

    const body = context.data;

    // Find the stock record
    const stockRecord = await prisma.inventoryStock.findUnique({
      where: { id: stockId },
      include: { store: { select: { name: true } } },
    });

    if (!stockRecord) {
      throw new NotFoundError("Stock record not found");
    }

    // Check for duplicate bin name in the same store for the same item
    const existing = await prisma.inventoryStock.findFirst({
      where: {
        inventoryItemId: stockRecord.inventoryItemId,
        storeId: stockRecord.storeId,
        bin: body.bin,
        NOT: { id: stockId },
      },
    });

    if (existing) {
      throw new BadRequestError(
        `Bin "${body.bin}" already exists in ${stockRecord.store.name}`
      );
    }

    const updated = await prisma.inventoryStock.update({
      where: { id: stockId },
      data: { bin: body.bin },
    });

    return success(
      updated,
      `Bin renamed to "${body.bin}" in ${stockRecord.store.name}`
    );
  }
);

export const DELETE = createApiHandler(
  {
    hasParams: true,
    permission: CommonPermissions.DELETE_INVENTORY,
  },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const stockId = context.params.id;

    if (!stockId) {
      throw new BadRequestError("Stock ID is required");
    }

    // Find the stock record
    const stockRecord = await prisma.inventoryStock.findUnique({
      where: { id: stockId },
      include: {
        inventoryItem: {
          select: {
            sku: true,
            description: true,
          },
        },
        store: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!stockRecord) {
      throw new NotFoundError("Stock record not found");
    }

    // Validate that the bin has 0 quantity (convert Decimal to number for comparison)
    const qtyOnHand = Number(stockRecord.quantityOnHand);
    const qtyReserved = Number(stockRecord.quantityReserved);

    if (qtyOnHand !== 0 || qtyReserved !== 0) {
      throw new BadRequestError(
        `Cannot delete bin with stock. Bin has ${qtyOnHand} on hand and ${qtyReserved} reserved.`
      );
    }

    // Delete the stock record
    await prisma.inventoryStock.delete({
      where: { id: stockId },
    });

    const binName = stockRecord.bin;
    return success(
      { deleted: true },
      `Bin "${binName}" deleted successfully from ${stockRecord.store.name}`
    );
  }
);
