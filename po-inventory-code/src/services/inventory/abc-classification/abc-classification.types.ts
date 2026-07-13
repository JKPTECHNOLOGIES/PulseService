/**
 * ABC Classification Service - Type Definitions and Validation Schemas
 *
 * This module provides comprehensive type definitions and Zod validation schemas
 * for the ABC/ABCD classification system. It follows the established pattern from
 * the cycle count service and integrates with Prisma-generated types.
 *
 * @module abc-classification.types
 */

import { Prisma, ABCClassification } from "@prisma/client";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";

// ============================================================================
// RE-EXPORT PRISMA TYPES
// ============================================================================

/**
 * ABC Classification Settings
 * Controls thresholds, frequencies, and calculation parameters
 */
export type ABCClassificationSettings =
  Prisma.ABCClassificationSettingsGetPayload<Record<string, never>>;

/**
 * Inventory Usage Statistic
 * Monthly aggregation of usage data
 */
export type InventoryUsageStatistic = Prisma.InventoryUsageStatisticGetPayload<
  Record<string, never>
>;

/**
 * Inventory Classification History
 * Audit trail for classification changes
 */
export type InventoryClassificationHistory =
  Prisma.InventoryClassificationHistoryGetPayload<Record<string, never>>;

// ============================================================================
// ZOD SCHEMAS FOR VALIDATION
// ============================================================================

/**
 * Schema for updating classification settings
 */
export const updateSettingsSchema = z
  .object({
    aThreshold: z
      .number()
      .min(0, "A threshold must be at least 0")
      .max(100, "A threshold cannot exceed 100"),
    bThreshold: z
      .number()
      .min(0, "B threshold must be at least 0")
      .max(100, "B threshold cannot exceed 100"),
    cThreshold: z
      .number()
      .min(0, "C threshold must be at least 0")
      .max(100, "C threshold cannot exceed 100"),
    aFrequency: z.number().int().min(1, "A frequency must be at least 1 day"),
    bFrequency: z.number().int().min(1, "B frequency must be at least 1 day"),
    cFrequency: z.number().int().min(1, "C frequency must be at least 1 day"),
    dFrequency: z.number().int().min(1, "D frequency must be at least 1 day"),
    rollingMonths: z
      .number()
      .int()
      .min(1, "Rolling months must be at least 1")
      .max(24, "Rolling months cannot exceed 24"),
    autoCalculate: z.boolean(),
    calculationDay: z
      .number()
      .int()
      .min(1, "Calculation day must be at least 1")
      .max(28, "Calculation day cannot exceed 28"),
  })
  .refine((data) => data.bThreshold > data.aThreshold, {
    message: "B threshold must be greater than A threshold",
    path: ["bThreshold"],
  })
  .refine((data) => data.cThreshold > data.bThreshold, {
    message: "C threshold must be greater than B threshold",
    path: ["cThreshold"],
  });

/**
 * Schema for classification report query parameters
 */
export const classificationReportQuerySchema = z.object({
  storeId: z.string().uuid("Invalid store ID").optional(),
  classification: z.nativeEnum(ABCClassification).optional(),
  includeHistory: z.boolean().optional(),
});

/**
 * Schema for items due query parameters
 */
export const itemsDueQuerySchema = z.object({
  storeId: z.string().uuid("Invalid store ID").optional(),
  classification: z.nativeEnum(ABCClassification).optional(),
  overdueDays: z
    .number()
    .int()
    .min(0, "Overdue days must be non-negative")
    .optional(),
});

// ============================================================================
// DTO TYPES (inferred from schemas)
// ============================================================================

export type UpdateSettingsDTO = z.infer<typeof updateSettingsSchema>;
export type ClassificationReportQueryDTO = z.infer<
  typeof classificationReportQuerySchema
>;
export type ItemsDueQueryDTO = z.infer<typeof itemsDueQuerySchema>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Result of classification calculation
 */
export interface ClassificationResult {
  success: boolean;
  itemsClassified: number;
  classifications: {
    A: number;
    B: number;
    C: number;
    D: number;
    UNCLASSIFIED: number;
  };
  totalValue: Decimal;
  executionTime: number;
  errors?: string[];
}

/**
 * Distribution of items by classification
 */
export interface ClassificationDistribution {
  classification: ABCClassification;
  itemCount: number;
  totalValue: Decimal;
  percentOfTotal: number;
  averageValue: Decimal;
}

/**
 * Comprehensive classification report
 */
export interface ClassificationReport {
  summary: {
    totalItems: number;
    totalValue: Decimal;
    lastCalculated: Date | null;
  };
  distribution: ClassificationDistribution[];
  itemsDue: {
    classification: ABCClassification;
    count: number;
    overdue: number;
  }[];
}

/**
 * Inventory item with classification details
 */
