/**
 * Master Cycle Count Service Types
 *
 * Type definitions and Zod schemas for the Master Cycle Count system.
 * Follows the pattern from inventory-stock.types.ts with comprehensive validation.
 */

import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Cycle count status enum
 */
export enum CycleCountStatus {
  IN_PROGRESS = "IN_PROGRESS",
  COUNT_COMPLETE = "COUNT_COMPLETE",
  UNDER_REVIEW = "UNDER_REVIEW",
  APPROVED = "APPROVED",
  POSTED = "POSTED",
  CANCELLED = "CANCELLED",
}

/**
 * Count item status enum
 */
export enum CountItemStatus {
  PENDING = "PENDING",
  COUNTED = "COUNTED",
  VARIANCE_DETECTED = "VARIANCE_DETECTED",
  RECOUNTED = "RECOUNTED",
  VERIFIED = "VERIFIED",
  SKIPPED = "SKIPPED",
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating a master cycle count
 */
export const createCycleCountSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or less"),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or less")
    .optional()
    .nullable(),
  storeId: z.string().uuid("Invalid store ID").optional().nullable(),
  binFilter: z
    .string()
    .max(100, "Bin filter must be 100 characters or less")
    .optional()
    .nullable(),
  categoryFilter: z
    .string()
    .max(100, "Category filter must be 100 characters or less")
    .optional()
    .nullable(),
  notes: z
    .string()
    .max(2000, "Notes must be 2000 characters or less")
    .optional()
    .nullable(),
});

/**
 * Schema for updating a cycle count
 */
export const updateCycleCountSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or less")
    .optional(),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or less")
    .optional()
    .nullable(),
  notes: z
    .string()
    .max(2000, "Notes must be 2000 characters or less")
    .optional()
    .nullable(),
});

/**
 * Schema for entering a count
 */
export const countItemInputSchema = z.object({
  countedQuantity: z
    .number()
    .nonnegative("Counted quantity must be non-negative"),
  notes: z
    .string()
    .max(1000, "Notes must be 1000 characters or less")
    .optional()
    .nullable(),
});

/**
 * Schema for recording a recount
 */
export const recountItemSchema = z.object({
  countedQuantity: z
    .number()
    .nonnegative("Counted quantity must be non-negative"),
  notes: z
    .string()
    .max(1000, "Notes must be 1000 characters or less")
    .optional()
    .nullable(),
});

/**
 * Schema for reviewing a cycle count
 */
export const reviewCycleCountSchema = z.object({
  approved: z.boolean(),
  notes: z
    .string()
    .max(2000, "Notes must be 2000 characters or less")
    .optional()
    .nullable(),
});

/**
 * Schema for approving a cycle count
 */
export const approveCycleCountSchema = z.object({
  notes: z
    .string()
    .max(2000, "Notes must be 2000 characters or less")
    .optional()
    .nullable(),
});

/**
 * Schema for posting a cycle count
 */
export const postCycleCountSchema = z.object({
  notes: z
    .string()
    .max(2000, "Notes must be 2000 characters or less")
    .optional()
    .nullable(),
});

/**
 * Schema for filtering cycle counts
 */
export const cycleCountFiltersSchema = z.object({
  status: z.nativeEnum(CycleCountStatus).optional(),
  storeId: z.string().uuid("Invalid store ID").optional(),
  startedBy: z.string().uuid("Invalid user ID").optional(),
  startDate: z.string().datetime("Invalid start date").optional(),
  endDate: z.string().datetime("Invalid end date").optional(),
  search: z.string().optional(),
});

// ============================================================================
// DTO TYPES (inferred from schemas)
// ============================================================================

export type CreateCycleCountDTO = z.infer<typeof createCycleCountSchema>;
export type UpdateCycleCountDTO = z.infer<typeof updateCycleCountSchema>;
export type CountItemInputDTO = z.infer<typeof countItemInputSchema>;
export type RecountItemDTO = z.infer<typeof recountItemSchema>;
export type ReviewCycleCountDTO = z.infer<typeof reviewCycleCountSchema>;
export type ApproveCycleCountDTO = z.infer<typeof approveCycleCountSchema>;
export type PostCycleCountDTO = z.infer<typeof postCycleCountSchema>;
export type CycleCountFiltersDTO = z.infer<typeof cycleCountFiltersSchema>;

// ============================================================================
// EXTENDED TYPES (with Prisma relations)
// ============================================================================

/**
 * User reference type
 */
export interface UserReference {
  id: string;
  name: string;
  email: string;
}

/**
 * Store reference type
 */
export interface StoreReference {
  id: string;
  name: string;
  code: string;
}

/**
 * Inventory item reference type
 */
export interface InventoryItemReference {
  id: string;
  sku: string;
  description: string;
  unit: string;
  category: string | null;
}

/**
 * Cycle count item with all relations
 */
export interface MasterCycleCountItemWithRelations {
  id: string;
  cycleCountId: string;
  inventoryItemId: string;
  storeId: string;
  bin: string;
  systemQuantity: Decimal;
  systemUnitCost: Decimal;
  status: CountItemStatus;
  firstCountQuantity: Decimal | null;
  firstCountedBy: string | null;
  firstCountedAt: Date | null;
  hasVariance: boolean;
  varianceQuantity: Decimal | null;
  varianceValue: Decimal | null;
  variancePercentage: Decimal | null;
  secondCountQuantity: Decimal | null;
  secondCountedBy: string | null;
  secondCountedAt: Date | null;
  secondCountMatches: boolean | null;
  finalQuantity: Decimal | null;
  finalCountedBy: string | null;
  finalCountedAt: Date | null;
  notes: string | null;
  varianceReason: string | null;
  requiresInvestigation: boolean;
  investigationNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  inventoryItem: InventoryItemReference;
  store: StoreReference;
  firstCounter: { id: string; name: string } | null;
  secondCounter: { id: string; name: string } | null;
  finalCounter: { id: string; name: string } | null;
}

