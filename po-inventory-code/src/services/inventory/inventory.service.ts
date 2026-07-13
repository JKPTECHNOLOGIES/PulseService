/**
 * Inventory Service V2 - Refactored
 *
 * Complete rewrite of inventory service using new patterns:
 * - No base class inheritance
 * - Direct Prisma usage with proper typing
 * - Utility functions for common operations
 * - Zero type safety violations
 * - Proper Decimal handling
 * - Multi-supplier support with lead time calculations
 * - Centralized stock operations via InventoryStockService
 */

import {
  PrismaClient,
  Prisma,
  CycleCountStatus,
  RepairableStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inventoryLogger, InventoryLogCategory } from "@/lib/inventory-logger";
import { generateRepairableTrackingId } from "@/services/inventory/repairable-tracking-id";

// New type system
import { ServiceContext } from "@/types/service-types";
import { PaginatedResponse } from "@/types/api";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";

// New utility functions
import { checkPermission } from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import {
  calculatePagination,
  buildOrderBy,
  buildSearchWhere,
} from "@/lib/query-helpers";

// Stock service for centralized stock operations
import { inventoryStockService } from "@/services/inventory/stock/inventory-stock.service";

// Assembly tracking backfill (runs when isAssembly is toggled on)
import { assemblyTrackingService } from "@/services/inventory/assembly-tracking.service";

// Transaction service for audit trail
import { inventoryTransactionService } from "@/services/inventory/transaction.service";
import { InventoryTransactionType } from "@/services/inventory/transaction.types";

// Inventory GL service for stock adjustment GL entries
import { inventoryGLService } from "@/services/inventory/inventory-gl.service";

// Audit logging
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";

// Type definitions
import {
  InventoryItemCreateDTO,
  InventoryItemUpdateDTO,
  InventoryItemWithRelations,
  StockAdjustmentDTO,
  StockIssueDTO,
  StockReceiveDTO,
  StockTransferDTO,
  StockCountDTO,
  InventoryStats,
  LowStockItem,
  calculateTotalQuantity,
  calculateAvailableQuantity,
} from "@/services/inventory/inventory.types";

// Error types
import {
  ValidationError,
  NotFoundError,
  BadRequestError,
} from "@/lib/api-errors";

/**
 * Inventory Service Class V2
 *
 * Refactored service with:
 * - No inheritance from base class
 * - Direct Prisma operations
 * - Proper type safety throughout
 * - Utility function composition
 */
class InventoryServiceV2 {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // CORE CRUD OPERATIONS
  // ============================================================================

  /**
   * List inventory items with pagination, filtering, and sorting
   */
  async list(
    context: ServiceContext,
    options?: {
      page?: number;
      limit?: number;
      sort?: string;
      order?: "asc" | "desc";
      filters?: Record<string, unknown>;
      search?: string;
      include?: string[];
    },
  ): Promise<PaginatedResponse<InventoryItemWithRelations>> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Build pagination
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const { skip, take } = calculatePagination(page, limit);

    // Build where clause
    const where: Prisma.InventoryItemWhereInput = {};

    // Handle plannerId filter separately (requires join through work orders)
    const plannerId = options?.filters?.plannerId as string | undefined;
    if (plannerId) {
      // Filter to items that are used in work orders where this user is the planner
      where.workOrderParts = {
        some: {
          workOrder: {
            plannerId: plannerId,
          },
        },
      };
    }

    // Handle bin filter separately — requires a relation traversal (stock.some.bin).
    // Object.assign cannot express this because Prisma needs { stock: { some: { bin: ... } } }.
    const bin = options?.filters?.bin as string | undefined;
    if (bin) {
      where.stock = {
        some: {
          bin: { contains: bin, mode: "insensitive" },
        },
      };
    }

    // Add other filters (excluding plannerId and bin since we handled them)
    const { plannerId: _, bin: _bin, ...otherFilters } = options?.filters ?? {};
    Object.assign(where, otherFilters);

    // Add search filter if provided
    if (options?.search) {
      const searchWhere = buildSearchWhere(options.search, [
        "sku",
        "description",
        "category",
      ]);
      Object.assign(where, searchWhere);
    }

    // Build order by
    const orderBy = options?.sort
      ? buildOrderBy(options.sort, options.order ?? "asc")
      : { sku: "asc" as const };

