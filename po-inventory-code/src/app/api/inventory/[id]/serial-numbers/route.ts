/**
 * API Route: Get Available Serial Numbers for Inventory Item
 * 
 * GET /api/inventory/[id]/serial-numbers
 * Returns available repairable items (serial numbers) for the specified inventory item
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandlerWithParams, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";
import { RepairableStatus } from "@prisma/client";

export const GET = createGetHandlerWithParams(
  async (request: NextRequest, context: ApiContextWithParams) => {
    const inventoryItemId = context.params.id;
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status");

    // Get the inventory item to check if it's repairable
    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: {
        id: true,
        sku: true,
        description: true,
        isRepairable: true,
      },
    });

    if (!inventoryItem) {
      throw new NotFoundError("Inventory item not found");
    }

    // If not a repairable item, return empty array
    if (!inventoryItem.isRepairable) {
      return success({
        data: [],
        isRepairable: false,
      });
    }

    // Build where clause based on status filter
    const whereClause: {
      inventoryItemId: string;
      status?: RepairableStatus | { notIn: RepairableStatus[] };
    } = {
      inventoryItemId,
    };

    if (statusFilter) {
      // If specific status requested, filter by that status
      whereClause.status = statusFilter as RepairableStatus;
    } else {
      // Otherwise, exclude RETIRED and SCRAPPED
      whereClause.status = {
        notIn: [RepairableStatus.RETIRED, RepairableStatus.SCRAPPED],
      };
    }

    // Get repairable items (serial numbers)
    const repairableItems = await prisma.repairableItem.findMany({
      where: whereClause,
      select: {
        id: true,
        serialNumber: true,
        condition: true,
        status: true,
        currentLocation: true,
        purchaseDate: true,
        lastRepairDate: true,
        repairCount: true,
        notes: true,
      },
      orderBy: {
        serialNumber: "asc",
      },
    });


    return success({
      data: repairableItems,
      isRepairable: true,
      totalAvailable: repairableItems.length,
    });
  }
);
