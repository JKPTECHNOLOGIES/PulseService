/**
 * Reservation Validation Functions
 *
 * Validation logic for reservation operations.
 * Extracted from the main service for better organization.
 */

import { PrismaClient } from "@prisma/client";
import { validateOrThrow } from "@/services/shared/validation";
import { validateWorkOrderNotClosed } from "@/services/work-orders/work-order-validation";
import { ValidationError } from "@/lib/api-errors";
import {
  ReservationCreateDTO,
  ReservationUpdateDTO,
  ReservationStatus,
  reservationCreateSchema,
  reservationUpdateSchema,
} from "./reservation.types";

/**
 * Validate reservation creation data
 * Checks inventory item exists, is active, and reference is valid
 */
export async function validateReservationCreate(
  prisma: PrismaClient,
  data: ReservationCreateDTO,
): Promise<void> {
  // Validate with Zod schema
  validateOrThrow(reservationCreateSchema, data);

  // Verify inventory item exists and is active
  const item = await prisma.inventoryItem.findUnique({
    where: { id: data.inventoryItemId },
    include: { stock: true },
  });

  if (!item) {
    throw new ValidationError("Inventory item not found", [
      {
        field: "inventoryItemId",
        message: "Inventory item not found",
        code: "ITEM_NOT_FOUND",
      },
    ]);
  }

  if (!item.isActive) {
    throw new ValidationError("Inventory item is not active", [
      {
        field: "inventoryItemId",
        message: "Inventory item is not active",
        code: "ITEM_INACTIVE",
      },
    ]);
  }

  // Validate reference exists (if provided)
  if (data.reservedFor && data.reservedForId) {
    const referenceExists = await validateReservationReference(
      prisma,
      data.reservedFor,
      data.reservedForId,
    );

    if (!referenceExists) {
      throw new ValidationError("Reference not found", [
        {
          field: "reservedForId",
          message: `${data.reservedFor} not found`,
          code: "REFERENCE_NOT_FOUND",
        },
      ]);
    }

    // Validate work order is not closed
    if (data.reservedFor === "WorkOrder") {
      await validateWorkOrderNotClosed(
        data.reservedForId,
        "create reservation",
      );
    }
  }
}

/**
 * Validate reservation update data
 * Checks reservation exists and is in valid state for updates
 */
export async function validateReservationUpdate(
  prisma: PrismaClient,
  id: string,
  data: ReservationUpdateDTO,
): Promise<void> {
  // Validate with Zod schema
  validateOrThrow(reservationUpdateSchema, data);

  // Verify reservation exists and is active
  const reservation = await prisma.inventoryReservation.findUnique({
    where: { id },
  });

  if (!reservation) {
    throw new ValidationError("Reservation not found", [
      {
        field: "id",
        message: "Reservation not found",
        code: "NOT_FOUND",
      },
    ]);
  }

  if (reservation.status !== ReservationStatus.ACTIVE) {
    throw new ValidationError("Cannot update non-active reservation", [
      {
        field: "id",
        message: `Cannot update ${reservation.status.toLowerCase()} reservation`,
        code: "INVALID_STATUS",
      },
    ]);
  }
}

/**
 * Validate reservation reference exists
 * Checks if the referenced entity (WorkOrder, PMSchedule) exists
 */
export async function validateReservationReference(
  prisma: PrismaClient,
  referenceType: string,
  referenceId: string,
): Promise<boolean> {
  switch (referenceType) {
    case "WorkOrder":
      const workOrder = await prisma.workOrder.findUnique({
        where: { id: referenceId },
      });
      return !!workOrder;

    case "PMSchedule":
      const pmInstance = await prisma.pMInstance.findUnique({
        where: { id: referenceId },
      });
      return !!pmInstance;

    default:
      return true; // Manual reservations don't need validation
  }
}

/**
 * Validate reservation quantity
 * Ensures quantity is positive and reasonable
 */
