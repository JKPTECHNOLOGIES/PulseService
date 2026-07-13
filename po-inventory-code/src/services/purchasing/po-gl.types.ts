/**
 * PO GL Service Types
 *
 * TypeScript interfaces for Purchase Order GL transaction operations.
 * Follows the pattern established by InventoryGLService.
 */

import { z } from "zod";

/**
 * Parameters for creating a PO receipt GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface POReceiptGLParams {
  // PO information
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;

  // Receipt information
  receiptId: string;
  receiptNumber: string;
  receiptDate: Date;

  // Line item information
  poLineId: string;
  inventoryItemId?: string;
  inventoryItemSku?: string;
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;

  // Account resolution (from PO line allocations)
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)

  // Freight/shipping (optional)
  freightCost?: number;
  capitalizeFreight?: boolean; // If true, add to inventory cost; if false, expense immediately
}

/**
 * Result of PO receipt GL transaction creation
 */
export interface POReceiptGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  budgetUpdated: boolean;
  freightGLTransactionId?: string; // Separate GL transaction for freight if expensed
}

/**
 * Parameters for creating a PO return GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface POReturnGLParams {
  // PO information
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;

  // Return information
  returnId: string;
  returnNumber: string;
  returnDate: Date;
  originalReceiptId: string;

  // Line item information
  poLineId: string;
  inventoryItemId?: string;
  inventoryItemSku?: string;
  description: string;
  quantity: number; // Negative value
  unitCost: number;
  totalCost: number; // Negative value

  // Account resolution (from original receipt)
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)

  // Return reason
  reason: string;
}

/**
 * Result of PO return GL transaction creation
 */
export interface POReturnGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  budgetUpdated: boolean;
}

/**
 * Parameters for creating freight cost GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface FreightCostGLParams {
  // PO information
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;

  // Freight information
  freightCost: number;
  description: string;
  referenceNumber: string;

  // Account resolution
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)

  // Freight handling
  capitalizeToInventory: boolean; // If true, add to inventory asset; if false, expense
  inventoryItemId?: string; // Required if capitalizing
}

/**
 * Result of freight cost GL transaction creation
 */
export interface FreightCostGLResult {
  glTransactionId: string;
  accountCodeId: string;
  budgetPeriodId: string;
}

/**
 * Parameters for creating a SERVICE receipt GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface ServiceReceiptGLParams {
  // PO information
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;

  // Receipt information
  receiptId: string;
  receiptNumber: string;
  receiptDate: Date;

  // Line item information
  poLineId: string;
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;

  // Account resolution (from PO line allocations)
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)
}

/**
 * Result of SERVICE receipt GL transaction creation
 */
export interface ServiceReceiptGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  budgetUpdated: boolean;
}

/**
 * Parameters for creating a CONSUMABLE receipt GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface ConsumableReceiptGLParams {
  // PO information
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;

  // Receipt information
  receiptId: string;
  receiptNumber: string;
  receiptDate: Date;

  // Line item information
  poLineId: string;
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;

  // Account resolution (from PO line allocations)
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)
}

/**
 * Result of CONSUMABLE receipt GL transaction creation
 */
export interface ConsumableReceiptGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  budgetUpdated: boolean;
}

/**
 * Parameters for creating a NON_STOCK receipt GL transaction
 *
 * Non-stock items are linked to inventory items but do NOT update stock levels.
 * Uses PO_RECEIPT_NSI event type for GL rule matching.
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface NonStockReceiptGLParams {
  // PO information
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;

  // Receipt information
  receiptId: string;
  receiptNumber: string;
  receiptDate: Date;

  // Line item information
  poLineId: string;
  inventoryItemId?: string;
  inventoryItemSku?: string;
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;

  // Account resolution (from PO line allocations)
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)
}

/**
 * Result of NON_STOCK receipt GL transaction creation
 */
export interface NonStockReceiptGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  budgetUpdated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax GL types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for creating a tax GL transaction (PO_TAX event).
 *
 * Tax is posted as a separate GL transaction at PO approval/send time
 * when the tax module is enabled and a tax GL account is configured.
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface TaxGLParams {
  /** Purchase order ID */
  purchaseOrderId: string;
  /** PO number for descriptions */
  poNumber: string;
  /** GL account ID for the tax liability/expense account */
  taxGLAccountId: string;
  /** Tax amount (must be > 0) */
  taxAmount: number;
  /** Human-readable tax label (e.g. "Sales Tax", "GST", "VAT") */
  taxLabel: string;
  /** Optional budget dimensions — used if your GL rules for PO_TAX track dimensions */
  accountCodeId?: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string;
  /** Transaction date (defaults to now) */
  transactionDate?: Date;
}

