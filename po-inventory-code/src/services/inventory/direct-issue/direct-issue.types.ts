/**
 * Direct Issue Service Types
 *
 * DTOs, types, and Zod schemas for direct inventory issue operations.
 * Allows issuing inventory to departments/account codes without work orders.
 */

import { z } from "zod";
import { DirectIssueStatus, ReturnCondition } from "@prisma/client";

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating direct issues
 */
export const directIssueCreateSchema = z
  .object({
    inventoryItemId: z.string().min(1, "Inventory item ID is required"),
    storeId: z.string().optional(), // Optional - required only for non-serialized items
    quantity: z.number().positive("Quantity must be positive").optional(),
    serialNumber: z.string().optional(),
    departmentId: z.string().optional(),
    accountCodeId: z.string().optional(),
    areaId: z.string().optional(),
    projectId: z.string().optional(), // Project code to charge — budget consumed from ProjectBudget
    workOrderId: z.string().optional(),
    pmEquipmentId: z.string().optional().nullable(),
    purpose: z.string().optional(),
    notes: z.string().optional(),
    // initialStatus is retained in the schema for potential programmatic use
    // but is never set by the UI dialog — the outgoing serial always becomes
    // IN_USE (set by the service) and the broken part is handled via the
    // auto-created repair WO (serial assigned later from the repair WO page).
    initialStatus: z
      .enum([
        "AVAILABLE",
        "IN_USE",
        "IN_REPAIR_INTERNAL",
        "IN_REPAIR_EXTERNAL",
        "AWAITING_PARTS",
        "REPAIR_COMPLETE",
        "RETIRED",
        "SCRAPPED",
      ])
      .optional(),
    // Broken-unit fields (brokenUnitAction, brokenSerialNumber, brokenCondition,
    // brokenRepairType, brokenRepairReason, brokenSupplierId) have been removed.
    // The broken part is now tracked exclusively through the auto-created repair
    // WO — the serial is assigned from the repair WO page, not at DI time.
  })
  .refine(
    (data) => {
      // Either quantity or serialNumber must be provided
      return data.quantity !== undefined || data.serialNumber !== undefined;
    },
    {
      message: "Either quantity or serial number must be provided",
      path: ["quantity"],
    },
  )
  .refine(
    (data) => {
      // If serialNumber is provided, storeId is not required (tracked on serial)
      // If quantity is provided (non-serialized), storeId is required
      if (data.quantity !== undefined && !data.serialNumber) {
        return !!data.storeId;
      }
      return true;
    },
    {
      message: "Store is required for non-serialized items",
      path: ["storeId"],
    },
  )
  .refine(
    (data) => {
      // accountCodeId is required ONLY when issuing to neither a work order nor a project.
      // Project issues resolve the account code from project.accountCodeId automatically.
      if (!data.workOrderId && !data.projectId) {
        return !!data.accountCodeId;
      }
      return true;
    },
    {
      message:
        "Account Code is required when not issuing to a work order or project",
      path: ["accountCodeId"],
    },
  )
  .refine(
    (data) => {
      // departmentId is required ONLY when issuing to neither a work order nor a project.
      // Project and work-order issues resolve the department via FinanceSettings defaults.
      if (!data.workOrderId && !data.projectId) {
        return !!data.departmentId;
      }
      return true;
    },
    {
      message:
        "Department is required when not issuing to a work order or project",
      path: ["departmentId"],
    },
  );

/**
 * Schema for updating direct issues (notes only)
 */
export const directIssueUpdateSchema = z.object({
  notes: z.string().optional(),
  purpose: z.string().optional(),
});

/**
 * Schema for creating returns
 */
export const directIssueReturnSchema = z.object({
  quantity: z.number().positive("Quantity must be positive"),
  returnToBin: z.string().optional(),
  reason: z.string().optional(),
  condition: z.nativeEnum(ReturnCondition),
  notes: z.string().optional(),
});

/**
 * Schema for filtering direct issues
 */
export const directIssueFilterSchema = z.object({
  inventoryItemId: z.string().optional(),
  departmentId: z.string().optional(),
  accountCodeId: z.string().optional(),
  areaId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.nativeEnum(DirectIssueStatus).optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
});

/**
 * Schema for summary filters
 */
