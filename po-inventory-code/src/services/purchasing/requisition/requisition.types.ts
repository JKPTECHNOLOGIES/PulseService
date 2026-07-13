/**
 * Requisition Service Types
 *
 * DTOs, types, and Zod schemas for the Requisition service.
 * These types define the shape of data for requisition operations.
 */

import { z } from "zod";

// Base types matching Prisma schema
interface Requisition {
  id: string;
  reqNumber: string;
  requestedById: string;
  supplierId: string | null;
  status: string;
  approvalStatus?: string; // Added for new approval system
  priority: RequisitionPriority;
  neededByDate: Date | null;
  description: string | null;
  justification: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
  // PO kickback tracking fields
  resetCount?: number;
  lastResetAt?: Date | null;
  lastResetReason?: string | null;
  // Multi-PO tracking fields (partial conversions / PO cancellation history)
  previousPOIds: string[];
  previousPONumbers: string[];
  /**
   * Tax amount on this requisition.
   * Always 0 when the tax module is disabled.
   * Persisted for budget commitment accuracy.
   * Accepts Prisma Decimal or number to stay compatible with both
   * Prisma query results (Decimal) and service-layer callers (number).
   */
  taxAmount?: number | { toNumber: () => number };
}

interface RequisitionLine {
  id: string;
  requisitionId: string;
  lineType:
    | "INVENTORY"
    | "SERVICE"
    | "CONSUMABLE"
    | "NON_STOCK"
    | "REPAIRABLE_RETURN";
  inventoryItemId: string | null;
  supplierId: string | null;
  description: string;
  quantity: number; // Decimal
  unit: string;
  estimatedPrice: number; // Decimal
  workOrderId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface InventoryItem {
  id: string;
  sku: string;
  description: string;
  unit: string;
  unitCost: number; // Decimal
}

interface Supplier {
  id: string;
  name: string;
  code: string | null;
}

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Requisition status values
 */
export enum RequisitionStatus {
  DRAFT = "Draft",
  SUBMITTED = "Submitted",
  APPROVED = "Approved",
  REJECTED = "Rejected",
  CANCELLED = "Cancelled",
  ORDERED = "Ordered",
  FULFILLED = "Fulfilled", // NEW - PO received & closed
  PARTIALLY_FULFILLED = "PartiallyFulfilled", // NEW - PO partially received
}

/**
 * Requisition priority levels
 */
export enum RequisitionPriority {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
  URGENT = "URGENT",
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for requisition item
 */
export const requisitionItemSchema = z.object({
  id: z.string().uuid().optional(), // Existing line ID — enables ID-based reconciliation
  lineType: z
    .enum([
      "INVENTORY",
      "SERVICE",
      "CONSUMABLE",
      "NON_STOCK",
      "REPAIRABLE_RETURN",
    ])
    .default("INVENTORY"),
  inventoryItemId: z
    .string()
    .uuid("Invalid inventory item ID")
    .optional()
    .nullable(),
  supplierId: z.string().uuid("Invalid supplier ID").optional().nullable(),
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit of measure is required").max(20).default("EA"),
  estimatedPrice: z
    .number()
    .nonnegative("Estimated price must be non-negative"),
  workOrderId: z.string().uuid("Invalid work order ID").optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  accountCodeId: z
    .string()
    .uuid("Invalid account code ID")
    .optional()
    .nullable(), // Per-line account code
  departmentId: z.string().uuid("Invalid department ID").optional().nullable(), // Per-line department
  areaId: z.string().uuid("Invalid area ID").optional().nullable(), // Per-line area
  projectId: z.string().uuid("Invalid project ID").optional().nullable(), // Per-line project
  // SERVICE fields
  serviceType: z.string().max(100).optional().nullable(),
  serviceProvider: z.string().max(200).optional().nullable(),
  serviceStartDate: z.string().datetime().optional().nullable(),
  serviceEndDate: z.string().datetime().optional().nullable(),
  serviceLocation: z.string().max(200).optional().nullable(),
  serviceEquipmentId: z
    .string()
    .uuid("Invalid equipment ID")
    .optional()
    .nullable(),
  serviceWorkOrderId: z
    .string()
    .uuid("Invalid work order ID")
    .optional()
    .nullable(),
  hourlyRate: z.number().nonnegative().optional().nullable(),
  estimatedHours: z.number().nonnegative().optional().nullable(),
  contractNumber: z.string().max(100).optional().nullable(),
  slaDetails: z.string().max(1000).optional().nullable(),
  deliverables: z.string().max(1000).optional().nullable(),
  // CONSUMABLE fields
  consumableCategory: z.string().max(100).optional().nullable(),
  manufacturer: z.string().max(200).optional().nullable(),
  modelNumber: z.string().max(100).optional().nullable(),
  packageSize: z.string().max(50).optional().nullable(),
  monthlyUsageRate: z.number().nonnegative().optional().nullable(),
  storageRequirements: z.string().max(500).optional().nullable(),
  sdsRequired: z.boolean().optional().nullable(),
  expirationTracking: z.boolean().optional().nullable(),
});

/**
 * Schema for creating requisitions
 */
export const requisitionCreateSchema = z
  .object({
    requestedById: z.string().uuid("Invalid user ID"),
    onBehalfOfId: z.string().uuid("Invalid user ID").optional().nullable(),
    /** Purchasing Manager assigned to this req. Only used when buyerAssignmentEnabled = true. */
    assignedBuyerId: z.string().uuid("Invalid buyer ID").optional().nullable(),
    supplierId: z.string().uuid("Invalid supplier ID").optional(),
    description: z.string().max(1000).optional().nullable(),
    priority: z
      .nativeEnum(RequisitionPriority)
      .default(RequisitionPriority.NORMAL),
    neededByDate: z.string().datetime().optional().nullable(),
    justification: z.string().max(2000).optional().nullable(),
    items: z
      .array(requisitionItemSchema)
      .min(1, "At least one item is required"),
    // Budget header fields
    budgetType: z.enum([
      "CHARGE_TO_ACCOUNT",
      "CHARGE_TO_WORK_ORDER",
      "CHARGE_TO_PROJECT",
      "ADD_TO_REORDER",
    ]),
    accountCodeId: z.string().uuid("Invalid account code ID").optional(),
    workOrderId: z.string().uuid("Invalid work order ID").optional(),
    projectId: z.string().uuid("Invalid project ID").optional().nullable(),
    budgetNotes: z.string().max(500).optional(),
    equipmentId: z.string().uuid("Invalid equipment ID").optional(),
    /**
     * Tax amount for this requisition.
     * Must be 0 if the tax module is disabled (enforced server-side via enforceTaxAmount).
     */
    taxAmount: z
      .number()
      .nonnegative("Tax amount must be non-negative")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.budgetType === "CHARGE_TO_ACCOUNT") {
      const hasHeaderAccountCode = !!data.accountCodeId;
      // Every non-INVENTORY line must resolve to an account code: either the
      // header accountCodeId OR its own per-line accountCodeId.
      // INVENTORY lines are allowed to have no account code (GLR-0040 handles
      // pure stockroom reorders). INVENTORY lines that ARE tied to a WO/project
      // must still carry an allocation — enforced by the has-WO/project checks
      // below and by the receiving validator.
      data.items.forEach((item, idx) => {
        if (item.lineType === "INVENTORY") return;
        if (!hasHeaderAccountCode && !item.accountCodeId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Line ${idx + 1} (${item.lineType}) requires an account code when using 'Charge to Account'`,
            path: ["items", idx, "accountCodeId"],
          });
        }
      });
    }
    if (data.budgetType === "CHARGE_TO_WORK_ORDER") {
      const hasHeaderWorkOrder = !!data.workOrderId;
      const hasLineWorkOrder = data.items.some((item) => !!item.workOrderId);
      if (!hasHeaderWorkOrder && !hasLineWorkOrder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Work order is required when budget type is 'Charge to Work Order'",
          path: ["workOrderId"],
        });
      }
      // Non-INVENTORY lines still need an account code when charging to a WO —
      // the WO carries the dept/project, but the WO itself has no account code.
      const hasHeaderAccountCode = !!data.accountCodeId;
      data.items.forEach((item, idx) => {
        if (item.lineType === "INVENTORY") return;
        if (!hasHeaderAccountCode && !item.accountCodeId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Line ${idx + 1} (${item.lineType}) requires an account code (the work order does not carry one)`,
            path: ["items", idx, "accountCodeId"],
          });
        }
      });
    }
    if (data.budgetType === "CHARGE_TO_PROJECT") {
      if (!data.projectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Project is required when budget type is 'Charge to Project'",
          path: ["projectId"],
        });
      }
    }
    // INVENTORY lines tied to a work order MUST carry an explicit account code
    // (line-level or header-level) so the receiving flow can route CIP (1580)
    // vs Store Room (1535) correctly. See line-item-receiving.service.ts:2079.
    const hasHeaderAccountCode = !!data.accountCodeId;
    data.items.forEach((item, idx) => {
      if (item.lineType !== "INVENTORY") return;
      if (!item.workOrderId && !data.workOrderId) return;
      if (!hasHeaderAccountCode && !item.accountCodeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Inventory line ${idx + 1} is linked to a work order — an account code is required for correct GL posting (Store Room vs CIP)`,
          path: ["items", idx, "accountCodeId"],
        });
      }
    });
  });

/**
 * Schema for updating requisitions (all fields optional)
 */
export const requisitionUpdateSchema = z
  .object({
    onBehalfOfId: z.string().uuid("Invalid user ID").optional().nullable(),
    /** Purchasing Manager assigned to this req. Only used when buyerAssignmentEnabled = true. */
    assignedBuyerId: z.string().uuid("Invalid buyer ID").optional().nullable(),
    supplierId: z.string().uuid("Invalid supplier ID").optional(),
    description: z.string().min(1).max(1000).optional(),
    priority: z.nativeEnum(RequisitionPriority).optional(),
    neededByDate: z.string().datetime().optional().nullable(),
    justification: z.string().max(2000).optional().nullable(),
    items: z.array(requisitionItemSchema).optional(),
    // Budget header fields
    budgetType: z
      .enum([
        "CHARGE_TO_ACCOUNT",
        "CHARGE_TO_WORK_ORDER",
        "CHARGE_TO_PROJECT",
        "ADD_TO_REORDER",
      ])
      .optional(),
    accountCodeId: z.string().uuid("Invalid account code ID").optional(),
    workOrderId: z.string().uuid("Invalid work order ID").optional(),
    projectId: z.string().uuid("Invalid project ID").optional().nullable(),
    budgetNotes: z.string().max(500).optional(),
    equipmentId: z.string().uuid("Invalid equipment ID").optional(),
    /** Tax amount — must be 0 if tax module is disabled (enforced server-side). */
    taxAmount: z
      .number()
      .nonnegative("Tax amount must be non-negative")
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Mirror the create-schema validations: when a budget type is specified AND
    // items are being replaced, enforce the same allocation-source requirements
    // so an edit cannot leave lines without a resolvable account code.
    // (If `items` is undefined, the caller isn't touching line items, so skip.)
    if (!data.items || !data.budgetType) return;

    const hasHeaderAccountCode = !!data.accountCodeId;

    if (data.budgetType === "CHARGE_TO_ACCOUNT") {
      data.items.forEach((item, idx) => {
        if (item.lineType === "INVENTORY") return;
        if (!hasHeaderAccountCode && !item.accountCodeId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Line ${idx + 1} (${item.lineType}) requires an account code when using 'Charge to Account'`,
            path: ["items", idx, "accountCodeId"],
          });
        }
      });
    }
    if (data.budgetType === "CHARGE_TO_WORK_ORDER") {
      data.items.forEach((item, idx) => {
        if (item.lineType === "INVENTORY") return;
        if (!hasHeaderAccountCode && !item.accountCodeId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Line ${idx + 1} (${item.lineType}) requires an account code (the work order does not carry one)`,
            path: ["items", idx, "accountCodeId"],
          });
        }
      });
    }
    // INVENTORY-with-WO enforcement (same as create schema)
    data.items.forEach((item, idx) => {
      if (item.lineType !== "INVENTORY") return;
      if (!item.workOrderId && !data.workOrderId) return;
      if (!hasHeaderAccountCode && !item.accountCodeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Inventory line ${idx + 1} is linked to a work order — an account code is required for correct GL posting (Store Room vs CIP)`,
          path: ["items", idx, "accountCodeId"],
        });
      }
    });
  });

