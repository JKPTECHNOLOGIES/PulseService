/**
 * Reservation Review Service
 *
 * Service layer for long-lead reservation review management.
 * Handles confirmation, bulk operations, notifications, and auto-cancellation.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Type system
import { ServiceContext } from "@/types/service-types";
import { PaginatedResponse } from "@/types/api";
import {
  PermissionResource,
  PermissionAction,
  ExtendedPermissionAction,
  buildPermissionString,
} from "@/types/permissions";

// Utility functions
import { checkPermission } from "@/services/shared/permissions";
import {
  validateOrThrow,
  validateRequired,
} from "@/services/shared/validation";
import { calculatePagination } from "@/lib/query-helpers";
import { toNumber } from "@/lib/decimal-helpers";

// Type definitions
import { ReservationStatus } from "./reservation.types";
import {
  ReservationConfirmDTO,
  ReservationBulkConfirmDTO,
  PendingReviewFilterDTO,
  PendingReviewReservation,
  PendingReviewSummary,
  ReservationConfirmResult,
  BulkConfirmResult,
  ReservationReviewLogWithReviewer,
  ReviewLogAction,
  reservationConfirmSchema,
  reservationBulkConfirmSchema,
  pendingReviewFilterSchema,
} from "./reservation-review.types";

// Error types
import {
  ValidationError,
  NotFoundError,
  BadRequestError,
} from "@/lib/api-errors";

// External dependencies
import { logInventoryEvent } from "@/lib/event-logger";
import { logger } from "@/lib/logger";

// Requisition services for auto-requisition creation
import { requisitionService } from "@/services/purchasing/requisition/requisition.service";
import { requisitionWorkflowService } from "@/services/purchasing/requisition/requisition-workflow.service";
import { RequisitionPriority } from "@/services/purchasing/requisition/requisition.types";

/**
 * Reservation Review Service Class
 *
 * Provides operations for long-lead reservation review management.
 */
