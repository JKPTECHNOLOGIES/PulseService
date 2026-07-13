/**
 * Inventory Single Resource API Routes
 *
 * Endpoints for individual inventory item operations (GET, PUT, DELETE).
 */

// Disable caching for GET requests to show real-time stock/reservation data
export const dynamic = "force-dynamic";
export const revalidate = 0; // No cache - always fetch fresh data

import { NextRequest } from "next/server";
import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory";
import {
  inventoryItemUpdateSchema,
  InventoryItemUpdateDTO,
} from "@/services/inventory/inventory.types";
import { RepairableItem, Equipment, Location } from "@prisma/client";

/**
 * GET /api/inventory/:id
 * Get a single inventory item by ID
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    // Call service
    const item = await inventoryService.getById(
      context.serviceContext,
      context.params.id
    );

    // Fetch repairable items for this inventory item if it's a repairable item
    type RepairableItemWithRelations = RepairableItem & {
      equipment: (Equipment & { location: Location | null }) | null;
    };
    
    let repairableItems: RepairableItemWithRelations[] = [];
    let repairableItemsCount = 0;
    const repairableItemsByStatus = {
      AVAILABLE: 0,
      IN_USE: 0,
      IN_REPAIR: 0,
      REPAIR_COMPLETE: 0,
      RETIRED: 0,
    };
    
    if (item.isRepairable) {
      const { prisma } = await import("@/lib/prisma");
      repairableItems = await prisma.repairableItem.findMany({
        where: {
          inventoryItemId: context.params.id,
        },
        include: {
          equipment: {
            include: {
              location: true,
            },
          },
        },
        orderBy: {
          serialNumber: "asc",
        },
      });
      
      // Count repairable items by status
      repairableItemsCount = repairableItems.length;
      repairableItems.forEach((ri) => {
        // Group all repair statuses together
        if (ri.status === 'IN_REPAIR_INTERNAL' || ri.status === 'IN_REPAIR_EXTERNAL') {
          repairableItemsByStatus.IN_REPAIR++;
        } else if (ri.status === 'REPAIR_COMPLETE') {
          repairableItemsByStatus.REPAIR_COMPLETE++;
        } else if (ri.status in repairableItemsByStatus) {
          repairableItemsByStatus[ri.status as keyof typeof repairableItemsByStatus]++;
        }
      });
    }

    return success(
      {
        ...item,
        repairableItems,
        repairableItemsCount,
        repairableItemsByStatus,
      },
      "Inventory item retrieved successfully"
    );
  }
);

/**
 * PUT /api/inventory/:id
 * Update an inventory item
 */
export const PUT = createPutHandler(
  inventoryItemUpdateSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<
      { id: string },
      InventoryItemUpdateDTO
    >,
  ) => {
    // Call service
    const item = await inventoryService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(item, "Inventory item updated successfully");
  }
);

/**
 * DELETE /api/inventory/:id
 * Delete an inventory item
 */
export const DELETE = createDeleteHandler(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    // Call service
    await inventoryService.delete(context.serviceContext, context.params.id);

    return noContent();
  }
);
