/**
 * Inventory Transaction Service Types
 *
 * DTOs, types, and Zod schemas for inventory transaction tracking.
 */

import { z } from "zod";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Inventory transaction type values
 */
export enum InventoryTransactionType {
  RECEIVE = "RECEIVE",
  ISSUE = "ISSUE",
  ADJUST = "ADJUST",
  TRANSFER_IN = "TRANSFER_IN",
  TRANSFER_OUT = "TRANSFER_OUT",
  RETURN = "RETURN",
  RESERVE = "RESERVE",
  UNRESERVE = "UNRESERVE",
  WO_PART_ISSUED = "WO_PART_ISSUED",
  WO_RESERVATION_CONSUMED = "WO_RESERVATION_CONSUMED",
  WO_PART_RETURNED = "WO_PART_RETURNED",
  WO_VERIFICATION_RELEASE = "WO_VERIFICATION_RELEASE",
  DIRECT_ISSUE = "DIRECT_ISSUE",
  DIRECT_ISSUE_RETURN = "DIRECT_ISSUE_RETURN",
  DIRECT_ISSUE_REVERSAL = "DIRECT_ISSUE_REVERSAL",
  RMA_DEDUCTION = "RMA_DEDUCTION", // Items leaving facility via supplier return
  RMA_RESTOCK = "RMA_RESTOCK", // Items restocked from a returned RMA
}

/**
 * Reference type values
 */
