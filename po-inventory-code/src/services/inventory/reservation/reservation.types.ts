/**
 * Inventory Reservation Service Types
 *
 * DTOs, types, and Zod schemas for the Inventory Reservation service.
 * These types define the shape of data for reservation operations.
 */

import { z } from "zod";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Reservation status types
 */
export enum ReservationStatus {
  ACTIVE = "ACTIVE",
  PENDING_REVIEW = "PENDING_REVIEW",
  PENDING = "PENDING", // Backorder/zero-stock reservation - waiting for stock to arrive
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
  CONSUMED = "CONSUMED",
}

/**
 * Reference types for reservations
 */
export enum ReservationReferenceType {
  WORK_ORDER = "WorkOrder",
  PM_SCHEDULE = "PMSchedule",
  MANUAL = "Manual",
}

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Base inventory reservation type matching Prisma schema
 */
export interface InventoryReservation {
  id: string;
  inventoryItemId: string;
  quantity: number;
  reservedBy: string;
  reservedFor: string | null;
  reservedForId: string | null;
  status: ReservationStatus;
  expiresAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  consumedAt: Date | null;
  consumedBy: string | null;

  // Long-lead reservation management fields
  reviewDate: Date | null;
  reviewNotifiedAt: Date | null;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  autoReqEnabled: boolean;
}

/**
 * Inventory item reference
 */
export interface InventoryItemReference {
  id: string;
  sku: string;
  description: string;
  unit: string;
  unitCost: number;
  stock?: Array<{
    bin: string | null;
    quantityOnHand: number;
    quantityReserved: number;
  }>;
}

/**
 * User reference
 */
