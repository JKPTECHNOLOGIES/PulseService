/**
 * Inventory Item Supplier Service
 *
 * Manages multi-supplier relationships for inventory items:
 * - CRUD operations for supplier assignments
 * - Supplier scoring and selection algorithms
 * - Lead time calculations
 * - Delivery performance tracking
 * - Supplier comparison and analysis
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Type system
import { ServiceContext } from "@/types/service-types";
import { PaginatedResponse } from "@/types/api";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";

// Utility functions
import { checkPermission } from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import { calculatePagination } from "@/lib/query-helpers";

// Type definitions
import {
  InventoryItemSupplierCreateDTO,
  InventoryItemSupplierUpdateDTO,
  DeliveryPerformanceDTO,
  BulkSupplierAssignmentDTO,
  InventoryItemSupplierWithRelations,
  SupplierComparison,
  SupplierComparisonEntry,
  LeadTimeCalculation,
  SupplierSelectionResult,
  SupplierPerformanceMetrics,
  SupplierScoringWeights,
  DEFAULT_SCORING_WEIGHTS,
  inventoryItemSupplierCreateSchema,
  inventoryItemSupplierUpdateSchema,
  deliveryPerformanceSchema,
  bulkSupplierAssignmentSchema,
  calculateOnTimeRate,
  calculateSupplierScore,
} from "./inventory-item-supplier.types";

// Error types
import {
  ValidationError,
  NotFoundError,
  BadRequestError,
} from "@/lib/api-errors";

/**
 * Inventory Item Supplier Service
 *
 * Manages supplier relationships with:
 * - Direct Prisma operations
 * - Proper type safety
 * - Supplier scoring algorithms
 * - Lead time calculations
 */
