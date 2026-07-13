/**
 * Inventory Stock Service Types
 *
 * Comprehensive type definitions for inventory stock operations.
 * These types support the 24 documented stock update locations throughout the system:
 *
 * RESERVE Operations (8 locations):
 * 1. reservation.service.ts - createReservation()
 * 2. reservation.service.ts - updateReservation()
 * 3. work-order-part.service.ts - reservePart()
 * 4. work-order-part.service.ts - updateReservation()
 * 5. inventory-reservation-dialog.tsx - handleReserve()
 * 6. work-order-parts-reserve-dialog.tsx - handleReserve()
 * 7. reservation-create-dialog.tsx - handleSubmit()
 * 8. reservation-list.tsx - handleUpdateReservation()
 *
 * UNRESERVE Operations (4 locations):
 * 9. reservation.service.ts - cancelReservation()
 * 10. work-order-part.service.ts - unreservePart()
 * 11. reservation-list.tsx - handleCancelReservation()
 * 12. work-order-parts-reserve-dialog.tsx - handleUnreserve()
 *
 * ISSUE Operations (6 locations):
 * 13. reservation.service.ts - issueReservation()
 * 14. work-order-part.service.ts - issuePart()
 * 15. route.ts (issue) - POST handler
 * 16. reservation-issue-dialog.tsx - handleIssue()
 * 17. reservation-list.tsx - handleIssueReservation()
 * 18. work-order-parts-reserve-dialog.tsx - handleIssue()
 *
 * RECEIVE Operations (2 locations):
 * 19. inventory-create-dialog.tsx - handleSubmit()
 * 20. inventory-edit-dialog.tsx - handleSubmit()
 *
 * TRANSFER Operations (1 location):
 * 21. inventory-edit-dialog.tsx - handleTransfer()
 *
 * ADJUST Operations (3 locations):
 * 22. inventory-edit-dialog.tsx - handleAdjust()
 * 23. inventory-create-dialog.tsx - handleAdjust()
 * 24. inventory.service.ts - adjustStock()
 */

import { ServiceContext } from "@/services/base/types";

/**
 * Options for reserving inventory stock
 * Used when creating or updating reservations
 */
export interface ReserveOptions {
  /**
   * Service context with user information and permissions
   */
  context: ServiceContext;

  /**
   * Store ID to reserve from
   * If not provided, reserves from ALL stores proportionally
   * This allows system-wide reservations without specifying location
   */
  storeId?: string;

  /**
   * Reason for the reservation
   * Helps with audit trail and reporting
   */
  reason?: string;

  /**
   * Type of reference creating this reservation
   * Used to track the source of the reservation
   */
  referenceType?: "WORK_ORDER" | "RESERVATION" | "MANUAL";

  /**
   * ID of the reference entity (work order, reservation, etc.)
   * Links the stock operation to its source
   */
  referenceId?: string;
}

/**
 * Options for unreserving inventory stock
 * Used when canceling reservations or releasing reserved stock
 */
export interface UnreserveOptions {
  /**
   * Service context with user information and permissions
   */
  context: ServiceContext;

  /**
   * Store ID to unreserve from
   * If not provided, unreserves from ALL stores proportionally
   */
  storeId?: string;

  /**
   * Reason for unreserving
   * Important for audit trail (e.g., "Work order cancelled", "Reservation expired")
   */
  reason?: string;

  /**
   * Type of reference that created the original reservation
   */
  referenceType?: "WORK_ORDER" | "RESERVATION" | "MANUAL";

  /**
   * ID of the reference entity
   */
  referenceId?: string;
}

/**
 * Options for issuing inventory stock
 * Used when physically distributing parts from inventory
 */
export interface IssueOptions {
  /**
   * Service context with user information and permissions
   */
  context: ServiceContext;

  /**
   * Store ID to issue from (REQUIRED)
   * Issues must specify exact location
   */
  storeId: string;

  /**
   * Bin location to issue from (OPTIONAL)
   * If not provided, defaults to "MAIN"
   * Used to issue from specific bin locations
   */
  bin?: string;

  /**
   * Reservation ID if issuing from a reservation (OPTIONAL)
   * When provided, validates against reservation quantity and marks reservation CONSUMED
   * When not provided, validates against available stock
   *
   * NOTE: For WorkOrderPart, we now use WorkOrderPart.status instead of InventoryReservation
   */
  reservationId?: string;