    // Build include clause
    const include: Prisma.InventoryItemInclude = {
      stock: {
        include: {
          store: {
            select: {
              id: true,
              name: true,
              code: true,
              locationId: true,
              description: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
      defaultSupplier: {
        select: {
          id: true,
          name: true,
          code: true,
          contactPerson: true,
          email: true,
          phone: true,
          billingAddress: true,
          website: true,
          rating: true,
          paymentTerms: true,
          notes: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      equipment: {
        select: {
          id: true,
          tag: true,
          description: true,
          locationId: true,
          status: true,
          criticality: true,
          purchaseCost: true,
          replacementCost: true,
          currentMeter: true,
        },
      },
    };

    // Execute query
    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include,
        skip,
        take,
        orderBy,
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    // Pre-fetch repairable counts in a single batch query
    const repairableItems = items.filter(
      (item) => (item as unknown as Record<string, unknown>).isRepairable,
    );
    const repairableIds = repairableItems.map(
      (item) => (item as unknown as Record<string, unknown>).id as string,
    );
    let repairCountMap = new Map<string, number>();
    if (repairableIds.length > 0) {
      const repairCounts = await this.prisma.repairableItem.groupBy({
        by: ["inventoryItemId"],
        where: {
          inventoryItemId: { in: repairableIds },
          status: {
            in: [
              "IN_REPAIR_INTERNAL",
              "IN_REPAIR_EXTERNAL",
              "REPAIR_COMPLETE",
              "AWAITING_PARTS",
            ],
          },
        },
        _count: { _all: true },
      });
      repairCountMap = new Map(
        repairCounts.map((r) => [r.inventoryItemId, r._count._all]),
      );
    }

    // Transform items
    const transformedItems = await Promise.all(
      items.map((item) => this.transformInventoryItem(item, repairCountMap)),
    );

    // Calculate pagination
    const totalPages = Math.ceil(total / take);

    return {
      success: true,
      data: transformedItems,
      pagination: {
        page,
        limit: take,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get a single inventory item by ID
   */
  async getById(
    context: ServiceContext,
    id: string,
  ): Promise<InventoryItemWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Fetch inventory item
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        stock: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                locationId: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        equipment: {
          select: {
            id: true,
            tag: true,
            description: true,
            locationId: true,
            status: true,
            criticality: true,
            purchaseCost: true,
            replacementCost: true,
            currentMeter: true,
          },
        },
        suppliers: {
          where: { isActive: true },
          include: {
            supplier: true,
          },
          orderBy: [{ isPrimary: "desc" }, { supplier: { name: "asc" } }],
        },
      },
    });

    if (!item) {
      throw new NotFoundError("InventoryItem", id);
    }

    return await this.transformInventoryItem(item);
  }

  /**
   * Create a new inventory item
   */
  async create(
    context: ServiceContext,
    data: InventoryItemCreateDTO,
  ): Promise<InventoryItemWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.CREATE,
    );
    await checkPermission(context, permission);

    // Log creation request
    inventoryLogger.info(
      InventoryLogCategory.ITEM_CREATE,
      "Inventory item creation requested",
      {
        sku: data.sku,
        description: data.description,
        equipmentId: data.equipmentId ?? "NONE",
        defaultSupplierId: data.defaultSupplierId ?? "NONE",
        leadTimeDays: data.leadTimeDays ?? "NOT_SET",
      },
      context.userId,
      context.userName,
    );

    // Validate data
    await this.validateCreate(data);

    // Prepare create data
    const createData: Prisma.InventoryItemCreateInput = {
      sku: data.sku,
      description: data.description,
      category: data.category ?? null,
      unit: data.unit,
      // Non-stock items don't need min/max quantities; default to 0
      minQuantity: data.minQuantity ?? 0,
      maxQuantity: data.maxQuantity ?? 0,
      defaultSupplier: data.defaultSupplierId
        ? {
            connect: { id: data.defaultSupplierId },
          }
        : undefined,
      unitCost: data.unitCost,
      leadTimeDays: data.leadTimeDays ?? null,
      equipment: data.equipmentId
        ? {
            connect: { id: data.equipmentId },
          }
        : undefined,
      notes: data.notes ?? null,
      isActive: true,
      isStockItem: data.isStockItem ?? true,
      isRepairable: data.isRepairable ?? false,
      isAssembly: data.isAssembly ?? false,
    };

    // Create inventory item
    const item = await this.prisma.inventoryItem.create({
      data: createData,
      include: {
        stock: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                locationId: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        equipment: {
          select: {
            id: true,
            tag: true,
            description: true,
            locationId: true,
            status: true,
            criticality: true,
            purchaseCost: true,
            replacementCost: true,
            currentMeter: true,
          },
        },
      },
    });

    // Log successful creation
    inventoryLogger.info(
      InventoryLogCategory.ITEM_CREATE,
      "Inventory item created successfully",
      {
        itemId: item.id,
        sku: item.sku,
        equipmentId: item.equipmentId ?? "NONE",
        equipmentTag: item.equipment?.tag ?? "NONE",
        defaultSupplierId: item.defaultSupplierId ?? "NONE",
      },
      context.userId,
      context.userName,
    );

    // Log audit trail
    try {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.CREATE,
        "InventoryItem",
        item.id,
        item.sku,
        undefined,
        item as unknown as Record<string, unknown>,
      );
    } catch (_error) {
      // Failed to log inventory item creation audit
    }

    return await this.transformInventoryItem(item);
  }

  /**
   * Update an existing inventory item
   */
  async update(
    context: ServiceContext,
    id: string,
    data: InventoryItemUpdateDTO,
  ): Promise<InventoryItemWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Get existing item for comparison
    const existingItem = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        equipment: {
          select: {
            id: true,
            tag: true,
            description: true,
            locationId: true,
            status: true,
            criticality: true,
            purchaseCost: true,
            replacementCost: true,
            currentMeter: true,
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!existingItem) {
      throw new NotFoundError("InventoryItem", id);
    }

    // Log the incoming update request
    inventoryLogger.info(
      InventoryLogCategory.ITEM_UPDATE,
      "Inventory item update requested",
      {
        itemId: id,
        sku: existingItem.sku,
        incomingData: {
          ...data,
          // Highlight critical fields
          equipmentId: data.equipmentId,
          equipmentIdType: typeof data.equipmentId,
          equipmentIdIsUndefined: data.equipmentId === undefined,
          equipmentIdIsNull: data.equipmentId === null,
          defaultSupplierId: data.defaultSupplierId,
          defaultSupplierIdType: typeof data.defaultSupplierId,
        },
        existingRelationships: {
          equipmentId: existingItem.equipmentId,
          equipmentTag: existingItem.equipment?.tag ?? "NONE",
          defaultSupplierId: existingItem.defaultSupplierId,
          defaultSupplierName: existingItem.defaultSupplier?.name ?? "NONE",
        },
      },
      context.userId,
      context.userName,
    );

    // Validate update data
    await this.validateUpdate(id, data);

    // Prepare update data
    const updateData: Prisma.InventoryItemUpdateInput = {};

    if (data.sku !== undefined) updateData.sku = data.sku;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.isStockItem !== undefined)
      updateData.isStockItem = data.isStockItem;
    if (data.isRepairable !== undefined)
      updateData.isRepairable = data.isRepairable;
    if (data.isAssembly !== undefined) updateData.isAssembly = data.isAssembly;
    if (data.minQuantity !== undefined && data.minQuantity !== null)
      updateData.minQuantity = data.minQuantity;
    if (data.maxQuantity !== undefined && data.maxQuantity !== null)
      updateData.maxQuantity = data.maxQuantity;
    if (data.unitCost !== undefined) {
      const oldCost = Number(existingItem.unitCost ?? 0);
      const newCost = data.unitCost;
      const diff = Math.abs(newCost - oldCost);
      // A "large" change is one that is either:
      //   • more than 5× or less than 1/5 the current cost (if cost was > 0), OR
      //   • item had $0 cost and is being set above $50 for the first time
      // AND the absolute difference is more than $50.
      const ratio = oldCost > 0 ? newCost / oldCost : Infinity;
      const isLargeChange =
        diff > 50 && (ratio > 5 || ratio < 0.2 || oldCost === 0);
      if (isLargeChange) {
        if (!data.costChangeReason?.trim()) {
          throw new ValidationError("Unit cost change requires a reason", [
            {
              field: "costChangeReason",
              message:
                `The unit cost is changing from $${oldCost.toFixed(2)} to $${newCost.toFixed(2)} ` +
                `(${oldCost === 0 ? "first-time pricing" : `${((newCost / oldCost) * 100 - 100).toFixed(0)}% change`}). ` +
                "Please provide a reason (e.g. 'Correcting import error', 'Supplier price increase Q2 2026').",
            },
          ]);
        }
        // Large-but-justified change: log prominently so Finance can audit it
        inventoryLogger.warn(
          InventoryLogCategory.ITEM_UPDATE,
          `LARGE UNIT COST CHANGE: ${existingItem.sku} $${oldCost.toFixed(2)} → $${newCost.toFixed(2)} (+${diff.toFixed(2)})`,
          {
            itemId: id,
            sku: existingItem.sku,
            oldCost,
            newCost,
            diff,
            ratio: oldCost > 0 ? ratio : null,
            reason: data.costChangeReason,
          },
          context.userId,
          context.userName,
        );
      }
      updateData.unitCost = data.unitCost;
    }
    if (data.leadTimeDays !== undefined)
      updateData.leadTimeDays = data.leadTimeDays;
    if (data.notes !== undefined) updateData.notes = data.notes;

    // Track relationship changes
    let supplierWillChange = false;
    let equipmentWillChange = false;
    let supplierAction = "NO_CHANGE";
    let equipmentAction = "NO_CHANGE";

    // Only update supplier relationship if it's actually changing
    if (
      data.defaultSupplierId !== undefined &&
      data.defaultSupplierId !== existingItem.defaultSupplierId
    ) {
      supplierWillChange = true;
      if (data.defaultSupplierId) {
        supplierAction = existingItem.defaultSupplierId
          ? "RECONNECT"
          : "CONNECT";
        updateData.defaultSupplier = {
          connect: { id: data.defaultSupplierId },
        };
      } else {
        // Only disconnect if explicitly changing from a supplier to null
        supplierAction = "DISCONNECT";
        updateData.defaultSupplier = { disconnect: true };
      }
    }

    // Only update equipment relationship if it's actually changing
    if (
      data.equipmentId !== undefined &&
      data.equipmentId !== existingItem.equipmentId
    ) {
      equipmentWillChange = true;
      if (data.equipmentId) {
        equipmentAction = existingItem.equipmentId ? "RECONNECT" : "CONNECT";
        updateData.equipment = {
          connect: { id: data.equipmentId },
        };
      } else {
        // Only disconnect if explicitly changing from equipment to null
        equipmentAction = "DISCONNECT";
        updateData.equipment = { disconnect: true };
      }
    }

    // Log relationship changes
    if (supplierWillChange || equipmentWillChange) {
      inventoryLogger.warn(
        InventoryLogCategory.RELATIONSHIP_CHANGE,
        "Inventory item relationships will be modified",
        {
          itemId: id,
          sku: existingItem.sku,
          supplierChange: {
            willChange: supplierWillChange,
            action: supplierAction,
            oldSupplierId: existingItem.defaultSupplierId,
            newSupplierId: data.defaultSupplierId,
            oldSupplierName: existingItem.defaultSupplier?.name ?? "NONE",
          },
          equipmentChange: {
            willChange: equipmentWillChange,
            action: equipmentAction,
            oldEquipmentId: existingItem.equipmentId,
            newEquipmentId: data.equipmentId,
            oldEquipmentTag: existingItem.equipment?.tag ?? "NONE",
            WARNING:
              equipmentAction === "DISCONNECT"
                ? "ITEM WILL BE REMOVED FROM EQUIPMENT HIERARCHY"
                : null,
          },
        },
        context.userId,
        context.userName,
      );
    }

    // Update inventory item
    const item = await this.prisma.inventoryItem.update({
      where: { id },
      data: updateData,
      include: {
        stock: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                locationId: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        equipment: {
          select: {
            id: true,
            tag: true,
            description: true,
            locationId: true,
            status: true,
            criticality: true,
            purchaseCost: true,
            replacementCost: true,
            currentMeter: true,
          },
        },
        suppliers: {
          where: { isActive: true },
          include: {
            supplier: true,
          },
          orderBy: [{ isPrimary: "desc" }, { supplier: { name: "asc" } }],
        },
      },
    });

    // Log the result
    inventoryLogger.info(
      InventoryLogCategory.ITEM_UPDATE,
      "Inventory item updated successfully",
      {
        itemId: id,
        sku: item.sku,
        updatedFields: Object.keys(data),
        finalRelationships: {
          equipmentId: item.equipmentId,
          equipmentTag: item.equipment?.tag ?? "NONE",
          defaultSupplierId: item.defaultSupplierId,
          defaultSupplierName: item.defaultSupplier?.name ?? "NONE",
        },
        relationshipChanges: {
          supplierChanged: supplierWillChange,
          supplierAction,
          equipmentChanged: equipmentWillChange,
          equipmentAction,
        },
      },
      context.userId,
      context.userName,
    );

    // Log audit trail
    try {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.UPDATE,
        "InventoryItem",
        id,
        item.sku,
        existingItem as unknown as Record<string, unknown>,
        item as unknown as Record<string, unknown>,
      );
    } catch (_error) {
      // Failed to log inventory item update audit
    }

