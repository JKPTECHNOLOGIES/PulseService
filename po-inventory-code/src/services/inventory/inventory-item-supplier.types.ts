/**
 * Inventory Item Supplier Service Types
 *
 * DTOs, types, and Zod schemas for the Inventory Item Supplier service.
 * These types define the shape of data for multi-supplier inventory operations.
 */

import { z } from "zod";

// Base types matching Prisma schema
interface InventoryItemSupplier {
  id: string;
  inventoryItemId: string;
  supplierId: string;
  supplierSku: string | null;
  unitCost: number; // Decimal
  leadTimeDays: number;
  minimumOrderQty: number | null; // Decimal
  isPrimary: boolean;
  isActive: boolean;
  lastOrderDate: Date | null;
  onTimeDeliveries: number;
  totalDeliveries: number;
  qualityRating: number | null; // Decimal (0-5)
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface InventoryItem {
  id: string;
  sku: string;
  description: string;
  unit: string;
  unitCost: number;
  leadTimeDays: number | null;
}

interface Supplier {
  id: string;
  name: string;
  code: string | null;
  leadTimeDays: number | null;
  rating: number | null;
  isActive: boolean;
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating inventory item supplier relationships
 */
export const inventoryItemSupplierCreateSchema = z.object({
  inventoryItemId: z.string().uuid("Invalid inventory item ID"),
  supplierId: z.string().uuid("Invalid supplier ID"),
  supplierSku: z.string().max(100).optional().nullable(),
  unitCost: z.number().nonnegative("Unit cost must be non-negative"),
  leadTimeDays: z.number().int().nonnegative("Lead time must be non-negative"),
  minimumOrderQty: z
    .number()
    .positive("Minimum order quantity must be positive")
    .optional()
    .nullable(),
  isPrimary: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  qualityRating: z.number().min(0).max(5).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for updating inventory item supplier relationships
 */
export const inventoryItemSupplierUpdateSchema = z.object({
  supplierSku: z.string().max(100).optional().nullable(),
  unitCost: z.number().nonnegative("Unit cost must be non-negative").optional(),
  leadTimeDays: z
    .number()
    .int()
    .nonnegative("Lead time must be non-negative")
    .optional(),
  minimumOrderQty: z
    .number()
    .positive("Minimum order quantity must be positive")
    .optional()
    .nullable(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  qualityRating: z.number().min(0).max(5).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for recording delivery performance
 */
export const deliveryPerformanceSchema = z.object({
  wasOnTime: z.boolean(),
  actualLeadTimeDays: z.number().int().nonnegative().optional(),
  qualityRating: z.number().min(0).max(5).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for bulk supplier assignment
 */
export const bulkSupplierAssignmentSchema = z.object({
  inventoryItemIds: z
    .array(z.string().uuid())
    .min(1, "At least one item required"),
  supplierId: z.string().uuid("Invalid supplier ID"),
  unitCost: z.number().nonnegative("Unit cost must be non-negative"),
  leadTimeDays: z.number().int().nonnegative("Lead time must be non-negative"),
  isPrimary: z.boolean().optional().default(false),
});

/**
 * Schema for supplier comparison filters
 */
export const supplierComparisonFilterSchema = z.object({
  inventoryItemId: z.string().uuid("Invalid inventory item ID").optional(),
  category: z.string().optional(),
  minLeadTime: z.number().int().nonnegative().optional(),
  maxLeadTime: z.number().int().nonnegative().optional(),
  minCost: z.number().nonnegative().optional(),
  maxCost: z.number().nonnegative().optional(),
  minQualityRating: z.number().min(0).max(5).optional(),
  activeOnly: z.boolean().optional().default(true),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating inventory item supplier relationships
 */
export type InventoryItemSupplierCreateDTO = z.infer<
  typeof inventoryItemSupplierCreateSchema
>;

/**
 * DTO for updating inventory item supplier relationships
 */
export type InventoryItemSupplierUpdateDTO = z.infer<
  typeof inventoryItemSupplierUpdateSchema
>;

/**
 * DTO for recording delivery performance
 */
export type DeliveryPerformanceDTO = z.infer<typeof deliveryPerformanceSchema>;

/**
 * DTO for bulk supplier assignment
 */
export type BulkSupplierAssignmentDTO = z.infer<
  typeof bulkSupplierAssignmentSchema
>;

/**
 * DTO for supplier comparison filters
 */
export type SupplierComparisonFilterDTO = z.infer<
  typeof supplierComparisonFilterSchema
>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Inventory item supplier with full relations
 */
export type InventoryItemSupplierWithRelations = InventoryItemSupplier & {
  inventoryItem: InventoryItem;
  supplier: Supplier;
  onTimeRate: number;
  averageLeadTime: number | null;
};

/**
 * Supplier comparison data for an inventory item
 */
export interface SupplierComparison {
  inventoryItemId: string;
  inventoryItemSku: string;
  inventoryItemDescription: string;
  suppliers: SupplierComparisonEntry[];
  recommendedSupplierId: string | null;
}

/**
 * Individual supplier entry in comparison
 */
export interface SupplierComparisonEntry {
  supplierId: string;
  supplierName: string;
  supplierCode: string | null;
  supplierSku: string | null;
  unitCost: number;
  leadTimeDays: number;
  minimumOrderQty: number | null;
  isPrimary: boolean;
  isActive: boolean;
  onTimeDeliveries: number;
  totalDeliveries: number;
  onTimeRate: number;
  qualityRating: number | null;
  lastOrderDate: Date | null;
  score: number; // Calculated score for ranking
  notes: string | null;
}

/**
 * Lead time calculation result
 */
export interface LeadTimeCalculation {
  inventoryItemId: string;
  supplierId: string | null;
  leadTimeDays: number;
  source:
    | "item-supplier"
    | "item-average"
    | "supplier-general"
    | "system-default";
  confidence: "high" | "medium" | "low";
  notes: string;
}

/**
 * Supplier selection result
 */
export interface SupplierSelectionResult {
  supplierId: string;
  supplierName: string;
  unitCost: number;
  leadTimeDays: number;
  score: number;
  reason: string;
  alternatives: Array<{
    supplierId: string;
    supplierName: string;
    score: number;
    reason: string;
  }>;
}

/**
 * Supplier performance metrics
 */
export interface SupplierPerformanceMetrics {
  supplierId: string;
  supplierName: string;
  totalItems: number;
  averageUnitCost: number;
  averageLeadTime: number;
  totalDeliveries: number;
  onTimeDeliveries: number;
  onTimeRate: number;
  averageQualityRating: number | null;
  lastOrderDate: Date | null;
  activeItems: number;
  primaryItems: number;
}

/**
 * Lead time analysis data
 */
export interface LeadTimeAnalysis {
  inventoryItemId: string;
  sku: string;
  description: string;
  category: string | null;
  itemLeadTime: number | null;
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    leadTimeDays: number;
    isPrimary: boolean;
    onTimeRate: number;
  }>;
  averageLeadTime: number;
  minLeadTime: number;
  maxLeadTime: number;
  recommendedLeadTime: number;
}

/**
 * Supplier scoring weights
 */
export interface SupplierScoringWeights {
  costWeight: number; // 0-1
  leadTimeWeight: number; // 0-1
  onTimeRateWeight: number; // 0-1
  qualityWeight: number; // 0-1
  recencyWeight: number; // 0-1
}

/**
 * Default scoring weights (must sum to 1.0)
 */
export const DEFAULT_SCORING_WEIGHTS: SupplierScoringWeights = {
  costWeight: 0.25,
  leadTimeWeight: 0.25,
  onTimeRateWeight: 0.25,
  qualityWeight: 0.15,
  recencyWeight: 0.1,
};

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate inventory item supplier create data
 */
export function validateInventoryItemSupplierCreate(
  data: unknown,
): InventoryItemSupplierCreateDTO {
  return inventoryItemSupplierCreateSchema.parse(data);
}

/**
 * Validate inventory item supplier update data
 */
export function validateInventoryItemSupplierUpdate(
  data: unknown,
): InventoryItemSupplierUpdateDTO {
  return inventoryItemSupplierUpdateSchema.parse(data);
}

/**
 * Validate delivery performance data
 */
export function validateDeliveryPerformance(
  data: unknown,
): DeliveryPerformanceDTO {
  return deliveryPerformanceSchema.parse(data);
}

/**
 * Validate bulk supplier assignment data
 */
export function validateBulkSupplierAssignment(
  data: unknown,
): BulkSupplierAssignmentDTO {
  return bulkSupplierAssignmentSchema.parse(data);
}

/**
 * Validate supplier comparison filter data
 */
export function validateSupplierComparisonFilter(
  data: unknown,
): SupplierComparisonFilterDTO {
  return supplierComparisonFilterSchema.parse(data);
}

/**
 * Validate scoring weights (must sum to 1.0)
 */
export function validateScoringWeights(
  weights: SupplierScoringWeights,
): boolean {
  const sum =
    weights.costWeight +
    weights.leadTimeWeight +
    weights.onTimeRateWeight +
    weights.qualityWeight +
    weights.recencyWeight;
  return Math.abs(sum - 1.0) < 0.001; // Allow small floating point errors
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if supplier relationship has delivery history
 */
export function hasDeliveryHistory(supplier: InventoryItemSupplier): boolean {
  return supplier.totalDeliveries > 0;
}

/**
 * Check if supplier relationship is primary
 */
export function isPrimarySupplier(supplier: InventoryItemSupplier): boolean {
  return supplier.isPrimary === true;
}

/**
 * Check if supplier relationship is active
 */
export function isActiveSupplier(supplier: InventoryItemSupplier): boolean {
  return supplier.isActive === true;
}

/**
 * Check if supplier has good on-time rate (>= 90%)
 */
export function hasGoodOnTimeRate(supplier: InventoryItemSupplier): boolean {
  if (supplier.totalDeliveries === 0) return false;
  const onTimeRate =
    (supplier.onTimeDeliveries / supplier.totalDeliveries) * 100;
  return onTimeRate >= 90;
}

/**
 * Check if supplier has good quality rating (>= 4.0)
 */
export function hasGoodQualityRating(supplier: InventoryItemSupplier): boolean {
  return supplier.qualityRating !== null && supplier.qualityRating >= 4.0;
}

// ============================================================================
// CALCULATION HELPERS
// ============================================================================

/**
 * Calculate on-time delivery rate
 */
export function calculateOnTimeRate(
  onTimeDeliveries: number,
  totalDeliveries: number,
): number {
  if (totalDeliveries === 0) return 0;
  return (onTimeDeliveries / totalDeliveries) * 100;
}

/**
 * Calculate supplier score based on multiple factors
 */
export function calculateSupplierScore(
  supplier: SupplierComparisonEntry,
  allSuppliers: SupplierComparisonEntry[],
  weights: SupplierScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  // Normalize cost (lower is better, 0-100 scale)
  const costs = allSuppliers.map((s) => s.unitCost).filter((c) => c > 0);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const costScore =
    maxCost > minCost
      ? ((maxCost - supplier.unitCost) / (maxCost - minCost)) * 100
      : 100;

  // Normalize lead time (lower is better, 0-100 scale)
  const leadTimes = allSuppliers.map((s) => s.leadTimeDays);
  const minLeadTime = Math.min(...leadTimes);
  const maxLeadTime = Math.max(...leadTimes);
  const leadTimeScore =
    maxLeadTime > minLeadTime
      ? ((maxLeadTime - supplier.leadTimeDays) / (maxLeadTime - minLeadTime)) *
        100
      : 100;

  // On-time rate (already 0-100 scale)
  const onTimeScore = supplier.onTimeRate;

  // Quality rating (convert 0-5 to 0-100 scale)
  const qualityScore =
    supplier.qualityRating !== null ? (supplier.qualityRating / 5) * 100 : 50; // Default to 50 if no rating

  // Recency score (more recent orders are better, 0-100 scale)
  let recencyScore = 50; // Default for no orders
  if (supplier.lastOrderDate) {
    const daysSinceLastOrder = Math.floor(
      (Date.now() - supplier.lastOrderDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    // Score decreases as days increase (100 for today, 0 for 365+ days ago)
    recencyScore = Math.max(
      0,
      Math.min(100, 100 - (daysSinceLastOrder / 365) * 100),
    );
  }

  // Calculate weighted score
  const totalScore =
    costScore * weights.costWeight +
    leadTimeScore * weights.leadTimeWeight +
    onTimeScore * weights.onTimeRateWeight +
    qualityScore * weights.qualityWeight +
    recencyScore * weights.recencyWeight;

  return Math.round(totalScore * 100) / 100; // Round to 2 decimal places
}

/**
 * Get lead time source description
 */
export function getLeadTimeSourceDescription(
  source: LeadTimeCalculation["source"],
): string {
  switch (source) {
    case "item-supplier":
      return "Specific supplier lead time for this item";
    case "item-average":
      return "Average of all supplier lead times for this item";
    case "supplier-general":
      return "General supplier lead time";
    case "system-default":
      return "System default lead time (no supplier data available)";
  }
}

/**
 * Get confidence level description
 */
export function getConfidenceLevelDescription(
  confidence: LeadTimeCalculation["confidence"],
): string {
  switch (confidence) {
    case "high":
      return "Based on actual delivery history";
    case "medium":
      return "Based on supplier data but no delivery history";
    case "low":
      return "Based on system defaults";
  }
}