  /**
   * Skip reserved quantity validation (OPTIONAL)
   * When true, skips the check that reserved >= quantity for non-reservation issues
   * Used for partial issues where the reservation is managed separately (WorkOrderPart.status)
   * and we don't want to mark the InventoryReservation as CONSUMED
   */
  skipReservedCheck?: boolean;

  /**
   * Skip decrementing quantityReserved (OPTIONAL)
   *
   * GAP 2 FIX: When issuing from a PLANNED WorkOrderPart (no InventoryReservation),
   * there is nothing to unreserve — quantityReserved should not change.
   * Previously the caller called issue() then immediately compensated with
   * quantityReserved += qty (two non-atomic operations).
   *
   * When this flag is true, issue() ONLY decrements quantityOnHand, leaving
   * quantityReserved untouched.  The caller must ensure this is correct (i.e.
   * the part truly has no associated InventoryReservation).
   */
  skipReservedDecrement?: boolean;

  /**
   * Work order ID if issuing to a work order
   */
  workOrderId?: string;

  /**
   * Work order number for reference
   */
  workOrderNumber?: string;

  /**
   * Equipment ID if issuing for specific equipment
   */
  equipmentId?: string;

  /**
   * Equipment tag for reference
   */
  equipmentTag?: string;

  /**
   * User ID performing the issue
   * Required for accountability
   */
  userId: string;

  /**
   * User name performing the issue
   * Stored for audit trail
   */
  userName: string;

  /**
   * Additional notes about the issue
   * Can include installation details, special instructions, etc.
   */
  notes?: string;
}

/**
 * Options for receiving inventory stock
 * Used when adding new stock to inventory
 */
export interface ReceiveOptions {
  /**
   * Service context with user information and permissions
   */
  context: ServiceContext;

  /**
   * Store ID to receive into (REQUIRED)
   * Receives must specify exact location
   */
  storeId: string;

  /**
   * Bin location to receive into (OPTIONAL)
   * If not provided, defaults to "MAIN"
   * Used to receive into specific bin locations
   */
  bin?: string;

  /**
   * Purchase order ID if receiving from PO
   */
  purchaseOrderId?: string;

  /**
   * Purchase order number (human-readable) if receiving from PO.
   * Stored in auto-generated serial notes for provenance.
   */
  purchaseOrderNumber?: string;

  /**
   * Work order ID if stock is being received against a work order
   * (e.g. WO part return or WO-linked receipt).
   * Stored in auto-generated serial notes for provenance.
   */
  workOrderId?: string;

  /**
   * Work order number (human-readable) for provenance in serial notes.
   */
  workOrderNumber?: string;

  /**
   * Generic reference type for the receive operation.
   * Used to tag auto-generated serial notes.
   */
  referenceType?: string;

  /**
   * Supplier ID if receiving from supplier
   */
  supplierId?: string;

  /**
   * Unit cost of received items
   * Used for inventory valuation
   */
  unitCost?: number;

  /**
   * User ID performing the receive
   * Required for accountability
   */
  userId: string;

  /**
   * User name performing the receive
   * Stored for audit trail
   */
  userName: string;

  /**
   * Additional notes about the receipt
   * Can include condition notes, discrepancies, etc.
   */
  notes?: string;

  /**
   * Skip automatic serial (RepairableItem) record generation for repairable items.
   * Set to true when returning previously-issued parts to inventory so that
   * existing serial records (currently IN_USE) are not duplicated.
   * Defaults to false — serial records ARE generated for true new stock (PO receipts,
   * manual adjustments, initial receives).
   */
  skipSerialGeneration?: boolean;
}

/**
 * Options for transferring inventory between stores
 * Used when moving stock from one location to another
 */
export interface TransferOptions {
  /**
   * Service context with user information and permissions
   */
  context: ServiceContext;

  /**
   * Source store ID (REQUIRED)
   */
  fromStoreId: string;

  /**
   * Destination store ID (REQUIRED)
   */
  toStoreId: string;

  /**
   * Inventory item ID being transferred (REQUIRED)
   */
  inventoryItemId: string;

  /**
   * Quantity to transfer (REQUIRED)
   */
  quantity: number;