export const directIssueSummaryFilterSchema = z.object({
  departmentId: z.string().optional(),
  accountCodeId: z.string().optional(),
  areaId: z.string().optional(),
  projectId: z.string().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  groupBy: z
    .enum(["department", "accountCode", "area", "item", "project"])
    .optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating direct issues
 */
export type DirectIssueCreateDTO = z.infer<typeof directIssueCreateSchema>;

/**
 * DTO for updating direct issues
 */
export type DirectIssueUpdateDTO = z.infer<typeof directIssueUpdateSchema>;

/**
 * DTO for creating returns
 */
export type DirectIssueReturnDTO = z.infer<typeof directIssueReturnSchema>;

/**
 * DTO for filtering direct issues
 */
export type DirectIssueFilterDTO = z.infer<typeof directIssueFilterSchema>;

/**
 * DTO for summary filters
 */
export type DirectIssueSummaryFilterDTO = z.infer<
  typeof directIssueSummaryFilterSchema
>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Direct issue with relations
 */
export interface DirectIssueWithRelations {
  id: string;
  issueNumber: string;
  inventoryItemId: string;
  inventoryItem: {
    id: string;
    sku: string;
    description: string;
    unit: string;
    unitCost: number;
  };
  storeId: string;
  store: {
    id: string;
    name: string;
    code: string;
  };
  bin: string;
  quantity: number;
  serialNumber: string | null;
  quantityReturned: number;
  quantityRemaining: number;
  unitCost: number;
  totalCost: number;
  departmentId: string | null;
  department: {
    id: string;
    name: string;
    code: string;
  } | null;
  accountCodeId: string | null;
  accountCode: {
    id: string;
    code: string;
    name: string;
  } | null;
  areaId: string | null;
  area: {
    id: string;
    name: string;
  } | null;
  projectId: string | null;
  project: {
    id: string;
    code: string;
    name: string;
  } | null;
  budgetPeriodId: string | null;
  budgetPeriod: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
  } | null;
  workOrderId: string | null;
  workOrder: {
    id: string;
    woNumber: string;
    title: string;
    status: string;
    equipment: {
      id: string;
      tag: string;
      description: string;
    } | null;
  } | null;
  pmEquipmentId: string | null;
  pmEquipment: {
    id: string;
    tag: string;
    description: string;
  } | null;
  issuedBy: string;
  issuedByName: string;
  issuedAt: Date;
  purpose: string | null;
  notes: string | null;
  status: DirectIssueStatus;
  createdAt: Date;
  updatedAt: Date;
  returns: DirectIssueReturnWithRelations[];
  // Reversal metadata for issues that were fully reversed (status REVERSED).
  // The who/when/reason live on the InventoryTransaction (not the DirectIssue),
  // so this is populated by the service from the reversed issue transaction.
  reversal?: {
    reversedByName: string | null;
    reversedAt: Date | null;
    reason: string | null;
  } | null;
}

/**
 * Direct issue return with relations
 */
export interface DirectIssueReturnWithRelations {
  id: string;
  directIssueId: string;
  returnNumber: string;
  quantity: number;
  returnToBin: string;
  reason: string | null;
  condition: ReturnCondition;
  returnedBy: string;
  returnedByName: string;
  returnedAt: Date;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  directIssue?: {
    id: string;
    issueNumber: string;
    inventoryItem: {
      sku: string;
      description: string;
      unit: string;
    };
  };
}

/**
 * Direct issue summary
 */
export interface DirectIssueSummary {
  totalIssues: number;
  totalQuantity: number;
  totalCost: number;
  totalReturned: number;
  returnRate: number;
  byDepartment?: Array<{
    departmentId: string;
    departmentName: string;
    issueCount: number;
    totalQuantity: number;
    totalCost: number;
  }>;
  byAccountCode?: Array<{
    accountCodeId: string;
    accountCode: string;
    accountName: string;
    issueCount: number;
    totalQuantity: number;
    totalCost: number;
  }>;
  byArea?: Array<{
    areaId: string;
    areaName: string;
    issueCount: number;
    totalQuantity: number;
    totalCost: number;
  }>;
  byItem?: Array<{
    inventoryItemId: string;
    sku: string;
    description: string;
    issueCount: number;
    totalQuantity: number;
    totalCost: number;
  }>;
  byProject?: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    issueCount: number;
    totalQuantity: number;
    totalCost: number;
  }>;
}

/**
 * Issue operation result
 */
export interface IssueOperationResult {
  success: boolean;
  directIssue?: DirectIssueWithRelations;
  autoCreatedRequisition?: {
    id: string;
    reqNumber: string;
  };
  error?: string;
  errorCode?: string;
}

/**
 * Return operation result
 */
export interface ReturnOperationResult {
  success: boolean;
  return?: DirectIssueReturnWithRelations;
  updatedIssue?: DirectIssueWithRelations;
  error?: string;
  errorCode?: string;
}

/**
 * Zod schema for reverse request validation
 */
export const directIssueReverseSchema = z.object({
  reason: z.string().min(1, "Reversal reason is required").max(500),
  reversedBy: z.string().min(1),
  reversedByName: z.string().optional(),
  // Optional quantity to reverse. When omitted the full remaining quantity is
  // reversed (legacy behaviour). When less than the full issued quantity the
  // reversal is processed as a partial return of stock to inventory.
  quantity: z
    .number()
    .positive("Reversal quantity must be greater than zero")
    .optional(),
});