/**
 * Cycle count with all relations
 */
export interface MasterCycleCountWithRelations {
  id: string;
  countNumber: string;
  title: string;
  description: string | null;
  status: CycleCountStatus;
  storeId: string | null;
  binFilter: string | null;
  categoryFilter: string | null;
  startedBy: string;
  startedAt: Date;
  countCompletedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  totalItems: number;
  itemsCounted: number;
  itemsWithVariance: number;
  totalVarianceValue: Decimal;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  starter: UserReference;
  reviewer: UserReference | null;
  approver: UserReference | null;
  store: StoreReference | null;
  items: MasterCycleCountItemWithRelations[];
}

/**
 * Bin count group for organizing items by bin
 */
export interface BinCountGroup {
  bin: string;
  totalItems: number;
  countedItems: number;
  pendingItems: number;
  varianceItems: number;
  totalValue: number;
  items: MasterCycleCountItemWithRelations[];
}

/**
 * Cycle count statistics
 */
export interface CycleCountStatistics {
  totalItems: number;
  itemsCounted: number;
  itemsPending: number;
  itemsWithVariance: number;
  totalVarianceValue: number;
  averageVariancePercentage: number;
  countProgress: number; // Percentage
  binProgress: {
    bin: string;
    total: number;
    counted: number;
    progress: number;
  }[];
}

/**
 * Variance report
 */
export interface VarianceReport {
  cycleCount: {
    id: string;
    countNumber: string;
    title: string;
    status: CycleCountStatus;
  };
  summary: {
    totalItems: number;
    itemsWithVariance: number;
    totalVarianceValue: number;
    variancePercentage: number;
  };
  variances: {
    item: {
      sku: string;
      description: string;
      bin: string;
    };
    systemQuantity: number;
    countedQuantity: number;
    varianceQuantity: number;
    varianceValue: number;
    variancePercentage: number;
    reason: string | null;
    requiresInvestigation: boolean;
  }[];
  byBin: {
    bin: string;
    itemsWithVariance: number;
    totalVarianceValue: number;
  }[];
  byCategory: {
    category: string;
    itemsWithVariance: number;
    totalVarianceValue: number;
  }[];
}

/**
 * Audit entry for cycle count actions
 */
export interface AuditEntry {
  id: string;
  action: string;
  performedAt: Date;
  performedByName: string;
  details: Record<string, unknown>;
}

/**
 * Variance thresholds for determining recount requirements
 */
export interface VarianceThresholds {
  minorPercentage: number;
  minorValue: number;
  moderatePercentage: number;
  moderateValue: number;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate create cycle count data
 */
export function validateCreateCycleCount(data: unknown): CreateCycleCountDTO {
  return createCycleCountSchema.parse(data);
}

/**
 * Validate update cycle count data
 */
export function validateUpdateCycleCount(data: unknown): UpdateCycleCountDTO {
  return updateCycleCountSchema.parse(data);
}

/**
 * Validate count item input data
 */
export function validateCountItemInput(data: unknown): CountItemInputDTO {
  return countItemInputSchema.parse(data);
}

/**
 * Validate recount item data
 */
export function validateRecountItem(data: unknown): RecountItemDTO {
  return recountItemSchema.parse(data);
}

/**
 * Validate review cycle count data
 */
export function validateReviewCycleCount(data: unknown): ReviewCycleCountDTO {
  return reviewCycleCountSchema.parse(data);
}

/**
 * Validate approve cycle count data
 */
export function validateApproveCycleCount(data: unknown): ApproveCycleCountDTO {
  return approveCycleCountSchema.parse(data);
}

/**
 * Validate post cycle count data
 */
export function validatePostCycleCount(data: unknown): PostCycleCountDTO {
  return postCycleCountSchema.parse(data);
}

/**
 * Validate cycle count filters
 */
export function validateCycleCountFilters(data: unknown): CycleCountFiltersDTO {
  return cycleCountFiltersSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if cycle count has items
 */
export function hasItems(
  cycleCount: MasterCycleCountWithRelations | { items?: unknown[] },
): cycleCount is MasterCycleCountWithRelations {
  return "items" in cycleCount && Array.isArray(cycleCount.items);
}

/**
 * Check if cycle count is editable
 */
export function isEditable(status: CycleCountStatus): boolean {
  return status === CycleCountStatus.IN_PROGRESS;
}

/**
 * Check if cycle count can be completed
 */
export function canComplete(status: CycleCountStatus): boolean {
  return status === CycleCountStatus.IN_PROGRESS;
}

/**
 * Check if cycle count can be approved
 */
export function canApprove(status: CycleCountStatus): boolean {
  return (
    status === CycleCountStatus.COUNT_COMPLETE ||
    status === CycleCountStatus.UNDER_REVIEW
  );
}

/**
 * Check if cycle count can be posted
 */
export function canPost(status: CycleCountStatus): boolean {
  return status === CycleCountStatus.APPROVED;
}

/**
 * Check if item requires recount
 */
export function requiresRecount(status: CountItemStatus): boolean {
  return status === CountItemStatus.VARIANCE_DETECTED;
}

/**
 * Check if item is counted
 */
export function isCounted(status: CountItemStatus): boolean {
  return (
    status === CountItemStatus.COUNTED ||
    status === CountItemStatus.VERIFIED ||
    status === CountItemStatus.RECOUNTED
  );
}
