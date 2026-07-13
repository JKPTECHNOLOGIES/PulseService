/**
 * Supplier Cost Update Service
 * 
 * Automatically updates supplier unit costs based on purchase order history
 */

import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";

export class SupplierCostUpdateService {
  /**
   * Update supplier unit costs for items in a purchase order
   * 
   * This method calculates average unit costs from recent PO history
   * (last 12 months, up to 5 most recent orders) and updates the
   * InventoryItemSupplier table accordingly.
   * 
   * @param purchaseOrderId - The ID of the purchase order that was just created/received
   */
  static async updateCostsForPurchaseOrder(purchaseOrderId: string): Promise<void> {
    // Get all lines from this PO with inventory items
    const poLines = await prisma.pOLine.findMany({
      where: {
        purchaseOrderId,
        inventoryItemId: { not: null },
      },
      select: {
        inventoryItemId: true,
        purchaseOrder: {
          select: {
            supplierId: true,
          },
        },
      },
    });

    // Update costs for each unique item-supplier combination
    const processed = new Set<string>();
    
    for (const line of poLines) {
      if (!line.inventoryItemId) continue;
      
      const key = `${line.inventoryItemId}-${line.purchaseOrder.supplierId}`;
      if (processed.has(key)) continue;
      processed.add(key);

      await this.updateSupplierCost(
        line.inventoryItemId,
        line.purchaseOrder.supplierId
      );
    }
  }

  /**
   * Update supplier unit cost for a specific item-supplier combination
   * 
   * @param inventoryItemId - The inventory item ID
   * @param supplierId - The supplier ID
   */
  static async updateSupplierCost(
    inventoryItemId: string,
    supplierId: string
  ): Promise<void> {
    // Get recent PO history for this item-supplier combination
    const recentPOs = await prisma.pOLine.findMany({
      where: {
        inventoryItemId,
        purchaseOrder: {
          supplierId,
          orderDate: {
            gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // Last 12 months
          },
        },
        unitPrice: { gt: 0 },
      },
      select: {
        unitPrice: true,
        purchaseOrder: {
          select: {
            orderDate: true,
          },
        },
      },
      orderBy: {
        purchaseOrder: {
          orderDate: "desc",
        },
      },
      take: 5, // Last 5 orders
    });

    if (recentPOs.length === 0) {
      return; // No history to calculate from
    }

    // Calculate average unit cost
    const sum = recentPOs.reduce(
      (acc, po) => acc.add(new Decimal(po.unitPrice)),
      new Decimal(0)
    );
    const avgCost = sum.div(recentPOs.length).toNumber();

    // Update the supplier cost
    await prisma.inventoryItemSupplier.updateMany({
      where: {
        inventoryItemId,
        supplierId,
      },
      data: {
        unitCost: avgCost,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Update all supplier costs (for batch operations or maintenance)
   * 
   * @returns Statistics about the update operation
   */
  static async updateAllSupplierCosts(): Promise<{
    total: number;
    updated: number;
    skipped: number;
  }> {
    const stats = {
      total: 0,
      updated: 0,
      skipped: 0,
    };

    // Get all active inventory item suppliers
    const suppliers = await prisma.inventoryItemSupplier.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        inventoryItemId: true,
        supplierId: true,
        unitCost: true,
      },
    });

    stats.total = suppliers.length;

    for (const supplier of suppliers) {
      // Get recent PO history
      const recentPOs = await prisma.pOLine.findMany({
        where: {
          inventoryItemId: supplier.inventoryItemId,
          purchaseOrder: {
            supplierId: supplier.supplierId,
            orderDate: {
              gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
            },
          },
          unitPrice: { gt: 0 },
        },
        select: {
          unitPrice: true,
        },
        orderBy: {
          purchaseOrder: {
            orderDate: "desc",
          },
        },
        take: 5,
      });

      if (recentPOs.length === 0) {
        stats.skipped++;
        continue;
      }

      // Calculate average
      const sum = recentPOs.reduce(
        (acc, po) => acc.add(new Decimal(po.unitPrice)),
        new Decimal(0)
      );
      const avgCost = sum.div(recentPOs.length).toNumber();

      // Only update if different (with small tolerance for rounding)
      const currentCost = supplier.unitCost.toNumber();
      if (Math.abs(avgCost - currentCost) > 0.01) {
        await prisma.inventoryItemSupplier.update({
          where: { id: supplier.id },
          data: {
            unitCost: avgCost,
            updatedAt: new Date(),
          },
        });
        stats.updated++;
      } else {
        stats.skipped++;
      }
    }

    return stats;
  }
}

export const supplierCostUpdateService = SupplierCostUpdateService;