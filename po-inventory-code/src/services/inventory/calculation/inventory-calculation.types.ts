/**
 * Inventory Calculation Types
 *
 * Centralized types for inventory availability and calculation operations.
 */

/**
 * Basic availability information
 */
export interface AvailabilityInfo {
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
}

/**
 * Store-specific availability
 */
export interface StoreAvailability extends AvailabilityInfo {
  storeId: string;
  storeName?: string;
  bin?: string | null;
}

/**
 * Detailed availability with context
 */
export interface DetailedAvailability extends AvailabilityInfo {
  inventoryItemId: string;
  stores: StoreAvailability[];
  isAvailable: boolean;
  shortfall?: number;
  message?: string;
}

/**
 * Work order context availability
 */
export interface WorkOrderAvailability extends DetailedAvailability {
  workOrderId: string;
  allocatedQuantity: number;
  adjustedAvailable: number;
}

/**
 * Validation result for inventory operations
 */
export interface InventoryValidationResult {
  valid: boolean;
  available: number;
  requested: number;
  shortfall?: number;
  message?: string;
  stores?: StoreAvailability[];
}

/**
 * Stock adjustment operation
 */
export interface StockAdjustment {
  storeId: string;
  quantityChange: number;
  reservedChange?: number;
}

/**
 * Calculation context for work order operations
 */
export interface WorkOrderContext {
  workOrderId: string;
  partId?: string;
  isIssued?: boolean;
  allocatedQuantity?: number;
}

/**
 * Calculation context for reservation operations
 */
export interface ReservationContext {
  reservationId: string;
  isActive?: boolean;
  reservedQuantity?: number;
}

/**
 * Options for availability calculations
 */
export interface CalculationOptions {
  includeReserved?: boolean;
  workOrderContext?: WorkOrderContext;
  reservationContext?: ReservationContext;
  storeId?: string;
}
