/**
 * Inventory Monitor Service
 *
 * Automated service for monitoring inventory levels and creating requisitions
 * when items fall below minimum quantity (MIN/MAX reordering).
 *
 * This service is designed to be run periodically via cron jobs.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/services/base/types";

import { RequisitionStatus } from "@/services/purchasing/requisition/requisition.types";

/**
 * Result of inventory monitoring check
 */
export interface InventoryMonitorResult {
  itemsChecked: number;
  itemsBelowReorder: number;
  requisitionsCreated: number;
  errors: Array<{
    itemId: string;
    sku: string;
    error: string;
  }>;
}

/**
 * Item that needs reordering
 */
interface ReorderItem {
  id: string;
  sku: string;
  description: string;
  category: string | null;
  currentQuantity: number;
  minQuantity: number;
  maxQuantity: number;
  defaultSupplierId: string | null;
  unitCost: number;
}

/**
 * Inventory Monitor Service Class
 *
 * Monitors inventory levels and automatically creates requisitions
 * for items that fall below their reorder points.
 */
class InventoryMonitorService {
  constructor(private prismaClient: PrismaClient) {}

  /**
   * Check all inventory items and create requisitions for items below minimum quantity
   *
   * @param context - Service context (system user for automated operations)
   * @returns Monitor result with statistics
   */
  async checkAndReorder(
    context: ServiceContext,
  ): Promise<InventoryMonitorResult> {
    const result: InventoryMonitorResult = {
      itemsChecked: 0,
      itemsBelowReorder: 0,
      requisitionsCreated: 0,
      errors: [],
    };

    try {
      // PERFORMANCE: only the fields needed to detect "below minimum".
      const items = await this.prismaClient.inventoryItem.findMany({
        where: { isActive: true },
        take: 50000,
        select: {
          id: true,
          sku: true,
          minQuantity: true,
          stock: { select: { quantityOnHand: true } },
        },
      });

      result.itemsChecked = items.length;

      // Delegate every reorder to the CANONICAL entry point so the
      // pipeline-aware quantity formula, dedup, supplier resolution, budget
      // classification and auto-submit all live in ONE place. (Previously this
      // used a divergent `max - currentQty` formula that ignored the inbound
      // PO/req pipeline.) Dynamic import avoids the reorder.service ↔
      // inventory.service import cycle.
      const { inventoryReorderService } =
        await import("@/services/inventory/reorder.service");

      for (const item of items) {
        const totalQuantity = item.stock.reduce(
          (sum, s) => sum + Number(s.quantityOnHand),
          0,
        );
        if (totalQuantity > Number(item.minQuantity)) continue;
        result.itemsBelowReorder++;
        try {
          const created = await inventoryReorderService.createReorderForItem(
            context,
            { inventoryItemId: item.id, source: "MONITOR" },
          );
          if (created) result.requisitionsCreated++;
        } catch (error) {
          result.errors.push({
            itemId: item.id,
            sku: item.sku,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      return result;
    } catch (error) {
      throw new Error(
        `Inventory monitor check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get items currently below minimum quantity
   *
   * @param context - Service context
   * @returns Array of items below minimum quantity
   */
  async getItemsBelowReorder(_context: ServiceContext): Promise<ReorderItem[]> {
    // PERFORMANCE: Only select fields needed for reorder calculation
    const items = await this.prismaClient.inventoryItem.findMany({
      where: { isActive: true },
      take: 50000,
      select: {
        id: true,
        sku: true,
        description: true,
        category: true,
        minQuantity: true,
        maxQuantity: true,
        unitCost: true,
        defaultSupplierId: true,
        stock: {
          select: { quantityOnHand: true },
        },
      },
    });

    const itemsBelowReorder: ReorderItem[] = [];

    for (const item of items) {
      const totalQuantity = item.stock.reduce(
        (sum, s) => sum + Number(s.quantityOnHand),
        0,
      );

      const minQuantity = Number(item.minQuantity);

      if (totalQuantity <= minQuantity) {
        itemsBelowReorder.push({
          id: item.id,
          sku: item.sku,
          description: item.description,
          category: item.category,
          currentQuantity: totalQuantity,
          minQuantity: minQuantity,
          maxQuantity: Number(item.maxQuantity),
          defaultSupplierId: item.defaultSupplierId,
          unitCost: Number(item.unitCost),
        });
      }
    }

    return itemsBelowReorder;
  }

  /**
   * Get monitoring statistics
   *
   * @param context - Service context
   * @returns Statistics about inventory monitoring
   */
  async getStats(context: ServiceContext): Promise<{
    totalActiveItems: number;
    itemsBelowReorder: number;
    itemsWithoutSupplier: number;
    pendingRequisitions: number;
  }> {
    const [totalActiveItems, itemsBelowReorder, pendingRequisitions] =
      await Promise.all([
        this.prismaClient.inventoryItem.count({
          where: { isActive: true },
        }),
        this.getItemsBelowReorder(context),
        this.prismaClient.requisition.count({
          where: {
            status: {
              in: [
                RequisitionStatus.DRAFT,
                RequisitionStatus.SUBMITTED,
                RequisitionStatus.APPROVED,
              ],
            },
          },
        }),
      ]);

    const itemsWithoutSupplier = itemsBelowReorder.filter(
      (item) => !item.defaultSupplierId,
    ).length;

    return {
      totalActiveItems,
      itemsBelowReorder: itemsBelowReorder.length,
      itemsWithoutSupplier,
      pendingRequisitions,
    };
  }
}

// Export singleton instance
const globalForInventoryMonitor = globalThis as unknown as {
  inventoryMonitorService: InventoryMonitorService | undefined;
};
export const inventoryMonitorService =
  globalForInventoryMonitor.inventoryMonitorService ??
  (globalForInventoryMonitor.inventoryMonitorService =
    new InventoryMonitorService(prisma));
