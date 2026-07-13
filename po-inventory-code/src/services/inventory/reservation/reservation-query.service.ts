/**
 * Reservation Query Service
 *
 * Service for querying and retrieving reservation data.
 * Handles specialized queries and summary operations.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { PermissionResource, PermissionAction, buildPermissionString } from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import {
  ReservationWithRelations,
  ReservationSummary,
  ReservationStatus,
  calculateTotalReserved,
} from "./reservation.types";
import {
  buildReservationInclude,
  transformReservation,
} from "./reservation-utils";

/**
 * Reservation Query Service Class
 *
 * Provides read-only query operations for reservations.
 * Optimized for various query patterns and summary generation.
 */
class ReservationQueryService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Get active reservations for an inventory item
   * Optionally include inactive reservations
   */
  async getActiveReservations(
    context: ServiceContext,
    inventoryItemId: string,
    includeInactive = false,
  ): Promise<ReservationWithRelations[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const where: Prisma.InventoryReservationWhereInput = { inventoryItemId };

    if (!includeInactive) {
      where.status = ReservationStatus.ACTIVE;
    }

    const reservations = await this.prisma.inventoryReservation.findMany({
      where,
      include: buildReservationInclude(),
      orderBy: { createdAt: "desc" },
    });

    return reservations.map((r) => transformReservation(r));
  }

  /**
   * Get expired reservations
   * Useful for cleanup and reporting
   */
  async getExpiredReservations(
    context: ServiceContext,
    options?: {
      inventoryItemId?: string;
      limit?: number;
    },
  ): Promise<ReservationWithRelations[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const where: Prisma.InventoryReservationWhereInput = {
      status: ReservationStatus.EXPIRED,
    };

    if (options?.inventoryItemId) {
      where.inventoryItemId = options.inventoryItemId;
    }

    const reservations = await this.prisma.inventoryReservation.findMany({
      where,
      include: buildReservationInclude(),
      orderBy: { expiresAt: "desc" },
      take: options?.limit ?? 100,
    });

    return reservations.map((r) => transformReservation(r));
  }

  /**
   * Get reservations by work order
   * Returns all reservations for a specific work order
   */
  async getReservationsByWorkOrder(
    context: ServiceContext,
    workOrderId: string,
    includeInactive = false,
  ): Promise<ReservationWithRelations[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const where: Prisma.InventoryReservationWhereInput = {
      reservedFor: "WorkOrder",
      reservedForId: workOrderId,
    };

    if (!includeInactive) {
      where.status = {
        in: [ReservationStatus.ACTIVE, ReservationStatus.PENDING_REVIEW],
      };
    }

    const reservations = await this.prisma.inventoryReservation.findMany({
      where,
      include: buildReservationInclude(),
      orderBy: { createdAt: "desc" },
    });

    return reservations.map((r) => transformReservation(r));
  }

  /**
   * Get reservations by reference (WorkOrder, PM, etc.)
   * Generic method for any reference type
   */
  async getByReference(
    context: ServiceContext,
    referenceType: string,
    referenceId: string,
    includeInactive = false,
  ): Promise<ReservationWithRelations[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const where: Prisma.InventoryReservationWhereInput = {
      reservedFor: referenceType,
      reservedForId: referenceId,
    };

    if (!includeInactive) {
      where.status = {
        in: [ReservationStatus.ACTIVE, ReservationStatus.PENDING_REVIEW],
      };
    }

    const reservations = await this.prisma.inventoryReservation.findMany({
      where,
      include: buildReservationInclude(),
      orderBy: { createdAt: "desc" },
    });

    return reservations.map((r) => transformReservation(r));
  }

  /**
   * Get reservation summary for an inventory item
   * Includes counts and totals by status
   */
  async getSummary(
    context: ServiceContext,
    inventoryItemId: string,
  ): Promise<ReservationSummary> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const reservations = await this.getActiveReservations(
      context,
      inventoryItemId,
      true, // Include all statuses
    );

    const activeReservations = reservations.filter(
      (r) => r.status === ReservationStatus.ACTIVE,
    );
    const expiredReservations = reservations.filter(
      (r) => r.status === ReservationStatus.EXPIRED,
    );

    const totalReserved = calculateTotalReserved(reservations);

    return {
      inventoryItemId,
      totalReserved,
      activeReservations: activeReservations.length,
      expiredReservations: expiredReservations.length,
      reservations,
    };
  }

  /**
   * Get reservations by user
   * Returns all reservations created by a specific user
   */
  async getByUser(
    context: ServiceContext,
    userId: string,
    options?: {
      status?: ReservationStatus;
      limit?: number;
    },
  ): Promise<ReservationWithRelations[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const where: Prisma.InventoryReservationWhereInput = {
      reservedBy: userId,
    };

    if (options?.status) {
      where.status = options.status;
    }

    const reservations = await this.prisma.inventoryReservation.findMany({
      where,
      include: buildReservationInclude(),
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 100,
    });

    return reservations.map((r) => transformReservation(r));
  }

  /**
   * Get reservations expiring soon
   * Useful for notifications and alerts
   */
  async getExpiringSoon(
    context: ServiceContext,
    daysAhead: number = 7,
  ): Promise<ReservationWithRelations[]> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const reservations = await this.prisma.inventoryReservation.findMany({
      where: {
        status: ReservationStatus.ACTIVE,
        expiresAt: {
          gte: now,
          lte: futureDate,
        },
      },
      include: buildReservationInclude(),
      orderBy: { expiresAt: "asc" },
    });

    return reservations.map((r) => transformReservation(r));
  }

  /**
   * Get pending review reservations count
   * Quick count for dashboard widgets
   */
  async getPendingReviewCount(
    context: ServiceContext,
    userId?: string,
  ): Promise<number> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const where: Prisma.InventoryReservationWhereInput = {
      status: ReservationStatus.PENDING_REVIEW,
    };

    // If userId provided, filter by planner
    if (userId) {
      const workOrderIds = (
        await this.prisma.workOrder.findMany({
          where: { plannerId: userId },
          select: { id: true },
        })
      ).map((wo) => wo.id);

      where.reservedFor = "WorkOrder";
      where.reservedForId = { in: workOrderIds };
    }

    return this.prisma.inventoryReservation.count({ where });
  }

  /**
   * Get reservation statistics
   * Aggregate statistics for reporting
   */
  async getStatistics(
    context: ServiceContext,
    options?: {
      startDate?: Date;
      endDate?: Date;
      inventoryItemId?: string;
    },
  ): Promise<{
    total: number;
    active: number;
    pendingReview: number;
    consumed: number;
    cancelled: number;
    expired: number;
    totalQuantityReserved: number;
    totalQuantityConsumed: number;
  }> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const where: Prisma.InventoryReservationWhereInput = {};

    if (options?.inventoryItemId) {
      where.inventoryItemId = options.inventoryItemId;
    }

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options.startDate) {
        where.createdAt.gte = options.startDate;
      }
      if (options.endDate) {
        where.createdAt.lte = options.endDate;
      }
    }

    const [
      total,
      active,
      pendingReview,
      consumed,
      cancelled,
      expired,
      allReservations,
    ] = await Promise.all([
      this.prisma.inventoryReservation.count({ where }),
      this.prisma.inventoryReservation.count({
        where: { ...where, status: ReservationStatus.ACTIVE },
      }),
      this.prisma.inventoryReservation.count({
        where: { ...where, status: ReservationStatus.PENDING_REVIEW },
      }),
      this.prisma.inventoryReservation.count({
        where: { ...where, status: ReservationStatus.CONSUMED },
      }),
      this.prisma.inventoryReservation.count({
        where: { ...where, status: ReservationStatus.CANCELLED },
      }),
      this.prisma.inventoryReservation.count({
        where: { ...where, status: ReservationStatus.EXPIRED },
      }),
      this.prisma.inventoryReservation.findMany({
        where,
        select: {
          status: true,
          quantity: true,
        },
      }),
    ]);

    const totalQuantityReserved = allReservations
      .filter((r) => r.status === ReservationStatus.ACTIVE)
      .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

    const totalQuantityConsumed = allReservations
      .filter((r) => r.status === ReservationStatus.CONSUMED)
      .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

    return {
      total,
      active,
      pendingReview,
      consumed,
      cancelled,
      expired,
      totalQuantityReserved,
      totalQuantityConsumed,
    };
  }
}

// Export singleton instance
const globalForReservationQuery = globalThis as unknown as { reservationQueryService: ReservationQueryService | undefined };
export const reservationQueryService = globalForReservationQuery.reservationQueryService ?? (globalForReservationQuery.reservationQueryService = new ReservationQueryService(prisma));
