/**
 * Reservation Utility Functions
 *
 * Pure utility functions for reservation operations.
 * These functions have no side effects and can be used across services.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { toNumber } from "@/lib/decimal-helpers";
import {
  ReservationStatus,
  ReservationWithRelations,
} from "./reservation.types";
import { ReservationSettings } from "./reservation-settings.types";

/**
 * Calculate expiration date for a reservation
 * Default: 30 days from now if no date provided
 */
export function calculateExpirationDate(
  plannedStartDate?: Date | null,
  daysBeforeStart: number = 7,
): Date | null {
  if (plannedStartDate) {
    const expirationDate = new Date(plannedStartDate);
    expirationDate.setDate(expirationDate.getDate() - daysBeforeStart);
    return expirationDate;
  }

  // Default: 30 days from now
  const defaultExpiration = new Date();
  defaultExpiration.setDate(defaultExpiration.getDate() + 30);
  return defaultExpiration;
}

/**
 * Check if a reservation is expired
 */
export function isExpired(reservation: {
  status: ReservationStatus;
  expiresAt: Date | null;
}): boolean {
  if (reservation.status === ReservationStatus.EXPIRED) {
    return true;
  }
  if (reservation.expiresAt && reservation.expiresAt < new Date()) {
    return true;
  }
  return false;
}

/**
 * Check if a reservation can be consumed
 */
export function canConsume(reservation: {
  status: ReservationStatus;
}): boolean {
  return reservation.status === ReservationStatus.ACTIVE;
}

/**
 * Check if a reservation can be cancelled
 */
export function canCancel(reservation: { status: ReservationStatus }): boolean {
  return (
    reservation.status === ReservationStatus.ACTIVE ||
    reservation.status === ReservationStatus.PENDING_REVIEW
  );
}

/**
 * Calculate reservation status based on work order planned date
 * Returns: { status, reviewDate, shouldReserveStock }
 *
 * @param plannedStartDate - Work order planned start date
 * @param settings - Optional reservation settings (uses default 30-day threshold if not provided)
 */
