/**
 * Purchase Order Line Item Types
 *
 * Comprehensive type definitions for all line item types:
 * - INVENTORY: Traditional inventory items with SKU tracking
 * - SERVICE: External services (labor, consulting, maintenance contracts)
 * - CONSUMABLE: Non-tracked consumables (gloves, supplies, etc.)
 *
 * Each type has specific fields stored as proper database columns (NO JSON metadata).
 */

import { z } from "zod";
import { LineItemType } from "@prisma/client";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Line item types matching Prisma schema
 */
export { LineItemType };

/**
 * Service types for SERVICE line items
 */
export enum ServiceType {
  LABOR = "LABOR",
  CONSULTING = "CONSULTING",
  MAINTENANCE_CONTRACT = "MAINTENANCE_CONTRACT",
  REPAIR_SERVICE = "REPAIR_SERVICE",
  INSPECTION = "INSPECTION",
  TRAINING = "TRAINING",
  OTHER = "OTHER",
}

/**
 * Consumable categories for CONSUMABLE line items
 */
export enum ConsumableCategory {
  SAFETY_SUPPLIES = "SAFETY_SUPPLIES",
  OFFICE_SUPPLIES = "OFFICE_SUPPLIES",
  CLEANING_SUPPLIES = "CLEANING_SUPPLIES",
  PACKAGING_MATERIALS = "PACKAGING_MATERIALS",
  DISPOSABLE_TOOLS = "DISPOSABLE_TOOLS",
  CHEMICALS = "CHEMICALS",
  OTHER = "OTHER",
}

// ============================================================================
// LINE ITEM SCHEMAS
// ============================================================================

/**
 * Base schema for all line items
 */
const baseLineItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.number().positive("Quantity must be positive"),
  unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  unitOfMeasure: z.string().max(50).optional().nullable(),
  notes: z.string().max(1250).optional().nullable(),
  deliveryDate: z.coerce.date().optional().nullable(),
  // PO-level copy of material long text — editable per PO without touching the material master.
  // null = not yet set (print view falls back to inventoryItem.longText)
  // ""   = explicitly cleared (print view shows nothing)
  longTextOverride: z.string().max(5000).optional().nullable(),
});

/**
 * Schema for INVENTORY line items
 * inventoryItemId is optional to support non-stock/Tabware-imported PO lines
 * that are inventory-type but not linked to a system inventory item.
 */
export const inventoryLineItemSchema = baseLineItemSchema.extend({
  lineType: z.literal(LineItemType.INVENTORY),
  inventoryItemId: z
    .string()
    .uuid("Invalid inventory item ID")
    .optional()
    .nullable(),
});

/**
 * Schema for SERVICE line items
 */