class ReservationReviewService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // CONFIRMATION OPERATIONS
  // ============================================================================

  /**
   * Confirm a pending reservation
   */
  async confirmReservation(
    context: ServiceContext,
    reservationId: string,
    data: ReservationConfirmDTO,
  ): Promise<ReservationConfirmResult> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    // Validate data
    validateOrThrow(reservationConfirmSchema, data);
    validateRequired(reservationId, "reservationId");

    // Get reservation with full context
    const reservation = await this.prisma.inventoryReservation.findUnique({
      where: { id: reservationId },
      include: {
        inventoryItem: {
          include: {
            stock: true,
          },
        },
      },
    });

    if (!reservation) {
      throw new NotFoundError("Inventory Reservation", reservationId);
    }

    // Validate status
    if (reservation.status !== ReservationStatus.PENDING_REVIEW) {
      throw new BadRequestError(
        `Cannot confirm reservation with status: ${reservation.status}`,
      );
    }

    const previousQty = toNumber(reservation.quantity) ?? 0;
    const newQty = data.confirmedQuantity ?? previousQty;

    // Validate quantity adjustment
    if (newQty <= 0) {
      throw new ValidationError("Confirmed quantity must be positive", [
        {
          field: "confirmedQuantity",
          message: "Confirmed quantity must be positive",
          code: "INVALID_QUANTITY",
        },
      ]);
    }

    let requisitionCreated = false;
    let requisitionId: string | null = null;

    // Perform confirmation in transaction
    await this.prisma.$transaction(async (tx) => {
      // Update reservation
      await tx.inventoryReservation.update({
        where: { id: reservationId },
        data: {
          status: ReservationStatus.ACTIVE,
          quantity: newQty,
          confirmedAt: new Date(),
          confirmedBy: context.userId,
          notes: data.notes
            ? `${reservation.notes ?? ""}\n\nConfirmed: ${data.notes}`.trim()
            : reservation.notes,
        },
      });

      // Create review log
      await tx.reservationReviewLog.create({
        data: {
          reservationId,
          reviewedBy: context.userId,
          action:
            newQty !== previousQty
              ? ReviewLogAction.ADJUSTED
              : ReviewLogAction.CONFIRMED,
          previousQty,
          newQty,
          notes: data.notes ?? null,
        },
      });

      // Check stock availability and create requisition if needed
      if (reservation.autoReqEnabled) {
        const totalOnHand = reservation.inventoryItem.stock.reduce(
          (sum, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
          0,
        );

        const activeReservations = await tx.inventoryReservation.findMany({
          where: {
            inventoryItemId: reservation.inventoryItemId,
            status: ReservationStatus.ACTIVE,
            id: { not: reservationId },
          },
        });

        const totalReserved = activeReservations.reduce(
          (sum, r) => sum + (toNumber(r.quantity) ?? 0),
          0,
        );

        const availableQty = totalOnHand - totalReserved;
        const shortfall = newQty - availableQty;

        // Create auto-requisition if there's a shortfall
        if (
          shortfall > 0 &&
          reservation.reservedFor === "WorkOrder" &&
          reservation.reservedForId
        ) {
          const workOrder = await tx.workOrder.findUnique({
            where: { id: reservation.reservedForId },
            select: {
              id: true,
              woNumber: true,
              plannedStartDate: true,
              equipmentId: true,
            },
          });

          if (workOrder) {
            // Resolve a GL account code for the WO-charged inventory requisition
            // line. The requisition schema REQUIRES lines linked to a work order
            // to carry an account code (Store Room 1535 vs CIP 1580 routing);
            // without it requisitionService.create() throws "Validation failed"
            // and rolls back this whole confirmation transaction. Chain mirrors
            // the GL engine: WO project/equipment → finance default WO account.
            const { budgetResolutionService } =
              await import("@/services/budget/budget-resolution.service");
            const resolvedAccountCodeId =
              await budgetResolutionService.resolveWorkOrderAccountCodeId(
                workOrder.id,
              );

            if (!resolvedAccountCodeId) {
              // No charge account configured for this WO — skip the auto-req
              // (best-effort) so confirming the reservation still succeeds. The
              // planner can raise the requisition manually once a default
              // work-order account is configured in Finance settings.
              logger.error(
                `[RESERVATION-CONFIRM] Skipped auto-requisition for reservation ${reservationId}: no GL account code resolvable for work order ${workOrder.woNumber} (no project, equipment account, or finance default). Configure a default work-order account in Finance settings.`,
              );
            } else {
              // CRITICAL: Elevate context with purchasing permissions.
              // `confirmReservation()` is called by planners/reviewers who may not have
              // purchasing:create. Without elevation the auto-req creation silently fails.
              const elevatedContext: ServiceContext = {
                ...context,
                permissions: [
                  ...context.permissions,
                  { resource: "purchasing", action: "create", isActive: true },
                  { resource: "purchasing", action: "update", isActive: true },
                  { resource: "purchasing", action: "read", isActive: true },
                ],
              };
              // Create requisition using the new requisition service
              const requisition = await requisitionService.create(
                elevatedContext,
                {
                  requestedById: context.userId,
                  description: `Auto-reorder for ${reservation.inventoryItem.description}`,
                  priority: RequisitionPriority.HIGH, // High priority for confirmed reservations
                  workOrderId: workOrder.id,
                  equipmentId: workOrder.equipmentId ?? undefined,
                  budgetType: "CHARGE_TO_WORK_ORDER",
                  accountCodeId: resolvedAccountCodeId,
                  neededByDate:
                    workOrder.plannedStartDate?.toISOString() ?? null,
                  justification: `Auto-generated for reservation ${reservationId} - Stock shortfall: ${shortfall} ${reservation.inventoryItem.unit}`,
                  items: [
                    {
                      lineType: "INVENTORY" as const,
                      inventoryItemId: reservation.inventoryItemId,
                      description: reservation.inventoryItem.description,
                      quantity: shortfall,
                      unit: reservation.inventoryItem.unit || "EA",
                      // FIX: estimatedPrice is the UNIT price, not total.
                      // The requisition service multiplies quantity × estimatedPrice for line total.
                      estimatedPrice:
                        toNumber(reservation.inventoryItem.unitCost) ?? 0,
                      notes: `Auto-generated from reservation confirmation for WO ${workOrder.woNumber}`,
                    },
                  ],
                },
              );

              // Auto-submit the requisition
              await requisitionWorkflowService.submit(context, requisition.id);

              requisitionCreated = true;
              requisitionId = requisition.id;
            }
          }
        }
      }

      // Update reserved quantity in stock
      await this.updateReservedQuantityInTransaction(
        tx,
        reservation.inventoryItemId,
      );
    });

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATION_CONFIRMED",
      reservation.inventoryItemId,
      `Reservation confirmed: ${newQty} units`,
      {
        reservationId,
        previousQty,
        newQty,
        requisitionCreated,
        requisitionId,
      },
    );

    return {
      id: reservationId,
      status: ReservationStatus.ACTIVE,
      confirmedAt: new Date(),
      confirmedBy: context.userId,
      requisitionCreated,
      requisitionId,
    };
  }

  /**
   * Bulk confirm multiple reservations
   */
  async bulkConfirmReservations(
    context: ServiceContext,
    data: ReservationBulkConfirmDTO,
  ): Promise<BulkConfirmResult> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    // Validate data
    validateOrThrow(reservationBulkConfirmSchema, data);

    const results: BulkConfirmResult["results"] = [];
    let confirmed = 0;
    let failed = 0;
    let requisitionsCreated = 0;

    // Process each reservation
    for (const reservationId of data.reservationIds) {
      try {
        const result = await this.confirmReservation(context, reservationId, {
          notes: data.notes ?? undefined,
        });

        results.push({
          reservationId,
          success: true,
          requisitionId: result.requisitionId ?? undefined,
        });

        confirmed++;
        if (result.requisitionCreated) {
          requisitionsCreated++;
        }
      } catch (error) {
        results.push({
          reservationId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        failed++;
      }
    }

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATIONS_BULK_CONFIRMED",
      "system",
      `Bulk confirmed ${confirmed} reservations (${failed} failed)`,
      {
        confirmed,
        failed,
        requisitionsCreated,
        reservationIds: data.reservationIds,
      },
    );

    return {
      confirmed,
      failed,
      requisitionsCreated,
      results,
    };
  }

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  /**
   * Get pending review reservations
   */
  async getPendingReview(
    context: ServiceContext,
    filters?: PendingReviewFilterDTO,
  ): Promise<PaginatedResponse<PendingReviewReservation>> {
    // Check permission - use READ for viewing, RESERVE for modifying
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Validate filters
    const validatedFilters = filters
      ? validateOrThrow(pendingReviewFilterSchema, filters)
      : {};

    // Build pagination
    const page = validatedFilters.page ?? 1;
    const limit = validatedFilters.limit ?? 20;
    const { skip, take } = calculatePagination(page, limit);

    // Build where clause
    const where: Prisma.InventoryReservationWhereInput = {
      status: ReservationStatus.PENDING_REVIEW,
    };

    // Apply filters
    if (validatedFilters.userId) {
      // Filter by user: show reservations that were either:
      // 1. Created by this user (reservedBy), OR
      // 2. For work orders where this user is the planner

      const workOrderIds = (
        await this.prisma.workOrder.findMany({
          where: { plannerId: validatedFilters.userId },
          select: { id: true },
        })
      ).map((wo) => wo.id);

      // Use OR condition to include both scenarios
      where.OR = [
        // Reservations created by this user
        { reservedBy: validatedFilters.userId },
        // Reservations for work orders they're planning
        {
          reservedFor: "WorkOrder",
          reservedForId: { in: workOrderIds },
        },
      ];
    }

    if (validatedFilters.workOrderId) {
      where.reservedFor = "WorkOrder";
      where.reservedForId = validatedFilters.workOrderId;
    }

    if (validatedFilters.itemId) {
      where.inventoryItemId = validatedFilters.itemId;
    }

    if (validatedFilters.dueWithinDays) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + validatedFilters.dueWithinDays);
      where.reviewDate = {
        lte: futureDate,
      };
    }

    // Execute query
    const [reservations, total] = await Promise.all([
      this.prisma.inventoryReservation.findMany({
        where,
        include: {
          inventoryItem: {
            select: {
              id: true,
              sku: true,
              description: true,
              unit: true,
              stock: {
                select: {
                  quantityOnHand: true,
                  quantityReserved: true,
                },
              },
            },
          },
          reservedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        skip,
        take,
        orderBy: { reviewDate: "asc" },
      }),
      this.prisma.inventoryReservation.count({ where }),
    ]);

    // Get work order details for reservations
    const workOrderIds = reservations
      .filter((r) => r.reservedFor === "WorkOrder" && r.reservedForId)
      .map((r) => r.reservedForId as string);

    const workOrders =
      workOrderIds.length > 0
        ? await this.prisma.workOrder.findMany({
            where: { id: { in: workOrderIds } },
            select: {
              id: true,
              woNumber: true,
              title: true,
              plannedStartDate: true,
            },
          })
        : [];

    const workOrderMap = new Map(workOrders.map((wo) => [wo.id, wo]));

    // Transform reservations
    const transformedReservations: PendingReviewReservation[] =
      reservations.map((r) => ({
        id: r.id,
        inventoryItem: {
          id: r.inventoryItem.id,
          sku: r.inventoryItem.sku,
          description: r.inventoryItem.description,
          unit: r.inventoryItem.unit,
          stock: r.inventoryItem.stock.map((s) => ({
            quantityOnHand: toNumber(s.quantityOnHand) ?? 0,
            quantityReserved: toNumber(s.quantityReserved) ?? 0,
          })),
        },
        quantity: toNumber(r.quantity) ?? 0,
        reviewDate: r.reviewDate,
        reviewNotifiedAt: r.reviewNotifiedAt,
        workOrder:
          r.reservedForId && workOrderMap.has(r.reservedForId)
            ? (() => {
                const wo = workOrderMap.get(r.reservedForId);
                return wo
                  ? {
                      id: wo.id,
                      woNumber: wo.woNumber,
                      title: wo.title,
                      plannedStartDate: wo.plannedStartDate,
                    }
                  : null;
              })()
            : null,
        createdBy: {
          id: r.reservedByUser.id,
          firstName: r.reservedByUser.firstName,
          lastName: r.reservedByUser.lastName,
        },
        notes: r.notes,
        createdAt: r.createdAt,
      }));

    // Calculate pagination
    const totalPages = Math.ceil(total / take);

    return {
      success: true,
      data: transformedReservations,
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
   * Get pending review summary
   */
  async getPendingReviewSummary(
    context: ServiceContext,
    userId?: string,
  ): Promise<PendingReviewSummary> {
    // Check permission - use READ for viewing summary
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    // Build base where clause
    const baseWhere: Prisma.InventoryReservationWhereInput = {
      status: ReservationStatus.PENDING_REVIEW,
    };

    // If userId provided, filter by user (created by OR planning)
    if (userId) {
      const workOrderIds = (
        await this.prisma.workOrder.findMany({
          where: { plannerId: userId },
          select: { id: true },
        })
      ).map((wo) => wo.id);

      // Use OR condition to include both scenarios
      baseWhere.OR = [
        // Reservations created by this user
        { reservedBy: userId },
        // Reservations for work orders they're planning
        {
          reservedFor: "WorkOrder",
          reservedForId: { in: workOrderIds },
        },
      ];
    }

    const [dueToday, dueThisWeek, overdue, total] = await Promise.all([
      this.prisma.inventoryReservation.count({
        where: {
          ...baseWhere,
          reviewDate: {
            gte: today,
            lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      }),
      this.prisma.inventoryReservation.count({
        where: {
          ...baseWhere,
          reviewDate: {
            gte: today,
            lte: weekFromNow,
          },
        },
      }),
      this.prisma.inventoryReservation.count({
        where: {
          ...baseWhere,
          reviewDate: {
            lt: today,
          },
        },
      }),
      this.prisma.inventoryReservation.count({
        where: baseWhere,
      }),
    ]);

    return {
      dueToday,
      dueThisWeek,
      overdue,
      total,
    };
  }

  /**
   * Get review history for a reservation
   */
  async getReviewHistory(
    context: ServiceContext,
    reservationId: string,
  ): Promise<ReservationReviewLogWithReviewer[]> {
    // Check permission - use READ for viewing history
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    validateRequired(reservationId, "reservationId");

    // Verify reservation exists
    const reservation = await this.prisma.inventoryReservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation) {
      throw new NotFoundError("Inventory Reservation", reservationId);
    }

    // Get review logs
    const logs = await this.prisma.reservationReviewLog.findMany({
      where: { reservationId },
      include: {
        reviewer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return logs.map((log) => ({
      id: log.id,
      reservationId: log.reservationId,
      reviewedBy: log.reviewedBy,
      action: log.action,
      previousQty: log.previousQty ? toNumber(log.previousQty) : null,
      newQty: log.newQty ? toNumber(log.newQty) : null,
      notes: log.notes,
      createdAt: log.createdAt,
      reviewer: log.reviewer,
    }));
  }

  // ============================================================================
  // SCHEDULED JOB OPERATIONS
  // ============================================================================

  /**
   * Send review notifications for reservations due for review
   */
  async sendReviewNotifications(context: ServiceContext): Promise<number> {
    const now = new Date();

    // Find reservations due for review that haven't been notified
    const reservations = await this.prisma.inventoryReservation.findMany({
      where: {
        status: ReservationStatus.PENDING_REVIEW,
        reviewDate: {
          lte: now,
        },
        reviewNotifiedAt: null,
      },
      include: {
        inventoryItem: true,
        reservedByUser: true,
      },
    });

    if (reservations.length === 0) {
      return 0;
    }

    // Update notification timestamp and create review logs
    await this.prisma.$transaction(async (tx) => {
      for (const reservation of reservations) {
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { reviewNotifiedAt: now },
        });

        await tx.reservationReviewLog.create({
          data: {
            reservationId: reservation.id,
            reviewedBy: context.userId,
            action: ReviewLogAction.REMINDED,
            notes: "Review notification sent",
          },
        });
      }
    });

    // TODO: Send actual notifications via notification system
    // This would integrate with the existing notification service

    return reservations.length;
  }

  /**
   * Auto-cancel reservations that haven't been reviewed after 7 days
   */
  async autoCancelOverdueReservations(
    context: ServiceContext,
  ): Promise<number> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Find reservations that were notified 7+ days ago and not confirmed
    const reservations = await this.prisma.inventoryReservation.findMany({
      where: {
        status: ReservationStatus.PENDING_REVIEW,
        reviewNotifiedAt: {
          lte: sevenDaysAgo,
        },
        confirmedAt: null,
      },
      include: {
        inventoryItem: true,
      },
    });

    if (reservations.length === 0) {
      return 0;
    }

    // Cancel reservations and create review logs
    await this.prisma.$transaction(async (tx) => {
      for (const reservation of reservations) {
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: {
            status: ReservationStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledBy: context.userId,
            notes:
              `${reservation.notes ?? ""}\n\nAuto-cancelled: No review response after 7 days`.trim(),
          },
        });

        await tx.reservationReviewLog.create({
          data: {
            reservationId: reservation.id,
            reviewedBy: context.userId,
            action: ReviewLogAction.AUTO_CANCELLED,
            notes: "Auto-cancelled after 7 days without review",
          },
        });

        // Update reserved quantity
        await this.updateReservedQuantityInTransaction(
          tx,
          reservation.inventoryItemId,
        );
      }
    });

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATIONS_AUTO_CANCELLED",
      "system",
      `Auto-cancelled ${reservations.length} overdue reservations`,
      {
        count: reservations.length,
        reservationIds: reservations.map((r) => r.id),
      },
    );

    return reservations.length;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Update reserved quantity within a transaction
   *
   * Recalculates total reserved quantity from active reservations
   * and updates all stock records for the item.
   * This ensures reserved quantities stay in sync with reservation records.
   */
  private async updateReservedQuantityInTransaction(
    tx: Prisma.TransactionClient,
    inventoryItemId: string,
  ): Promise<void> {
    // Get all active reservations for this item
    const reservations = await tx.inventoryReservation.findMany({
      where: {
        inventoryItemId,
        status: ReservationStatus.ACTIVE,
      },
    });

    // Calculate total reserved from active reservations (source of truth)
    const totalReserved = reservations.reduce(
      (total, r) => total + (toNumber(r.quantity) ?? 0),
      0,
    );

    // Update all stock records for this item with recalculated total
    await tx.inventoryStock.updateMany({
      where: { inventoryItemId },
      data: { quantityReserved: totalReserved },
    });
  }
}

// Export singleton instance
const globalForReservationReview = globalThis as unknown as {
  reservationReviewService: ReservationReviewService | undefined;
};
export const reservationReviewService =
  globalForReservationReview.reservationReviewService ??
  (globalForReservationReview.reservationReviewService =
    new ReservationReviewService(prisma));
