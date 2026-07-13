/**
 * Reservation Review Service Types
 *
 * DTOs, types, and Zod schemas for the Long-Lead Reservation Review system.
 * These types define the shape of data for reservation review operations.
 */

import { z } from "zod";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Review log action types
 */
export enum ReviewLogAction {
  CONFIRMED = "CONFIRMED",
  ADJUSTED = "ADJUSTED",
  CANCELLED = "CANCELLED",
  REMINDED = "REMINDED",
  AUTO_CANCELLED = "AUTO_CANCELLED",
}

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Reservation review log entry
 */
export interface ReservationReviewLog {
  id: string;
  reservationId: string;
  reviewedBy: string;
  action: string;
  previousQty: number | null;
  newQty: number | null;
  notes: string | null;
  createdAt: Date;
}

/**
 * User reference for review logs
 */
export interface ReviewerReference {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Review log with reviewer details
 */
export interface ReservationReviewLogWithReviewer extends ReservationReviewLog {
  reviewer: ReviewerReference;
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for confirming a reservation
 */
export const reservationConfirmSchema = z.object({
  confirmedQuantity: z
    .number()
    .positive("Quantity must be positive")
    .optional(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for bulk confirming reservations
 */
export const reservationBulkConfirmSchema = z.object({
  reservationIds: z
    .array(z.string().uuid("Invalid reservation ID"))
    .min(1, "At least one reservation ID is required"),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for filtering pending review reservations
 */
export const pendingReviewFilterSchema = z.object({
  userId: z.string().uuid().optional(),
  workOrderId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  dueWithinDays: z.number().int().positive().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for confirming a reservation
 */
export type ReservationConfirmDTO = z.infer<typeof reservationConfirmSchema>;

/**
 * DTO for bulk confirming reservations
 */
export type ReservationBulkConfirmDTO = z.infer<
  typeof reservationBulkConfirmSchema
>;

/**
 * DTO for filtering pending review reservations
 */
export type PendingReviewFilterDTO = z.infer<typeof pendingReviewFilterSchema>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Work order reference for pending review
 */
export interface PendingReviewWorkOrder {
  id: string;
  woNumber: string;
  title: string;
  plannedStartDate: Date | null;
}

/**
 * Stock reference for pending review
 */
export interface PendingReviewStock {
  quantityOnHand: number;
  quantityReserved: number;
}

/**
 * Inventory item reference for pending review
 */
export interface PendingReviewInventoryItem {
  id: string;
  sku: string;
  description: string;
  unit: string;
  stock: PendingReviewStock[];
}

/**
 * User reference for pending review
 */
export interface PendingReviewUser {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * Pending review reservation
 */
export interface PendingReviewReservation {
  id: string;
  inventoryItem: PendingReviewInventoryItem;
  quantity: number;
  reviewDate: Date | null;
  reviewNotifiedAt: Date | null;
  workOrder: PendingReviewWorkOrder | null;
  createdBy: PendingReviewUser;
  notes: string | null;
  createdAt: Date;
}

/**
 * Pending review summary
 */
export interface PendingReviewSummary {
  dueToday: number;
  dueThisWeek: number;
  overdue: number;
  total: number;
}

/**
 * Pending review response
 */
export interface PendingReviewResponse {
  reservations: PendingReviewReservation[];
  summary: PendingReviewSummary;
}

/**
 * Confirmation result for a single reservation
 */
export interface ReservationConfirmResult {
  id: string;
  status: string;
  confirmedAt: Date;
  confirmedBy: string;
  requisitionCreated: boolean;
  requisitionId: string | null;
}

/**
 * Bulk confirmation result
 */
export interface BulkConfirmResult {
  confirmed: number;
  failed: number;
  requisitionsCreated: number;
  results: Array<{
    reservationId: string;
    success: boolean;
    error?: string;
    requisitionId?: string;
  }>;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate reservation confirm data
 */
export function validateReservationConfirm(
  data: unknown,
): ReservationConfirmDTO {
  return reservationConfirmSchema.parse(data);
}

/**
 * Validate bulk confirm data
 */
export function validateBulkConfirm(data: unknown): ReservationBulkConfirmDTO {
  return reservationBulkConfirmSchema.parse(data);
}

/**
 * Validate pending review filter data
 */
export function validatePendingReviewFilter(
  data: unknown,
): PendingReviewFilterDTO {
  return pendingReviewFilterSchema.parse(data);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a reservation is overdue for review
 */
export function isOverdueForReview(
  reviewDate: Date | null,
  reviewNotifiedAt: Date | null,
): boolean {
  if (!reviewDate) return false;
  const now = new Date();
  return reviewDate < now && !reviewNotifiedAt;
}

/**
 * Check if a reservation should be auto-cancelled
 */
export function shouldAutoCancelReservation(
  reviewNotifiedAt: Date | null,
): boolean {
  if (!reviewNotifiedAt) return false;
  const now = new Date();
  const daysSinceNotified = Math.floor(
    (now.getTime() - reviewNotifiedAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  return daysSinceNotified >= 7;
}

/**
 * Calculate days until review
 */
export function daysUntilReview(reviewDate: Date | null): number | null {
  if (!reviewDate) return null;
  const now = new Date();
  const diffTime = reviewDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get review log action label
 */
export function getReviewLogActionLabel(action: string): string {
  switch (action) {
    case ReviewLogAction.CONFIRMED:
      return "Confirmed";
    case ReviewLogAction.ADJUSTED:
      return "Adjusted";
    case ReviewLogAction.CANCELLED:
      return "Cancelled";
    case ReviewLogAction.REMINDED:
      return "Reminded";
    case ReviewLogAction.AUTO_CANCELLED:
      return "Auto-Cancelled";
    default:
      return action;
  }
}

/**
 * Get review log action color
 */
export function getReviewLogActionColor(action: string): string {
  switch (action) {
    case ReviewLogAction.CONFIRMED:
      return "green";
    case ReviewLogAction.ADJUSTED:
      return "blue";
    case ReviewLogAction.CANCELLED:
      return "red";
    case ReviewLogAction.REMINDED:
      return "yellow";
    case ReviewLogAction.AUTO_CANCELLED:
      return "orange";
    default:
      return "gray";
  }
}
