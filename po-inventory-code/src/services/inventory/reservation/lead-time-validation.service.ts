/**
 * Lead Time Validation Service
 *
 * Service for validating lead times during reservation creation and
 * generating warnings for planners when parts cannot arrive in time.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Type system
import { ServiceContext } from "@/types/service-types";
import { PaginatedResponse } from "@/types/api";
import { PermissionResource, PermissionAction, buildPermissionString } from "@/types/permissions";

// Utility functions
import { checkPermission } from "@/services/shared/permissions";
import { validateOrThrow } from "@/services/shared/validation";
import { calculatePagination } from "@/lib/query-helpers";

// Type definitions
import {
  LeadTimeCalculation,
  LeadTimeValidationResult,
  LeadTimeWarning,
  LeadTimeWarningSummary,
  LeadTimeValidationRequestDTO,
  LeadTimeWarningFilterDTO,
  LeadTimeWarningSeverity,
  leadTimeValidationRequestSchema,
  leadTimeWarningFilterSchema,
  calculateSeverity,
  generateWarningMessage,
  generateRecommendation,
  isUrgentWarning,
} from "./lead-time-validation.types";

// Error types
import { ValidationError, NotFoundError } from "@/lib/api-errors";

/**
 * Lead Time Validation Service Class
 *
 * Provides operations for lead time validation and warning management.
 */
