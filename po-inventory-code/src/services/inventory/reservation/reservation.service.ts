/**
 * Inventory Reservation Service - Refactored Core CRUD
 *
 * Core service for inventory reservation CRUD operations only.
 * Specialized operations delegated to:
 * - reservation-lifecycle.service.ts (consume, cancel, expire)
 * - reservation-query.service.ts (queries and summaries)
 * - reservation-availability.service.ts (availability checking)
 * - reservation-automation.service.ts (notifications, auto-requisitions)
 */

import { PrismaClient, Prisma, WorkOrderPartStatus } from "@prisma/client";
import {
  logReservationCreate,
  logStockReservation,
  logError,
  LogCategory,
} from "@/lib/reservation-schedule-logger";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { PaginatedResponse } from "@/types/api";
import {
  PermissionResource,
  ExtendedPermissionAction,
  PermissionAction,
  buildPermissionString,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import {
  calculatePagination,
  buildOrderBy,
  buildSearchWhere,
} from "@/lib/query-helpers";
import { toNumber } from "@/lib/decimal-helpers";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { logInventoryEvent } from "@/lib/event-logger";
import { inventoryStockService } from "@/services/inventory/stock";
import {
  ReservationCreateDTO,
  ReservationUpdateDTO,
  ReservationWithRelations,
  ReservationStatus,
} from "./reservation.types";
import {
  buildReservationInclude,
  transformReservation,
  calculateReservationStatus,
  recalculateFifoActive,
} from "./reservation-utils";
import {
  validateReservationCreate,
  validateReservationUpdate,
} from "./reservation-validation";
import { reservationAutomationService } from "./reservation-automation.service";
import { reservationSettingsService } from "./reservation-settings.service";

interface StockCheckPromptResult {
  stockCheckResult: {
    needsPrompt: boolean;
    shortage: boolean;
    willHitMin: boolean;
    message: string;
    currentStock: number;
    requestedQty: number;
    minQty: number;
    availableQty: number;
  };
}

/**
 * Reservation Service Class - Core CRUD Only
 *
 * Provides CRUD operations for inventory reservations.
 * Delegates specialized operations to other services.
 */
class ReservationService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // CORE CRUD OPERATIONS
  // ============================================================================

  /**
   * Get a single reservation by ID
   */
  async getById(
    context: ServiceContext,
    id: string,
  ): Promise<ReservationWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Fetch reservation
    const reservation = await this.prisma.inventoryReservation.findUnique({
      where: { id },
      include: buildReservationInclude(),
    });

    if (!reservation) {
      throw new NotFoundError("Inventory Reservation", id);
    }

    return transformReservation(reservation);
  }

  /**
   * Alias for getById (backward compatibility)
   */
  findById(
    context: ServiceContext,
    id: string,
  ): Promise<ReservationWithRelations> {
    return this.getById(context, id);
  }

  /**
   * List reservations with pagination and filtering
   */
  async findMany(
    context: ServiceContext,
    options?: {
      page?: number;
      limit?: number;
      sort?: string;
      order?: "asc" | "desc";
      filters?: Record<string, unknown>;
      search?: string;
    },
  ): Promise<PaginatedResponse<ReservationWithRelations>> {
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
    const where: Prisma.InventoryReservationWhereInput = {
      ...options?.filters,
    };

    // Add search filter if provided
    if (options?.search) {
      const searchWhere = buildSearchWhere(options.search, ["notes"]);
      Object.assign(where, searchWhere);
    }

    // Build order by
    const orderBy = options?.sort
      ? buildOrderBy(options.sort, options.order ?? "asc")
      : { createdAt: "desc" as const };

    // Execute query
    const [items, total] = await Promise.all([
      this.prisma.inventoryReservation.findMany({
        where,
        include: buildReservationInclude(),
        skip,
        take,
        orderBy,
      }),
      this.prisma.inventoryReservation.count({ where }),
    ]);

    // Transform items
    const transformedItems = items.map((item) => transformReservation(item));

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
   * Alias for findMany (backward compatibility)
   */
  findAll(
    context: ServiceContext,
    options?: {
      page?: number;
      limit?: number;
      sort?: string;
      order?: "asc" | "desc";
      filters?: Record<string, unknown>;
      search?: string;
    },
  ): Promise<PaginatedResponse<ReservationWithRelations>> {
    return this.findMany(context, options);
  }

  /**
   * Create a new reservation
   * Handles scenarios based on configurable settings:
   * - TIME_BASED mode: Uses daysThreshold to determine ACTIVE vs PENDING_REVIEW
   * - PROMPT_BASED mode: Always ACTIVE, prompts handled at UI level
   *
   * IDEMPOTENCY: Checks for existing active reservation before creating new one
   */
  async create(
    context: ServiceContext,
    data: ReservationCreateDTO,
  ): Promise<ReservationWithRelations | StockCheckPromptResult> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    // Validate data
    await validateReservationCreate(this.prisma, data);

    // Fetch reservation settings (no permission check needed for internal use)
    const settings = await reservationSettingsService.getSettingsInternal();

    // GAP 1 FIX: Non-stock items (isStockItem = false) must never have inventory
    // reservations created against them.  They are not tracked in stock and have no
    // quantityOnHand to reserve against.  Creating a reservation on a non-stock item
    // produces phantom negative-available quantities (quantityReserved > quantityOnHand).
    // Non-stock parts must be ordered via REQ/PO using createNonStockRequisition().
    const itemCheck = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      select: { sku: true, isStockItem: true },
    });
    if (!itemCheck) {
      throw new NotFoundError("Inventory Item", data.inventoryItemId);
    }
    if (!itemCheck.isStockItem) {
      throw new BadRequestError(
        `Cannot reserve non-stock item ${itemCheck.sku}. ` +
        `Non-stock parts must be ordered via a Purchase Requisition. ` +
        `Use the "Order Part" button on the Work Order parts page.`,
      );
    }

    // PROMPT_BASED MODE: Check stock BEFORE creating reservation
    if (settings.mode === 'PROMPT_BASED' && !data.skipStockCheck) {
      // Get inventory item with stock info
      const inventoryItem = await this.prisma.inventoryItem.findUnique({
        where: { id: data.inventoryItemId },
        include: { stock: true },
      });

      if (!inventoryItem) {
        throw new NotFoundError("Inventory Item", data.inventoryItemId);
      }

      // Calculate current stock levels
      const currentOnHand = inventoryItem.stock.reduce(
        (sum, s) => sum + (Number(s.quantityOnHand) || 0),
        0
      );
      const currentReserved = inventoryItem.stock.reduce(
        (sum, s) => sum + (Number(s.quantityReserved) || 0),
        0
      );
      const minQty = Number(inventoryItem.minQuantity) || 0;

      // Check stock
      const stockCheck = await reservationSettingsService.checkStockForPrompt(
        data.inventoryItemId,
        data.quantity,
        currentOnHand,
        currentReserved,
        minQty,
      );

      // If stock check indicates we should prompt, return the result
      if (stockCheck.shouldPrompt) {
        return {
          stockCheckResult: {
            needsPrompt: true,
            shortage: stockCheck.reason === 'STOCK_SHORTAGE',
            willHitMin: stockCheck.reason === 'MIN_QTY_HIT',
            message: stockCheck.message,
            currentStock: stockCheck.currentStock,
            requestedQty: stockCheck.requestedQty,
            minQty: stockCheck.minQty,
            availableQty: stockCheck.availableQty,
          },
        };
      }
    }

    // IDEMPOTENCY CHECK: Look for existing active reservation
    if (data.reservedFor && data.reservedForId) {
      const existingReservation = await this.prisma.inventoryReservation.findFirst({
        where: {
          inventoryItemId: data.inventoryItemId,
          reservedFor: data.reservedFor,
          reservedForId: data.reservedForId,
          status: {
            in: [ReservationStatus.ACTIVE, ReservationStatus.PENDING_REVIEW, ReservationStatus.PENDING],
          },
        },
        include: buildReservationInclude(),
      });

      if (existingReservation) {
        // If quantities are different, update the existing reservation
        if (Number(existingReservation.quantity) !== data.quantity) {
          // Calculate the difference for stock adjustment
          const quantityDiff = data.quantity - Number(existingReservation.quantity);
          
          // If PROMPT_BASED mode and existing is PENDING_REVIEW, upgrade to ACTIVE
          const shouldActivate = settings.mode === 'PROMPT_BASED' && existingReservation.status === ReservationStatus.PENDING_REVIEW;
          
          // Update the reservation quantity (and status if activating)
          const updatedReservation = await this.prisma.inventoryReservation.update({
            where: { id: existingReservation.id },
            data: {
              quantity: data.quantity,
              ...(shouldActivate && { status: ReservationStatus.ACTIVE, reviewDate: null }),
            },
            include: buildReservationInclude(),
          });
          
          // Stock adjustment logic:
          // - If activating from PENDING_REVIEW: reserve the FULL new quantity (no stock was reserved before)
          // - If already ACTIVE: adjust by the difference
          if (shouldActivate) {
            await inventoryStockService.reserve(
              data.inventoryItemId,
              data.quantity,
              {
                context,
                storeId: undefined,
                reason: `Reservation ${existingReservation.id} activated from PENDING_REVIEW (qty updated)`,
                referenceType: "MANUAL",
                referenceId: existingReservation.id,
              },
            );
          } else if (existingReservation.status === ReservationStatus.ACTIVE && quantityDiff !== 0) {
            if (quantityDiff > 0) {
              // Reserve additional stock
              await inventoryStockService.reserve(
                data.inventoryItemId,
                quantityDiff,
                {
                  context,
                  storeId: undefined,
                  reason: `Reservation ${existingReservation.id} quantity increased`,
                  referenceType: "MANUAL",
                  referenceId: existingReservation.id,
                },
              );
            } else {
              // Unreserve excess stock
              await inventoryStockService.unreserve(
                data.inventoryItemId,
                Math.abs(quantityDiff),
                {
                  context,
                  storeId: undefined,
                  reason: `Reservation ${existingReservation.id} quantity decreased`,
                  referenceType: "MANUAL",
                  referenceId: existingReservation.id,
                },
              );
            }
          }
          
          return transformReservation(updatedReservation);
        }
        
        // If PROMPT_BASED mode and existing is PENDING_REVIEW, upgrade to ACTIVE before returning
        if (settings.mode === 'PROMPT_BASED' && existingReservation.status === ReservationStatus.PENDING_REVIEW) {
          const activatedReservation = await this.prisma.inventoryReservation.update({
            where: { id: existingReservation.id },
            data: { status: ReservationStatus.ACTIVE, reviewDate: null },
            include: buildReservationInclude(),
          });
          
          // Reserve stock for the now-ACTIVE reservation (PENDING_REVIEW had no stock reserved)
          await inventoryStockService.reserve(
            data.inventoryItemId,
            data.quantity,
            {
              context,
              storeId: undefined,
              reason: `Reservation ${existingReservation.id} activated from PENDING_REVIEW`,
              referenceType: "MANUAL",
              referenceId: existingReservation.id,
            },
          );
          
          return transformReservation(activatedReservation);
        }
        
        // Return existing reservation if quantities match (true idempotency)
        logReservationCreate({
          reservationId: existingReservation.id,
          inventoryItemId: data.inventoryItemId,
          quantity: data.quantity,
          reservedFor: data.reservedFor,
          reservedForId: data.reservedForId,
          status: existingReservation.status as ReservationStatus,
          reviewDate: existingReservation.reviewDate,
          shouldReserveStock: false,
          plannedStartDate: null,
          daysUntilStart: null,
          stockReserved: false,
        });
        return transformReservation(existingReservation);
      }
    }

    // Get inventory item details for notifications
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      include: { stock: true },
    });

    if (!inventoryItem) {
      throw new NotFoundError("Inventory Item", data.inventoryItemId);
    }

    // Check if this is a zero-stock / backorder reservation
    const currentOnHand = inventoryItem.stock.reduce(
      (sum, s) => sum + (Number(s.quantityOnHand) || 0),
      0
    );
    const currentReserved = inventoryItem.stock.reduce(
      (sum, s) => sum + (Number(s.quantityReserved) || 0),
      0
    );
    const currentAvailable = currentOnHand - currentReserved;
    const isZeroStockReservation = data.allowZeroStock === true && currentAvailable < data.quantity;

    // BUG FIX: In PROMPT_BASED mode, allowZeroStock / backorder reservations are
    // NOT permitted.  The stock-check prompt (above) must have already been presented
    // to the user before this point.  If we reach here with insufficient stock in
    // PROMPT_BASED mode it means the caller bypassed the prompt — block it with a
    // clear error instead of silently creating an un-backed PENDING reservation.
    if (settings.mode === 'PROMPT_BASED' && isZeroStockReservation) {
      throw new BadRequestError(
        `Cannot create a backorder (PENDING) reservation in prompt-based mode. ` +
        `Available stock: ${currentAvailable}, requested: ${data.quantity}. ` +
        `Please confirm via the stock shortage prompt before proceeding.`,
      );
    }

    // Determine reservation status and behavior
    let plannedStartDate: Date | null = null;
    let statusInfo = {
      status: ReservationStatus.ACTIVE,
      reviewDate: null as Date | null,
      shouldReserveStock: true,
    };

    // ZERO-STOCK / BACKORDER: When allowZeroStock is true and stock is insufficient,
    // create a PENDING reservation without reserving stock.
    // NOTE: This path is only reachable in TIME_BASED mode (PROMPT_BASED is blocked above).
    if (isZeroStockReservation) {
      statusInfo = {
        status: ReservationStatus.PENDING,
        reviewDate: null,
        shouldReserveStock: false, // No stock to reserve
      };
    } else if (settings.mode === 'PROMPT_BASED') {
      // PROMPT_BASED mode: Always ACTIVE (stock check/prompt already handled above)
      // Keep default ACTIVE status - user already confirmed via dialog
      statusInfo = {
        status: ReservationStatus.ACTIVE,
        reviewDate: null,
        shouldReserveStock: true,
      };
    } else if (data.reservedFor === "WorkOrder" && data.reservedForId) {
      // TIME_BASED mode: Use time-based logic to determine ACTIVE vs PENDING_REVIEW
      const workOrder = await this.prisma.workOrder.findUnique({
        where: { id: data.reservedForId },
        select: {
          plannedStartDate: true,
          woNumber: true,
          title: true,
        },
      });

      if (workOrder) {
        plannedStartDate = workOrder.plannedStartDate;
        // Pass settings to calculateReservationStatus
        statusInfo = calculateReservationStatus(plannedStartDate, {
          daysThreshold: settings.daysThreshold,
        });
      }
    }

    // Prepare create data
    const createData: Prisma.InventoryReservationCreateInput = {
      inventoryItem: {
        connect: { id: data.inventoryItemId },
      },
      quantity: data.quantity,
      reservedByUser: {
        connect: { id: context.userId },
      },
      reservedFor: data.reservedFor ?? null,
      reservedForId: data.reservedForId ?? null,
      status: statusInfo.status,
      reviewDate: statusInfo.reviewDate,
      autoReqEnabled: true,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      notes: data.notes ?? null,
    };

    // Create reservation
    const reservation = await this.prisma.inventoryReservation.create({
      data: createData,
      include: buildReservationInclude(),
    });

    const daysUntilStart = plannedStartDate
      ? Math.ceil(
          (plannedStartDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : null;

    // Reserve stock (only for ACTIVE short-lead reservations)
    if (
      statusInfo.shouldReserveStock &&
      statusInfo.status === ReservationStatus.ACTIVE
    ) {
      const reserveResult = await inventoryStockService.reserve(
        data.inventoryItemId,
        data.quantity,
        {
          context,
          storeId: undefined, // Reserve across all stores
          reason: `Reservation ${reservation.id}`,
          referenceType:
            data.reservedFor === "WorkOrder"
              ? "WORK_ORDER"
              : data.reservedFor === "PMSchedule"
                ? "RESERVATION"
                : "MANUAL",
          referenceId: reservation.id,
        },
      );

      // Log the stock reservation attempt
      logStockReservation({
        inventoryItemId: data.inventoryItemId,
        quantity: data.quantity,
        reason: `Reservation ${reservation.id}`,
        referenceType:
          data.reservedFor === "WorkOrder"
            ? "WORK_ORDER"
            : data.reservedFor === "PMSchedule"
              ? "RESERVATION"
              : "MANUAL",
        referenceId: reservation.id,
        workOrderId:
          data.reservedFor === "WorkOrder"
            ? data.reservedForId ?? undefined
            : undefined,
        plannedStartDate,
        daysUntilStart,
        success: reserveResult.success,
        error: reserveResult.error,
      });

      if (!reserveResult.success) {
        logError(
          LogCategory.RESERVATION,
          "RESERVE_STOCK",
          new Error(reserveResult.error ?? "Failed to reserve stock"),
          {
            reservationId: reservation.id,
            inventoryItemId: data.inventoryItemId,
          },
        );
        // Delete the reservation since we couldn't reserve the stock
        await this.prisma.inventoryReservation.delete({
          where: { id: reservation.id },
        });

        // COMPENSATING ACTION: If the stock was partially incremented before the error
        // (e.g., the $transaction succeeded but the audit trail recording failed),
        // we must decrement quantityReserved to prevent accumulation of phantom reservations.
        // This is a best-effort rollback — if it fails, log but don't mask the original error.
        try {
          await inventoryStockService.unreserve(
            data.inventoryItemId,
            data.quantity,
            {
              context,
              storeId: undefined, // Unreserve across all stores (mirrors the reserve call)
              reason: `Compensating unreserve for failed reservation ${reservation.id}`,
              referenceType: "MANUAL",
              referenceId: reservation.id,
            },
          );
        } catch (unreserveError) {
          logError(
            LogCategory.RESERVATION,
            "COMPENSATING_UNRESERVE_FAILED",
            unreserveError instanceof Error ? unreserveError : new Error(String(unreserveError)),
            {
              reservationId: reservation.id,
              inventoryItemId: data.inventoryItemId,
              quantity: data.quantity,
            },
          );
        }

        throw new BadRequestError(
          `Failed to reserve stock: ${reserveResult.error ?? "Unknown error"}`,
        );
      }

      // Log the reservation creation with stock reserved
      logReservationCreate({
        reservationId: reservation.id,
        inventoryItemId: data.inventoryItemId,
        quantity: data.quantity,
        reservedFor: data.reservedFor ?? "MANUAL",
        reservedForId: data.reservedForId,
        status: statusInfo.status,
        reviewDate: statusInfo.reviewDate,
        shouldReserveStock: statusInfo.shouldReserveStock,
        plannedStartDate,
        daysUntilStart,
        stockReserved: true,
      });

      // Check if stock will go below minimum level after reservation
      // NOTE: This will create auto-requisition if needed (removed duplicate above)
      // IMPORTANT: Fetch fresh stock data AFTER reservation
      const freshInventoryItem = await this.prisma.inventoryItem.findUnique({
        where: { id: data.inventoryItemId },
        include: { stock: true },
      });

      if (freshInventoryItem) {
        // If user chose "Proceed Without Requisition" (skipStockCheck=true),
        // don't create auto-requisition even if stock is below minimum
        const skipRequisition = data.skipStockCheck === true;
        
        await reservationAutomationService.checkStockLevelsAndNotify(
          context,
          {
            id: freshInventoryItem.id,
            sku: freshInventoryItem.sku,
            description: freshInventoryItem.description,
            minQuantity: toNumber(freshInventoryItem.minQuantity),
            maxQuantity: toNumber(freshInventoryItem.maxQuantity),
            unitCost: toNumber(freshInventoryItem.unitCost),
            stock: freshInventoryItem.stock.map((s) => ({
              quantityOnHand: toNumber(s.quantityOnHand) ?? 0,
              quantityReserved: toNumber(s.quantityReserved) ?? 0,
            })),
          },
          data.quantity,
          data.reservedForId ?? undefined,
          skipRequisition, // Pass the flag to prevent auto-requisition
        );
      }
    } else {
      // Log the reservation creation without stock reserved
      logReservationCreate({
        reservationId: reservation.id,
        inventoryItemId: data.inventoryItemId,
        quantity: data.quantity,
        reservedFor: data.reservedFor ?? "MANUAL",
        reservedForId: data.reservedForId,
        status: statusInfo.status,
        reviewDate: statusInfo.reviewDate,
        shouldReserveStock: statusInfo.shouldReserveStock,
        plannedStartDate,
        daysUntilStart,
        stockReserved: false,
      });
    }

    // Create or update WorkOrderPart if this is a work order reservation with ACTIVE status
    if (
      data.reservedFor === "WorkOrder" &&
      data.reservedForId &&
      statusInfo.status === ReservationStatus.ACTIVE
    ) {
      try {
        // Find matching WorkOrderPart record
        const workOrderPart = await this.prisma.workOrderPart.findFirst({
          where: {
            workOrderId: data.reservedForId,
            inventoryItemId: data.inventoryItemId,
            status: {
              in: [WorkOrderPartStatus.PLANNED, WorkOrderPartStatus.RESERVED],
            },
          },
        });

        if (workOrderPart) {
          // Determine FIFO priority order
          let fifoPriorityOrder = workOrderPart.fifoPriorityOrder;
          let originalReservedAt = workOrderPart.originalReservedAt;
          
          if (!fifoPriorityOrder) {
            // This is the first time this part is being reserved
            // Find the highest priority order for this inventory item
            const maxPriority = await this.prisma.workOrderPart.aggregate({
              where: {
                inventoryItemId: data.inventoryItemId,
                fifoPriorityOrder: { not: null },
              },
              _max: {
                fifoPriorityOrder: true,
              },
            });
            
            fifoPriorityOrder = (maxPriority._max.fifoPriorityOrder ?? 0) + 1;
            originalReservedAt = new Date();
          }
          
          // Update status to RESERVED with FIFO tracking
          await this.prisma.workOrderPart.update({
            where: { id: workOrderPart.id },
            data: {
              status: WorkOrderPartStatus.RESERVED,
              reservationId: reservation.id, // Link to the reservation
              reservedAt: new Date(),
              reservedBy: context.userId,
              // FIFO tracking fields
              fifoPriorityOrder,
              originalReservedAt,
              fifoActive: false, // Will be set correctly by recalculateFifoActive
            },
          });
          
          // Recalculate fifoActive flags for this inventory item
          await this.recalculateFifoActive(data.inventoryItemId);
        } else {
          // Determine FIFO priority order for new part
          const maxPriority = await this.prisma.workOrderPart.aggregate({
            where: {
              inventoryItemId: data.inventoryItemId,
              fifoPriorityOrder: { not: null },
            },
            _max: {
              fifoPriorityOrder: true,
            },
          });
          
          const fifoPriorityOrder = (maxPriority._max.fifoPriorityOrder ?? 0) + 1;
          const originalReservedAt = new Date();
          
          // Create new WorkOrderPart with RESERVED status and FIFO tracking
          const unitCost = toNumber(inventoryItem.unitCost) ?? 0;
          await this.prisma.workOrderPart.create({
            data: {
              workOrderId: data.reservedForId,
              inventoryItemId: data.inventoryItemId,
              quantityPlanned: data.quantity,
              quantityUsed: null,
              unitCost,
              totalCost: data.quantity * unitCost,
              status: WorkOrderPartStatus.RESERVED,
              reservationId: reservation.id,
              reservedAt: new Date(),
              reservedBy: context.userId,
              notes: `Reservation ${reservation.id} created in PROMPT_BASED mode`,
              // FIFO tracking fields
              fifoPriorityOrder,
              originalReservedAt,
              fifoActive: false, // Will be set correctly by recalculateFifoActive
            },
          });
          
          // Recalculate fifoActive flags for this inventory item
          await this.recalculateFifoActive(data.inventoryItemId);
        }
      } catch (partError) {
        // Don't fail the whole operation - reservation was already created
        logError(
          LogCategory.RESERVATION,
          "CREATE_UPDATE_WORK_ORDER_PART",
          partError instanceof Error ? partError : new Error(String(partError)),
          {
            reservationId: reservation.id,
            workOrderId: data.reservedForId,
            inventoryItemId: data.inventoryItemId,
          },
        );
      }
    }

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATION_CREATED",
      data.inventoryItemId,
      `Reservation created for ${data.quantity} units (${statusInfo.status === ReservationStatus.PENDING ? "backorder/pending" : statusInfo.status === ReservationStatus.PENDING_REVIEW ? "pending review" : "active"})`,
      {
        reservationId: reservation.id,
        quantity: data.quantity,
        reservedFor: data.reservedFor,
        reservedForId: data.reservedForId,
        status: statusInfo.status,
        reviewDate: statusInfo.reviewDate?.toISOString(),
        shouldReserveStock: statusInfo.shouldReserveStock,
      },
    );

    return transformReservation(reservation);
  }

  /**
   * Update an existing reservation
   */
  async update(
    context: ServiceContext,
    id: string,
    data: ReservationUpdateDTO,
  ): Promise<ReservationWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Validate update data
    await validateReservationUpdate(this.prisma, id, data);

    // Prepare update data
    const updateData: Prisma.InventoryReservationUpdateInput = {};

    if (data.expiresAt !== undefined) {
      updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    }
    if (data.notes !== undefined) {
      updateData.notes = data.notes;
    }

    // Update reservation
    const reservation = await this.prisma.inventoryReservation.update({
      where: { id },
      data: updateData,
      include: buildReservationInclude(),
    });

    return transformReservation(reservation);
  }

  /**
   * Delete a reservation (only if active or pending review)
   */
  async delete(context: ServiceContext, id: string): Promise<void> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    // Validate ID
    validateRequired(id, "id");

    // Get reservation with full details
    const reservation = await this.prisma.inventoryReservation.findUnique({
      where: { id },
    });

    if (!reservation) {
      throw new NotFoundError("Inventory Reservation", id);
    }

    // Check if can delete - allow ACTIVE, PENDING_REVIEW, and PENDING (backorder)
    if (
      reservation.status !== ReservationStatus.ACTIVE &&
      reservation.status !== ReservationStatus.PENDING_REVIEW &&
      reservation.status !== ReservationStatus.PENDING
    ) {
      throw new BadRequestError(
        `Cannot delete ${reservation.status.toLowerCase()} reservation. Use cancel instead.`,
      );
    }

    // Store inventory item ID and quantity before deletion
    const inventoryItemId = reservation.inventoryItemId;
    const quantity = Number(reservation.quantity) || 0;
    // PENDING (backorder) reservations don't have stock reserved, so don't unreserve
    const wasActive = reservation.status === ReservationStatus.ACTIVE;
    const reservedFor = reservation.reservedFor;
    const reservedForId = reservation.reservedForId;

    // Update WorkOrderPart status back to PLANNED if this was a work order reservation
    if (reservedFor === "WorkOrder" && reservedForId) {
      try {
        // Find matching WorkOrderPart record that's linked to this reservation
        const workOrderPart = await this.prisma.workOrderPart.findFirst({
          where: {
            workOrderId: reservedForId,
            inventoryItemId: inventoryItemId,
            reservationId: id,
            status: WorkOrderPartStatus.RESERVED,
          },
        });

        if (workOrderPart) {
          // Update status back to PLANNED and clear reservation link
          await this.prisma.workOrderPart.update({
            where: { id: workOrderPart.id },
            data: {
              status: WorkOrderPartStatus.PLANNED,
              reservationId: null, // Clear the reservation link
              reservedAt: null,
              reservedBy: null,
            },
          });
        }
      } catch (partError) {
        // Don't fail the whole operation - continue with deletion
        logError(
          LogCategory.RESERVATION,
          "UPDATE_WORK_ORDER_PART_ON_DELETE",
          partError instanceof Error ? partError : new Error(String(partError)),
          {
            reservationId: id,
            workOrderId: reservedForId,
            inventoryItemId: inventoryItemId,
          },
        );
      }
    }

    // Delete reservation
    await this.prisma.inventoryReservation.delete({
      where: { id },
    });

    // Unreserve stock (only if it was ACTIVE and had stock reserved)
    if (wasActive) {
      await inventoryStockService.unreserve(inventoryItemId, quantity, {
        context,
        storeId: undefined, // Unreserve across all stores
        reason: "Reservation deleted",
        referenceType: "MANUAL",
        referenceId: id,
      });
    }

    // Delete auto-requisitions for this item if they don't have a PO yet
    // Block deletion if there's an active PO - user must cancel PO first
    try {
      const requisitions = await this.prisma.requisition.findMany({
        where: {
          status: { in: ["Draft", "Submitted", "Approved"] },
          lines: {
            some: {
              inventoryItemId: inventoryItemId,
            },
          },
        },
        select: {
          id: true,
          reqNumber: true,
          status: true,
          purchaseOrderId: true,
        },
      });

      if (requisitions.length > 0) {
        // Check if any have active POs
        const requisitionsWithPOs = requisitions.filter(r => r.purchaseOrderId !== null);
        
        if (requisitionsWithPOs.length > 0) {
          // Get PO details
          const poIds = requisitionsWithPOs.map(r => r.purchaseOrderId).filter((poId): poId is string => poId !== null);
          const pos = await this.prisma.purchaseOrder.findMany({
            where: { id: { in: poIds } },
            select: { id: true, poNumber: true },
          });
          
          const poNumbers = pos.map(po => po.poNumber).join(', ');
          
          throw new BadRequestError(
            `Cannot remove reservation: There are active Purchase Orders (${poNumbers}) for this item. Please cancel the PO(s) before removing the reservation.`
          );
        }
        
        // No POs - safe to delete requisitions
        for (const req of requisitions) {
          await this.prisma.requisition.delete({
            where: { id: req.id },
          });
        }
      }
    } catch (reqError) {
      // If it's a BadRequestError (PO exists), re-throw it
      if (reqError instanceof BadRequestError) {
        throw reqError;
      }
      // Don't fail the whole operation for other errors - reservation was already deleted
    }

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATION_DELETED",
      inventoryItemId,
      `Reservation deleted for ${quantity} units`,
      {
        reservationId: id,
        quantity,
        wasActive,
        reservedFor,
        reservedForId,
      },
    );
  }

  /**
   * Get reservation with full details (including work order, PM, etc.)
   */
  getReservationWithDetails(
    context: ServiceContext,
    id: string,
  ): Promise<ReservationWithRelations> {
    // This is just an alias for getById with full relations
    return this.getById(context, id);
  }

  /**
   * Recalculate fifoActive flags for all RESERVED parts of a given inventory item.
   * Delegates to the shared utility in reservation-utils.ts.
   */
  private async recalculateFifoActive(inventoryItemId: string): Promise<void> {
    await recalculateFifoActive(this.prisma, inventoryItemId);
  }
}

// Export singleton instance
const globalForReservation = globalThis as unknown as { reservationService: ReservationService | undefined };
export const reservationService = globalForReservation.reservationService ?? (globalForReservation.reservationService = new ReservationService(prisma));
