/**
 * Inventory Automation Types
 *
 * Type definitions for inventory automation including auto-reorder,
 * smart supplier selection, auto-PO generation, and stock optimization.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Inventory automation rule types
 */
export enum InventoryAutomationRule {
  AUTO_REORDER = "AutoReorder",
  SUPPLIER_SELECTION = "SupplierSelection",
  PO_GENERATION = "POGeneration",
  STOCK_OPTIMIZATION = "StockOptimization",
}

/**
 * Automation trigger types
 */
export enum AutomationTrigger {
  LOW_STOCK = "LowStock",
  STOCK_OUT = "StockOut",
  USAGE_PATTERN = "UsagePattern",
  SEASONAL_DEMAND = "SeasonalDemand",
  LEAD_TIME_CHANGE = "LeadTimeChange",
}

/**
 * Automation action types
 */
export enum AutomationAction {
  CREATE_REQUISITION = "CreateRequisition",
  CREATE_PO = "CreatePO",
  SELECT_SUPPLIER = "SelectSupplier",
  ADJUST_REORDER_POINT = "AdjustReorderPoint",
  SEND_ALERT = "SendAlert",
}

// ============================================================================
// AUTOMATION RULE TYPES
// ============================================================================

/**
 * Automation rule configuration
 */
export interface AutomationRuleConfig {
  trigger: AutomationTrigger;
  conditions: Record<string, unknown>;
  actions: Array<{
    type: AutomationAction;
    parameters: Record<string, unknown>;
  }>;
  priority: number;
}

/**
 * Automation rule with relations
 */
export interface InventoryAutomationRuleWithRelations {
  id: string;
  name: string;
  description: string | null;
  ruleType: InventoryAutomationRule;
  trigger: AutomationTrigger;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lastExecutedAt: Date | null;
  executionCount: number;
}

// ============================================================================
// AUTOMATION RECOMMENDATION TYPES
// ============================================================================

/**
 * Automation recommendation
 */
export interface AutomationRecommendation {
  id: string;
  ruleId: string | null;
  inventoryItemId: string | null;
  recommendationType: string;
  title: string;
  description: string;
  impact: string;
  estimatedSavings: number | null;
  data: Prisma.JsonValue;
  status: string;
  appliedAt: Date | null;
  appliedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  inventoryItem?: {
    id: string;
    sku: string;
    description: string;
  };
}

// ============================================================================
// REORDER TYPES
// ============================================================================

/**
 * Reorder point calculation result
 */
export interface ReorderPointCalculation {
  itemId: string;
  currentStock: number;
  minQuantity: number;
  maxQuantity: number;
  leadTimeDays: number;
  averageDailyUsage: number;
  safetyStock: number;
  needsReorder: boolean;
  daysUntilStockout: number | null;
}

/**
 * Economic Order Quantity (EOQ) calculation
 */
export interface EOQCalculation {
  optimalOrderQuantity: number;
  annualDemand: number;
  orderingCost: number;
  holdingCost: number;
  totalAnnualCost: number;
  ordersPerYear: number;
}

// ============================================================================
// SUPPLIER SELECTION TYPES
// ============================================================================

/**
 * Supplier score calculation
 */
export interface SupplierScore {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  priceScore: number;
  leadTimeScore: number;
  reliabilityScore: number;
  qualityScore: number;
  metrics: {
    averagePrice: number;
    averageLeadTime: number;
    onTimeDeliveryRate: number;
    defectRate: number;
    totalOrders: number;
  };
}

/**
 * Supplier comparison result
 */
export interface SupplierComparison {
  itemId: string;
  itemSku: string;
  suppliers: SupplierScore[];
  recommendedSupplierId: string;
  reasoning: string;
}

// ============================================================================
// STOCK OPTIMIZATION TYPES
// ============================================================================

/**
 * Usage pattern analysis
 */
export interface UsagePattern {
  itemId: string;
  averageDailyUsage: number;
  usageVariance: number;
  trend: "Increasing" | "Decreasing" | "Stable";
  seasonality: boolean;
  peakMonths: number[];
  lowMonths: number[];
}

/**
 * ABC classification
 */
export enum ABCClass {
  A = "A", // High value, tight control
  B = "B", // Moderate value, moderate control
  C = "C", // Low value, simple control
}

/**
 * ABC classification result
 */
export interface ABCClassification {
  itemId: string;
  classification: ABCClass;
  annualUsageValue: number;
  percentageOfTotalValue: number;
  cumulativePercentage: number;
}

/**
 * Stock level optimization result
 */
export interface StockLevelOptimization {
  itemId: string;
  currentMin: number;
  currentMax: number;
  currentReorderPoint: number;
  recommendedMin: number;
  recommendedMax: number;
  recommendedReorderPoint: number;
  reasoning: string;
  estimatedSavings: number;
}

// ============================================================================
// DTO SCHEMAS
// ============================================================================

/**
 * Create automation rule DTO schema
 */
