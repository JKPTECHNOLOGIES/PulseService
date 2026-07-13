/**
 * Inventory Service Types
 *
 * DTOs, types, and Zod schemas for the Inventory service.
 * These types define the shape of data for inventory operations.
 */

import { z } from "zod";

// Base types matching Prisma schema
interface InventoryItem {
  id: string;
  sku: string;
  description: string;
  category: string | null;
  unit: string;
  minQuantity: number; // Decimal - Triggers reorder when stock ≤ this value
  maxQuantity: number; // Decimal - Target stock level for reorders
  defaultSupplierId: string | null;
  unitCost: number; // Decimal
  leadTimeDays: number | null; // Item-level lead time
  equipmentId: string | null;
  isActive: boolean;
  isStockItem: boolean; // true = Stock (tracked), false = Non-Stock (direct purchase)
  isRepairable: boolean; // true = Repairable item with serial tracking
  isAssembly: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InventoryStock {
  id: string;
  inventoryItemId: string;
  storeId: string;
  bin: string | null;
  quantityOnHand: number; // Decimal
  quantityReserved: number; // Decimal
  quantityCommitted?: number; // Decimal - units on order via active REQs/POs for specific WOs
  lastCountDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Store {
  id: string;
  name: string;
  code: string;
  locationId: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Supplier {
  id: string;
  name: string;
  code: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  website: string | null;
  rating: number | null;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Equipment {
  id: string;
  tag: string;
  description: string;
  locationId: string;
  status: string;
  criticality: string;
}

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Inventory item categories
 */
export enum InventoryCategory {
  SPARE_PARTS = "Spare Parts",
  CONSUMABLES = "Consumables",
  TOOLS = "Tools",
  SAFETY_EQUIPMENT = "Safety Equipment",
  CHEMICALS = "Chemicals",
  LUBRICANTS = "Lubricants",
  ELECTRICAL = "Electrical",
  MECHANICAL = "Mechanical",
  INSTRUMENTATION = "Instrumentation",
  OTHER = "Other",
}

/**
 * Stock transaction types
 */
export enum TransactionType {
  PURCHASE = "Purchase",
  ISSUE = "Issue",
  ADJUSTMENT = "Adjustment",
  RETURN = "Return",
  TRANSFER = "Transfer",
}

/**
 * Unit of measure types
 */
export enum UnitOfMeasure {
  EA = "EA", // Each
  LB = "LB", // Pound
  GAL = "GAL", // Gallon
  TON = "TON", // Ton
  FT = "FT", // Foot
  IN = "IN", // Inch
  YD = "YD", // Yard
  BG = "BG", // Bag
  BX = "BX", // Box
  CS = "CS", // Case
  PL = "PL", // Pallet
  DR = "DR", // Drum
  CF = "CF", // Cubic Foot
  CY = "CY", // Cubic Yard
  SF = "SF", // Square Foot
  SY = "SY", // Square Yard
  HR = "HR", // Hour
  LOT = "LOT", // Lot
  SET = "SET", // Set
  RL = "RL", // Roll
  KG = "KG", // Kilogram
  L = "L", // Liter
  M = "M", // Meter
  BOX = "BOX", // Box (legacy)
  ROLL = "ROLL", // Roll (legacy)
  PACK = "PACK", // Pack
}

/**
 * Display labels for UnitOfMeasure enum values
 */
export const UnitOfMeasureLabels: Record<UnitOfMeasure, string> = {
  [UnitOfMeasure.EA]: "EA - Each",
  [UnitOfMeasure.LB]: "LB - Pound",
  [UnitOfMeasure.GAL]: "GAL - Gallon",
  [UnitOfMeasure.TON]: "TON - Ton",
  [UnitOfMeasure.FT]: "FT - Foot",
  [UnitOfMeasure.IN]: "IN - Inch",
  [UnitOfMeasure.YD]: "YD - Yard",
  [UnitOfMeasure.BG]: "BG - Bag",
  [UnitOfMeasure.BX]: "BX - Box",
  [UnitOfMeasure.CS]: "CS - Case",
  [UnitOfMeasure.PL]: "PL - Pallet",
  [UnitOfMeasure.DR]: "DR - Drum",
  [UnitOfMeasure.CF]: "CF - Cubic Foot",
  [UnitOfMeasure.CY]: "CY - Cubic Yard",
  [UnitOfMeasure.SF]: "SF - Square Foot",
  [UnitOfMeasure.SY]: "SY - Square Yard",
  [UnitOfMeasure.HR]: "HR - Hour",
  [UnitOfMeasure.LOT]: "LOT - Lot",
  [UnitOfMeasure.SET]: "SET - Set",
  [UnitOfMeasure.RL]: "RL - Roll",
  [UnitOfMeasure.KG]: "KG - Kilogram",
  [UnitOfMeasure.L]: "L - Liter",
  [UnitOfMeasure.M]: "M - Meter",
  [UnitOfMeasure.BOX]: "BOX - Box",
  [UnitOfMeasure.ROLL]: "ROLL - Roll",
  [UnitOfMeasure.PACK]: "PACK - Pack",
};

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating inventory items
 */
export const inventoryItemCreateSchema = z
  .object({
    sku: z.string().min(1, "SKU is required").max(50),
    description: z.string().min(1, "Description is required").max(500),
    category: z.string().optional().nullable(),
    unit: z.string().min(1, "Unit of measure is required").max(20),
    isStockItem: z.boolean().optional(),
    isRepairable: z.boolean().optional(),
    isAssembly: z.boolean().optional(),
    minQuantity: z
      .number()
      .nonnegative("Minimum quantity must be non-negative")
      .optional()
      .nullable(),
    maxQuantity: z
      .number()
      .nonnegative("Maximum quantity must be non-negative")
      .optional()
      .nullable(),
    defaultSupplierId: z
      .string()
      .uuid("Invalid supplier ID")
      .optional()
      .nullable(),
    unitCost: z.number().nonnegative("Unit cost must be non-negative"),
    leadTimeDays: z
      .number()
      .int()
      .nonnegative("Lead time must be non-negative")
      .optional()
      .nullable(),
    equipmentId: z.string().uuid("Invalid equipment ID").optional().nullable(),
    isActive: z.boolean().optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) =>
      // Only enforce min < max for stock items that have both values set
      !data.isStockItem ||
      data.minQuantity == null ||
      data.maxQuantity == null ||
      data.minQuantity <= data.maxQuantity,
    {
      message:
        "Minimum quantity must be less than or equal to maximum quantity",
      path: ["maxQuantity"],
    },
  );

/**
 * Schema for updating inventory items (all fields optional)
 */
export const inventoryItemUpdateSchema = inventoryItemCreateSchema
  .partial()
  .extend({
    // Required when unitCost changes by more than 5× or $50 from the current value.
    // Prevents silent typo-driven cost explosions (root cause of the $2,161.85 bolt incident).
    costChangeReason: z.string().max(500).optional().nullable(),
  });

/**
 * Schema for filtering inventory items
 */
export const inventoryItemFilterSchema = z.object({
  category: z.nativeEnum(InventoryCategory).optional(),
  storeId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  equipmentId: z.string().uuid().optional(),
  lowStock: z.boolean().optional(),
  search: z.string().optional(),
});

/**
 * Schema for stock adjustments
 */
export const stockAdjustmentSchema = z.object({
  storeId: z.string().uuid("Invalid store ID"),
  quantity: z.number().refine((val) => val !== 0, {
    message: "Quantity cannot be zero",
  }),
  reason: z.string().min(1, "Reason is required").max(500),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for issuing stock
 */
export const stockIssueSchema = z.object({
  storeId: z.string().uuid("Invalid store ID"),
  quantity: z.number().positive("Quantity must be positive"),
  workOrderId: z.string().uuid("Invalid work order ID").optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for receiving stock
 */
export const stockReceiveSchema = z.object({
  storeId: z.string().uuid("Invalid store ID"),
  quantity: z.number().positive("Quantity must be positive"),
  purchaseOrderId: z
    .string()
    .uuid("Invalid purchase order ID")
    .optional()
    .nullable(),
  unitCost: z.number().nonnegative("Unit cost must be non-negative").optional(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for transferring stock
 */
export const stockTransferSchema = z
  .object({
    fromStoreId: z.string().uuid("Invalid source store ID"),
    toStoreId: z.string().uuid("Invalid destination store ID"),
    quantity: z.number().positive("Quantity must be positive"),
    notes: z.string().max(1000).optional().nullable(),
  })
  .refine((data) => data.fromStoreId !== data.toStoreId, {
    message: "Source and destination stores must be different",
    path: ["toStoreId"],
  });

/**
 * Schema for stock count
 * Supports multi-bin inventory tracking
 * bin is optional and defaults to 'MAIN' if not provided
 */
export const stockCountSchema = z.object({
  storeId: z.string().uuid("Invalid store ID"),
  bin: z.string().min(1, "Bin cannot be empty").max(50).optional(),
  countedQuantity: z
    .number()
    .nonnegative("Counted quantity must be non-negative"),
  reason: z.string().min(1, "Reason is required").max(500),
  notes: z.string().min(1, "Notes are required for physical counts").max(1000),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating inventory items
 */
export type InventoryItemCreateDTO = z.infer<typeof inventoryItemCreateSchema>;

/**
 * DTO for updating inventory items
 */
export type InventoryItemUpdateDTO = z.infer<typeof inventoryItemUpdateSchema>;

/**
 * DTO for filtering inventory items
 */
export type InventoryItemFilterDTO = z.infer<typeof inventoryItemFilterSchema>;

/**
 * DTO for stock adjustments
 */
export type StockAdjustmentDTO = z.infer<typeof stockAdjustmentSchema>;

/**
 * DTO for issuing stock
 */
export type StockIssueDTO = z.infer<typeof stockIssueSchema>;

/**
 * DTO for receiving stock
 */
export type StockReceiveDTO = z.infer<typeof stockReceiveSchema>;

/**
 * DTO for transferring stock
 */
export type StockTransferDTO = z.infer<typeof stockTransferSchema>;

/**
 * DTO for stock count
 */
export type StockCountDTO = z.infer<typeof stockCountSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Inventory item with stock information
 */
export type InventoryItemWithStock = InventoryItem & {
  stock: InventoryStock[];
  totalQuantity: number;
  availableQuantity: number;
};

/**
 * Inventory item with all relations
 */
export type InventoryItemWithRelations = InventoryItem & {
  stock: (InventoryStock & { store: Store })[];
  defaultSupplier: Supplier | null;
  equipment: Equipment | null;
  totalQuantity: number;
  availableQuantity: number;
};

/**
 * Stock transaction record
 */
export interface StockTransaction {
  id: string;
  inventoryItemId: string;
  storeId: string;
  type: TransactionType;
  quantity: number;
  unitCost: number | null;
  reference: string | null; // Work order ID, PO ID, etc.
  notes: string | null;
  performedBy: string;
  performedAt: Date;
}

/**
 * Per-SKU-prefix breakdown for inventory stats
 */
export interface SkuGroupBreakdown {
  count: number;
  totalValue: number;
}

/**
 * Inventory statistics
 */
export interface InventoryStats {
  totalItems: number;
  /** Total value across ALL items (kept for backward compat) */
  totalValue: number;
  /** Total value of items whose SKU is exactly 5 digits (standard storeroom items) */
  standardSkuTotalValue: number;
  /** Per-prefix item counts and values */
  skuBreakdown: {
    standard: SkuGroupBreakdown; // exactly 5-digit numeric SKUs
    ni: SkuGroupBreakdown; // SKUs starting with "NI"
    in: SkuGroupBreakdown; // SKUs starting with "IN"
    sara: SkuGroupBreakdown; // SKUs starting with "SARA"
    other: SkuGroupBreakdown; // everything else
  };
  lowStockItems: number;
  outOfStockItems: number;
  byCategory: Record<string, number>;
  recentTransactions: number;
  averageStockLevel: number;
}

/**
 * Low stock item information
 */
export interface LowStockItem {
  id: string;
  sku: string;
  description: string;
  category: string | null;
  currentQuantity: number;
  minQuantity: number;
  maxQuantity: number;
  defaultSupplier: Supplier | null;
  daysUntilStockout: number | null;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate inventory item create data
 */
export function validateInventoryItemCreate(
  data: unknown,
): InventoryItemCreateDTO {
  return inventoryItemCreateSchema.parse(data);
}

/**
 * Validate inventory item update data
 */
export function validateInventoryItemUpdate(
  data: unknown,
): InventoryItemUpdateDTO {
  return inventoryItemUpdateSchema.parse(data);
}

/**
 * Validate inventory item filter data
 */
export function validateInventoryItemFilter(
  data: unknown,
): InventoryItemFilterDTO {
  return inventoryItemFilterSchema.parse(data);
}

/**
 * Validate stock adjustment data
 */
export function validateStockAdjustment(data: unknown): StockAdjustmentDTO {
  return stockAdjustmentSchema.parse(data);
}

/**
 * Validate stock issue data
 */
export function validateStockIssue(data: unknown): StockIssueDTO {
  return stockIssueSchema.parse(data);
}

/**
 * Validate stock receive data
 */
export function validateStockReceive(data: unknown): StockReceiveDTO {
  return stockReceiveSchema.parse(data);
}

/**
 * Validate stock transfer data
 */
export function validateStockTransfer(data: unknown): StockTransferDTO {
  return stockTransferSchema.parse(data);
}

/**
 * Validate stock count data
 */
export function validateStockCount(data: unknown): StockCountDTO {
  return stockCountSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if inventory item has stock
 */
export function hasStock(
  item: InventoryItem | InventoryItemWithStock,
): item is InventoryItemWithStock {
  return "stock" in item && Array.isArray(item.stock);
}

/**
 * Check if inventory item has all relations
 */
export function hasAllRelations(
  item: InventoryItem | InventoryItemWithRelations,
): item is InventoryItemWithRelations {
  return "stock" in item && "defaultSupplier" in item && "equipment" in item;
}

/**
 * Check if item is low stock (at or below minimum quantity)
 */
export function isLowStock(item: InventoryItemWithStock): boolean {
  return item.totalQuantity <= Number(item.minQuantity);
}

/**
 * Check if item is out of stock
 */
export function isOutOfStock(item: InventoryItemWithStock): boolean {
  return item.totalQuantity === 0;
}

/**
 * Calculate available quantity (on hand - reserved)
 *
 * NOTE: Items in repair are NOT subtracted here because quantityOnHand already
 * reflects the correct count — stock was decremented when items were direct-issued
 * for repair, and incremented back when they return from repair.
 * Subtracting inRepairCount would be a double-deduction.
 *
 * The inRepairCount parameter is kept for backward compatibility but is intentionally ignored.
 */
export function calculateAvailableQuantity(
  stock: InventoryStock[],
  _inRepairCount?: number,
): number {
  return stock.reduce((total, s) => {
    const onHand = Number(s.quantityOnHand);
    const reserved = Number(s.quantityReserved);
    const committed = Number(s.quantityCommitted ?? 0);
    return total + (onHand - reserved - committed);
  }, 0);
}

/**
 * Calculate total quantity on hand
 */
export function calculateTotalQuantity(stock: InventoryStock[]): number {
  return stock.reduce((total, s) => total + Number(s.quantityOnHand), 0);
}