export interface ItemWithClassification {
  id: string;
  sku: string;
  description: string;
  category: string | null;
  unit: string;
  unitCost: Decimal;
  abcClassification: ABCClassification | null;
  lastClassifiedAt: Date | null;
  annualUsageQuantity: Decimal | null;
  annualUsageValue: Decimal | null;
  cycleCountFrequencyDays: number | null;
  lastCycleCountDate: Date | null;
  nextCycleCountDate: Date | null;
  usageStatistics: InventoryUsageStatistic[];
  classificationHistory: InventoryClassificationHistory[];
}

// ============================================================================
// INTERNAL CALCULATION TYPES
// ============================================================================

/**
 * Item usage data for classification calculation
 */
export interface ItemUsageData {
  itemId: string;
  sku: string;
  description: string;
  unitCost: Decimal;
  annualUsageQuantity: Decimal;
  annualUsageValue: Decimal;
  currentClassification: ABCClassification | null;
}

/**
 * Classification assignment result
 */
export interface ClassificationAssignment {
  itemId: string;
  classification: ABCClassification;
  frequency: number;
  annualUsageQuantity: Decimal;
  annualUsageValue: Decimal;
  percentileRank: Decimal;
}

/**
 * Settings with calculated thresholds
 */
export interface SettingsWithThresholds extends ABCClassificationSettings {
  thresholds: {
    a: number;
    b: number;
    c: number;
  };
  frequencies: {
    A: number;
    B: number;
    C: number;
    D: number;
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate update settings data
 */
export function validateUpdateSettings(data: unknown): UpdateSettingsDTO {
  return updateSettingsSchema.parse(data);
}

/**
 * Validate classification report query
 */
export function validateClassificationReportQuery(
  data: unknown,
): ClassificationReportQueryDTO {
  return classificationReportQuerySchema.parse(data);
}

/**
 * Validate items due query
 */
export function validateItemsDueQuery(data: unknown): ItemsDueQueryDTO {
  return itemsDueQuerySchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if item has classification
 */
export function hasClassification(item: {
  abcClassification?: ABCClassification | null;
}): item is { abcClassification: ABCClassification } {
  return (
    item.abcClassification !== null && item.abcClassification !== undefined
  );
}

/**
 * Check if item is classified (not UNCLASSIFIED)
 */
export function isClassified(
  classification: ABCClassification | null,
): boolean {
  return (
    classification !== null && classification !== ABCClassification.UNCLASSIFIED
  );
}

/**
 * Check if item is due for cycle count
 */
export function isDueForCount(item: {
  nextCycleCountDate: Date | null;
  abcClassification: ABCClassification | null;
}): boolean {
  if (!item.nextCycleCountDate || !isClassified(item.abcClassification)) {
    return false;
  }
  return new Date(item.nextCycleCountDate) <= new Date();
}

/**
 * Check if item is overdue for cycle count
 */
export function isOverdueForCount(
  item: {
    nextCycleCountDate: Date | null;
    abcClassification: ABCClassification | null;
  },
  overdueDays: number = 0,
): boolean {
  if (!item.nextCycleCountDate || !isClassified(item.abcClassification)) {
    return false;
  }
  const dueDate = new Date(item.nextCycleCountDate);
  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - overdueDays);
  return dueDate <= overdueDate;
}

/**
 * Get classification priority (lower is higher priority)
 */
export function getClassificationPriority(
  classification: ABCClassification,
): number {
  const priorities: Record<ABCClassification, number> = {
    [ABCClassification.A]: 1,
    [ABCClassification.B]: 2,
    [ABCClassification.C]: 3,
    [ABCClassification.D]: 4,
    [ABCClassification.UNCLASSIFIED]: 5,
  };
  return priorities[classification];
}

/**
 * Compare classifications by priority
 */
export function compareClassifications(
  a: ABCClassification,
  b: ABCClassification,
): number {
  return getClassificationPriority(a) - getClassificationPriority(b);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate days until next cycle count
 */
export function daysUntilNextCount(
  nextCycleCountDate: Date | null,
): number | null {
  if (!nextCycleCountDate) return null;
  const now = new Date();
  const next = new Date(nextCycleCountDate);
  const diffTime = next.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Format classification for display
 */
export function formatClassification(
  classification: ABCClassification | null,
): string {
  if (!classification || classification === ABCClassification.UNCLASSIFIED) {
    return "Unclassified";
  }
  return `Class ${classification}`;
}

/**
 * Get classification color for UI
 */
export function getClassificationColor(
  classification: ABCClassification | null,
): string {
  const colors: Record<ABCClassification, string> = {
    [ABCClassification.A]: "red",
    [ABCClassification.B]: "orange",
    [ABCClassification.C]: "yellow",
    [ABCClassification.D]: "gray",
    [ABCClassification.UNCLASSIFIED]: "slate",
  };
  return colors[classification ?? ABCClassification.UNCLASSIFIED];
}

/**
 * Calculate percentage of total value
 */
export function calculatePercentOfTotal(
  value: Decimal,
  totalValue: Decimal,
): number {
  if (totalValue.equals(0)) return 0;
  return (Number(value) / Number(totalValue)) * 100;
}