class LeadTimeValidationService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // VALIDATION OPERATIONS
  // ============================================================================

  /**
   * Validate lead time for a reservation
   * Called during reservation creation to check if part can arrive in time
   */
  async validateLeadTime(
    context: ServiceContext,
    data: LeadTimeValidationRequestDTO,
  ): Promise<LeadTimeValidationResult> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Validate data
    validateOrThrow(leadTimeValidationRequestSchema, data);

    // Get inventory item with supplier information
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      select: {
        id: true,
        sku: true,
        description: true,
        leadTimeDays: true, // Explicitly include item-level lead time
        suppliers: {
          where: { isActive: true },
          orderBy: { isPrimary: "desc" },
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                leadTimeDays: true,
              },
            },
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
            leadTimeDays: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", data.inventoryItemId);
    }

    // Parse planned start date from DTO
    const workOrderStartDate = new Date(data.plannedStartDate);

    if (isNaN(workOrderStartDate.getTime())) {
      throw new ValidationError("Invalid planned start date", [
        {
          field: "plannedStartDate",
          message: "Planned start date must be a valid date",
          code: "INVALID_DATE",
        },
      ]);
    }

    // Calculate lead time
    const calculation = this.calculateLeadTimeForItem(
      item,
      data.supplierId ?? null,
    );

    // Calculate dates and buffer
    const now = new Date();
    const orderByDate = new Date(workOrderStartDate);
    orderByDate.setDate(orderByDate.getDate() - calculation.leadTimeDays);

    const daysUntilWorkOrder = Math.ceil(
      (workOrderStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    const daysUntilOrderNeeded = Math.ceil(
      (orderByDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    const bufferDays = daysUntilWorkOrder - calculation.leadTimeDays;

    // Calculate severity
    const severity = calculateSeverity(bufferDays, daysUntilOrderNeeded);

    // Generate messages
    const message = generateWarningMessage(
      severity,
      calculation.leadTimeDays,
      bufferDays,
      daysUntilOrderNeeded,
    );

    const recommendation = generateRecommendation(
      severity,
      daysUntilOrderNeeded,
      calculation.supplierName,
    );

    // Determine if valid (not critical)
    const isValid = severity !== LeadTimeWarningSeverity.CRITICAL;

    return {
      isValid,
      severity,
      leadTimeDays: calculation.leadTimeDays,
      workOrderStartDate,
      orderByDate,
      daysUntilOrderNeeded,
      daysUntilWorkOrder,
      bufferDays,
      message,
      recommendation,
      calculation,
    };
  }

  /**
   * Get lead time warnings for a planner
   * Shows all reservations and work orders with lead time issues
   */
  async getLeadTimeWarnings(
    context: ServiceContext,
    filters?: LeadTimeWarningFilterDTO,
  ): Promise<PaginatedResponse<LeadTimeWarning>> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Validate filters
    const validatedFilters = filters
      ? validateOrThrow(leadTimeWarningFilterSchema, filters)
      : {};

    // Build pagination
    const page = validatedFilters.page ?? 1;
    const limit = validatedFilters.limit ?? 20;
    const { skip, take } = calculatePagination(page, limit);

    const daysAhead = validatedFilters.daysAhead ?? 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

    // Build work order filter
    const workOrderWhere: Prisma.WorkOrderWhereInput = {
      plannedStartDate: {
        lte: cutoffDate,
        gte: new Date(), // Only future work orders
      },
      status: {
        in: ["Requested", "Approved", "InProgress", "OnHold"],
      },
    };

    // Filter by planner if specified
    if (validatedFilters.plannerId) {
      workOrderWhere.plannerId = validatedFilters.plannerId;
    }

    // Filter by specific work order if specified
    if (validatedFilters.workOrderId) {
      workOrderWhere.id = validatedFilters.workOrderId;
    }

    // Get work orders
    const workOrders = await this.prisma.workOrder.findMany({
      where: workOrderWhere,
      select: {
        id: true,
        woNumber: true,
        title: true,
        plannedStartDate: true,
      },
      orderBy: {
        plannedStartDate: "asc",
      },
    });

    // Get reservations for these work orders
    const workOrderIds = workOrders.map((wo) => wo.id);
    const reservations = await this.prisma.inventoryReservation.findMany({
      where: {
        reservedFor: "WorkOrder",
        reservedForId: { in: workOrderIds },
        status: {
          in: ["ACTIVE", "PENDING_REVIEW"],
        },
      },
      include: {
        inventoryItem: {
          include: {
            suppliers: {
              where: { isActive: true, isPrimary: true },
              include: {
                supplier: {
                  select: {
                    id: true,
                    name: true,
                    leadTimeDays: true,
                  },
                },
              },
            },
            defaultSupplier: {
              select: {
                id: true,
                name: true,
                leadTimeDays: true,
              },
            },
          },
        },
      },
    });

    // Group reservations by work order
    const reservationsByWorkOrder = new Map<string, typeof reservations>();
    reservations.forEach((res) => {
      if (res.reservedForId) {
        if (!reservationsByWorkOrder.has(res.reservedForId)) {
          reservationsByWorkOrder.set(res.reservedForId, []);
        }
        reservationsByWorkOrder.get(res.reservedForId)?.push(res);
      }
    });

    // Generate warnings for each reservation
    const warnings: LeadTimeWarning[] = [];
    const now = new Date();

    for (const wo of workOrders) {
      if (!wo.plannedStartDate) continue;

      const woReservations = reservationsByWorkOrder.get(wo.id) ?? [];
      for (const reservation of woReservations) {
        // Calculate lead time
        const calculation = this.calculateLeadTimeForItem(
          reservation.inventoryItem,
          null,
        );

        // Calculate dates and buffer
        const orderByDate = new Date(wo.plannedStartDate);
        orderByDate.setDate(orderByDate.getDate() - calculation.leadTimeDays);

        const daysUntilWorkOrder = Math.ceil(
          (wo.plannedStartDate.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        const daysUntilOrderNeeded = Math.ceil(
          (orderByDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        const bufferDays = daysUntilWorkOrder - calculation.leadTimeDays;

        // Calculate severity
        const severity = calculateSeverity(bufferDays, daysUntilOrderNeeded);

        // Skip if filtering by severity
        if (
          validatedFilters.severity &&
          severity !== validatedFilters.severity
        ) {
          continue;
        }

        // Skip if filtering urgent only
        const isUrgent = isUrgentWarning(severity, daysUntilOrderNeeded);
        if (validatedFilters.urgentOnly && !isUrgent) {
          continue;
        }

        // Generate messages
        const message = generateWarningMessage(
          severity,
          calculation.leadTimeDays,
          bufferDays,
          daysUntilOrderNeeded,
        );

        const recommendation = generateRecommendation(
          severity,
          daysUntilOrderNeeded,
          calculation.supplierName,
        );

        warnings.push({
          id: `${wo.id}-${reservation.id}`,
          reservationId: reservation.id,
          inventoryItemId: reservation.inventoryItemId,
          inventoryItemSku: reservation.inventoryItem.sku,
          inventoryItemDescription: reservation.inventoryItem.description,
          quantity: Number(reservation.quantity),
          workOrderId: wo.id,
          workOrderNumber: wo.woNumber,
          workOrderTitle: wo.title,
          plannedStartDate: wo.plannedStartDate,
          leadTimeDays: calculation.leadTimeDays,
          orderByDate,
          daysUntilOrderNeeded,
          daysUntilWorkOrder,
          bufferDays,
          severity,
          isUrgent,
          message,
          recommendation,
          createdAt: reservation.createdAt,
        });
      }
    }

    // Sort by urgency (most urgent first)
    warnings.sort((a, b) => {
      // Critical first
      if (
        a.severity === LeadTimeWarningSeverity.CRITICAL &&
        b.severity !== LeadTimeWarningSeverity.CRITICAL
      )
        return -1;
      if (
        b.severity === LeadTimeWarningSeverity.CRITICAL &&
        a.severity !== LeadTimeWarningSeverity.CRITICAL
      )
        return 1;

      // Then by days until order needed
      return a.daysUntilOrderNeeded - b.daysUntilOrderNeeded;
    });

    // Apply pagination
    const total = warnings.length;
    const paginatedWarnings = warnings.slice(skip, skip + take);
    const totalPages = Math.ceil(total / take);

    return {
      success: true,
      data: paginatedWarnings,
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
   * Get lead time warning summary for dashboard
   */
  async getLeadTimeWarningSummary(
    context: ServiceContext,
    plannerId?: string,
  ): Promise<LeadTimeWarningSummary> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get all warnings
    const result = await this.getLeadTimeWarnings(context, {
      plannerId,
      daysAhead: 90,
      limit: 1000, // Get all warnings for summary
    });

    const warnings = result.data;

    // Count by severity
    const summary: LeadTimeWarningSummary = {
      total: warnings.length,
      critical: warnings.filter(
        (w) => w.severity === LeadTimeWarningSeverity.CRITICAL,
      ).length,
      high: warnings.filter((w) => w.severity === LeadTimeWarningSeverity.HIGH)
        .length,
      medium: warnings.filter(
        (w) => w.severity === LeadTimeWarningSeverity.MEDIUM,
      ).length,
      low: warnings.filter((w) => w.severity === LeadTimeWarningSeverity.LOW)
        .length,
      urgent: warnings.filter((w) => w.isUrgent).length,
    };

    return summary;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate lead time for an inventory item
   * Priority: Item-specific supplier > Item default > Supplier default > System default (14 days)
   */
  private calculateLeadTimeForItem(
    item: {
      id: string;
      sku: string;
      description: string;
      leadTimeDays: number | null;
      suppliers: Array<{
        leadTimeDays: number;
        isPrimary: boolean;
        supplier: {
          id: string;
          name: string;
          leadTimeDays: number | null;
        };
      }>;
      defaultSupplier: {
        id: string;
        name: string;
        leadTimeDays: number | null;
      } | null;
    },
    preferredSupplierId: string | null,
  ): LeadTimeCalculation {
    let leadTimeDays = 14; // System default
    let source = "system_default";
    let confidence = "low";
    let supplierId: string | null = null;
    let supplierName: string | null = null;

    // Priority 1: Preferred supplier (if specified)
    if (preferredSupplierId) {
      const preferredSupplier = item.suppliers.find(
        (s) => s.supplier.id === preferredSupplierId,
      );
      if (preferredSupplier) {
        leadTimeDays = preferredSupplier.leadTimeDays;
        source = "item_supplier";
        confidence = "high";
        supplierId = preferredSupplier.supplier.id;
        supplierName = preferredSupplier.supplier.name;
        return {
          inventoryItemId: item.id,
          inventoryItemSku: item.sku,
          inventoryItemDescription: item.description,
          leadTimeDays,
          source,
          confidence,
          supplierId,
          supplierName,
        };
      }
    }

    // Priority 2: Primary supplier for this item
    const primarySupplier = item.suppliers.find((s) => s.isPrimary);
    if (primarySupplier) {
      leadTimeDays = primarySupplier.leadTimeDays;
      source = "item_supplier";
      confidence = "high";
      supplierId = primarySupplier.supplier.id;
      supplierName = primarySupplier.supplier.name;
      return {
        inventoryItemId: item.id,
        inventoryItemSku: item.sku,
        inventoryItemDescription: item.description,
        leadTimeDays,
        source,
        confidence,
        supplierId,
        supplierName,
      };
    }

    // Priority 3: Item-level lead time
    if (item.leadTimeDays !== null) {
      leadTimeDays = item.leadTimeDays;
      source = "item_default";
      confidence = "medium";

      // Use default supplier if available
      if (item.defaultSupplier) {
        supplierId = item.defaultSupplier.id;
        supplierName = item.defaultSupplier.name;
      }

      return {
        inventoryItemId: item.id,
        inventoryItemSku: item.sku,
        inventoryItemDescription: item.description,
        leadTimeDays,
        source,
        confidence,
        supplierId,
        supplierName,
      };
    }

    // Priority 4: Default supplier general lead time
    if (
      item.defaultSupplier?.leadTimeDays !== null &&
      item.defaultSupplier?.leadTimeDays !== undefined
    ) {
      leadTimeDays = item.defaultSupplier.leadTimeDays;
      source = "supplier_default";
      confidence = "medium";
      supplierId = item.defaultSupplier.id;
      supplierName = item.defaultSupplier.name;
      return {
        inventoryItemId: item.id,
        inventoryItemSku: item.sku,
        inventoryItemDescription: item.description,
        leadTimeDays,
        source,
        confidence,
        supplierId,
        supplierName,
      };
    }

    // Priority 5: First available supplier
    if (item.suppliers.length > 0 && item.suppliers[0]) {
      leadTimeDays = item.suppliers[0].leadTimeDays;
      source = "item_supplier";
      confidence = "medium";
      supplierId = item.suppliers[0].supplier.id;
      supplierName = item.suppliers[0].supplier.name;
      return {
        inventoryItemId: item.id,
        inventoryItemSku: item.sku,
        inventoryItemDescription: item.description,
        leadTimeDays,
        source,
        confidence,
        supplierId,
        supplierName,
      };
    }

    // Fallback: System default
    return {
      inventoryItemId: item.id,
      inventoryItemSku: item.sku,
      inventoryItemDescription: item.description,
      leadTimeDays,
      source,
      confidence,
      supplierId,
      supplierName,
    };
  }
}

// Export singleton instance
const globalForLeadTimeValidation = globalThis as unknown as { leadTimeValidationService: LeadTimeValidationService | undefined };
export const leadTimeValidationService = globalForLeadTimeValidation.leadTimeValidationService ?? (globalForLeadTimeValidation.leadTimeValidationService = new LeadTimeValidationService(prisma));
