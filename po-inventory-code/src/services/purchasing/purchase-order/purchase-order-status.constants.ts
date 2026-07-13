/**
 * Purchase Order Status Constants & Validation
 *
 * B5-6: Runtime validation for PO status values and transitions.
 * The PO status stays as a String in the database (no enum migration).
 * This module provides type-safe constants, validation functions,
 * and status transition rules.
 *
 * The canonical PurchaseOrderStatus enum is defined in purchase-order.types.ts
 * and re-exported here for convenience.
 */

import { PurchaseOrderStatus } from "./purchase-order.types";

// Re-export the enum so consumers can import from either location
export { PurchaseOrderStatus };

/**
 * Type alias for the string values of PurchaseOrderStatus
 * e.g. "Draft" | "Submitted" | "Approved" | ...
 */
export type PurchaseOrderStatusType = `${PurchaseOrderStatus}`;

/**
 * Check if a string is a valid PurchaseOrderStatus value
 */
export function isValidPOStatus(status: string): status is PurchaseOrderStatusType {
  return (Object.values(PurchaseOrderStatus) as string[]).includes(status);
}

/**
 * Valid status transitions for purchase orders.
 *
 * Key = current status, Value = array of allowed next statuses.
 *
 * Notable rules:
 * - CLOSED → [PARTIALLY_RECEIVED]: Allows reopening a closed PO after receipt reversal
 * - PARTIALLY_RECEIVED → [..., CANCELLED]: Allows cancellation from partially received state
 * - CANCELLED → []: Terminal state, no transitions allowed
 */
export const PO_STATUS_TRANSITIONS: Record<PurchaseOrderStatusType, PurchaseOrderStatusType[]> = {
  [PurchaseOrderStatus.DRAFT]: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.CANCELLED],
  [PurchaseOrderStatus.SUBMITTED]: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.CANCELLED], // B8-1: Added Draft for rejection path
  [PurchaseOrderStatus.APPROVED]: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.CANCELLED],
  [PurchaseOrderStatus.ORDERED]: [
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
    PurchaseOrderStatus.RECEIVED,
    PurchaseOrderStatus.INVOICED,
    PurchaseOrderStatus.CLOSED,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [
    PurchaseOrderStatus.RECEIVED,
    PurchaseOrderStatus.INVOICED,
    PurchaseOrderStatus.CLOSED,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.RECEIVED]: [PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.INVOICED, PurchaseOrderStatus.CLOSED], // PartiallyReceived allows reopening for blanket PO additions
  [PurchaseOrderStatus.INVOICED]: [PurchaseOrderStatus.CLOSED],
  [PurchaseOrderStatus.CLOSED]: [PurchaseOrderStatus.PARTIALLY_RECEIVED], // reopen on receipt reversal
  [PurchaseOrderStatus.CANCELLED]: [],
};

/**
 * Check if a status transition is valid according to the transition rules.
 *
 * @param from - Current status (string)
 * @param to - Desired next status (string)
 * @returns true if the transition is allowed, false otherwise
 */
export function isValidPOTransition(from: string, to: string): boolean {
  if (!isValidPOStatus(from) || !isValidPOStatus(to)) return false;
  return PO_STATUS_TRANSITIONS[from].includes(to);
}