export function validateReservationQuantity(
  quantity: number,
  maxQuantity?: number,
): void {
  if (quantity <= 0) {
    throw new ValidationError("Invalid quantity", [
      {
        field: "quantity",
        message: "Quantity must be positive",
        code: "INVALID_QUANTITY",
      },
    ]);
  }

  if (maxQuantity && quantity > maxQuantity) {
    throw new ValidationError("Quantity exceeds maximum", [
      {
        field: "quantity",
        message: `Quantity cannot exceed ${maxQuantity}`,
        code: "QUANTITY_EXCEEDS_MAX",
      },
    ]);
  }
}

/**
 * Validate reservation dates
 * Ensures expiration date is in the future
 */
export function validateReservationDates(
  expiresAt?: Date | null,
  plannedStartDate?: Date | null,
): void {
  if (expiresAt) {
    if (expiresAt <= new Date()) {
      throw new ValidationError("Invalid expiration date", [
        {
          field: "expiresAt",
          message: "Expiration date must be in the future",
          code: "INVALID_EXPIRATION",
        },
      ]);
    }

    if (plannedStartDate && expiresAt > plannedStartDate) {
      throw new ValidationError("Invalid expiration date", [
        {
          field: "expiresAt",
          message: "Expiration date cannot be after planned start date",
          code: "EXPIRATION_AFTER_START",
        },
      ]);
    }
  }
}

/**
 * Validate consumption quantity
 * Ensures consumed quantity doesn't exceed reserved quantity
 */
export function validateConsumptionQuantity(
  quantityConsumed: number,
  quantityReserved: number,
): void {
  if (quantityConsumed <= 0) {
    throw new ValidationError("Invalid consumption quantity", [
      {
        field: "quantityConsumed",
        message: "Quantity consumed must be positive",
        code: "INVALID_QUANTITY",
      },
    ]);
  }

  if (quantityConsumed > quantityReserved) {
    throw new ValidationError("Consumption exceeds reservation", [
      {
        field: "quantityConsumed",
        message: `Cannot consume more than reserved quantity. Reserved: ${quantityReserved}, Requested: ${quantityConsumed}`,
        code: "EXCEEDS_RESERVED",
      },
    ]);
  }
}

/**
 * Validate reservation can be consumed
 * Checks status and other conditions
 */
export function validateCanConsume(reservation: {
  status: ReservationStatus;
  expiresAt: Date | null;
}): void {
  if (reservation.status !== ReservationStatus.ACTIVE) {
    throw new ValidationError("Cannot consume reservation", [
      {
        field: "status",
        message: `Cannot consume ${reservation.status.toLowerCase()} reservation`,
        code: "INVALID_STATUS",
      },
    ]);
  }

  if (reservation.expiresAt && reservation.expiresAt < new Date()) {
    throw new ValidationError("Cannot consume expired reservation", [
      {
        field: "expiresAt",
        message: "Reservation has expired",
        code: "RESERVATION_EXPIRED",
      },
    ]);
  }
}

/**
 * Validate reservation can be cancelled
 * Checks status and other conditions
 */
export function validateCanCancel(reservation: {
  status: ReservationStatus;
}): void {
  if (
    reservation.status !== ReservationStatus.ACTIVE &&
    reservation.status !== ReservationStatus.PENDING_REVIEW
  ) {
    throw new ValidationError("Cannot cancel reservation", [
      {
        field: "status",
        message: `Cannot cancel ${reservation.status.toLowerCase()} reservation`,
        code: "INVALID_STATUS",
      },
    ]);
  }
}

/**
 * Validate lead time for reservation
 * Ensures part can arrive before work order start
 */
export function validateLeadTime(
  leadTimeDays: number,
  plannedStartDate: Date,
): {
  isValid: boolean;
  daysUntilStart: number;
  bufferDays: number;
  message?: string;
} {
  const now = new Date();
  const daysUntilStart = Math.ceil(
    (plannedStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  const bufferDays = daysUntilStart - leadTimeDays;
  const isValid = bufferDays >= 0;

  let message: string | undefined;
  if (!isValid) {
    message = `Part cannot arrive in time. Lead time: ${leadTimeDays} days, Work order starts in: ${daysUntilStart} days`;
  } else if (bufferDays < 7) {
    message = `Warning: Only ${bufferDays} days buffer before work order start`;
  }

  return {
    isValid,
    daysUntilStart,
    bufferDays,
    message,
  };
}
