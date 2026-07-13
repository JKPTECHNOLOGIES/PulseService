/**
 * Reservation Availability Service
 *
 * Service for checking inventory availability for reservations.
 * Delegates to InventoryStockService for actual stock operations.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { PermissionResource, PermissionAction, buildPermissionString } from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import { inventoryStockService } from "@/services/inventory/stock";
import { AvailabilityCheck } from "./reservation.types";

/**
 * Reservation Availability Service Class
 *
 * Provides availability checking operations for reservations.
 * Read-only service that delegates to InventoryStockService.
 */
class ReservationAvailabilityService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Check if quantity can be reserved
   * Uses InventoryStockService for availability validation
   */
  async checkAvailability(
    context: ServiceContext,
    inventoryItemId: string,
    requestedQuantity: number,
  ): Promise<AvailabilityCheck> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Use InventoryStockService for availability check
    const validation = await inventoryStockService.validateAvailability(
      inventoryItemId,
      requestedQuantity,
    );

    return {
      inventoryItemId,
      onHandQuantity: validation.onHand,
      reservedQuantity: validation.reserved,
      availableQuantity: validation.available,
      canReserve: validation.valid,
      requestedQuantity,
    };
  }

  /**
   * Get available quantity for an inventory item
   * Returns the quantity available for reservation
   */
  async getAvailableQuantity(
    context: ServiceContext,
    inventoryItemId: string,
  ): Promise<number> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const validation = await inventoryStockService.validateAvailability(
      inventoryItemId,
      0, // Just checking current availability
    );

    return validation.available;
  }

  /**
   * Validate sufficient stock is available
   * Throws error if insufficient stock
   */
  async validateSufficientStock(
    context: ServiceContext,
    inventoryItemId: string,
    requestedQuantity: number,
  ): Promise<void> {
    const availability = await this.checkAvailability(
      context,
      inventoryItemId,
      requestedQuantity,
    );

    if (!availability.canReserve) {
      throw new Error(
        `Insufficient stock available. Requested: ${requestedQuantity}, Available: ${availability.availableQuantity}`,
      );
    }
  }

  /**
   * Check availability for multiple items
   * Useful for bulk reservation operations
   */
  async checkBulkAvailability(
    context: ServiceContext,
    items: Array<{ inventoryItemId: string; quantity: number }>,
  ): Promise<AvailabilityCheck[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const results: AvailabilityCheck[] = [];

    for (const item of items) {
      const availability = await this.checkAvailability(
        context,
        item.inventoryItemId,
        item.quantity,
      );
      results.push(availability);
    }

    return results;
  }

  /**
   * Get stock summary for an inventory item
   * Includes on-hand, reserved, and available quantities
   */
  async getStockSummary(
    context: ServiceContext,
    inventoryItemId: string,
  ): Promise<{
    inventoryItemId: string;
    onHandQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
    stores: Array<{
      storeId: string;
      storeName: string;
      onHand: number;
      reserved: number;
      available: number;
    }>;
  }> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get stock records with store details
    const stockRecords = await this.prisma.inventoryStock.findMany({
      where: { inventoryItemId },
      include: {
        store: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Calculate totals
    let totalOnHand = 0;
    let totalReserved = 0;
    const stores = stockRecords.map((stock) => {
      const onHand = Number(stock.quantityOnHand) || 0;
      const reserved = Number(stock.quantityReserved) || 0;
      const available = onHand - reserved;

      totalOnHand += onHand;
      totalReserved += reserved;

      return {
        storeId: stock.storeId,
        storeName: stock.store.name,
        onHand,
        reserved,
        available,
      };
    });

    return {
      inventoryItemId,
      onHandQuantity: totalOnHand,
      reservedQuantity: totalReserved,
      availableQuantity: totalOnHand - totalReserved,
      stores,
    };
  }
}

// Export singleton instance
export const reservationAvailabilityService =
  new ReservationAvailabilityService(prisma);