export const inventoryAutomationRuleCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  ruleType: z.nativeEnum(InventoryAutomationRule),
  trigger: z.nativeEnum(AutomationTrigger),
  conditions: z.record(z.string(), z.unknown()),
  actions: z.array(
    z.object({
      type: z.nativeEnum(AutomationAction),
      parameters: z.record(z.string(), z.unknown()),
    }),
  ),
  priority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export type InventoryAutomationRuleCreateDTO = z.infer<
  typeof inventoryAutomationRuleCreateSchema
>;

/**
 * Update automation rule DTO schema
 */
export const inventoryAutomationRuleUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  trigger: z.nativeEnum(AutomationTrigger).optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  actions: z
    .array(
      z.object({
        type: z.nativeEnum(AutomationAction),
        parameters: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type InventoryAutomationRuleUpdateDTO = z.infer<
  typeof inventoryAutomationRuleUpdateSchema
>;

/**
 * Apply recommendation DTO schema
 */
export const applyRecommendationSchema = z.object({
  notes: z.string().optional(),
});

export type ApplyRecommendationDTO = z.infer<typeof applyRecommendationSchema>;

/**
 * Analyze inventory DTO schema
 */
export const analyzeInventorySchema = z.object({
  itemIds: z.array(z.string()).optional(),
  storeId: z.string().optional(),
  analysisType: z.enum(["usage", "abc", "optimization", "all"]).default("all"),
});

export type AnalyzeInventoryDTO = z.infer<typeof analyzeInventorySchema>;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate Economic Order Quantity (EOQ)
 */
export function calculateEOQ(
  annualDemand: number,
  orderingCost: number,
  holdingCostPerUnit: number,
): EOQCalculation {
  const eoq = Math.sqrt((2 * annualDemand * orderingCost) / holdingCostPerUnit);
  const ordersPerYear = annualDemand / eoq;
  const totalAnnualCost =
    (annualDemand / eoq) * orderingCost + (eoq / 2) * holdingCostPerUnit;

  return {
    optimalOrderQuantity: Math.ceil(eoq),
    annualDemand,
    orderingCost,
    holdingCost: holdingCostPerUnit,
    totalAnnualCost,
    ordersPerYear,
  };
}

/**
 * Calculate safety stock
 */
export function calculateSafetyStock(
  _averageDailyUsage: number,
  usageVariance: number,
  leadTimeDays: number,
  serviceLevel: number = 0.95, // 95% service level
): number {
  // Z-score for 95% service level is approximately 1.65
  const zScore = serviceLevel === 0.95 ? 1.65 : 1.96; // 99% = 1.96
  const standardDeviation = Math.sqrt(usageVariance);
  const safetyStock = zScore * standardDeviation * Math.sqrt(leadTimeDays);

  return Math.ceil(safetyStock);
}

/**
 * Calculate reorder point
 */
export function calculateReorderPoint(
  averageDailyUsage: number,
  leadTimeDays: number,
  safetyStock: number,
): number {
  return Math.ceil(averageDailyUsage * leadTimeDays + safetyStock);
}

/**
 * Determine ABC classification
 */
export function determineABCClass(cumulativePercentage: number): ABCClass {
  if (cumulativePercentage <= 80) return ABCClass.A;
  if (cumulativePercentage <= 95) return ABCClass.B;
  return ABCClass.C;
}

/**
 * Calculate days until stockout
 */
export function calculateDaysUntilStockout(
  currentStock: number,
  averageDailyUsage: number,
): number | null {
  if (averageDailyUsage <= 0) return null;
  return Math.floor(currentStock / averageDailyUsage);
}

/**
 * Validate automation rule conditions
 */
export function validateRuleConditions(
  trigger: AutomationTrigger,
  conditions: Record<string, unknown>,
): boolean {
  switch (trigger) {
    case AutomationTrigger.LOW_STOCK:
      return typeof conditions.threshold === "number";

    case AutomationTrigger.STOCK_OUT:
      return true; // No specific conditions required

    case AutomationTrigger.USAGE_PATTERN:
      return typeof conditions.minUsageChange === "number";

    case AutomationTrigger.SEASONAL_DEMAND:
      return Array.isArray(conditions.months);

    case AutomationTrigger.LEAD_TIME_CHANGE:
      return typeof conditions.minLeadTimeChange === "number";

    default:
      return false;
  }
}

/**
 * Validate automation rule actions
 */
export function validateRuleActions(
  actions: Array<{
    type: AutomationAction;
    parameters: Record<string, unknown>;
  }>,
): boolean {
  if (actions.length === 0) return false;

  return actions.every((action) => {
    switch (action.type) {
      case AutomationAction.CREATE_REQUISITION:
        return typeof action.parameters.autoSubmit === "boolean";

      case AutomationAction.CREATE_PO:
        return typeof action.parameters.supplierId === "string";

      case AutomationAction.SELECT_SUPPLIER:
        return typeof action.parameters.criteria === "string";

      case AutomationAction.ADJUST_REORDER_POINT:
        return typeof action.parameters.adjustmentFactor === "number";

      case AutomationAction.SEND_ALERT:
        return typeof action.parameters.recipients === "object";

      default:
        return false;
    }
  });
}