/**
 * Schema for filtering requisitions
 */
export const requisitionFilterSchema = z.object({
  status: z.nativeEnum(RequisitionStatus).optional(),
  requestedById: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  priority: z.nativeEnum(RequisitionPriority).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().optional(),
  excludeCancelled: z.boolean().optional(),
  activeOnly: z.boolean().optional(),
  // Budget header filters
  budgetType: z
    .enum([
      "CHARGE_TO_ACCOUNT",
      "CHARGE_TO_WORK_ORDER",
      "CHARGE_TO_PROJECT",
      "ADD_TO_REORDER",
    ])
    .optional(),
  accountCodeId: z.string().uuid().optional(),
  workOrderId: z.string().uuid().optional(),
  budgetNotes: z.string().optional(),
});

/**
 * Schema for approving requisitions
 */
export const requisitionApproveSchema = z.object({
  notes: z.string().max(5000).optional().nullable(),
});

/**
 * Schema for rejecting requisitions
 */
export const requisitionRejectSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required").max(1000),
});

/**
 * Schema for cancelling requisitions
 */
export const requisitionCancelSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required").max(1000),
});

/**
 * Schema for converting to PO
 */
export const requisitionConvertToPOSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID"),
  notes: z.string().max(2000).optional().nullable(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for requisition items
 */
export type RequisitionItemDTO = z.infer<typeof requisitionItemSchema>;

/**
 * DTO for creating requisitions
 */
export type RequisitionCreateDTO = z.infer<typeof requisitionCreateSchema>;

/**
 * DTO for updating requisitions
 */
export type RequisitionUpdateDTO = z.infer<typeof requisitionUpdateSchema>;

/**
 * DTO for filtering requisitions
 */
export type RequisitionFilterDTO = z.infer<typeof requisitionFilterSchema>;

/**
 * DTO for approving requisitions
 */
export type RequisitionApproveDTO = z.infer<typeof requisitionApproveSchema>;

/**
 * DTO for rejecting requisitions
 */
export type RequisitionRejectDTO = z.infer<typeof requisitionRejectSchema>;

/**
 * DTO for cancelling requisitions
 */
export type RequisitionCancelDTO = z.infer<typeof requisitionCancelSchema>;

/**
 * DTO for converting to PO
 */
export type RequisitionConvertToPODTO = z.infer<
  typeof requisitionConvertToPOSchema
>;

// ============================================================================
// BUDGET HEADER ARCHITECTURE TYPES
// ============================================================================

/**
 * Budget header interface matching Prisma RequisitionBudgetHeader
 */
export interface RequisitionBudgetHeader {
  id: string;
  requisitionId: string;
  budgetType:
    | "CHARGE_TO_ACCOUNT"
    | "CHARGE_TO_WORK_ORDER"
    | "CHARGE_TO_PROJECT"
    | "ADD_TO_REORDER";
  accountCodeId: string | null;
  workOrderId: string | null;
  projectId: string | null;
  totalAmount: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Line allocation interface (optional detail) matching Prisma RequisitionLineAllocation
 */
export interface RequisitionLineAllocation {
  id: string;
  requisitionId: string;
  requisitionLineId: string | null;
  accountCodeId: string | null;
  areaId: string | null;
  departmentId: string | null;
  projectId: string | null;
  percentage: number;
  amount: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Type for creating requisition with budget information
 */
export interface CreateRequisitionWithBudget {
  requestedById: string;
  description?: string | null;
  priority: RequisitionPriority;
  neededByDate?: Date | null;
  justification?: string | null;
  items: RequisitionItemDTO[];
  budgetType:
    | "CHARGE_TO_ACCOUNT"
    | "CHARGE_TO_WORK_ORDER"
    | "CHARGE_TO_PROJECT"
    | "ADD_TO_REORDER";
  accountCodeId?: string;
  workOrderId?: string;
  projectId?: string | null;
  budgetNotes?: string;
}

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Requisition with items
 */
export type RequisitionWithItems = Requisition & {
  lines: RequisitionLine[];
};

/**
 * Requisition with all relations including new budget architecture
 */
export type RequisitionWithRelations = Requisition & {
  lines: (RequisitionLine & {
    inventoryItem: InventoryItem | null;
    supplier: Supplier | null;
    allocations?: (RequisitionLineAllocation & {
      accountCode?: { code: string; name: string } | null;
      department?: { id: string; name: string } | null;
      area?: { id: string; name: string } | null;
      project?: { id: string; name: string } | null;
    })[];
  })[];
  requestedBy: User;
  supplier?: Supplier | null;
  budgetHeader?: RequisitionBudgetHeader & {
    accountCode?: { code: string; name: string } | null;
    workOrder?: {
      woNumber: string;
      // Equipment department — used to display the real charge destination on
      // INVENTORY lines (which carry no per-line allocation).
      equipment?: {
        department?: { id: string; code: string; name: string } | null;
      } | null;
    } | null;
    project?: {
      id: string;
      name: string;
      code: string;
      accountCodeId: string | null;
    } | null;
  };
  lineAllocations?: (RequisitionLineAllocation & {
    accountCode?: { code: string; name: string } | null;
    department?: { id: string; name: string } | null;
    area?: { id: string; name: string } | null;
    project?: { id: string; name: string } | null;
  })[];
};

/**
 * Requisition statistics (legacy - kept for backward compatibility)
 */
export interface RequisitionStats {
  totalRequisitions: number;
  pendingApproval: number;
  approved: number;
  rejected: number;
  totalValue: number;
  averageApprovalTime: number; // in hours
}

/**
 * Comprehensive requisition statistics
 * Used by the statistics service for reporting and analytics
 */
export interface RequisitionStatistics {
  totalCount: number;
  byStatus: Record<RequisitionStatus, number>;
  byPriority: Record<RequisitionPriority, number>;
  totalValue: number;
  averageValue: number;
  averageApprovalTime: number; // in hours
  approvalRate: number; // percentage
  conversionRate: number; // percentage converted to PO
  topRequestors: Array<{
    userId: string;
    userName: string;
    count: number;
    totalValue: number;
  }>;
  byDepartment: Array<{
    departmentId: string;
    departmentName: string;
    count: number;
    totalValue: number;
  }>;
}

/**
 * Filters for requisition statistics queries
 */
export interface RequisitionStatisticsFilters {
  startDate?: Date;
  endDate?: Date;
  departmentId?: string;
  requestorId?: string;
  status?: RequisitionStatus;
  priority?: RequisitionPriority;
}

/**
 * PO Metadata structure for tracking requisition relationship
 */
export interface POMetadata {
  requisitionId?: string;
  requisitionNumber?: string;
  createdFrom?: "requisition" | "direct";
  conversionDate?: string;
  conversionUserId?: string;
}

// ============================================================================
// WORKFLOW TYPES
// ============================================================================

/**
 * Base workflow input with optional notes and reason
 */
export interface RequisitionWorkflowInput {
  notes?: string;
  reason?: string;
}

/**
 * Input for approving a requisition
 */
export interface RequisitionApproveInput extends RequisitionWorkflowInput {
  approvedBy: string;
}

/**
 * Input for rejecting a requisition
 */
export interface RequisitionRejectInput extends RequisitionWorkflowInput {
  rejectedBy: string;
  reason: string; // Required for rejection
}

/**
 * Input for cancelling a requisition
 */
export interface RequisitionCancelInput extends RequisitionWorkflowInput {
  cancelledBy: string;
  reason: string; // Required for cancellation
}

/**
 * Input for converting requisition to purchase order
 */
export interface RequisitionConvertToPOInput {
  supplierId: string;
  convertedBy: string;
  notes?: string;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate requisition create data
 */
export function validateRequisitionCreate(data: unknown): RequisitionCreateDTO {
  return requisitionCreateSchema.parse(data);
}

/**
 * Validate requisition update data
 */
export function validateRequisitionUpdate(data: unknown): RequisitionUpdateDTO {
  return requisitionUpdateSchema.parse(data);
}

/**
 * Validate requisition filter data
 */
export function validateRequisitionFilter(data: unknown): RequisitionFilterDTO {
  return requisitionFilterSchema.parse(data);
}

/**
 * Validate requisition item data
 */
export function validateRequisitionItem(data: unknown): RequisitionItemDTO {
  return requisitionItemSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if requisition has items
 */
export function hasItems(
  requisition: Requisition | RequisitionWithItems,
): requisition is RequisitionWithItems {
  return "lines" in requisition && Array.isArray(requisition.lines);
}

/**
 * Check if requisition has all relations
 */
export function hasAllRelations(
  requisition: Requisition | RequisitionWithRelations,
): requisition is RequisitionWithRelations {
  return "lines" in requisition && "requestedBy" in requisition;
}

/**
 * Check if requisition can be edited
 * @deprecated - Use approvalStatus field instead of status
 */
export function canEdit(requisition: Requisition): boolean {
  const approvalStatus = requisition.approvalStatus ?? "DRAFT";
  return approvalStatus === "DRAFT";
}

/**
 * Check if requisition can be submitted
 * @deprecated - Use approvalStatus field instead of status
 */
export function canSubmit(requisition: Requisition): boolean {
  const approvalStatus = requisition.approvalStatus ?? "DRAFT";
  return approvalStatus === "DRAFT";
}

/**
 * Check if requisition can be approved
 * @deprecated - Use new approval system instead
 */
export function canApprove(requisition: Requisition): boolean {
  const approvalStatus = requisition.approvalStatus;
  return (
    approvalStatus === "PENDING" || approvalStatus === "PARTIALLY_APPROVED"
  );
}

/**
 * Check if requisition can be rejected
 * @deprecated - Use new approval system instead
 */
export function canReject(requisition: Requisition): boolean {
  const approvalStatus = requisition.approvalStatus;
  return (
    approvalStatus === "PENDING" || approvalStatus === "PARTIALLY_APPROVED"
  );
}

/**
 * Check if requisition can be cancelled
 * @deprecated - Use approvalStatus field instead of status
 */
export function canCancel(requisition: Requisition): boolean {
  const approvalStatus = requisition.approvalStatus;
  return ["DRAFT", "PENDING", "PARTIALLY_APPROVED", "APPROVED"].includes(
    approvalStatus ?? "",
  );
}

/**
 * Check if requisition can be converted to PO
 * Uses approvalStatus field (correct)
 */
export function canConvertToPO(requisition: Requisition): boolean {
  const approvalStatus = requisition.approvalStatus;
  return approvalStatus === "APPROVED";
}

/**
 * Check if requisition is closed
 */
export function isClosed(requisition: Requisition): boolean {
  return [
    RequisitionStatus.FULFILLED,
    RequisitionStatus.REJECTED,
    RequisitionStatus.CANCELLED,
  ].includes(requisition.status as RequisitionStatus);
}

/**
 * Check if requisition is in progress
 */
export function isInProgress(requisition: Requisition): boolean {
  return [
    RequisitionStatus.ORDERED,
    RequisitionStatus.PARTIALLY_FULFILLED,
  ].includes(requisition.status as RequisitionStatus);
}

/**
 * Calculate total estimated value
 */
export function calculateTotalValue(lines: RequisitionLine[]): number {
  return lines.reduce((total, line) => {
    const quantity = Number(line.quantity);
    const price = Number(line.estimatedPrice);
    return total + quantity * price;
  }, 0);
}

// ============================================================================
// LINE-LEVEL TRACKING TYPES (Phase 2)
// ============================================================================

/**
 * Requisition line status enum
 */
export enum RequisitionLineStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  ORDERED = "ORDERED",
  CANCELLED = "CANCELLED",
  FULFILLED = "FULFILLED",
  PARTIALLY_FULFILLED = "PARTIALLY_FULFILLED",
}

/**
 * Extended requisition line with PO tracking
 * Using Partial to allow flexibility with Prisma includes
 */
export interface RequisitionLineWithPOTracking {
  id: string;
  requisitionId: string;
  lineType:
    | "INVENTORY"
    | "SERVICE"
    | "CONSUMABLE"
    | "NON_STOCK"
    | "REPAIRABLE_RETURN";
  inventoryItemId: string | null;
  supplierId: string | null;
  description: string;
  quantity: number | { toNumber: () => number }; // Support Prisma Decimal
  unit: string;
  estimatedPrice: number | { toNumber: () => number }; // Support Prisma Decimal
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  lineStatus: RequisitionLineStatus;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  poLineId: string | null;
  convertedToPOAt: Date | null;
  convertedToPOBy: string | null;
  // Optional relations
  requisition?: Requisition;
  supplier?: Supplier | null;
  inventoryItem?: InventoryItem | null;
  purchaseOrder?: {
    id: string;
    poNumber: string;
    status: string;
  } | null;
  poLine?: {
    id: string;
    description: string;
    quantity: number;
  } | null;
  convertedByUser?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

/**
 * Input for converting selected lines to PO
 */
export interface ConvertLinesToPOInput {
  requisitionId: string;
  lineIds: string[];
  supplierId: string;
  notes?: string;
  convertedBy: string;
  convertedByName: string;
}

/**
 * Result of converting lines to PO
 */
export interface ConvertLinesToPOResult {
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: string;
    totalAmount: number;
  };
  convertedLines: RequisitionLineWithPOTracking[];
  remainingLines: RequisitionLineWithPOTracking[];
  requisition: RequisitionWithRelations;
  success: boolean;
  message: string;
}

/**
 * Input for updating line status
 */
export interface UpdateLineStatusInput {
  lineId: string;
  newStatus: RequisitionLineStatus;
  updatedBy: string;
  reason?: string;
}

/**
 * Line status validation result
 */
export interface LineStatusValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Bulk line operation input
 */
export interface BulkLineOperationInput {
  lineIds: string[];
  operation: "approve" | "cancel" | "convert_to_po";
  performedBy: string;
  reason?: string;
  supplierId?: string; // Required for convert_to_po
}

/**
 * Bulk line operation result
 */
export interface BulkLineOperationResult {
  successCount: number;
  failureCount: number;
  successfulLineIds: string[];
  failedLineIds: string[];
  errors: Array<{ lineId: string; error: string }>;
}

/**
 * Line selection validation
 */
export interface LineSelectionValidation {
  canCreatePO: boolean;
  allSameSupplier: boolean;
  allApproved: boolean;
  supplierId: string | null;
  supplierName: string | null;
  errors: string[];
}

/**
 * Requisition with computed line counts
 */
export interface RequisitionWithLineCounts extends Requisition {
  totalLines: number;
  orderedLines: number;
  pendingLines: number;
  fulfilledLines: number;
  approvedLines: number;
  cancelledLines: number;
}

/**
 * Extended requisition with line tracking
 */
export type RequisitionWithLineTracking = RequisitionWithRelations &
  RequisitionWithLineCounts & {
    lines: RequisitionLineWithPOTracking[];
  };

// ============================================================================
// VALIDATION SCHEMAS FOR LINE OPERATIONS
// ============================================================================

/**
 * Schema for converting lines to PO
 */
export const convertLinesToPOSchema = z.object({
  requisitionId: z.string().uuid("Invalid requisition ID"),
  lineIds: z
    .array(z.string().uuid())
    .min(1, "At least one line must be selected"),
  supplierId: z.string().uuid("Invalid supplier ID"),
  notes: z.string().max(2000).optional().nullable(),
  convertedBy: z.string().uuid("Invalid user ID"),
  convertedByName: z.string().min(1, "User name is required"),
});

/**
 * Schema for updating line status
 */
export const updateLineStatusSchema = z.object({
  lineId: z.string().uuid("Invalid line ID"),
  newStatus: z.nativeEnum(RequisitionLineStatus),
  updatedBy: z.string().uuid("Invalid user ID"),
  reason: z.string().max(500).optional().nullable(),
});

/**
 * Schema for bulk line operations
 */
export const bulkLineOperationSchema = z
  .object({
    lineIds: z
      .array(z.string().uuid())
      .min(1, "At least one line must be selected"),
    operation: z.enum(["approve", "cancel", "convert_to_po"]),
    performedBy: z.string().uuid("Invalid user ID"),
    reason: z.string().max(500).optional().nullable(),
    supplierId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      if (data.operation === "convert_to_po") {
        return !!data.supplierId;
      }
      return true;
    },
    {
      message: "Supplier ID is required for convert_to_po operation",
      path: ["supplierId"],
    },
  );

/**
 * DTO for converting lines to PO
 */
export type ConvertLinesToPODTO = z.infer<typeof convertLinesToPOSchema>;

/**
 * DTO for updating line status
 */
export type UpdateLineStatusDTO = z.infer<typeof updateLineStatusSchema>;

/**
 * DTO for bulk line operations
 */
export type BulkLineOperationDTO = z.infer<typeof bulkLineOperationSchema>;

// ============================================================================
// VALIDATION FUNCTIONS FOR LINE OPERATIONS
// ============================================================================

/**
 * Validate convert lines to PO input
 */
export function validateConvertLinesToPO(data: unknown): ConvertLinesToPODTO {
  return convertLinesToPOSchema.parse(data);
}

/**
 * Validate update line status input
 */
export function validateUpdateLineStatus(data: unknown): UpdateLineStatusDTO {
  return updateLineStatusSchema.parse(data);
}

/**
 * Validate bulk line operation input
 */
export function validateBulkLineOperation(data: unknown): BulkLineOperationDTO {
  return bulkLineOperationSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS FOR LINE-LEVEL OPERATIONS
// ============================================================================

/**
 * Check if line can be converted to PO
 */
export function canConvertLineToPO(
  line: RequisitionLineWithPOTracking,
): boolean {
  return (
    line.lineStatus === RequisitionLineStatus.APPROVED && !line.purchaseOrderId
  );
}

/**
 * Check if line is already on a PO
 */
export function isLineOnPO(line: RequisitionLineWithPOTracking): boolean {
  return (
    line.lineStatus === RequisitionLineStatus.ORDERED && !!line.purchaseOrderId
  );
}

/**
 * Check if requisition has any convertible lines
 */
export function hasConvertibleLines(
  requisition: RequisitionWithLineTracking,
): boolean {
  return requisition.lines.some(canConvertLineToPO);
}

/**
 * Check if requisition is fully ordered
 */
export function isFullyOrdered(
  requisition: RequisitionWithLineCounts,
): boolean {
  return (
    requisition.totalLines > 0 &&
    requisition.orderedLines === requisition.totalLines
  );
}

/**
 * Check if requisition is partially ordered
 */
export function isPartiallyOrdered(
  requisition: RequisitionWithLineCounts,
): boolean {
  return (
    requisition.orderedLines > 0 &&
    requisition.orderedLines < requisition.totalLines
  );
}

/**
 * Compute requisition status from line statuses
 *
 * B5-3: Removed phantom "Partially Ordered" status — this value was never stored
 * in the database and has no corresponding `RequisitionApprovalStatus` enum value.
 * When some (but not all) lines are ordered, the requisition remains "Approved"
 * because the unordered lines still need to be converted to POs.
 */
export function computeRequisitionStatus(
  requisition: RequisitionWithLineCounts,
): string {
  if (requisition.totalLines === 0) return "Draft";

  if (requisition.fulfilledLines === requisition.totalLines) {
    return "Fulfilled";
  }

  if (requisition.fulfilledLines > 0) {
    return "Partially Fulfilled";
  }

  if (requisition.orderedLines === requisition.totalLines) {
    return "Ordered";
  }

  if (requisition.orderedLines > 0) {
    // B5-3: Some lines are ordered but not all — the requisition is still
    // "Approved" because the remaining lines have not yet been converted to POs.
    // Previously returned "Partially Ordered" which was a phantom status that
    // never existed in the RequisitionApprovalStatus enum or database.
    return "Approved";
  }

  if (requisition.approvedLines === requisition.totalLines) {
    return "Approved";
  }

  if (requisition.cancelledLines === requisition.totalLines) {
    return "Cancelled";
  }

  return "Draft";
}

/**
 * Get line status display text
 */
export function getLineStatusDisplay(status: RequisitionLineStatus): string {
  const displayMap: Record<RequisitionLineStatus, string> = {
    [RequisitionLineStatus.PENDING]: "Pending",
    [RequisitionLineStatus.APPROVED]: "Approved",
    [RequisitionLineStatus.ORDERED]: "Ordered",
    [RequisitionLineStatus.CANCELLED]: "Cancelled",
    [RequisitionLineStatus.FULFILLED]: "Fulfilled",
    [RequisitionLineStatus.PARTIALLY_FULFILLED]: "Partially Fulfilled",
  };
  return displayMap[status] || status;
}

/**
 * Get line status color for UI
 */
export function getLineStatusColor(status: RequisitionLineStatus): string {
  const colorMap: Record<RequisitionLineStatus, string> = {
    [RequisitionLineStatus.PENDING]: "gray",
    [RequisitionLineStatus.APPROVED]: "blue",
    [RequisitionLineStatus.ORDERED]: "purple",
    [RequisitionLineStatus.CANCELLED]: "red",
    [RequisitionLineStatus.FULFILLED]: "green",
    [RequisitionLineStatus.PARTIALLY_FULFILLED]: "yellow",
  };
  return colorMap[status] || "gray";
}

// ============================================================================
// TRANSPARENCY TYPES - For Work Order Part Reservation
// ============================================================================

/**
 * Summary of open requisitions for an inventory item
 */
export interface RequisitionSummary {
  totalQuantityOnOrder: number;
  totalEstimatedCost: number;
  requisitionCount: number;
  affectedWorkOrders: Array<{ id: string; woNumber: string }>;
}

/**
 * Requisition with details for transparency display
 */
export interface RequisitionWithDetails extends RequisitionWithRelations {
  // Additional computed fields for UI display
  totalValue: number;
  lineCount: number;
  statusDisplay: string;
}

/**
 * Result of cancelling requisitions
 */
export interface CancellationResult {
  cancelledCount: number;
  cancelledRequisitionIds: string[];
}

/**
 * Result of creating requisition with cancellation
 */
export interface CreateWithCancellationResult {
  requisition: RequisitionWithRelations;
  cancelledCount: number;
  cancelledRequisitionIds: string[];
}

/**
 * Input for transparency check
 */
export interface TransparencyCheckInput {
  inventoryItemId: string;
  workOrderId?: string;
  requestedQuantity: number;
}

/**
 * Complete transparency check result
 */
export interface TransparencyCheckResult {
  inventoryItem: {
    id: string;
    sku: string;
    description: string;
    currentStock: number;
    minQty: number;
    unit: string;
  };
  requestedQuantity: number;
  stockAfterReservation: number;
  willHitMinQty: boolean;
  willGoNegative: boolean;
  existingReservation: {
    id: string;
    quantity: number;
    reservedAt: string;
    status: string;
  } | null;
  openRequisitions: RequisitionWithDetails[];
  requisitionSummary: RequisitionSummary;
  recommendation: "PROCEED" | "CREATE_REQ" | "REVIEW_EXISTING";
  recommendationReason: string;
}