export type DirectIssueReverseInput = z.infer<typeof directIssueReverseSchema>;

/**
 * Result of a reverse issue operation
 */
export interface ReverseIssueResult {
  success: boolean;
  reversalTransactionId: string;
  originalTransactionId: string;
  quantityRestored: number;
  glReversed: boolean;
  directIssueUpdated: boolean;
  message: string;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate direct issue create data
 */
export function validateDirectIssueCreate(data: unknown): DirectIssueCreateDTO {
  return directIssueCreateSchema.parse(data);
}

/**
 * Validate direct issue update data
 */
export function validateDirectIssueUpdate(data: unknown): DirectIssueUpdateDTO {
  return directIssueUpdateSchema.parse(data);
}

/**
 * Validate direct issue return data
 */
export function validateDirectIssueReturn(data: unknown): DirectIssueReturnDTO {
  return directIssueReturnSchema.parse(data);
}

/**
 * Validate direct issue filter data
 */
export function validateDirectIssueFilter(data: unknown): DirectIssueFilterDTO {
  return directIssueFilterSchema.parse(data);
}

/**
 * Validate summary filter data
 */
export function validateDirectIssueSummaryFilter(
  data: unknown,
): DirectIssueSummaryFilterDTO {
  return directIssueSummaryFilterSchema.parse(data);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate quantity remaining
 */
export function calculateQuantityRemaining(
  quantity: number,
  quantityReturned: number,
  status?: DirectIssueStatus,
): number {
  // REVERSED and CANCELLED issues are void: the issue has been fully undone, so
  // nothing remains outstanding regardless of quantityReturned. (A full reversal
  // restores all stock but does NOT write DirectIssueReturn rows, so
  // quantityReturned stays 0 — the status is the authoritative signal here.)
  if (
    status === DirectIssueStatus.REVERSED ||
    status === DirectIssueStatus.CANCELLED
  ) {
    return 0;
  }
  return Math.max(0, quantity - quantityReturned);
}

/**
 * Calculate total cost
 */
export function calculateTotalCost(quantity: number, unitCost: number): number {
  return quantity * unitCost;
}

/**
 * Determine status based on returns
 */
export function determineStatus(
  quantity: number,
  quantityReturned: number,
): DirectIssueStatus {
  if (quantityReturned === 0) {
    return DirectIssueStatus.ISSUED;
  } else if (quantityReturned >= quantity) {
    return DirectIssueStatus.FULLY_RETURNED;
  } else {
    return DirectIssueStatus.PARTIALLY_RETURNED;
  }
}

/**
 * Check if return condition allows restocking
 */
export function canRestock(condition: ReturnCondition): boolean {
  return condition === ReturnCondition.GOOD;
}

/**
 * Get status label
 */
export function getStatusLabel(status: DirectIssueStatus): string {
  switch (status) {
    case DirectIssueStatus.ISSUED:
      return "Issued";
    case DirectIssueStatus.PARTIALLY_RETURNED:
      return "Partially Returned";
    case DirectIssueStatus.FULLY_RETURNED:
      return "Fully Returned";
    case DirectIssueStatus.CANCELLED:
      return "Cancelled";
    case DirectIssueStatus.REVERSED:
      return "Reversed";
    default:
      return status;
  }
}

/**
 * Get status color for UI
 */
export function getStatusColor(status: DirectIssueStatus): string {
  switch (status) {
    case DirectIssueStatus.ISSUED:
      return "blue";
    case DirectIssueStatus.PARTIALLY_RETURNED:
      return "yellow";
    case DirectIssueStatus.FULLY_RETURNED:
      return "green";
    case DirectIssueStatus.CANCELLED:
      return "gray";
    case DirectIssueStatus.REVERSED:
      return "red";
    default:
      return "gray";
  }
}

/**
 * Get condition label
 */
export function getConditionLabel(condition: ReturnCondition): string {
  switch (condition) {
    case ReturnCondition.GOOD:
      return "Good (Return to Stock)";
    case ReturnCondition.DAMAGED:
      return "Damaged (Cannot Restock)";
    case ReturnCondition.EXPIRED:
      return "Expired";
    case ReturnCondition.WRONG_ITEM:
      return "Wrong Item";
    default:
      return condition;
  }
}

/**
 * Get condition color for UI
 */
export function getConditionColor(condition: ReturnCondition): string {
  switch (condition) {
    case ReturnCondition.GOOD:
      return "green";
    case ReturnCondition.DAMAGED:
      return "red";
    case ReturnCondition.EXPIRED:
      return "orange";
    case ReturnCondition.WRONG_ITEM:
      return "yellow";
    default:
      return "gray";
  }
}

// BrokenUnitRegistrationInput and registerBrokenUnit() have been removed.
// Broken parts are now tracked exclusively via the auto-created repair WO.
// The serial number is assigned from the repair WO page, not at DI time.