export interface UserReference {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating reservations
 */
export const reservationCreateSchema = z
  .object({
    inventoryItemId: z.string().uuid("Invalid inventory item ID"),
    quantity: z.number().positive("Quantity must be positive"),
    reservedFor: z.nativeEnum(ReservationReferenceType).optional().nullable(),
    reservedForId: z
      .string()
      .uuid("Invalid reference ID")
      .optional()
      .nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    skipStockCheck: z.boolean().optional(), // Skip stock check (for PROMPT_BASED mode)
    createRequisition: z.boolean().optional(), // Create requisition with reservation
    allowZeroStock: z.boolean().optional(), // Allow reservation when stock is zero/insufficient (backorder)
  })
  .refine(
    (data) => {
      // If reservedFor is provided, reservedForId must also be provided
      if (
        data.reservedFor &&
        data.reservedFor !== ReservationReferenceType.MANUAL
      ) {
        return !!data.reservedForId;
      }
      return true;
    },
    {
      message: "Reference ID is required when reference type is specified",
      path: ["reservedForId"],
    },
  )
  .refine(
    (data) => {
      // If expiresAt is provided, it must be in the future
      if (data.expiresAt) {
        return data.expiresAt > new Date();
      }
      return true;
    },
    {
      message: "Expiration date must be in the future",
      path: ["expiresAt"],
    },
  );

/**
 * Schema for updating reservations
 */
export const reservationUpdateSchema = z
  .object({
    expiresAt: z.coerce.date().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) => {
      // If expiresAt is provided, it must be in the future
      if (data.expiresAt) {
        return data.expiresAt > new Date();
      }
      return true;
    },
    {
      message: "Expiration date must be in the future",
      path: ["expiresAt"],
    },
  );

/**
 * Schema for consuming reservations
 */
export const reservationConsumeSchema = z.object({
  quantityConsumed: z.number().positive("Quantity consumed must be positive"),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for cancelling reservations
 */
export const reservationCancelSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required").max(500),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for filtering reservations
 */
export const reservationFilterSchema = z.object({
  inventoryItemId: z.string().uuid().optional(),
  status: z.nativeEnum(ReservationStatus).optional(),
  reservedBy: z.string().uuid().optional(),
  reservedFor: z.nativeEnum(ReservationReferenceType).optional(),
  reservedForId: z.string().uuid().optional(),
  includeExpired: z.boolean().optional(),
  search: z.string().optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating reservations
 */
export type ReservationCreateDTO = z.infer<typeof reservationCreateSchema>;

/**
 * DTO for updating reservations
 */
export type ReservationUpdateDTO = z.infer<typeof reservationUpdateSchema>;

/**
 * DTO for consuming reservations
 */
export type ReservationConsumeDTO = z.infer<typeof reservationConsumeSchema>;

/**
 * DTO for cancelling reservations
 */
export type ReservationCancelDTO = z.infer<typeof reservationCancelSchema>;

/**
 * DTO for filtering reservations
 */
export type ReservationFilterDTO = z.infer<typeof reservationFilterSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Reservation with inventory item details
 */
export type ReservationWithItem = InventoryReservation & {
  inventoryItem: InventoryItemReference;
};

/**
 * Work order reference
 */
export interface WorkOrderReference {
  id: string;
  woNumber: string;
  title: string;
}

/**
 * PM instance reference
 */
export interface PMInstanceReference {
  id: string;
  pmSchedule: {
    id: string;
    pmTemplate: {
      name: string;
    };
  } | null;
}

/**
 * Reservation with all relations
 */
export type ReservationWithRelations = InventoryReservation & {
  inventoryItem: InventoryItemReference;
  reservedByUser: UserReference;
  cancelledByUser: UserReference | null;
  consumedByUser: UserReference | null;
  workOrder?: WorkOrderReference | null;
  pmInstance?: PMInstanceReference | null;
};

/**
 * Reservation summary for inventory items
 */
export interface ReservationSummary {
  inventoryItemId: string;
  totalReserved: number;
  activeReservations: number;
  expiredReservations: number;
  reservations: ReservationWithRelations[];
}

/**
 * Available quantity calculation result
 */
export interface AvailabilityCheck {
  inventoryItemId: string;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  canReserve: boolean;
  requestedQuantity: number;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate reservation create data
 */
export function validateReservationCreate(data: unknown): ReservationCreateDTO {
  return reservationCreateSchema.parse(data);
}

/**
 * Validate reservation update data
 */
export function validateReservationUpdate(data: unknown): ReservationUpdateDTO {
  return reservationUpdateSchema.parse(data);
}

/**
 * Validate reservation consume data
 */
export function validateReservationConsume(
  data: unknown,
): ReservationConsumeDTO {
  return reservationConsumeSchema.parse(data);
}

/**
 * Validate reservation cancel data
 */
export function validateReservationCancel(data: unknown): ReservationCancelDTO {
  return reservationCancelSchema.parse(data);
}

/**
 * Validate reservation filter data
 */
export function validateReservationFilter(data: unknown): ReservationFilterDTO {
  return reservationFilterSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if reservation is active
 */
export function isActiveReservation(
  reservation: InventoryReservation,
): boolean {
  return reservation.status === ReservationStatus.ACTIVE;
}

/**
 * Check if reservation is expired
 */
export function isExpiredReservation(
  reservation: InventoryReservation,
): boolean {
  if (reservation.status === ReservationStatus.EXPIRED) {
    return true;
  }
  if (reservation.expiresAt && reservation.expiresAt < new Date()) {
    return true;
  }
  return false;
}

/**
 * Check if reservation is cancelled
 */
export function isCancelledReservation(
  reservation: InventoryReservation,
): boolean {
  return reservation.status === ReservationStatus.CANCELLED;
}

/**
 * Check if reservation is consumed
 */
export function isConsumedReservation(
  reservation: InventoryReservation,
): boolean {
  return reservation.status === ReservationStatus.CONSUMED;
}

/**
 * Check if reservation can be cancelled
 */
export function canCancelReservation(
  reservation: InventoryReservation,
): boolean {
  return reservation.status === ReservationStatus.ACTIVE;
}

/**
 * Check if reservation can be consumed
 */
export function canConsumeReservation(
  reservation: InventoryReservation,
): boolean {
  return reservation.status === ReservationStatus.ACTIVE;
}

/**
 * Check if reservation can be edited
 */
export function canEditReservation(reservation: InventoryReservation): boolean {
  return reservation.status === ReservationStatus.ACTIVE;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate total reserved quantity from reservations
 */
export function calculateTotalReserved(
  reservations: InventoryReservation[],
): number {
  return reservations
    .filter((r) => r.status === ReservationStatus.ACTIVE)
    .reduce((total, r) => total + Number(r.quantity), 0);
}

/**
 * Get reservation status color for UI
 */
export function getReservationStatusColor(status: ReservationStatus): string {
  switch (status) {
    case ReservationStatus.ACTIVE:
      return "blue";
    case ReservationStatus.PENDING_REVIEW:
      return "yellow";
    case ReservationStatus.PENDING:
      return "orange";
    case ReservationStatus.EXPIRED:
      return "gray";
    case ReservationStatus.CANCELLED:
      return "red";
    case ReservationStatus.CONSUMED:
      return "green";
    default:
      return "gray";
  }
}

/**
 * Get reservation status label
 */
export function getReservationStatusLabel(status: ReservationStatus): string {
  switch (status) {
    case ReservationStatus.ACTIVE:
      return "Active";
    case ReservationStatus.PENDING_REVIEW:
      return "Pending Review";
    case ReservationStatus.PENDING:
      return "Pending (Backorder)";
    case ReservationStatus.EXPIRED:
      return "Expired";
    case ReservationStatus.CANCELLED:
      return "Cancelled";
    case ReservationStatus.CONSUMED:
      return "Consumed";
    default:
      return "Unknown";
  }
}

/**
 * Format reservation reference
 */
export function formatReservationReference(
  reservedFor: string | null,
  reservedForId: string | null,
): string {
  if (!reservedFor || !reservedForId) {
    return "Manual Reservation";
  }
  return `${reservedFor} #${reservedForId.substring(0, 8)}`;
}