export const serviceLineItemSchema = baseLineItemSchema.extend({
  lineType: z.literal(LineItemType.SERVICE),
  inventoryItemId: z.literal(null).optional(),

  // SERVICE-specific fields
  serviceType: z.string().max(100).optional().nullable(),
  serviceProvider: z.string().max(200).optional().nullable(),
  serviceStartDate: z.coerce.date().optional().nullable(),
  serviceEndDate: z.coerce.date().optional().nullable(),
  serviceLocation: z.string().max(500).optional().nullable(),
  serviceEquipmentId: z.string().uuid().optional().nullable(),
  serviceWorkOrderId: z.string().uuid().optional().nullable(),
  hourlyRate: z.number().nonnegative().optional().nullable(),
  estimatedHours: z.number().positive().optional().nullable(),
  contractNumber: z.string().max(100).optional().nullable(),
  slaDetails: z.string().max(1000).optional().nullable(),
  deliverables: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for CONSUMABLE line items
 */
export const consumableLineItemSchema = baseLineItemSchema.extend({
  lineType: z.literal(LineItemType.CONSUMABLE),
  inventoryItemId: z.literal(null).optional(),

  // CONSUMABLE-specific fields
  consumableCategory: z.string().max(100).optional().nullable(),
  manufacturer: z.string().max(200).optional().nullable(),
  modelNumber: z.string().max(100).optional().nullable(),
  packageSize: z.string().max(100).optional().nullable(),
  monthlyUsageRate: z.number().positive().optional().nullable(),
  storageRequirements: z.string().max(500).optional().nullable(),
  sdsRequired: z.boolean().optional().nullable().default(false),
  expirationTracking: z.boolean().optional().nullable().default(false),
});

/**
 * Schema for NON_STOCK line items
 * Non-stock inventory items that are purchased but not tracked in inventory.
 * Similar to inventory items but without stock tracking.
 */
export const nonStockLineItemSchema = baseLineItemSchema.extend({
  lineType: z.literal(LineItemType.NON_STOCK),
  inventoryItemId: z
    .string()
    .uuid("Invalid inventory item ID")
    .optional()
    .nullable(),
});

/**
 * Schema for REPAIRABLE_RETURN line items
 * Represents a physical repairable part returning from vendor repair.
 * inventoryItemId links to the actual inventory item (the part's SKU).
 * repairableItemId links to the specific serial being returned.
 */
export const repairableReturnLineItemSchema = baseLineItemSchema.extend({
  lineType: z.literal("REPAIRABLE_RETURN" as const),
  inventoryItemId: z
    .string()
    .uuid("Invalid inventory item ID")
    .optional()
    .nullable(),
  repairableItemId: z
    .string()
    .uuid("Invalid repairable item ID")
    .optional()
    .nullable(),
});

/**
 * Discriminated union schema for all line item types
 */
export const lineItemSchema = z.discriminatedUnion("lineType", [
  inventoryLineItemSchema,
  serviceLineItemSchema,
  consumableLineItemSchema,
  nonStockLineItemSchema,
  repairableReturnLineItemSchema,
]);

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for inventory line items
 */
export type InventoryLineItemDTO = z.infer<typeof inventoryLineItemSchema>;

/**
 * DTO for service line items
 */
export type ServiceLineItemDTO = z.infer<typeof serviceLineItemSchema>;

/**
 * DTO for consumable line items
 */
export type ConsumableLineItemDTO = z.infer<typeof consumableLineItemSchema>;

/**
 * DTO for non-stock line items
 */
export type NonStockLineItemDTO = z.infer<typeof nonStockLineItemSchema>;

/**
 * DTO for repairable return line items
 */
export type RepairableReturnLineItemDTO = z.infer<
  typeof repairableReturnLineItemSchema
>;

/**
 * Union DTO for all line item types
 */
export type LineItemDTO = z.infer<typeof lineItemSchema>;

// ============================================================================
// RECEIVING SCHEMAS
// ============================================================================

/**
 * Base schema for receiving any line item type
 * UPDATED: Now supports negative quantities for returns/corrections
 */
const baseReceiveItemSchema = z.object({
  itemId: z.string().uuid("Invalid item ID"),
  quantityReceived: z
    .number()
    .refine((val) => val !== 0, "Quantity received cannot be zero"), // Allow positive (receive) or negative (return)
  receivedBy: z.string().min(1, "Received by is required"),
  receivedByName: z.string().min(1, "Received by name is required"),
  receivedAt: z.coerce.date().optional(),
  invoiceNumber: z.string().max(100).optional().nullable(),
  invoiceDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  documentNumber: z.string().max(100).optional().nullable(), // NEW: Packing slip, receiving doc number
  isReturn: z.boolean().optional().default(false), // NEW: Flag for returns
  originalReceiptId: z.string().uuid().optional().nullable(), // NEW: Reference to original receipt
});

/**
 * Schema for receiving INVENTORY items
 */
export const receiveInventoryItemSchema = baseReceiveItemSchema.extend({
  lineType: z.literal(LineItemType.INVENTORY),
  storeId: z.string().uuid("Invalid store ID"),
  bin: z.string().max(50).optional().default("MAIN"),
  lotNumber: z.string().max(100).optional().nullable(),
  serialNumbers: z.array(z.string()).optional().default([]),
  /** Explicit invoice ID selected by the user during receiving.
   *  When provided, the backend will validate and use this invoice instead of auto-selecting. */
  invoiceId: z.string().uuid("Invalid invoice ID").optional().nullable(),
});

/**
 * Schema for receiving SERVICE items
 */
export const receiveServiceItemSchema = baseReceiveItemSchema.extend({
  lineType: z.literal(LineItemType.SERVICE),
  serviceDate: z.coerce.date(),
  serviceProvider: z.string().max(200).optional().nullable(),
  hoursOrUnits: z.number().positive().optional().nullable(),
  completionNotes: z.string().max(2000).optional().nullable(),
  qualityRating: z.number().int().min(1).max(5).optional().nullable(),
  /** Explicit invoice ID selected by the user during receiving.
   *  When provided, the backend will validate and use this invoice instead of auto-selecting. */
  invoiceId: z.string().uuid("Invalid invoice ID").optional().nullable(),
});

/**
 * Schema for receiving CONSUMABLE items
 */
export const receiveConsumableItemSchema = baseReceiveItemSchema.extend({
  lineType: z.literal(LineItemType.CONSUMABLE),
  usedBy: z.string().uuid().optional().nullable(),
  usedByName: z.string().max(200).optional().nullable(),
  usedAt: z.coerce.date().optional(),
  departmentId: z.string().uuid().optional().nullable(),
  areaId: z.string().uuid().optional().nullable(),
  purpose: z.string().max(500).optional().nullable(),
  /** Explicit invoice ID selected by the user during receiving.
   *  When provided, the backend will validate and use this invoice instead of auto-selecting. */
  invoiceId: z.string().uuid("Invalid invoice ID").optional().nullable(),
});

/**
 * Schema for receiving NON_STOCK items
 * Non-stock items are received like inventory but without stock tracking.
 */
export const receiveNonStockItemSchema = baseReceiveItemSchema.extend({
  lineType: z.literal(LineItemType.NON_STOCK),
  departmentId: z.string().uuid().optional().nullable(),
  areaId: z.string().uuid().optional().nullable(),
  purpose: z.string().max(500).optional().nullable(),
  /** Explicit invoice ID selected by the user during receiving.
   *  When provided, the backend will validate and use this invoice instead of auto-selecting. */
  invoiceId: z.string().uuid("Invalid invoice ID").optional().nullable(),
});

/**
 * Schema for receiving REPAIRABLE_RETURN items.
 * Quantity is always 1 (one physical part back). No store/bin needed —
 * the repair completion service handles the stock increment and location update.
 * No invoice required — the part return is independent of vendor invoicing.
 */
export const receiveRepairableReturnItemSchema = baseReceiveItemSchema.extend({
  lineType: z.literal("REPAIRABLE_RETURN" as const),
});

/**
 * Discriminated union schema for receiving all item types
 */
export const receiveItemSchema = z.discriminatedUnion("lineType", [
  receiveInventoryItemSchema,
  receiveServiceItemSchema,
  receiveConsumableItemSchema,
  receiveNonStockItemSchema,
  receiveRepairableReturnItemSchema,
]);

/**
 * Schema for batch receiving multiple items
 * UPDATED: Added freight cost tracking
 */
export const batchReceiveItemsSchema = z.object({
  items: z.array(receiveItemSchema).min(1, "At least one item is required"),
  notes: z.string().max(2000).optional().nullable(),
  // Freight cost fields
  freightCost: z.number().nonnegative().optional().default(0),
  freightInvoiceNumber: z.string().max(100).optional().nullable(),
  freightCarrier: z.string().max(200).optional().nullable(),
  capitalizeFreight: z.boolean().optional().default(true), // True = add to inventory cost, False = expense immediately
});

// ============================================================================
// RECEIVING DTO TYPES
// ============================================================================

/**
 * DTO for receiving inventory items
 */
export type ReceiveInventoryItemDTO = z.infer<
  typeof receiveInventoryItemSchema
>;

/**
 * DTO for receiving service items
 */
export type ReceiveServiceItemDTO = z.infer<typeof receiveServiceItemSchema>;

/**
 * DTO for receiving consumable items
 */
export type ReceiveConsumableItemDTO = z.infer<
  typeof receiveConsumableItemSchema
>;

/**
 * DTO for receiving non-stock items
 */
export type ReceiveNonStockItemDTO = z.infer<typeof receiveNonStockItemSchema>;

/**
 * DTO for receiving repairable return items
 */
export type ReceiveRepairableReturnItemDTO = z.infer<
  typeof receiveRepairableReturnItemSchema
>;

/**
 * Union DTO for receiving any item type
 */
export type ReceiveItemDTO = z.infer<typeof receiveItemSchema>;

/**
 * DTO for batch receiving
 */
export type BatchReceiveItemsDTO = z.infer<typeof batchReceiveItemsSchema>;

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Result of receiving a single line item
 */
export interface ReceiveLineItemResult {
  success: boolean;
  receiptId?: string;
  receiptNumber?: string;
  itemId: string;
  lineType: LineItemType;
  quantityReceived: number;
  totalCost: number;
  error?: string;
}

/**
 * Result of batch receiving
 */
export interface BatchReceiveResult {
  success: boolean;
  receipts: ReceiveLineItemResult[];
  totalCost: number;
  errors: Array<{
    itemId: string;
    error: string;
  }>;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate line item data
 */
export function validateLineItem(data: unknown): LineItemDTO {
  return lineItemSchema.parse(data);
}

/**
 * Validate inventory line item data
 */
export function validateInventoryLineItem(data: unknown): InventoryLineItemDTO {
  return inventoryLineItemSchema.parse(data);
}

/**
 * Validate service line item data
 */
export function validateServiceLineItem(data: unknown): ServiceLineItemDTO {
  return serviceLineItemSchema.parse(data);
}

/**
 * Validate consumable line item data
 */
export function validateConsumableLineItem(
  data: unknown,
): ConsumableLineItemDTO {
  return consumableLineItemSchema.parse(data);
}

/**
 * Validate receive item data
 */
export function validateReceiveItem(data: unknown): ReceiveItemDTO {
  return receiveItemSchema.parse(data);
}

/**
 * Validate batch receive items data
 */
export function validateBatchReceiveItems(data: unknown): BatchReceiveItemsDTO {
  return batchReceiveItemsSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if line item is INVENTORY type
 */
export function isInventoryLineItem(
  item: LineItemDTO,
): item is InventoryLineItemDTO {
  return item.lineType === LineItemType.INVENTORY;
}

/**
 * Check if line item is SERVICE type
 */
export function isServiceLineItem(
  item: LineItemDTO,
): item is ServiceLineItemDTO {
  return item.lineType === LineItemType.SERVICE;
}

/**
 * Check if line item is CONSUMABLE type
 */
export function isConsumableLineItem(
  item: LineItemDTO,
): item is ConsumableLineItemDTO {
  return item.lineType === LineItemType.CONSUMABLE;
}

/**
 * Check if receive item is INVENTORY type
 */
export function isReceiveInventoryItem(
  item: ReceiveItemDTO,
): item is ReceiveInventoryItemDTO {
  return item.lineType === LineItemType.INVENTORY;
}

/**
 * Check if receive item is SERVICE type
 */
export function isReceiveServiceItem(
  item: ReceiveItemDTO,
): item is ReceiveServiceItemDTO {
  return item.lineType === LineItemType.SERVICE;
}

/**
 * Check if receive item is CONSUMABLE type
 */
export function isReceiveConsumableItem(
  item: ReceiveItemDTO,
): item is ReceiveConsumableItemDTO {
  return item.lineType === LineItemType.CONSUMABLE;
}

/**
 * Check if line item is NON_STOCK type
 */
export function isNonStockLineItem(
  item: LineItemDTO,
): item is NonStockLineItemDTO {
  return item.lineType === LineItemType.NON_STOCK;
}

/**
 * Check if receive item is NON_STOCK type
 */
export function isReceiveNonStockItem(
  item: ReceiveItemDTO,
): item is ReceiveNonStockItemDTO {
  return item.lineType === LineItemType.NON_STOCK;
}

/**
 * Check if line item is REPAIRABLE_RETURN type
 */
export function isRepairableReturnLineItem(
  item: LineItemDTO,
): item is RepairableReturnLineItemDTO {
  return item.lineType === "REPAIRABLE_RETURN";
}

/**
 * Check if receive item is REPAIRABLE_RETURN type
 */
export function isReceiveRepairableReturnItem(
  item: ReceiveItemDTO,
): item is ReceiveRepairableReturnItemDTO {
  return item.lineType === "REPAIRABLE_RETURN";
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get display name for line item type
 */
export function getLineItemTypeDisplay(type: LineItemType): string {
  switch (type) {
    case LineItemType.INVENTORY:
      return "Inventory Item";
    case LineItemType.SERVICE:
      return "Service";
    case LineItemType.CONSUMABLE:
      return "Consumable";
    case LineItemType.NON_STOCK:
      return "Non-Stock Item";
    case LineItemType.REPAIRABLE_RETURN:
      return "Repairable Return";
    default:
      return "Unknown";
  }
}

/**
 * Get display name for service type
 */
export function getServiceTypeDisplay(type: string): string {
  const typeMap: Record<string, string> = {
    LABOR: "Labor",
    CONSULTING: "Consulting",
    MAINTENANCE_CONTRACT: "Maintenance Contract",
    REPAIR_SERVICE: "Repair Service",
    INSPECTION: "Inspection",
    TRAINING: "Training",
    OTHER: "Other",
  };
  return typeMap[type] ?? "Unknown";
}

/**
 * Get display name for consumable category
 */
export function getConsumableCategoryDisplay(category: string): string {
  const categoryMap: Record<string, string> = {
    SAFETY_SUPPLIES: "Safety Supplies",
    OFFICE_SUPPLIES: "Office Supplies",
    CLEANING_SUPPLIES: "Cleaning Supplies",
    PACKAGING_MATERIALS: "Packaging Materials",
    DISPOSABLE_TOOLS: "Disposable Tools",
    CHEMICALS: "Chemicals",
    OTHER: "Other",
  };
  return categoryMap[category] ?? "Unknown";
}