export function calculateReservationStatus(
  plannedStartDate: Date | null,
  settings?: Pick<ReservationSettings, 'daysThreshold'> | null,
): {
  status: ReservationStatus;
  reviewDate: Date | null;
  shouldReserveStock: boolean;
} {
  // Use configurable threshold or default to 30 days
  const daysThreshold = settings?.daysThreshold ?? 30;

  if (!plannedStartDate) {
    // SCENARIO 3: No planned date - PENDING_REVIEW, no stock reservation
    // Set review date based on threshold so planners can review unscheduled reservations
    const reviewDate = new Date();
    reviewDate.setDate(reviewDate.getDate() + daysThreshold);

    return {
      status: ReservationStatus.PENDING_REVIEW,
      reviewDate,
      shouldReserveStock: false,
    };
  }

  const daysUntilStart = Math.ceil(
    (plannedStartDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (daysUntilStart > daysThreshold) {
    // SCENARIO 1: Long-lead (>threshold days) - PENDING_REVIEW, no stock reservation
    const reviewDate = new Date(plannedStartDate);
    reviewDate.setDate(reviewDate.getDate() - daysThreshold);

    return {
      status: ReservationStatus.PENDING_REVIEW,
      reviewDate,
      shouldReserveStock: false,
    };
  }

  // SCENARIO 2: Short-lead (≤threshold days) - ACTIVE, reserves stock
  return {
    status: ReservationStatus.ACTIVE,
    reviewDate: null,
    shouldReserveStock: true,
  };
}

/**
 * Calculate review date for long-lead reservations
 * Review date is threshold days before work order start
 *
 * @param plannedStartDate - Work order planned start date
 * @param daysThreshold - Days before start to review (default 30)
 */
export function calculateReviewDate(
  plannedStartDate: Date,
  daysThreshold: number = 30,
): Date {
  const reviewDate = new Date(plannedStartDate);
  reviewDate.setDate(reviewDate.getDate() - daysThreshold);
  return reviewDate;
}

/**
 * Determine if stock should be reserved based on status
 *
 * @param status - Reservation status
 * @param plannedStartDate - Work order planned start date
 * @param daysThreshold - Days threshold for reservation (default 30)
 */
export function shouldReserveStock(
  status: ReservationStatus,
  plannedStartDate: Date | null,
  daysThreshold: number = 30,
): boolean {
  if (status !== ReservationStatus.ACTIVE) {
    return false;
  }

  if (!plannedStartDate) {
    return false;
  }

  const daysUntilStart = Math.ceil(
    (plannedStartDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  return daysUntilStart <= daysThreshold;
}

/**
 * Build standard Prisma include for reservation queries
 */
export function buildReservationInclude(): Prisma.InventoryReservationInclude {
  return {
    inventoryItem: {
      select: {
        id: true,
        sku: true,
        description: true,
        unit: true,
        unitCost: true,
      },
    },
    reservedByUser: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
    cancelledByUser: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
    consumedByUser: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
  };
}

/**
 * Transform Prisma reservation to API response format
 * Converts Decimal types to numbers for JSON serialization
 */
export function transformReservation(
  reservation: unknown,
): ReservationWithRelations {
  const res = reservation as Record<string, unknown>;

  return {
    ...res,
    quantity: toNumber(res.quantity as number) ?? 0,
    inventoryItem: res.inventoryItem
      ? {
          ...(res.inventoryItem as Record<string, unknown>),
          unitCost:
            toNumber(
              (res.inventoryItem as Record<string, unknown>).unitCost as number,
            ) ?? 0,
        }
      : res.inventoryItem,
  } as ReservationWithRelations;
}

/**
 * Calculate days until work order start
 */
export function calculateDaysUntilStart(plannedStartDate: Date): number {
  return Math.ceil(
    (plannedStartDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
}

/**
 * Calculate order-by date (work order start - lead time)
 */
export function calculateOrderByDate(
  plannedStartDate: Date,
  leadTimeDays: number,
): Date {
  const orderByDate = new Date(plannedStartDate);
  orderByDate.setDate(orderByDate.getDate() - leadTimeDays);
  return orderByDate;
}

/**
 * Format user name from user object
 */
export function formatUserName(
  user: {
    firstName: string;
    lastName: string;
  } | null,
): string {
  if (!user) {
    return "Unknown User";
  }
  return `${user.firstName} ${user.lastName}`.trim();
}

/**
 * Generate consumption note with user and timestamp
 */
export function generateConsumptionNote(
  userName: string,
  quantity: number,
  notes?: string | null,
): string {
  const consumedAt = new Date();
  const timestamp = consumedAt.toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });

  let note = `Consumed ${quantity} by ${userName} on ${timestamp}`;
  if (notes) {
    note += `\n${notes}`;
  }

  return note;
}

/**
 * Recalculate fifoActive flags for all RESERVED WorkOrderParts of a given
 * inventory item.
 *
 * Rules:
 * - Only RESERVED parts with a non-null fifoPriorityOrder participate.
 * - The part with the LOWEST fifoPriorityOrder gets fifoActive = true.
 * - All other RESERVED parts get fifoActive = false.
 * - originalReservedAt is used as a tiebreaker when two parts share the same
 *   fifoPriorityOrder (edge case from the concurrent-assignment race window).
 *
 * This is the SINGLE shared implementation — previously duplicated in
 * reservation.service.ts, reservation-lifecycle.service.ts, and
 * work-order-part.service.ts.
 *
 * @param prismaClient - Prisma client (or transaction client)
 * @param inventoryItemId - Inventory item whose FIFO queue should be recalculated
 */
export async function recalculateFifoActive(
  prismaClient: PrismaClient | Prisma.TransactionClient,
  inventoryItemId: string,
): Promise<void> {
  const reservedParts = await (prismaClient as PrismaClient).workOrderPart.findMany({
    where: {
      inventoryItemId,
      status: "RESERVED",
      fifoPriorityOrder: { not: null },
    },
    orderBy: [
      { fifoPriorityOrder: "asc" },
      { originalReservedAt: "asc" }, // Tiebreaker: earlier original reservation wins
    ],
  });

  if (reservedParts.length === 0) {
    return;
  }

  const firstPart = reservedParts[0];
  if (!firstPart) return;

  // Reset all RESERVED parts for this item to fifoActive=false
  await (prismaClient as PrismaClient).workOrderPart.updateMany({
    where: {
      inventoryItemId,
      status: "RESERVED",
    },
    data: { fifoActive: false },
  });

  // Promote the first-in-queue part to fifoActive=true
  await (prismaClient as PrismaClient).workOrderPart.update({
    where: { id: firstPart.id },
    data: { fifoActive: true },
  });
}