class InventoryItemSupplierService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;
  private readonly DEFAULT_LEAD_TIME = 14; // System default: 14 days

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * List supplier relationships for an inventory item
   */
  async listForItem(
    context: ServiceContext,
    inventoryItemId: string,
    options?: {
      page?: number;
      limit?: number;
      activeOnly?: boolean;
    },
  ): Promise<PaginatedResponse<InventoryItemSupplierWithRelations>> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Validate item ID
    validateRequired(inventoryItemId, "inventoryItemId");

    // Build pagination
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const { skip, take } = calculatePagination(page, limit);

    // Build where clause
    const where: Prisma.InventoryItemSupplierWhereInput = {
      inventoryItemId,
    };

    if (options?.activeOnly) {
      where.isActive = true;
    }

    // Execute query
    const [suppliers, total] = await Promise.all([
      this.prisma.inventoryItemSupplier.findMany({
        where,
        include: {
          inventoryItem: true,
          supplier: true,
        },
        skip,
        take,
        orderBy: [
          { isPrimary: "desc" },
          { isActive: "desc" },
          { supplier: { name: "asc" } },
        ],
      }),
      this.prisma.inventoryItemSupplier.count({ where }),
    ]);

    // Transform suppliers
    const transformedSuppliers = suppliers.map((s) =>
      this.transformSupplierRelation(s),
    );

    // Calculate pagination
    const totalPages = Math.ceil(total / take);

    return {
      success: true,
      data: transformedSuppliers,
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
   * Get a single supplier relationship by ID
   */
  async getById(
    context: ServiceContext,
    id: string,
  ): Promise<InventoryItemSupplierWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Fetch supplier relationship
    const supplierRelation = await this.prisma.inventoryItemSupplier.findUnique(
      {
        where: { id },
        include: {
          inventoryItem: true,
          supplier: true,
        },
      },
    );

    if (!supplierRelation) {
      throw new NotFoundError("InventoryItemSupplier", id);
    }

    return this.transformSupplierRelation(supplierRelation);
  }

  /**
   * Create a new supplier relationship
   */
  async create(
    context: ServiceContext,
    data: InventoryItemSupplierCreateDTO,
  ): Promise<InventoryItemSupplierWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.CREATE,
    );
    await checkPermission(context, permission);

    // Validate data
    await this.validateCreate(data);

    // If setting as primary, unset other primary suppliers for this item
    if (data.isPrimary) {
      await this.prisma.inventoryItemSupplier.updateMany({
        where: {
          inventoryItemId: data.inventoryItemId,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });
    }

    // Create supplier relationship
    const supplierRelation = await this.prisma.inventoryItemSupplier.create({
      data: {
        inventoryItemId: data.inventoryItemId,
        supplierId: data.supplierId,
        supplierSku: data.supplierSku ?? null,
        unitCost: data.unitCost,
        leadTimeDays: data.leadTimeDays,
        minimumOrderQty: data.minimumOrderQty ?? null,
        isPrimary: data.isPrimary,
        isActive: data.isActive,
        qualityRating: data.qualityRating ?? null,
        notes: data.notes ?? null,
        createdBy: context.userId,
        onTimeDeliveries: 0,
        totalDeliveries: 0,
      },
      include: {
        inventoryItem: true,
        supplier: true,
      },
    });

    return this.transformSupplierRelation(supplierRelation);
  }

  /**
   * Update an existing supplier relationship
   */
  async update(
    context: ServiceContext,
    id: string,
    data: InventoryItemSupplierUpdateDTO,
  ): Promise<InventoryItemSupplierWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Validate update data
    await this.validateUpdate(id, data);

    // Get existing relationship
    const existing = await this.prisma.inventoryItemSupplier.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError("InventoryItemSupplier", id);
    }

    // If setting as primary, unset other primary suppliers for this item
    if (data.isPrimary && !existing.isPrimary) {
      await this.prisma.inventoryItemSupplier.updateMany({
        where: {
          inventoryItemId: existing.inventoryItemId,
          isPrimary: true,
          id: { not: id },
        },
        data: {
          isPrimary: false,
        },
      });
    }

    // Prepare update data
    const updateData: Prisma.InventoryItemSupplierUpdateInput = {};

    if (data.supplierSku !== undefined)
      updateData.supplierSku = data.supplierSku;
    if (data.unitCost !== undefined) updateData.unitCost = data.unitCost;
    if (data.leadTimeDays !== undefined)
      updateData.leadTimeDays = data.leadTimeDays;
    if (data.minimumOrderQty !== undefined)
      updateData.minimumOrderQty = data.minimumOrderQty;
    if (data.isPrimary !== undefined) updateData.isPrimary = data.isPrimary;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.qualityRating !== undefined)
      updateData.qualityRating = data.qualityRating;
    if (data.notes !== undefined) updateData.notes = data.notes;

    // Update supplier relationship
    const supplierRelation = await this.prisma.inventoryItemSupplier.update({
      where: { id },
      data: updateData,
      include: {
        inventoryItem: true,
        supplier: true,
      },
    });

    return this.transformSupplierRelation(supplierRelation);
  }

  /**
   * Delete a supplier relationship
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

    // Check if exists
    const existing = await this.prisma.inventoryItemSupplier.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError("InventoryItemSupplier", id);
    }

    // Delete supplier relationship
    await this.prisma.inventoryItemSupplier.delete({
      where: { id },
    });
  }

  // ============================================================================
  // DELIVERY PERFORMANCE TRACKING
  // ============================================================================

  /**
   * Record delivery performance for a supplier
   */
  async recordDeliveryPerformance(
    context: ServiceContext,
    id: string,
    data: DeliveryPerformanceDTO,
  ): Promise<InventoryItemSupplierWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Validate data
    const validation = deliveryPerformanceSchema.safeParse(data);
    if (!validation.success) {
      const errors = validation.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw new ValidationError("Validation failed", errors);
    }

    // Get existing relationship
    const existing = await this.prisma.inventoryItemSupplier.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError("InventoryItemSupplier", id);
    }

    // Update delivery metrics
    const updateData: Prisma.InventoryItemSupplierUpdateInput = {
      totalDeliveries: existing.totalDeliveries + 1,
      lastOrderDate: new Date(),
    };

    if (data.wasOnTime) {
      updateData.onTimeDeliveries = existing.onTimeDeliveries + 1;
    }

    if (data.qualityRating !== undefined) {
      updateData.qualityRating = data.qualityRating;
    }

    if (data.notes) {
      const existingNotes = existing.notes ?? "";
      const timestamp = new Date().toISOString();
      updateData.notes =
        `${existingNotes}\n[${timestamp}] ${data.notes}`.trim();
    }

    // Update relationship
    const supplierRelation = await this.prisma.inventoryItemSupplier.update({
      where: { id },
      data: updateData,
      include: {
        inventoryItem: true,
        supplier: true,
      },
    });

    return this.transformSupplierRelation(supplierRelation);
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Assign a supplier to multiple inventory items
   */
  async bulkAssignSupplier(
    context: ServiceContext,
    data: BulkSupplierAssignmentDTO,
  ): Promise<{ created: number; errors: string[] }> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.CREATE,
    );
    await checkPermission(context, permission);

    // Validate data
    const validation = bulkSupplierAssignmentSchema.safeParse(data);
    if (!validation.success) {
      const errors = validation.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw new ValidationError("Validation failed", errors);
    }

    // Verify supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: data.supplierId },
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", data.supplierId);
    }

    let created = 0;
    const errors: string[] = [];

    // Process each item
    for (const itemId of data.inventoryItemIds) {
      try {
        // Check if relationship already exists
        const existing = await this.prisma.inventoryItemSupplier.findUnique({
          where: {
            inventoryItemId_supplierId: {
              inventoryItemId: itemId,
              supplierId: data.supplierId,
            },
          },
        });

        if (existing) {
          errors.push(`Supplier already assigned to item ${itemId}`);
          continue;
        }

        // If setting as primary, unset other primary suppliers
        if (data.isPrimary) {
          await this.prisma.inventoryItemSupplier.updateMany({
            where: {
              inventoryItemId: itemId,
              isPrimary: true,
            },
            data: {
              isPrimary: false,
            },
          });
        }

        // Create relationship
        await this.prisma.inventoryItemSupplier.create({
          data: {
            inventoryItemId: itemId,
            supplierId: data.supplierId,
            unitCost: data.unitCost,
            leadTimeDays: data.leadTimeDays,
            isPrimary: data.isPrimary || false,
            isActive: true,
            createdBy: context.userId,
            onTimeDeliveries: 0,
            totalDeliveries: 0,
          },
        });

        created++;
      } catch (error) {
        errors.push(
          `Failed to assign supplier to item ${itemId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    return { created, errors };
  }

  // ============================================================================
  // SUPPLIER COMPARISON AND ANALYSIS
  // ============================================================================

  /**
   * Compare suppliers for an inventory item
   */
  async compareSuppliers(
    context: ServiceContext,
    inventoryItemId: string,
    weights?: SupplierScoringWeights,
  ): Promise<SupplierComparison> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get inventory item
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });

    if (!item) {
      throw new NotFoundError("InventoryItem", inventoryItemId);
    }

    // Get all suppliers for this item
    const suppliers = await this.prisma.inventoryItemSupplier.findMany({
      where: {
        inventoryItemId,
        isActive: true,
      },
      include: {
        supplier: true,
      },
    });

    // Transform to comparison entries
    const entries: SupplierComparisonEntry[] = suppliers.map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplier.name,
      supplierCode: s.supplier.code,
      supplierSku: s.supplierSku,
      unitCost: Number(s.unitCost),
      leadTimeDays: s.leadTimeDays,
      minimumOrderQty: s.minimumOrderQty ? Number(s.minimumOrderQty) : null,
      isPrimary: s.isPrimary,
      isActive: s.isActive,
      onTimeDeliveries: s.onTimeDeliveries,
      totalDeliveries: s.totalDeliveries,
      onTimeRate: calculateOnTimeRate(s.onTimeDeliveries, s.totalDeliveries),
      qualityRating: s.qualityRating ? Number(s.qualityRating) : null,
      lastOrderDate: s.lastOrderDate,
      score: 0, // Will be calculated below
      notes: s.notes,
    }));

    // Calculate scores for each supplier
    const scoringWeights = weights ?? DEFAULT_SCORING_WEIGHTS;
    entries.forEach((entry) => {
      entry.score = calculateSupplierScore(entry, entries, scoringWeights);
    });

    // Sort by score (highest first)
    entries.sort((a, b) => b.score - a.score);

    // Determine recommended supplier (highest score)
    const recommendedSupplierId =
      entries.length > 0 && entries[0] ? entries[0].supplierId : null;

    return {
      inventoryItemId,
      inventoryItemSku: item.sku,
      inventoryItemDescription: item.description,
      suppliers: entries,
      recommendedSupplierId,
    };
  }

  /**
   * Get supplier performance metrics
   */
  async getSupplierPerformance(
    context: ServiceContext,
    supplierId: string,
  ): Promise<SupplierPerformanceMetrics> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get supplier
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", supplierId);
    }

    // Get all items for this supplier
    const items = await this.prisma.inventoryItemSupplier.findMany({
      where: { supplierId },
    });

    // Calculate metrics
    const totalItems = items.length;
    const activeItems = items.filter((i) => i.isActive).length;
    const primaryItems = items.filter((i) => i.isPrimary).length;

    const totalDeliveries = items.reduce(
      (sum, i) => sum + i.totalDeliveries,
      0,
    );
    const onTimeDeliveries = items.reduce(
      (sum, i) => sum + i.onTimeDeliveries,
      0,
    );
    const onTimeRate = calculateOnTimeRate(onTimeDeliveries, totalDeliveries);

    const averageUnitCost =
      totalItems > 0
        ? items.reduce((sum, i) => sum + Number(i.unitCost), 0) / totalItems
        : 0;

    const averageLeadTime =
      totalItems > 0
        ? items.reduce((sum, i) => sum + i.leadTimeDays, 0) / totalItems
        : 0;

    const qualityRatings = items
      .filter((i) => i.qualityRating !== null)
      .map((i) => Number(i.qualityRating));
    const averageQualityRating =
      qualityRatings.length > 0
        ? qualityRatings.reduce((sum, r) => sum + r, 0) / qualityRatings.length
        : null;

    const lastOrderDates = items
      .filter((i) => i.lastOrderDate !== null)
      .map((i) => i.lastOrderDate as Date);
    const lastOrderDate =
      lastOrderDates.length > 0
        ? new Date(Math.max(...lastOrderDates.map((d) => d.getTime())))
        : null;

    return {
      supplierId,
      supplierName: supplier.name,
      totalItems,
      averageUnitCost,
      averageLeadTime,
      totalDeliveries,
      onTimeDeliveries,
      onTimeRate,
      averageQualityRating,
      lastOrderDate,
      activeItems,
      primaryItems,
    };
  }

  // ============================================================================
  // LEAD TIME CALCULATIONS
  // ============================================================================

  /**
   * Calculate lead time for an inventory item
   * Uses 4-tier priority: item-supplier > item-average > supplier-general > system-default
   */
  async calculateLeadTime(
    context: ServiceContext,
    inventoryItemId: string,
    supplierId?: string,
  ): Promise<LeadTimeCalculation> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get inventory item
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: {
        suppliers: {
          where: { isActive: true },
          include: { supplier: true },
        },
        defaultSupplier: true,
      },
    });

    if (!item) {
      throw new NotFoundError("InventoryItem", inventoryItemId);
    }

    // Priority 1: Item-specific supplier lead time
    if (supplierId) {
      const itemSupplier = item.suppliers.find(
        (s) => s.supplierId === supplierId,
      );
      if (itemSupplier) {
        return {
          inventoryItemId,
          supplierId,
          leadTimeDays: itemSupplier.leadTimeDays,
          source: "item-supplier",
          confidence: itemSupplier.totalDeliveries > 0 ? "high" : "medium",
          notes: `Specific lead time for this item from ${itemSupplier.supplier.name}`,
        };
      }
    }

    // Priority 2: Item-level lead time (if set)
    if (item.leadTimeDays !== null) {
      return {
        inventoryItemId,
        supplierId: null,
        leadTimeDays: item.leadTimeDays,
        source: "item-supplier",
        confidence: "medium",
        notes: "Item-specific lead time",
      };
    }

    // Priority 3: Average of all supplier lead times for this item
    if (item.suppliers.length > 0) {
      const avgLeadTime = Math.round(
        item.suppliers.reduce((sum, s) => sum + s.leadTimeDays, 0) /
          item.suppliers.length,
      );
      return {
        inventoryItemId,
        supplierId: null,
        leadTimeDays: avgLeadTime,
        source: "item-average",
        confidence: "medium",
        notes: `Average of ${item.suppliers.length} supplier lead times`,
      };
    }

    // Priority 4: Default supplier general lead time
    if (item.defaultSupplier && item.defaultSupplier.leadTimeDays !== null) {
      return {
        inventoryItemId,
        supplierId: item.defaultSupplierId,
        leadTimeDays: item.defaultSupplier.leadTimeDays,
        source: "supplier-general",
        confidence: "low",
        notes: `General lead time from default supplier ${item.defaultSupplier.name}`,
      };
    }

    // Priority 5: System default
    return {
      inventoryItemId,
      supplierId: null,
      leadTimeDays: this.DEFAULT_LEAD_TIME,
      source: "system-default",
      confidence: "low",
      notes: "System default lead time (no supplier data available)",
    };
  }

  /**
   * Select best supplier for an inventory item
   */
  async selectBestSupplier(
    context: ServiceContext,
    inventoryItemId: string,
    weights?: SupplierScoringWeights,
  ): Promise<SupplierSelectionResult> {
    // Get supplier comparison
    const comparison = await this.compareSuppliers(
      context,
      inventoryItemId,
      weights,
    );

    if (comparison.suppliers.length === 0) {
      throw new BadRequestError("No active suppliers found for this item");
    }

    // Best supplier is first (highest score)
    const best = comparison.suppliers[0];
    if (!best) {
      throw new BadRequestError("No suppliers available for selection");
    }

    // Get alternatives (next 3 suppliers)
    const alternatives = comparison.suppliers.slice(1, 4).map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      score: s.score,
      reason: this.getSupplierScoreReason(s),
    }));

    return {
      supplierId: best.supplierId,
      supplierName: best.supplierName,
      unitCost: best.unitCost,
      leadTimeDays: best.leadTimeDays,
      score: best.score,
      reason: this.getSupplierScoreReason(best),
      alternatives,
    };
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate supplier relationship creation data
   */
  private async validateCreate(
    data: InventoryItemSupplierCreateDTO,
  ): Promise<void> {
    // Validate with Zod schema
    const validation = inventoryItemSupplierCreateSchema.safeParse(data);
    if (!validation.success) {
      const errors = validation.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw new ValidationError("Validation failed", errors);
    }

    // Check inventory item exists
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
    });

    if (!item) {
      throw new ValidationError("Inventory item not found", [
        {
          field: "inventoryItemId",
          message: "Inventory item not found",
        },
      ]);
    }

    // Check supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: data.supplierId },
    });

    if (!supplier) {
      throw new ValidationError("Supplier not found", [
        {
          field: "supplierId",
          message: "Supplier not found",
        },
      ]);
    }

    // Check for duplicate relationship
    const existing = await this.prisma.inventoryItemSupplier.findUnique({
      where: {
        inventoryItemId_supplierId: {
          inventoryItemId: data.inventoryItemId,
          supplierId: data.supplierId,
        },
      },
    });

    if (existing) {
      throw new ValidationError("Supplier already assigned to this item", [
        {
          field: "supplierId",
          message: "This supplier is already assigned to this inventory item",
        },
      ]);
    }
  }

  /**
   * Validate supplier relationship update data
   */
  private async validateUpdate(
    id: string,
    data: InventoryItemSupplierUpdateDTO,
  ): Promise<void> {
    // Validate with Zod schema
    const validation = inventoryItemSupplierUpdateSchema.safeParse(data);
    if (!validation.success) {
      const errors = validation.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw new ValidationError("Validation failed", errors);
    }

    // Check relationship exists
    const existing = await this.prisma.inventoryItemSupplier.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError("InventoryItemSupplier", id);
    }
  }

  // ============================================================================
  // TRANSFORMATION METHODS
  // ============================================================================

  /**
   * Transform Prisma supplier relationship to API response format
   */
  private transformSupplierRelation(
    relation: Record<string, unknown>,
  ): InventoryItemSupplierWithRelations {
    const r = relation;
    const onTimeDeliveries = Number(r.onTimeDeliveries) || 0;
    const totalDeliveries = Number(r.totalDeliveries) || 0;
    const leadTimeDays = Number(r.leadTimeDays) || 0;

    const onTimeRate = calculateOnTimeRate(onTimeDeliveries, totalDeliveries);

    // Calculate average lead time if there's delivery history
    const averageLeadTime = totalDeliveries > 0 ? leadTimeDays : null;

    return {
      ...r,
      unitCost: Number(r.unitCost),
      minimumOrderQty: r.minimumOrderQty ? Number(r.minimumOrderQty) : null,
      qualityRating: r.qualityRating ? Number(r.qualityRating) : null,
      onTimeRate,
      averageLeadTime,
    } as unknown as InventoryItemSupplierWithRelations;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Get human-readable reason for supplier score
   */
  private getSupplierScoreReason(supplier: SupplierComparisonEntry): string {
    const reasons: string[] = [];

    if (supplier.isPrimary) {
      reasons.push("Primary supplier");
    }

    if (supplier.onTimeRate >= 95) {
      reasons.push("Excellent on-time delivery");
    } else if (supplier.onTimeRate >= 90) {
      reasons.push("Good on-time delivery");
    }

    if (supplier.qualityRating && supplier.qualityRating >= 4.5) {
      reasons.push("Excellent quality rating");
    } else if (supplier.qualityRating && supplier.qualityRating >= 4.0) {
      reasons.push("Good quality rating");
    }

    if (supplier.leadTimeDays <= 7) {
      reasons.push("Fast delivery");
    } else if (supplier.leadTimeDays <= 14) {
      reasons.push("Standard delivery time");
    }

    if (reasons.length === 0) {
      return "Based on overall scoring";
    }

    return reasons.join(", ");
  }
}

// Export singleton instance
const globalForInventoryItemSupplier = globalThis as unknown as { inventoryItemSupplierService: InventoryItemSupplierService | undefined };
export const inventoryItemSupplierService = globalForInventoryItemSupplier.inventoryItemSupplierService ?? (globalForInventoryItemSupplier.inventoryItemSupplierService = new InventoryItemSupplierService(
  prisma,
));