    // If this update converted the item to repairable (false -> true), its
    // existing on-hand stock has no serial records yet. Auto-generate one
    // AVAILABLE serial per whole on-hand unit so the repairable serial count
    // matches stock — exactly what the PO / stock-receive path does for newly
    // received units. Without this, a converted item shows N on-hand but 0
    // serials, so the units cannot be tracked or issued by serial number.
    if (data.isRepairable === true && existingItem.isRepairable === false) {
      await this.reconcileRepairableSerials(
        context,
        id,
        item.sku,
        "conversion to repairable",
      );
    }

    // If this update enabled the item as an assembly (false -> true), retroactively
    // reconstruct the learned BOM + sub-serial parent links from its historical
    // repair work orders and direct issues. The live learning hook only fires on
    // NEW direct issues, so without this an enabled assembly would show an empty
    // BOM. Non-fatal: a backfill failure must never block the item update itself.
    if (data.isAssembly === true && existingItem.isAssembly === false) {
      try {
        const report = await assemblyTrackingService.backfillAssemblyTracking(
          context,
          id,
        );
        inventoryLogger.info(
          InventoryLogCategory.ITEM_UPDATE,
          `Assembly tracking backfilled for ${item.sku}`,
          {
            itemId: id,
            sku: item.sku,
            bomRows: report.bomRows.length,
            parentLinks: report.parentLinks.filter((l) => l.action === "link")
              .length,
            assemblySerialCount: report.assemblySerialCount,
            workOrdersScanned: report.workOrdersScanned,
            directIssuesScanned: report.directIssuesScanned,
            notes: report.notes,
          },
          context.userId,
          context.userName,
        );
      } catch (backfillError) {
        inventoryLogger.warn(
          InventoryLogCategory.ITEM_UPDATE,
          `Assembly tracking backfill failed for ${item.sku} (item still updated)`,
          {
            itemId: id,
            sku: item.sku,
            error:
              backfillError instanceof Error
                ? backfillError.message
                : String(backfillError),
          },
          context.userId,
          context.userName,
        );
      }
    }