export enum ReferenceType {
  PURCHASE_ORDER = "PurchaseOrder",
  WORK_ORDER = "WorkOrder",
  ADJUSTMENT = "Adjustment",
  TRANSFER = "Transfer",
  RETURN = "Return",
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating inventory transactions
 *
 * Note: quantity validation is conditional:
 * - Most transaction types require positive quantities (> 0)
 * - ADJUST transactions allow any number (positive, negative, or zero)
 *   - Positive = stock increase
 *   - Negative = stock decrease
 *   - Zero = no-change stock count
 */
export const inventoryTransactionCreateSchema = z
  .object({
    inventoryItemId: z.string().min(1, "Inventory item ID is required"),
    storeId: z.string().min(1, "Store ID is required"),
    transactionType: z.nativeEnum(InventoryTransactionType),
    quantity: z.number(), // Allow any number, validation happens in refinement
    unitCost: z
      .number()
      .nonnegative("Unit cost must be non-negative")
      .optional(),
    referenceType: z.nativeEnum(ReferenceType).optional(),
    referenceId: z.string().optional(),
    referenceNumber: z.string().optional(),
    directIssueId: z.string().optional(),
    directIssueNumber: z.string().optional(),
    notes: z.string().optional(),
    performedBy: z.string().optional(),
    performedByName: z.string().optional(),
    quantityBefore: z.number().optional(),
    quantityAfter: z.number().optional(),
    equipmentId: z.string().optional(),
    equipmentTag: z.string().optional(),
    transactionDate: z.date().optional(),
  })
  .refine(
    (data) => {
      // ADJUST transactions can have any quantity (positive, negative, or zero)
      if (data.transactionType === InventoryTransactionType.ADJUST) {
        return true;
      }
      // All other transaction types must have positive quantities
      return data.quantity > 0;
    },
    {
      message: "Quantity must be positive for non-adjustment transactions",
      path: ["quantity"],
    },
  );

/**
 * Schema for filtering transactions
 */
export const inventoryTransactionFilterSchema = z.object({
  inventoryItemId: z.string().optional(),
  storeId: z.string().optional(),
  transactionType: z.nativeEnum(InventoryTransactionType).optional(),
  referenceType: z.nativeEnum(ReferenceType).optional(),
  referenceId: z.string().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating inventory transactions
 */
export type InventoryTransactionCreateDTO = z.infer<
  typeof inventoryTransactionCreateSchema
>;

/**
 * DTO for filtering inventory transactions
 */
export type InventoryTransactionFilterDTO = z.infer<
  typeof inventoryTransactionFilterSchema
>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Inventory transaction with relations
 */
export interface InventoryTransactionWithRelations {
  id: string;
  inventoryItemId: string;
  inventoryItem: {
    id: string;
    sku: string;
    description: string;
    unit: string;
  };
  storeId: string;
  store: {
    id: string;
    name: string;
    code: string;
  };
  transactionType: string;
  quantity: number;
  unitCost: number | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
  directIssueId: string | null;
  directIssueNumber: string | null;
  notes: string | null;
  performedBy: string | null;
  performedByName: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  equipmentId: string | null;
  equipmentTag: string | null;
  transactionDate: Date;
  createdAt: Date;
}

/**
 * Transaction summary by type
 */
export interface TransactionSummary {
  transactionType: string;
  count: number;
  totalQuantity: number;
  totalValue: number;
}

/**
 * Inventory movement report
 */
export interface InventoryMovementReport {
  inventoryItemId: string;
  sku: string;
  description: string;
  openingBalance: number;
  received: number;
  issued: number;
  adjusted: number;
  transferred: number;
  returned: number;
  closingBalance: number;
  transactions: InventoryTransactionWithRelations[];
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate transaction create data
 */
export function validateTransactionCreate(
  data: unknown,
): InventoryTransactionCreateDTO {
  return inventoryTransactionCreateSchema.parse(data);
}

/**
 * Validate transaction filter data
 */
export function validateTransactionFilter(
  data: unknown,
): InventoryTransactionFilterDTO {
  return inventoryTransactionFilterSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if transaction is a receipt
 */
export function isReceiptTransaction(type: InventoryTransactionType): boolean {
  return (
    type === InventoryTransactionType.RECEIVE ||
    type === InventoryTransactionType.TRANSFER_IN ||
    type === InventoryTransactionType.RETURN
  );
}

/**
 * Check if transaction is an issue
 */
export function isIssueTransaction(type: InventoryTransactionType): boolean {
  return (
    type === InventoryTransactionType.ISSUE ||
    type === InventoryTransactionType.TRANSFER_OUT ||
    type === InventoryTransactionType.WO_PART_ISSUED ||
    type === InventoryTransactionType.WO_RESERVATION_CONSUMED ||
    type === InventoryTransactionType.DIRECT_ISSUE
  );
}

/**
 * Check if transaction is an adjustment
 */
export function isAdjustmentTransaction(
  type: InventoryTransactionType,
): boolean {
  return type === InventoryTransactionType.ADJUST;
}

/**
 * Get transaction type label
 */
export function getTransactionTypeLabel(
  type: InventoryTransactionType,
): string {
  switch (type) {
    case InventoryTransactionType.RECEIVE:
      return "Receipt";
    case InventoryTransactionType.ISSUE:
      return "Issue";
    case InventoryTransactionType.ADJUST:
      return "Adjustment";
    case InventoryTransactionType.TRANSFER_IN:
      return "Transfer In";
    case InventoryTransactionType.TRANSFER_OUT:
      return "Transfer Out";
    case InventoryTransactionType.RETURN:
      return "Return";
    case InventoryTransactionType.RESERVE:
      return "Reserved";
    case InventoryTransactionType.UNRESERVE:
      return "Unreserved";
    case InventoryTransactionType.WO_PART_ISSUED:
      return "WO Part Issued";
    case InventoryTransactionType.WO_RESERVATION_CONSUMED:
      return "WO Reservation Consumed";
    case InventoryTransactionType.WO_PART_RETURNED:
      return "WO Part Returned";
    case InventoryTransactionType.WO_VERIFICATION_RELEASE:
      return "WO Verification Release";
    case InventoryTransactionType.DIRECT_ISSUE:
      return "Direct Issue";
    case InventoryTransactionType.DIRECT_ISSUE_RETURN:
      return "Direct Issue Return";
    case InventoryTransactionType.DIRECT_ISSUE_REVERSAL:
      return "Direct Issue Reversal";
    case InventoryTransactionType.RMA_DEDUCTION:
      return "RMA Deduction";
    case InventoryTransactionType.RMA_RESTOCK:
      return "RMA Restock";
    default:
      return type;
  }
}

/**
 * Get transaction type color for UI
 */
export function getTransactionTypeColor(
  type: InventoryTransactionType,
): string {
  switch (type) {
    case InventoryTransactionType.RECEIVE:
    case InventoryTransactionType.TRANSFER_IN:
    case InventoryTransactionType.RETURN:
    case InventoryTransactionType.WO_PART_RETURNED:
    case InventoryTransactionType.WO_VERIFICATION_RELEASE:
    case InventoryTransactionType.DIRECT_ISSUE_RETURN:
    case InventoryTransactionType.RMA_RESTOCK:
    case InventoryTransactionType.UNRESERVE:
      return "green";
    case InventoryTransactionType.ISSUE:
    case InventoryTransactionType.TRANSFER_OUT:
    case InventoryTransactionType.WO_PART_ISSUED:
    case InventoryTransactionType.WO_RESERVATION_CONSUMED:
    case InventoryTransactionType.DIRECT_ISSUE:
    case InventoryTransactionType.RMA_DEDUCTION:
      return "red";
    case InventoryTransactionType.ADJUST:
    case InventoryTransactionType.RESERVE:
      return "yellow";
    case InventoryTransactionType.DIRECT_ISSUE_REVERSAL:
      return "orange";
    default:
      return "gray";
  }
}
