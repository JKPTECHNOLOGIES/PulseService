/**
 * Store Service
 *
 * Service layer for store/warehouse management operations.
 * Extends the base CrudService to provide store-specific functionality.
 */

import { PrismaClient } from "@prisma/client";
import { CrudService } from "@/services/base/crud.service";
import {
  ServiceContext,
  ValidationResult,
  ServiceConfig,
} from "@/services/base/types";
import {
  StoreCreateDTO,
  StoreUpdateDTO,
  StoreWithRelations,
  StoreStats,
  storeCreateSchema,
  storeUpdateSchema,
} from "@/services/inventory/store.types";
import { prisma } from "@/lib/prisma";
import { PermissionResource } from "@/types/permissions";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";

/**
 * Store Service Class
 *
 * Provides CRUD operations and business logic for store/warehouse management.
 * Implements validation, permission checking, and inventory integration.
 */
class StoreService extends CrudService<
  StoreWithRelations,
  StoreCreateDTO,
  StoreUpdateDTO
> {
  constructor(prismaClient: PrismaClient) {
    const config: ServiceConfig = {
      resourceName: "Store",
      permissions: {
        read: `${PermissionResource.INVENTORY}:read`,
        create: `${PermissionResource.INVENTORY}:create`,
        update: `${PermissionResource.INVENTORY}:update`,
        delete: `${PermissionResource.INVENTORY}:delete`,
      },
      softDelete: false,
      trackAudit: false,
      defaultLimit: 20,
      maxLimit: 100,
    };

    super(
      prismaClient,
      prismaClient.store as unknown as Record<string, unknown>,
      config,
    );
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate store creation data
   * Checks:
   * - Name uniqueness
   * - Code uniqueness
   * - Location exists (if provided)
   */
  protected override async validateCreate(
    data: StoreCreateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation = storeCreateSchema.safeParse(data);
    if (!schemaValidation.success) {
      schemaValidation.error.issues.forEach((err) => {
        errors.push({
          field: err.path.join("."),
          message: err.message,
          code: err.code,
        });
      });
      return { valid: false, errors };
    }

    // Check name uniqueness
    const existingByName = await this.prisma.store.findUnique({
      where: { name: data.name },
    });

    if (existingByName) {
      errors.push({
        field: "name",
        message: `Store with name "${data.name}" already exists`,
        code: "DUPLICATE_NAME",
      });
    }

    // Check code uniqueness
    const existingByCode = await this.prisma.store.findUnique({
      where: { code: data.code },
    });

    if (existingByCode) {
      errors.push({
        field: "code",
        message: `Store with code "${data.code}" already exists`,
        code: "DUPLICATE_CODE",
      });
    }

    // Validate location exists (if provided)
    if (data.locationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: data.locationId },
      });

      if (!location) {
        errors.push({
          field: "locationId",
          message: "Location not found",
          code: "LOCATION_NOT_FOUND",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Validate store update data
   * Checks:
   * - Name uniqueness (if changed)
   * - Code uniqueness (if changed)
   * - Location exists (if changed)
   */
  protected override async validateUpdate(
    id: string,
    data: StoreUpdateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation = storeUpdateSchema.safeParse(data);
    if (!schemaValidation.success) {
      schemaValidation.error.issues.forEach((err) => {
        errors.push({
          field: err.path.join("."),
          message: err.message,
          code: err.code,
        });
      });
      return { valid: false, errors };
    }

    // Check name uniqueness if name is being changed
    if (data.name) {
      const existingByName = await this.prisma.store.findUnique({
        where: { name: data.name },
      });

      if (existingByName && existingByName.id !== id) {
        errors.push({
          field: "name",
          message: `Store with name "${data.name}" already exists`,
          code: "DUPLICATE_NAME",
        });
      }
    }

    // Check code uniqueness if code is being changed
    if (data.code) {
      const existingByCode = await this.prisma.store.findUnique({
        where: { code: data.code },
      });

      if (existingByCode && existingByCode.id !== id) {
        errors.push({
          field: "code",
          message: `Store with code "${data.code}" already exists`,
          code: "DUPLICATE_CODE",
        });
      }
    }

    // Validate location exists if being changed
    if (data.locationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: data.locationId },
      });

      if (!location) {
        errors.push({
          field: "locationId",
          message: "Location not found",
          code: "LOCATION_NOT_FOUND",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Validate store deletion
   * Prevents deletion if store has inventory items
   */
  protected override async beforeDelete(
    id: string,
    _context: ServiceContext,
  ): Promise<void> {
    // Check for existing inventory stock
    const stockCount = await this.prisma.inventoryStock.count({
      where: { storeId: id },
    });

    if (stockCount > 0) {
      throw new BadRequestError(
        `Cannot delete store with ${stockCount} inventory item(s). Please transfer or remove all inventory first.`,
      );
    }
  }

  // ============================================================================
  // DATA TRANSFORMATION
  // ============================================================================

  /**
   * Transform create DTO to Prisma data
   */
  protected override transformCreateDTO(
    data: StoreCreateDTO,
    _context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    return Promise.resolve({
      name: data.name,
      code: data.code,
      locationId: data.locationId ?? null,
      description: data.description ?? null,
      isActive: data.isActive ?? true,
    });
  }

  /**
   * Transform update DTO to Prisma data
   */
  protected override transformUpdateDTO(
    data: StoreUpdateDTO,
    _context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    const transformed: Record<string, unknown> = {};

    if (data.name !== undefined) transformed.name = data.name;
    if (data.code !== undefined) transformed.code = data.code;
    if (data.locationId !== undefined) transformed.locationId = data.locationId;
    if (data.description !== undefined)
      transformed.description = data.description;
    if (data.isActive !== undefined) transformed.isActive = data.isActive;

    return Promise.resolve(transformed);
  }

  /**
   * Transform model to include relations and calculated fields
   */
  protected override async transformModel(
    model: Record<string, unknown>,
  ): Promise<StoreWithRelations> {
    // Fetch with relations - limit stock to prevent loading entire inventory
    const store = await this.prisma.store.findUnique({
      where: { id: model.id as string },
      include: {
        _count: {
          select: {
            stock: true,
          },
        },
        stock: {
          take: 5000,
          include: {
            inventoryItem: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundError("Store", model.id as string);
    }

    // Fetch location separately if locationId exists
    let location: Record<string, unknown> | null = null;
    if (store.locationId) {
      location = await this.prisma.location.findUnique({
        where: { id: store.locationId },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
        },
      });
    }

    // Convert Decimal fields in stock
    const stockWithNumbers = store.stock.map((s) => ({
      ...s,
      quantityOnHand: Number(s.quantityOnHand),
      quantityReserved: Number(s.quantityReserved),
      inventoryItem: {
        ...s.inventoryItem,
        unitCost: Number(s.inventoryItem.unitCost),
        minQuantity: Number(s.inventoryItem.minQuantity),
        maxQuantity: Number(s.inventoryItem.maxQuantity),
      },
    }));

    return {
      ...store,
      location,
      stock: stockWithNumbers,
    } as unknown as StoreWithRelations;
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get store statistics
   *
   * @param context - Service context
   * @returns Store statistics
   */
  async getStats(context: ServiceContext): Promise<StoreStats> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Use efficient aggregate/count queries instead of loading all stores + stock + items
    const [totalStores, activeStores, totalInventoryItems, stockWithCost] = await Promise.all([
      this.prisma.store.count(),
      this.prisma.store.count({ where: { isActive: true } }),
      this.prisma.inventoryStock.count(),
      // For stock value, we need quantity * unitCost which requires joining stock with items
      // Load only the minimal fields needed for calculation, with a safety limit
      this.prisma.inventoryStock.findMany({
        take: 100000,
        select: {
          quantityOnHand: true,
          inventoryItem: {
            select: { unitCost: true },
          },
        },
      }),
    ]);

    let totalStockValue = 0;
    for (const stock of stockWithCost) {
      totalStockValue += Number(stock.quantityOnHand) * Number(stock.inventoryItem.unitCost);
    }

    return {
      totalStores,
      activeStores,
      inactiveStores: totalStores - activeStores,
      totalInventoryItems,
      totalStockValue,
    };
  }

  /**
   * Get inventory value for a specific store
   *
   * @param context - Service context
   * @param storeId - Store ID
   * @returns Total inventory value
   */
  async getStoreInventoryValue(
    context: ServiceContext,
    storeId: string,
  ): Promise<number> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Verify store exists
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundError("Store", storeId);
    }

    // Get stock for this store with minimal fields for value calculation
    const stock = await this.prisma.inventoryStock.findMany({
      where: { storeId },
      take: 50000,
      select: {
        quantityOnHand: true,
        inventoryItem: {
          select: { unitCost: true },
        },
      },
    });

    // Calculate total value
    let totalValue = 0;
    for (const item of stock) {
      totalValue += Number(item.quantityOnHand) * Number(item.inventoryItem.unitCost);
    }

    return totalValue;
  }

  /**
   * Get inventory items count for a specific store
   *
   * @param context - Service context
   * @param storeId - Store ID
   * @returns Number of inventory items
   */
  async getStoreInventoryCount(
    context: ServiceContext,
    storeId: string,
  ): Promise<number> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Verify store exists
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundError("Store", storeId);
    }

    // Count inventory items
    return this.prisma.inventoryStock.count({
      where: { storeId },
    });
  }
}

// Export singleton instance
const globalForStore = globalThis as unknown as { storeService: StoreService | undefined };
export const storeService = globalForStore.storeService ?? (globalForStore.storeService = new StoreService(prisma));