  /**
   * User ID performing the transfer
   * Required for accountability
   */
  userId: string;

  /**
   * User name performing the transfer
   * Stored for audit trail
   */
  userName: string;

  /**
   * Additional notes about the transfer
   * Can include reason, special handling, etc.
   */
  notes?: string;
}

/**
 * Options for adjusting inventory stock
 * Used for cycle counts, corrections, and other adjustments
 */
export interface AdjustOptions {
  /**
   * Service context with user information and permissions
   */
  context: ServiceContext;

  /**
   * Reason for the adjustment (REQUIRED)
   * Must be one of the predefined reasons for audit compliance
   */
  reason: "CYCLE_COUNT" | "DAMAGE" | "LOSS" | "FOUND" | "CORRECTION";

  /**
   * User ID performing the adjustment
   * Required for accountability
   */
  userId: string;

  /**
   * User name performing the adjustment
   * Stored for audit trail
   */
  userName: string;

  /**
   * Additional notes about the adjustment (REQUIRED for most reasons)
   * Should explain the circumstances of the adjustment
   */
  notes?: string;

  /**
   * Bin to adjust. Defaults to "MAIN" if not provided.
   * Allows cycle counts to target the specific bin being counted.
   */
  bin?: string;
}

/**
 * Result of stock validation check
 * Used to verify if sufficient stock is available before operations
 */
export interface StockValidationResult {
  /**
   * Whether the requested quantity is available
   */
  valid: boolean;

  /**
   * Total available quantity across all stores
   */
  available: number;

  /**
   * Total on-hand quantity across all stores
   */
  onHand: number;

  /**
   * Total reserved quantity across all stores
   */
  reserved: number;

  /**
   * Shortfall amount if insufficient stock
   * Only present when valid = false
   */
  shortfall?: number;

  /**
   * Human-readable message about the validation result
   */
  message?: string;

  /**
   * Breakdown by store
   * Useful for multi-store operations and transfer planning
   */
  stores?: Array<{
    /**
     * Store ID
     */
    storeId: string;

    /**
     * Store name for display
     */
    storeName: string;

    /**
     * Available quantity at this store
     */
    available: number;

    /**
     * On-hand quantity at this store
     */
    onHand: number;

    /**
     * Reserved quantity at this store
     */
    reserved: number;
  }>;
}

/**
 * Summary of stock levels for an inventory item
 * Used for displaying current stock status
 */
export interface StockSummary {
  /**
   * Inventory item ID
   */
  inventoryItemId: string;

  /**
   * Total on-hand quantity across all stores
   */
  totalOnHand: number;

  /**
   * Total reserved quantity across all stores
   */
  totalReserved: number;

  /**
   * Total committed quantity across all stores
   * Units on order via active REQs/POs for specific WOs
   */
  totalCommitted?: number;

  /**
   * Total available quantity across all stores
   * Calculated as: totalOnHand - totalReserved - totalCommitted
   */
  totalAvailable: number;

  /**
   * Breakdown by store
   * Provides detailed view of stock distribution
   */
  stores: Array<{
    /**
     * Store ID
     */
    storeId: string;

    /**
     * Store name for display
     */
    storeName: string;

    /**
     * On-hand quantity at this store
     */
    onHand: number;

    /**
     * Reserved quantity at this store
     */
    reserved: number;

    /**
     * Committed quantity at this store
     * Units on order via active REQs/POs
     */
    committed?: number;

    /**
     * Available quantity at this store
     * Calculated as: onHand - reserved - committed
     */
    available: number;

    /**
     * Bin location within the store
     * Optional, may be null if not assigned
     */
    bin?: string | null;
  }>;
}

/**
 * Result of a stock operation
 * Returned by all stock modification methods
 */
export interface StockOperationResult {
  /**
   * Whether the operation succeeded
   */
  success: boolean;

  /**
   * Updated stock summary after the operation
   * Only present if success = true
   */
  stockSummary?: StockSummary;

  /**
   * Error message if operation failed
   * Only present if success = false
   */
  error?: string;

  /**
   * Error code for programmatic handling
   * Only present if success = false
   */
  errorCode?: string;

  /**
   * Additional metadata about the operation
   * Can include transaction IDs, affected stores, etc.
   */
  metadata?: Record<string, unknown>;
}