    return await this.transformInventoryItem(item);
  }

  /**
   * Reconcile RepairableItem serials for a repairable item so that the number of
   * AVAILABLE serials equals on-hand stock. Creates one AVAILABLE / GOOD serial
   * per missing unit (it NEVER deletes). Idempotent and safe to call after any
   * stock-increasing operation on a repairable item (convert-to-repairable,
   * manual stock adjustment, etc.).
   *
   * Invariant: for a repairable item, quantityOnHand must equal the count of
   * AVAILABLE serials. IN_USE / in-repair serials have been issued out and are
   * NOT on hand, so they must be EXCLUDED from the comparison (comparing against
   * all live serials under-counts and fails to backfill when units are issued —
   * e.g. on-hand 9 with 3 IN_USE + 8 AVAILABLE still needs a 9th AVAILABLE).
   * Reserved units stay AVAILABLE until actually issued, so reservations do not
   * affect this count.
   *
   * Does NOT touch stock quantity or post GL — the units are already on hand and
   * valued; only their serial-tracking records are missing.
   *
   * @returns the number of serials created.
   */
  private async reconcileRepairableSerials(
    context: ServiceContext,
    inventoryItemId: string,
    sku: string,
    reason: string,
  ): Promise<number> {
    const [stock, availableSerials] = await Promise.all([
      this.prisma.inventoryStock.findMany({
        where: { inventoryItemId },
        select: { bin: true, quantityOnHand: true },
      }),
      this.prisma.repairableItem.findMany({
        where: { inventoryItemId, status: RepairableStatus.AVAILABLE },
        select: { id: true },
      }),
    ]);

    const onHand = stock.reduce((sum, s) => sum + Number(s.quantityOnHand), 0);
    const availableCount = availableSerials.length;
    const gap = Math.floor(onHand) - availableCount;

    if (gap <= 0) {
      inventoryLogger.info(
        InventoryLogCategory.ITEM_UPDATE,
        `Repairable serial reconcile: no backfill needed for ${sku} (onHand=${onHand}, available=${availableCount}, reason=${reason})`,
        { inventoryItemId, sku, onHand, availableCount, reason },
        context.userId,
        context.userName,
      );
      return 0;
    }

    const binLocation =
      stock.find((s) => Number(s.quantityOnHand) > 0)?.bin ??
      stock[0]?.bin ??
      null;
    const note = `Auto-generated serial (${reason}): backfilled to match on-hand stock.`;

    let created = 0;
    for (let i = 0; i < gap; i++) {
      // Generate then immediately create so the next iteration's sequence read
      // sees the just-created serial (prevents duplicate REP-{SKU}-{N}). Run on
      // the global client (NOT a transaction): generateRepairableTrackingId
      // issues its own retry/back-off queries and must not run inside a
      // long-lived interactive transaction.
      const serialNumber = await generateRepairableTrackingId(
        this.prisma,
        inventoryItemId,
      );
      await this.prisma.repairableItem.create({
        data: {
          inventoryItemId,
          serialNumber,
          status: RepairableStatus.AVAILABLE,
          condition: "GOOD",
          currentLocation: binLocation,
          isAutoGenerated: true,
          notes: note,
          createdBy: context.userId,
          lastModifiedBy: context.userId,
        },
      });
      created++;
    }

    inventoryLogger.info(
      InventoryLogCategory.ITEM_UPDATE,
      `Repairable serial reconcile: backfilled ${created} serial(s) for ${sku} (reason=${reason})`,
      { inventoryItemId, sku, onHand, availableCount, created, reason },
      context.userId,
      context.userName,
    );
    return created;
  }

  /**
   * Archive an inventory item (soft archive - requires zero stock)
   */
  async archive(
    context: ServiceContext,
    id: string,
  ): Promise<InventoryItemWithRelations> {
    // Check update permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Get existing item
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: { stock: true },
    });

    if (!item) {
      throw new NotFoundError("InventoryItem", id);
    }

    if (item.isArchived) {
      throw new BadRequestError("Inventory item is already archived.");
    }

    // Check total stock across all stores/bins
    const totalStock = item.stock.reduce(
      (sum, s) => sum + Number(s.quantityOnHand),
      0,
    );

    if (totalStock > 0) {
      throw new BadRequestError(
        `Cannot archive inventory item with ${totalStock} units in stock. Stock must be zero before archiving.`,
      );
    }

    // Archive the item
    const archived = await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: context.userId,
        isActive: false,
      },
      include: {
        stock: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                locationId: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        equipment: {
          select: {
            id: true,
            tag: true,
            description: true,
            locationId: true,
            status: true,
            criticality: true,
            purchaseCost: true,
            replacementCost: true,
            currentMeter: true,
          },
        },
      },
    });

    // Remove this item from any active (non-posted, non-cancelled) cycle counts.
    // Cycle counts are snapshot-based but still hold a live FK to InventoryItem.
    // If an item is archived mid-count it must be dropped from the count sheet so
    // counters are not asked to count something that no longer exists in inventory.
    try {
      // First, find which active cycle counts contain this item (before deletion)
      const affectedCounts = await this.prisma.masterCycleCountItem.findMany({
        where: {
          inventoryItemId: id,
          cycleCount: {
            status: {
              notIn: [CycleCountStatus.POSTED, CycleCountStatus.CANCELLED],
            },
          },
        },
        select: { cycleCountId: true },
      });

      if (affectedCounts.length > 0) {
        const affectedCountIds = [
          ...new Set(affectedCounts.map((r) => r.cycleCountId)),
        ];

        // Delete the MasterCycleCountItem rows
        await this.prisma.masterCycleCountItem.deleteMany({
          where: {
            inventoryItemId: id,
            cycleCountId: { in: affectedCountIds },
          },
        });

        // Recalculate totalItems on each affected cycle count
        for (const countId of affectedCountIds) {
          const remaining = await this.prisma.masterCycleCountItem.count({
            where: { cycleCountId: countId },
          });
          await this.prisma.masterCycleCount.update({
            where: { id: countId },
            data: { totalItems: remaining },
          });
        }
      }
    } catch (_error) {
      // Non-fatal: cycle count cleanup failed — do not block archiving
    }

    // Log audit trail
    try {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.UPDATE,
        "InventoryItem",
        id,
        item.sku,
        item as unknown as Record<string, unknown>,
        archived as unknown as Record<string, unknown>,
      );
    } catch (_error) {
      // Failed to log inventory item archive audit
    }

    return await this.transformInventoryItem(archived);
  }

  /**
   * Unarchive an inventory item
   */
  async unarchive(
    context: ServiceContext,
    id: string,
  ): Promise<InventoryItemWithRelations> {
    // Check update permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundError("InventoryItem", id);
    }

    if (!item.isArchived) {
      throw new BadRequestError("Inventory item is not archived.");
    }

    // Unarchive the item (restore to active)
    const unarchived = await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        isActive: true,
      },
      include: {
        stock: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                locationId: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        equipment: {
          select: {
            id: true,
            tag: true,
            description: true,
            locationId: true,
            status: true,
            criticality: true,
            purchaseCost: true,
            replacementCost: true,
            currentMeter: true,
          },
        },
      },
    });

    // Log audit trail
    try {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.UPDATE,
        "InventoryItem",
        id,
        item.sku,
        item as unknown as Record<string, unknown>,
        unarchived as unknown as Record<string, unknown>,
      );
    } catch (_error) {
      // Failed to log inventory item unarchive audit
    }

    return await this.transformInventoryItem(unarchived);
  }

  /**
   * Delete an inventory item
   */
  async delete(context: ServiceContext, id: string): Promise<void> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.DELETE,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Get item for audit trail
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundError("InventoryItem", id);
    }

    // Check for existing stock
    const stock = await this.prisma.inventoryStock.findMany({
      where: { inventoryItemId: id },
    });

    const totalStock = stock.reduce(
      (sum, s) => sum + Number(s.quantityOnHand),
      0,
    );

    if (totalStock > 0) {
      throw new BadRequestError(
        `Cannot delete inventory item with ${totalStock} units in stock. Please adjust stock to zero first.`,
      );
    }

    // Check for pending work order parts
    const pendingParts = await this.prisma.workOrderPart.count({
      where: {
        inventoryItemId: id,
        workOrder: {
          status: { in: ["Requested", "Approved", "InProgress"] },
        },
      },
    });

    if (pendingParts > 0) {
      throw new BadRequestError(
        `Cannot delete inventory item with ${pendingParts} pending work order part(s).`,
      );
    }

    // Delete inventory item
    await this.prisma.inventoryItem.delete({
      where: { id },
    });

    // Log audit trail
    try {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.DELETE,
        "InventoryItem",
        id,
        item.sku,
        item as unknown as Record<string, unknown>,
        undefined,
      );
    } catch (_error) {
      // Failed to log inventory item deletion audit
    }
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate inventory item creation data
   */
  private async validateCreate(data: InventoryItemCreateDTO): Promise<void> {
    // Note: Zod schema validation is already performed by the API middleware
    // before this method is called. We only perform business logic validation here.

    // Check SKU uniqueness
    const existingItem = await this.prisma.inventoryItem.findUnique({
      where: { sku: data.sku },
    });

    if (existingItem) {
      throw new ValidationError("SKU already exists", [
        {
          field: "sku",
          message: `Inventory item with SKU "${data.sku}" already exists`,
        },
      ]);
    }

    // Validate supplier exists (if provided)
    if (data.defaultSupplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: data.defaultSupplierId },
      });

      if (!supplier) {
        throw new ValidationError("Supplier not found", [
          {
            field: "defaultSupplierId",
            message: "Supplier not found",
          },
        ]);
      }
    }

    // Validate equipment exists (if provided)
    if (data.equipmentId) {
      const equipment = await this.prisma.equipment.findUnique({
        where: { id: data.equipmentId },
      });

      if (!equipment) {
        throw new ValidationError("Equipment not found", [
          {
            field: "equipmentId",
            message: "Equipment not found",
          },
        ]);
      }
    }
  }

  /**
   * Validate inventory item update data
   */
  private async validateUpdate(
    id: string,
    data: InventoryItemUpdateDTO,
  ): Promise<void> {
    // Note: Zod schema validation is already performed by the API middleware.
    // We only perform business logic validation here.

    // Get existing item
    const existingItem = await this.prisma.inventoryItem.findUnique({
      where: { id },
    });

    if (!existingItem) {
      throw new NotFoundError("InventoryItem", id);
    }

    // Check SKU uniqueness if SKU is being changed
    if (data.sku && data.sku !== existingItem.sku) {
      const duplicateItem = await this.prisma.inventoryItem.findUnique({
        where: { sku: data.sku },
      });

      if (duplicateItem) {
        throw new ValidationError("SKU already exists", [
          {
            field: "sku",
            message: `Inventory item with SKU "${data.sku}" already exists`,
          },
        ]);
      }
    }

    // Validate supplier exists if being changed
    if (data.defaultSupplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: data.defaultSupplierId },
      });

      if (!supplier) {
        throw new ValidationError("Supplier not found", [
          {
            field: "defaultSupplierId",
            message: "Supplier not found",
          },
        ]);
      }
    }

    // Validate equipment exists if being changed
    if (data.equipmentId) {
      const equipment = await this.prisma.equipment.findUnique({
        where: { id: data.equipmentId },
      });

      if (!equipment) {
        throw new ValidationError("Equipment not found", [
          {
            field: "equipmentId",
            message: "Equipment not found",
          },
        ]);
      }
    }
  }

  // ============================================================================
  // TRANSFORMATION METHODS
  // ============================================================================

  /**
   * Transform Prisma inventory item to API response format
   * Converts Decimal types to numbers for JSON serialization
   *
   * IMPORTANT: For repairable items, also counts items in repair status
   * and subtracts from available quantity
   */
  private async transformInventoryItem(
    item: unknown,
    repairCountMap?: Map<string, number>,
  ): Promise<InventoryItemWithRelations> {
    const i = item as Record<string, unknown>;

    // Transform stock records
    const stock = (i.stock as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      bin: s.bin as string, // Preserve bin information
      quantityOnHand: Number(s.quantityOnHand),
      quantityReserved: Number(s.quantityReserved),
      quantityCommitted: Number(s.quantityCommitted ?? 0),
    }));

    // Calculate total quantity
    const totalQuantity = calculateTotalQuantity(stock as never);

    // For repairable items, count how many are in repair status
    // Include REPAIR_COMPLETE (in receiving) and AWAITING_PARTS as they're not available for use
    let inRepairCount = 0;
    if (i.isRepairable) {
      if (repairCountMap) {
        // Use pre-fetched batch count if available
        inRepairCount = repairCountMap.get(i.id as string) ?? 0;
      } else {
        inRepairCount = await this.prisma.repairableItem.count({
          where: {
            inventoryItemId: i.id as string,
            status: {
              in: [
                "IN_REPAIR_INTERNAL",
                "IN_REPAIR_EXTERNAL",
                "REPAIR_COMPLETE",
                "AWAITING_PARTS",
              ],
            },
          },
        });
      }
    }

    // Calculate available quantity (subtract reserved AND in-repair items)
    const availableQuantity = calculateAvailableQuantity(
      stock as never,
      inRepairCount,
    );

    // Transform equipment if present
    const equipment = i.equipment
      ? {
          ...(i.equipment as Record<string, unknown>),
          purchaseCost: (i.equipment as Record<string, unknown>).purchaseCost
            ? Number((i.equipment as Record<string, unknown>).purchaseCost)
            : null,
          replacementCost: (i.equipment as Record<string, unknown>)
            .replacementCost
            ? Number((i.equipment as Record<string, unknown>).replacementCost)
            : null,
          currentMeter: (i.equipment as Record<string, unknown>).currentMeter
            ? Number((i.equipment as Record<string, unknown>).currentMeter)
            : null,
        }
      : null;

    return {
      ...i,
      unitCost: Number(i.unitCost),
      minQuantity: Number(i.minQuantity),
      maxQuantity: Number(i.maxQuantity),
      stock: stock as never,
      equipment,
      totalQuantity,
      availableQuantity,
    } as unknown as InventoryItemWithRelations;
  }

  // ============================================================================
  // STOCK MANAGEMENT METHODS
  // ============================================================================

  /**
   * Adjust stock levels (increase or decrease)
   *
   * @param context - Service context
   * @param itemId - Inventory item ID
   * @param data - Adjustment data
   * @returns Updated inventory item
   */
  async adjustStock(
    context: ServiceContext,
    itemId: string,
    data: StockAdjustmentDTO,
  ): Promise<InventoryItemWithRelations> {
    // Check update permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Verify item exists
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
      include: { stock: true },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    // Verify store exists
    const store = await this.prisma.store.findUnique({
      where: { id: data.storeId },
    });

    if (!store) {
      throw new NotFoundError("Store", data.storeId);
    }

    // Get ALL stock records for this item at this store (across all bins)
    const stockRecords = await this.prisma.inventoryStock.findMany({
      where: {
        inventoryItemId: itemId,
        storeId: data.storeId,
      },
    });

    // Calculate total current quantity across all bins
    const currentQuantity = stockRecords.reduce(
      (sum, record) => sum + Number(record.quantityOnHand),
      0,
    );
    const newQuantity = currentQuantity + data.quantity;

    // Prevent negative stock
    if (newQuantity < 0) {
      throw new BadRequestError(
        `Adjustment would result in negative stock. Current: ${currentQuantity}, Adjustment: ${data.quantity}`,
      );
    }

    // Prepare notes combining reason and notes fields
    const combinedNotes = `${data.reason}${data.notes ? `: ${data.notes}` : ""}`;

    // Determine which bin record to adjust:
    // 1. Prefer the MAIN bin if it exists
    // 2. Fall back to the first existing bin record (preserves existing bin structure)
    // 3. Only create a new MAIN bin if NO stock records exist at all for this store
    const mainBinRecord = stockRecords.find((r) => r.bin === "MAIN") ?? null;
    const targetBinRecord = mainBinRecord ?? stockRecords[0] ?? null;

    if (!targetBinRecord) {
      // No stock records exist for this store at all — create a MAIN bin
      await this.prisma.inventoryStock.create({
        data: {
          inventoryItemId: itemId,
          storeId: data.storeId,
          bin: "MAIN",
          quantityOnHand: newQuantity,
          quantityReserved: 0,
        },
      });

      // Record transaction for audit trail
      await inventoryTransactionService.recordWorkOrderTransaction(context, {
        inventoryItemId: itemId,
        storeId: data.storeId,
        transactionType: InventoryTransactionType.ADJUST,
        quantity: data.quantity, // Use the adjustment amount, not the new total
        unitCost: Number(item.unitCost),
        workOrderId: "",
        workOrderNumber: "Stock Adjustment",
        userId: context.userId,
        userName: context.userName,
        notes: combinedNotes,
      });
    } else {
      // An existing stock record was found — update it directly
      // This handles both MAIN bins and any other named bins (A1, RACK-1, etc.)
      const targetCurrentQty = Number(targetBinRecord.quantityOnHand);
      const targetNewQty = targetCurrentQty + data.quantity;

      await this.prisma.inventoryStock.update({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId: itemId,
            storeId: data.storeId,
            bin: targetBinRecord.bin,
          },
        },
        data: {
          quantityOnHand: targetNewQty,
        },
      });

      // Record transaction for audit trail
      await inventoryTransactionService.recordWorkOrderTransaction(context, {
        inventoryItemId: itemId,
        storeId: data.storeId,
        transactionType: InventoryTransactionType.ADJUST,
        quantity: data.quantity, // Use the adjustment amount, not the new total
        unitCost: Number(item.unitCost),
        workOrderId: "",
        workOrderNumber: "Stock Adjustment",
        userId: context.userId,
        userName: context.userName,
        notes: combinedNotes,
      });
    }

    // ------------------------------------------------------------------
    // Create GL entry for the stock adjustment
    // Uses INV_ADJ_INC or INV_ADJ_DEC via inventoryGLService —
    // same pattern as inventoryStockService.adjust().
    // ------------------------------------------------------------------
    try {
      const unitCost = Number(item.unitCost);
      if (unitCost > 0) {
        const glResult = await inventoryGLService.createAdjustmentTransaction(
          context,
          {
            inventoryItemId: itemId,
            inventoryItemSku: item.sku,
            oldQuantity: currentQuantity,
            newQuantity,
            unitCost,
            referenceType: "MANUAL_ADJUSTMENT",
            referenceId: itemId,
            referenceNumber: item.sku,
            description: `Stock Adjustment: ${item.sku} ${data.quantity >= 0 ? "+" : ""}${data.quantity} (${currentQuantity} → ${newQuantity})`,
            reason: combinedNotes,
          },
        );

        if (!glResult.glTransactionId) {
          inventoryLogger.warn(
            InventoryLogCategory.STOCK_ADJUST,
            "[INVENTORY-ADJUST] GL skipped - zero adjustment amount.",
            { itemId, sku: item.sku, unitCost, currentQuantity, newQuantity },
          );
        }
      }
    } catch (glError) {
      // GL is best-effort - don't fail the adjustment if GL rules
      // are not configured or the budget period is missing.
      inventoryLogger.error(
        InventoryLogCategory.STOCK_ADJUST,
        `[INVENTORY-ADJUST] GL entry failed: ${glError instanceof Error ? glError.message : String(glError)}`,
      );
    }

    // For a repairable item, a positive stock adjustment adds physical units that
    // each need a serial record (quantityOnHand must equal the AVAILABLE serial
    // count). The adjust path historically updated stock + GL but never created
    // serials, leaving on-hand ahead of the serial count. Reconcile so every
    // added unit is serialized and issuable. (Negative adjustments are left
    // alone here — retiring specific serials is a manual decision.)
    if (item.isRepairable && data.quantity > 0) {
      await this.reconcileRepairableSerials(
        context,
        itemId,
        item.sku,
        "manual stock adjustment",
      );
    }

    // Return updated item
    return this.getById(context, itemId);
  }

  /**
   * Issue stock to a work order
   *
   * @param context - Service context
   * @param itemId - Inventory item ID
   * @param data - Issue data
   * @returns Updated inventory item
   */
  async issueStock(
    context: ServiceContext,
    itemId: string,
    data: StockIssueDTO,
  ): Promise<InventoryItemWithRelations> {
    // Check update permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Verify item exists
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    // Verify work order exists (if provided)
    if (data.workOrderId) {
      const workOrder = await this.prisma.workOrder.findUnique({
        where: { id: data.workOrderId },
      });

      if (!workOrder) {
        throw new NotFoundError("Work Order", data.workOrderId);
      }
    }

    // Use InventoryStockService for the issue
    const result = await inventoryStockService.issue(itemId, data.quantity, {
      context,
      storeId: data.storeId,
      workOrderId: data.workOrderId ?? undefined,
      workOrderNumber: data.workOrderId ?? "",
      userId: context.userId,
      userName: context.userName,
      notes: data.notes ?? undefined,
    });

    if (!result.success) {
      throw new BadRequestError(result.error ?? "Failed to issue stock");
    }

    // Return updated item
    return this.getById(context, itemId);
  }

  /**
   * Receive stock from a purchase order
   *
   * @param context - Service context
   * @param itemId - Inventory item ID
   * @param data - Receive data
   * @returns Updated inventory item
   */
  async receiveStock(
    context: ServiceContext,
    itemId: string,
    data: StockReceiveDTO,
  ): Promise<InventoryItemWithRelations> {
    // Check update permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Verify item exists
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    // Verify purchase order exists (if provided)
    if (data.purchaseOrderId) {
      const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
        where: { id: data.purchaseOrderId },
      });

      if (!purchaseOrder) {
        throw new NotFoundError("Purchase Order", data.purchaseOrderId);
      }
    }

    // Use InventoryStockService for the receive
    const result = await inventoryStockService.receive(itemId, data.quantity, {
      context,
      storeId: data.storeId,
      purchaseOrderId: data.purchaseOrderId ?? undefined,
      unitCost: data.unitCost,
      userId: context.userId,
      userName: context.userName,
      notes: data.notes ?? undefined,
    });

    if (!result.success) {
      throw new BadRequestError(result.error ?? "Failed to receive stock");
    }

    // Update unit cost if provided
    if (data.unitCost !== undefined) {
      await this.prisma.inventoryItem.update({
        where: { id: itemId },
        data: { unitCost: data.unitCost },
      });
    }

    // Return updated item
    return this.getById(context, itemId);
  }

  /**
   * Transfer stock between stores
   *
   * @param context - Service context
   * @param itemId - Inventory item ID
   * @param data - Transfer data
   * @returns Updated inventory item
   */
  async transferStock(
    context: ServiceContext,
    itemId: string,
    data: StockTransferDTO,
  ): Promise<InventoryItemWithRelations> {
    // Check update permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Verify item exists
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    // Verify stores exist
    const [fromStore, toStore] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: data.fromStoreId } }),
      this.prisma.store.findUnique({ where: { id: data.toStoreId } }),
    ]);

    if (!fromStore) {
      throw new NotFoundError("Source Store", data.fromStoreId);
    }

    if (!toStore) {
      throw new NotFoundError("Destination Store", data.toStoreId);
    }

    // Use InventoryStockService for the transfer
    const result = await inventoryStockService.transfer({
      context,
      inventoryItemId: itemId,
      fromStoreId: data.fromStoreId,
      toStoreId: data.toStoreId,
      quantity: data.quantity,
      userId: context.userId,
      userName: context.userName,
      notes: data.notes ?? undefined,
    });

    if (!result.success) {
      throw new BadRequestError(result.error ?? "Failed to transfer stock");
    }

    // Return updated item
    return this.getById(context, itemId);
  }

  /**
   * Perform physical stock count
   *
   * @param context - Service context
   * @param itemId - Inventory item ID
   * @param data - Count data
   * @returns Updated inventory item
   */
  async performStockCount(
    context: ServiceContext,
    itemId: string,
    data: StockCountDTO,
  ): Promise<InventoryItemWithRelations> {
    // Check update permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Verify item exists
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    // Verify store exists
    const store = await this.prisma.store.findUnique({
      where: { id: data.storeId },
    });

    if (!store) {
      throw new NotFoundError("Store", data.storeId);
    }

    // Find the most appropriate bin to count:
    // 1. If bin is explicitly specified, use that bin (or create it if missing)
    // 2. If no bin specified, find the first existing stock record for this store
    //    (prefer MAIN bin, fall back to any other bin)
    let bin: string;
    let existingStock;

    if (data.bin) {
      // Explicit bin specified — use it as-is
      bin = data.bin;
      existingStock = await this.prisma.inventoryStock.findUnique({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId: itemId,
            storeId: data.storeId,
            bin,
          },
        },
      });
    } else {
      // No bin specified — find existing stock for this store
      const allStoreStock = await this.prisma.inventoryStock.findMany({
        where: { inventoryItemId: itemId, storeId: data.storeId },
        orderBy: { bin: "asc" },
      });
      // Prefer MAIN bin; fall back to first record; fall back to creating MAIN
      existingStock =
        allStoreStock.find((r) => r.bin === "MAIN") ?? allStoreStock[0] ?? null;
      bin = existingStock?.bin ?? "MAIN";
    }

    const combinedNotes = `${data.reason}${data.notes ? `: ${data.notes}` : ""}`;

    if (!existingStock) {
      // No stock record exists — create with counted quantity
      await this.prisma.inventoryStock.create({
        data: {
          inventoryItemId: itemId,
          storeId: data.storeId,
          bin,
          quantityOnHand: data.countedQuantity,
          quantityReserved: 0,
          lastCountDate: new Date(),
        },
      });

      // Record audit transaction
      await inventoryTransactionService.recordWorkOrderTransaction(context, {
        inventoryItemId: itemId,
        storeId: data.storeId,
        transactionType: InventoryTransactionType.ADJUST,
        quantity: data.countedQuantity,
        unitCost: Number(item.unitCost),
        workOrderId: "",
        workOrderNumber: "Physical Count",
        userId: context.userId,
        userName: context.userName,
        notes: `${combinedNotes}\nBin: ${bin}\nInitial count: ${data.countedQuantity}`,
      });

      // GL entry for establishing initial stock
      const unitCost = Number(item.unitCost);
      if (unitCost > 0 && data.countedQuantity > 0) {
        const glResult = await inventoryGLService.createCountVarianceGL(
          context,
          {
            inventoryItemId: itemId,
            inventoryItemSku: item.sku,
            storeId: data.storeId,
            bin,
            oldQuantity: 0,
            newQuantity: data.countedQuantity,
            unitCost,
            referenceType: "PHYSICAL_COUNT",
            referenceId: itemId,
            referenceNumber: item.sku,
            description: `Physical Count: ${item.sku} initial count ${data.countedQuantity}`,
            reason: combinedNotes,
          },
        );

        if (!glResult.success) {
          inventoryLogger.error(
            InventoryLogCategory.STOCK_ADJUST,
            `[STOCK-COUNT] GL entry failed: ${glResult.error}`,
          );
        }
      }
    } else {
      const oldQuantity = Number(existingStock.quantityOnHand);
      const countedQty = Number(data.countedQuantity);
      const adjustmentAmount = countedQty - oldQuantity;

      // Update the stock record
      await this.prisma.inventoryStock.update({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId: itemId,
            storeId: data.storeId,
            bin,
          },
        },
        data: {
          quantityOnHand: data.countedQuantity,
          lastCountDate: new Date(),
        },
      });

      // Record audit transaction (use signed adjustment amount)
      await inventoryTransactionService.recordWorkOrderTransaction(context, {
        inventoryItemId: itemId,
        storeId: data.storeId,
        transactionType: InventoryTransactionType.ADJUST,
        quantity: adjustmentAmount,
        unitCost: Number(item.unitCost),
        workOrderId: "",
        workOrderNumber: "Physical Count",
        userId: context.userId,
        userName: context.userName,
        notes: `${combinedNotes}\nBin: ${bin}\nSystem: ${oldQuantity}, Counted: ${countedQty}, Change: ${adjustmentAmount >= 0 ? "+" : ""}${adjustmentAmount}`,
      });

      // GL entry for the variance (only if there is a change)
      if (adjustmentAmount !== 0) {
        const unitCost = Number(item.unitCost);
        if (unitCost > 0) {
          const glResult = await inventoryGLService.createCountVarianceGL(
            context,
            {
              inventoryItemId: itemId,
              inventoryItemSku: item.sku,
              storeId: data.storeId,
              bin,
              oldQuantity,
              newQuantity: countedQty,
              unitCost,
              referenceType: "PHYSICAL_COUNT",
              referenceId: itemId,
              referenceNumber: item.sku,
              description: `Physical Count: ${item.sku} variance ${oldQuantity} to ${countedQty}`,
              reason: combinedNotes,
            },
          );

          if (!glResult.success) {
            inventoryLogger.error(
              InventoryLogCategory.STOCK_ADJUST,
              `[STOCK-COUNT] GL entry failed: ${glResult.error}`,
            );
          }
        }
      }
    }

    // Return updated item
    return this.getById(context, itemId);
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get items with low stock (at or below minimum quantity)
   *
   * @param context - Service context
   * @returns Array of low stock items
   */
  async getLowStockItems(context: ServiceContext): Promise<LowStockItem[]> {
    // Check read permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // PERFORMANCE: Use select to minimize payload. With millions of records,
    // loading full supplier objects for all items is expensive.
    const items = await this.prisma.inventoryItem.findMany({
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
        stock: {
          select: { quantityOnHand: true, quantityReserved: true },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    // Filter and transform low stock items
    const lowStockItems: LowStockItem[] = [];

    // Batch-fetch active reservation totals and open PO unreceived quantities
    // for ALL items at once so we avoid N+1 queries.
    const allItemIds = items.map((i) => i.id);

    // Active/Pending reservations that consume stock (ACTIVE counts against available)
    const activeReservationRows =
      await this.prisma.inventoryReservation.groupBy({
        by: ["inventoryItemId"],
        where: {
          inventoryItemId: { in: allItemIds },
          status: "ACTIVE",
        },
        _sum: { quantity: true },
      });
    const reservedMap = new Map<string, number>(
      activeReservationRows.map((r) => [
        r.inventoryItemId,
        Number(r._sum.quantity ?? 0),
      ]),
    );

    // Open PO unreceived quantities and open requisition quantities
    // (ordered - received for non-Draft/Cancelled/Closed POs; non-Cancelled/Rejected reqs)
    const { poMap: openPOMap, reqMap: openReqMap } =
      await this.getOnOrderQuantities(allItemIds);

    for (const item of items) {
      const stockWithNumbers = item.stock.map((s) => ({
        ...s,
        quantityOnHand: Number(s.quantityOnHand),
        quantityReserved: Number(s.quantityReserved),
      }));
      const totalOnHand = calculateTotalQuantity(stockWithNumbers as never);
      const activeReserved = reservedMap.get(item.id) ?? 0;
      const openPOQty = openPOMap.get(item.id)?.qty ?? 0;
      const openReqQty = openReqMap.get(item.id)?.qty ?? 0;

      // Use pipeline-aware effective supply to decide if reorder is needed.
      // Formula: effectiveSupply = onHand - activeReserved + openPOQty + openReqQty
      // Including openReqQty prevents the system from prompting for a new requisition
      // when an existing open requisition already covers the shortfall.
      const effectiveAvailable =
        totalOnHand - activeReserved + openPOQty + openReqQty;
      const minQuantity = Number(item.minQuantity);

      if (effectiveAvailable < minQuantity) {
        lowStockItems.push({
          id: item.id,
          sku: item.sku,
          description: item.description,
          category: item.category,
          currentQuantity: effectiveAvailable, // Use effective available, not raw onHand
          minQuantity: minQuantity,
          maxQuantity: Number(item.maxQuantity),
          defaultSupplier: item.defaultSupplier
            ? {
                id: item.defaultSupplier.id,
                name: item.defaultSupplier.name,
                code: item.defaultSupplier.code,
                contactPerson: item.defaultSupplier.contactPerson,
                email: item.defaultSupplier.email,
                phone: item.defaultSupplier.phone,
                billingAddress: item.defaultSupplier.billingAddress,
                website: item.defaultSupplier.website,
                rating: item.defaultSupplier.rating,
                paymentTerms: item.defaultSupplier.paymentTerms,
                notes: item.defaultSupplier.notes,
                isActive: item.defaultSupplier.isActive,
                createdAt: item.defaultSupplier.createdAt,
                updatedAt: item.defaultSupplier.updatedAt,
              }
            : null,
          daysUntilStockout: null, // TODO: Calculate based on usage rate
        });
      }
    }

    return lowStockItems;
  }

  /**
   * Get total inventory value
   *
   * @param context - Service context
   * @param storeId - Optional store ID to filter by
   * @returns Total inventory value
   */
  async getStockValue(
    context: ServiceContext,
    storeId?: string,
  ): Promise<number> {
    // Check read permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const whereClause: Record<string, unknown> = { isActive: true };

    // PERFORMANCE: Only select fields needed for value calculation.
    // Avoids loading description, category, notes, etc. for all items.
    const items = await this.prisma.inventoryItem.findMany({
      where: whereClause,
      take: 50000,
      select: {
        unitCost: true,
        stock: {
          where: storeId ? { storeId } : {},
          select: { quantityOnHand: true },
        },
      },
    });

    // Calculate total value
    let totalValue = 0;

    for (const item of items) {
      const totalQuantity = item.stock.reduce(
        (sum, s) => sum + Number(s.quantityOnHand),
        0,
      );
      const unitCost = Number(item.unitCost);
      totalValue += totalQuantity * unitCost;
    }

    return totalValue;
  }

  /**
   * Check if sufficient quantity is available
   *
   * @param context - Service context
   * @param itemId - Inventory item ID
   * @param quantity - Required quantity
   * @param storeId - Optional store ID
   * @returns True if available
   */
  async checkAvailability(
    context: ServiceContext,
    itemId: string,
    quantity: number,
    storeId?: string,
  ): Promise<boolean> {
    // Check read permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const whereClause: Record<string, unknown> = { inventoryItemId: itemId };
    if (storeId) {
      whereClause.storeId = storeId;
    }

    const stock = await this.prisma.inventoryStock.findMany({
      where: whereClause,
    });

    const stockWithNumbers = stock.map((s) => ({
      ...s,
      quantityOnHand: Number(s.quantityOnHand),
      quantityReserved: Number(s.quantityReserved),
    }));

    const availableQuantity = calculateAvailableQuantity(
      stockWithNumbers as never,
    );
    return availableQuantity >= quantity;
  }

  /**
   * Get inventory statistics
   *
   * @param context - Service context
   * @returns Inventory statistics
   */
  async getStats(context: ServiceContext): Promise<InventoryStats> {
    // Check read permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // PERFORMANCE: Use count + aggregate for totals, and only load needed fields
    // for the low-stock / out-of-stock calculation.
    const [totalItems, categoryGroups, itemsForStockCalc] = await Promise.all([
      this.prisma.inventoryItem.count({ where: { isActive: true } }),
      this.prisma.inventoryItem.groupBy({
        by: ["category"],
        where: { isActive: true },
        _count: { _all: true },
      }),
      // Only load fields needed for stock level checks + SKU for breakdown
      this.prisma.inventoryItem.findMany({
        where: { isActive: true },
        take: 50000,
        select: {
          sku: true,
          unitCost: true,
          minQuantity: true,
          stock: {
            select: { quantityOnHand: true, quantityReserved: true },
          },
        },
      }),
    ]);

    const items = itemsForStockCalc;

    // Helper: classify an SKU into a known group
    const classifySku = (
      sku: string,
    ): "standard" | "ni" | "in" | "sara" | "other" => {
      if (/^\d{5}$/.test(sku)) return "standard";
      const upper = sku.toUpperCase();
      if (upper.startsWith("SARA")) return "sara";
      if (upper.startsWith("NI")) return "ni";
      if (upper.startsWith("IN")) return "in";
      return "other";
    };

    let totalValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    const byCategory: Record<string, number> = {};
    let totalStockLevel = 0;

    // SKU breakdown accumulators
    const skuBreakdown = {
      standard: { count: 0, totalValue: 0 },
      ni: { count: 0, totalValue: 0 },
      in: { count: 0, totalValue: 0 },
      sara: { count: 0, totalValue: 0 },
      other: { count: 0, totalValue: 0 },
    };

    for (const item of items) {
      const stockWithNumbers = item.stock.map((s) => ({
        ...s,
        quantityOnHand: Number(s.quantityOnHand),
        quantityReserved: Number(s.quantityReserved),
      }));
      const totalQuantity = calculateTotalQuantity(stockWithNumbers as never);
      const unitCost = Number(item.unitCost);
      const minQuantity = Number(item.minQuantity);
      const itemValue = totalQuantity * unitCost;

      totalValue += itemValue;
      totalStockLevel += totalQuantity;

      // Accumulate per-SKU-group stats
      const group = classifySku(item.sku);
      skuBreakdown[group].count++;
      skuBreakdown[group].totalValue += itemValue;

      if (totalQuantity === 0) {
        outOfStockCount++;
      } else if (totalQuantity <= minQuantity) {
        lowStockCount++;
      }
    }

    // Build byCategory from the groupBy result (avoids loading category for each item)
    for (const group of categoryGroups) {
      const category = group.category ?? "Uncategorized";
      byCategory[category] = group._count._all;
    }

    const averageStockLevel =
      items.length > 0 ? totalStockLevel / items.length : 0;

    return {
      totalItems,
      totalValue,
      standardSkuTotalValue: skuBreakdown.standard.totalValue,
      skuBreakdown,
      lowStockItems: lowStockCount,
      outOfStockItems: outOfStockCount,
      byCategory,
      recentTransactions: 0, // TODO: Implement transaction tracking
      averageStockLevel,
    };
  }
  /**
   * Get primary supplier for an inventory item
   * Returns the primary supplier from the multi-supplier relationships,
   * or falls back to defaultSupplier if no primary is set
   */
  async getPrimarySupplier(
    context: ServiceContext,
    inventoryItemId: string,
  ): Promise<{ id: string; name: string; leadTimeDays: number | null } | null> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get item with suppliers
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: {
        suppliers: {
          where: {
            isActive: true,
            isPrimary: true,
          },
          include: {
            supplier: true,
          },
        },
        defaultSupplier: true,
      },
    });

    if (!item) {
      return null;
    }

    // Return primary supplier from multi-supplier relationships
    if (item.suppliers.length > 0 && item.suppliers[0]) {
      const primarySupplier = item.suppliers[0];
      return {
        id: primarySupplier.supplierId,
        name: primarySupplier.supplier.name,
        leadTimeDays: primarySupplier.leadTimeDays,
      };
    }

    // Fall back to default supplier
    if (item.defaultSupplier) {
      return {
        id: item.defaultSupplier.id,
        name: item.defaultSupplier.name,
        leadTimeDays: item.defaultSupplier.leadTimeDays,
      };
    }

    return null;
  }

  /**
   * Get On Req / On PO quantities for a batch of inventory items.
   *
   * On Req  = RequisitionLine where lineStatus is PENDING, APPROVED, or ORDERED
   *           (including lines already converted to a PO — these still have an open req)
   *           AND parent Requisition not Cancelled/Rejected.
   *           CANCELLED and FULFILLED lines are excluded.
   *
   * On PO   = POLine where PO status is active (not Draft/Cancelled/Closed).
   *           Returns remaining-to-receive quantity (ordered - received) per line.
   *           Includes both direct PO lines and those converted from requisition lines.
   *
   * Returns two Maps keyed by inventoryItemId:
   *   reqMap  → { qty, count }
   *   poMap   → { qty, count }
   */
  async getOnOrderQuantities(itemIds: string[]): Promise<{
    reqMap: Map<string, { qty: number; count: number }>;
    poMap: Map<string, { qty: number; count: number }>;
  }> {
    if (itemIds.length === 0) {
      return { reqMap: new Map(), poMap: new Map() };
    }

    const [openReqRows, openPORows] = await Promise.all([
      this.prisma.requisitionLine.findMany({
        where: {
          inventoryItemId: { in: itemIds },
          lineStatus: { notIn: ["CANCELLED", "FULFILLED"] },
          requisition: {
            status: { notIn: ["Cancelled", "Rejected"] },
          },
        },
        select: { inventoryItemId: true, quantity: true },
      }),
      this.prisma.pOLine.findMany({
        where: {
          inventoryItemId: { in: itemIds },
          purchaseOrder: {
            status: { notIn: ["Draft", "Cancelled", "Closed"] },
          },
        },
        select: {
          inventoryItemId: true,
          quantity: true,
          receivedQuantity: true,
        },
      }),
    ]);

    const reqMap = new Map<string, { qty: number; count: number }>();
    for (const row of openReqRows) {
      if (row.inventoryItemId) {
        const existing = reqMap.get(row.inventoryItemId);
        if (existing) {
          existing.qty += Number(row.quantity);
          existing.count += 1;
        } else {
          reqMap.set(row.inventoryItemId, {
            qty: Number(row.quantity),
            count: 1,
          });
        }
      }
    }

    const poMap = new Map<string, { qty: number; count: number }>();
    for (const row of openPORows) {
      if (row.inventoryItemId) {
        const remainingQty = Math.max(
          0,
          Number(row.quantity) - Number(row.receivedQuantity),
        );
        if (remainingQty <= 0) continue;
        const existing = poMap.get(row.inventoryItemId);
        if (existing) {
          existing.qty += remainingQty;
          existing.count += 1;
        } else {
          poMap.set(row.inventoryItemId, { qty: remainingQty, count: 1 });
        }
      }
    }

    return { reqMap, poMap };
  }

  /**
   * Get items with supplier data included
   * Useful for displaying supplier information in lists
   */
  async getItemsWithSuppliers(
    context: ServiceContext,
    itemIds: string[],
  ): Promise<InventoryItemWithRelations[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const items = await this.prisma.inventoryItem.findMany({
      where: {
        id: { in: itemIds },
      },
      include: {
        stock: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                locationId: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            website: true,
            rating: true,
            paymentTerms: true,
            notes: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        equipment: {
          select: {
            id: true,
            tag: true,
            description: true,
            locationId: true,
            status: true,
            criticality: true,
            purchaseCost: true,
            replacementCost: true,
            currentMeter: true,
          },
        },
        suppliers: {
          where: { isActive: true },
          include: {
            supplier: true,
          },
          orderBy: [{ isPrimary: "desc" }, { supplier: { name: "asc" } }],
        },
      },
    });

    // Pre-fetch repairable counts in a single batch query
    const repairableItems2 = items.filter(
      (item) => (item as unknown as Record<string, unknown>).isRepairable,
    );
    const repairableIds2 = repairableItems2.map(
      (item) => (item as unknown as Record<string, unknown>).id as string,
    );
    let repairCountMap2 = new Map<string, number>();
    if (repairableIds2.length > 0) {
      const repairCounts2 = await this.prisma.repairableItem.groupBy({
        by: ["inventoryItemId"],
        where: {
          inventoryItemId: { in: repairableIds2 },
          status: {
            in: [
              "IN_REPAIR_INTERNAL",
              "IN_REPAIR_EXTERNAL",
              "REPAIR_COMPLETE",
              "AWAITING_PARTS",
            ],
          },
        },
        _count: { _all: true },
      });
      repairCountMap2 = new Map(
        repairCounts2.map((r) => [r.inventoryItemId, r._count._all]),
      );
    }

    return await Promise.all(
      items.map((item) => this.transformInventoryItem(item, repairCountMap2)),
    );
  }
}

// Export singleton instance - always create fresh in dev to pick up HMR changes
const globalForInventory = globalThis as unknown as {
  inventoryService: InventoryServiceV2 | undefined;
};
if (process.env.NODE_ENV !== "production") {
  globalForInventory.inventoryService = new InventoryServiceV2(prisma);
}
export const inventoryService =
  globalForInventory.inventoryService ??
  (globalForInventory.inventoryService = new InventoryServiceV2(prisma));