/**
 * Result of creating a tax GL transaction
 */
export interface TaxGLResult {
  glTransactionId: string;
  budgetPeriodId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod validation schemas for API route input validation
// ─────────────────────────────────────────────────────────────────────────────

const budgetDimensions = {
  accountCodeId: z.string().min(1, "Account code ID is required"),
  departmentId: z.string().optional(),
  projectId: z.string().optional(),
  areaId: z.string().optional(),
};

export const POReceiptGLParamsSchema = z.object({
  purchaseOrderId: z.string().min(1, "Purchase order ID is required"),
  poNumber: z.string().min(1, "PO number is required"),
  supplierId: z.string().min(1, "Supplier ID is required"),
  supplierName: z.string().min(1, "Supplier name is required"),
  receiptId: z.string().min(1, "Receipt ID is required"),
  receiptNumber: z.string().min(1, "Receipt number is required"),
  receiptDate: z.coerce.date(),
  poLineId: z.string().min(1, "PO line ID is required"),
  inventoryItemId: z.string().optional(),
  inventoryItemSku: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unitCost: z.number().min(0, "Unit cost must be non-negative"),
  totalCost: z.number().min(0, "Total cost must be non-negative"),
  ...budgetDimensions,
  freightCost: z.number().optional(),
  capitalizeFreight: z.boolean().optional(),
});

export const ServiceReceiptGLParamsSchema = z.object({
  purchaseOrderId: z.string().min(1, "Purchase order ID is required"),
  poNumber: z.string().min(1, "PO number is required"),
  supplierId: z.string().min(1, "Supplier ID is required"),
  supplierName: z.string().min(1, "Supplier name is required"),
  receiptId: z.string().min(1, "Receipt ID is required"),
  receiptNumber: z.string().min(1, "Receipt number is required"),
  receiptDate: z.coerce.date(),
  poLineId: z.string().min(1, "PO line ID is required"),
  description: z.string().min(1, "Description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unitCost: z.number().min(0, "Unit cost must be non-negative"),
  totalCost: z.number().min(0, "Total cost must be non-negative"),
  ...budgetDimensions,
});

export const ConsumableReceiptGLParamsSchema = z.object({
  purchaseOrderId: z.string().min(1, "Purchase order ID is required"),
  poNumber: z.string().min(1, "PO number is required"),
  supplierId: z.string().min(1, "Supplier ID is required"),
  supplierName: z.string().min(1, "Supplier name is required"),
  receiptId: z.string().min(1, "Receipt ID is required"),
  receiptNumber: z.string().min(1, "Receipt number is required"),
  receiptDate: z.coerce.date(),
  poLineId: z.string().min(1, "PO line ID is required"),
  description: z.string().min(1, "Description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unitCost: z.number().min(0, "Unit cost must be non-negative"),
  totalCost: z.number().min(0, "Total cost must be non-negative"),
  ...budgetDimensions,
});

export const POReturnGLParamsSchema = z.object({
  purchaseOrderId: z.string().min(1, "Purchase order ID is required"),
  poNumber: z.string().min(1, "PO number is required"),
  supplierId: z.string().min(1, "Supplier ID is required"),
  supplierName: z.string().min(1, "Supplier name is required"),
  returnId: z.string().min(1, "Return ID is required"),
  returnNumber: z.string().min(1, "Return number is required"),
  returnDate: z.coerce.date(),
  originalReceiptId: z.string().min(1, "Original receipt ID is required"),
  poLineId: z.string().min(1, "PO line ID is required"),
  inventoryItemId: z.string().optional(),
  inventoryItemSku: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  quantity: z.number().negative("Return quantity must be negative"),
  unitCost: z.number().min(0, "Unit cost must be non-negative"),
  totalCost: z.number().negative("Return total cost must be negative"),
  ...budgetDimensions,
  reason: z.string().min(1, "Return reason is required"),
});

export const FreightCostGLParamsSchema = z.object({
  purchaseOrderId: z.string().min(1, "Purchase order ID is required"),
  poNumber: z.string().min(1, "PO number is required"),
  supplierId: z.string().min(1, "Supplier ID is required"),
  freightCost: z.number().positive("Freight cost must be positive"),
  description: z.string().min(1, "Description is required"),
  referenceNumber: z.string().min(1, "Reference number is required"),
  ...budgetDimensions,
  capitalizeToInventory: z.boolean(),
  inventoryItemId: z.string().optional(),
});
