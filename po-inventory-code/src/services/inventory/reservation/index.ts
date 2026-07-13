/**
 * Inventory Reservation Service Barrel Export
 *
 * Exports all reservation-related services, types, and utilities.
 * Refactored into modular services for better maintainability.
 */

// ============================================================================
// TYPES
// ============================================================================
export * from "./reservation.types";
export * from "./lead-time-validation.types";
export * from "./reservation-review.types";

// ============================================================================
// CORE SERVICE (CRUD Operations)
// ============================================================================
export * from "./reservation.service";
export { reservationService } from "./reservation.service";

// ============================================================================
// SPECIALIZED SERVICES
// ============================================================================

// Lifecycle operations (consume, cancel, expire, extend)
export * from "./reservation-lifecycle.service";
export { reservationLifecycleService } from "./reservation-lifecycle.service";

// Query operations (getActive, getExpired, getByWorkOrder, getSummary, etc.)
export * from "./reservation-query.service";
export { reservationQueryService } from "./reservation-query.service";

// Availability checking
export * from "./reservation-availability.service";
export { reservationAvailabilityService } from "./reservation-availability.service";

// Automation (notifications, auto-requisitions, stock monitoring)
export * from "./reservation-automation.service";
export { reservationAutomationService } from "./reservation-automation.service";

// Lead time validation
export * from "./lead-time-validation.service";
export { leadTimeValidationService } from "./lead-time-validation.service";

// Reservation review (long-lead confirmation)
export * from "./reservation-review.service";
export { reservationReviewService } from "./reservation-review.service";

// ============================================================================
// UTILITIES
// ============================================================================
export * from "./reservation-utils";

// Export validation functions explicitly to avoid conflicts
export {
  validateReservationReference,
  validateReservationQuantity,
  validateReservationDates,
  validateConsumptionQuantity,
  validateCanConsume,
  validateCanCancel,
  validateLeadTime,
} from "./reservation-validation";
