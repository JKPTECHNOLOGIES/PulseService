/**
 * RMA (Return Merchandise Authorization) Service Types
 *
 * DTOs, types, and Zod schemas for the RMA service.
 * These types define the shape of data for return operations.
 */

import { z } from "zod";
import {
  RMAStatus,
  RMAReturnType,
  ReturnCondition,
  ReturnDisposition,
} from "@prisma/client";

// ============================================================================
// BASE TYPES
// ============================================================================

interface PurchaseOrderReturn {
  id: string;
  rmaNumber: string;
  purchaseOrderId: string;
  supplierId: string;
  returnType: RMAReturnType;
  status: RMAStatus;
  requestedAt: Date;
  requestedBy: string;
  submittedAt: Date | null;
  submittedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  processedAt: Date | null;
  processedBy: string | null;
  shippedAt: Date | null;
  shippedBy: string | null;
  receivedBySupplierAt: Date | null;
  creditIssuedAt: Date | null;
  creditIssuedBy: string | null;
  completedAt: Date | null;
  completedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  totalAmount: number;
  restockingFee: number;
  shippingCost: number;
  netRefundAmount: number;
  creditAmount: number | null;
  creditMethod: string | null;
  creditReferenceNumber: string | null;
  supplierRMANumber: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  reason: string;
  internalNotes: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface POLineReturn {
  id: string;
  purchaseOrderReturnId: string;
  poLineId: string;
  poLineReceiptId: string | null;
  inventoryItemId: string | null;
  quantityToReturn: number;
  quantityReturned: number;
  condition: ReturnCondition;
  conditionNotes: string | null;
  defectDescription: string | null;
  disposition: ReturnDisposition;
  dispositionNotes: string | null;
  inspectedAt: Date | null;
  inspectedBy: string | null;
  inspectionNotes: string | null;
  restockedAt: Date | null;
  restockedBy: string | null;
  scrapedAt: Date | null;
  scrapedBy: string | null;
  lotNumber: string | null;
  serialNumbers: string[];
  photoUrls: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface RMAApprovalHistory {
  id: string;
  returnId: string;
  approverUserId: string;
  approverName: string;
  action: string;
  previousStatus: RMAStatus | null;
  newStatus: RMAStatus;
  comments: string | null;
  approvedAt: Date;
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for return line items
 */
export const returnLineItemSchema = z.object({
  poLineId: z.string().uuid("Invalid PO line ID"),
  poLineReceiptId: z.string().uuid("Invalid receipt ID").optional().nullable(),
  inventoryItemId: z
    .string()
    .uuid("Invalid inventory item ID")
    .optional()
    .nullable(),
  description: z.string().optional(),
  quantityToReturn: z.number().positive("Quantity must be positive"),
  unitPrice: z
    .number()
    .nonnegative("Unit price must be non-negative")
    .optional(),
  condition: z.nativeEnum(ReturnCondition),
  conditionNotes: z.string().max(1000).optional().nullable(),
  defectDescription: z.string().max(2000).optional().nullable(),
  lotNumber: z.string().max(100).optional().nullable(),
  serialNumbers: z.array(z.string()).default([]),
  photoUrls: z.array(z.string().url()).default([]),
});

/**
 * Schema for creating RMA
 */
export const rmaCreateSchema = z.object({
  purchaseOrderId: z.string().uuid("Invalid purchase order ID"),
  returnType: z.nativeEnum(RMAReturnType),
  reason: z.string().min(10, "Reason must be at least 10 characters").max(2000),
  items: z.array(returnLineItemSchema).min(1, "At least one item is required"),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for updating RMA (draft only)
 */
export const rmaUpdateSchema = z.object({
  returnType: z.nativeEnum(RMAReturnType).optional(),
  reason: z.string().min(10).max(2000).optional(),
  items: z.array(returnLineItemSchema).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for submitting RMA for approval
 */
export const rmaSubmitSchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for approving RMA
 */
export const rmaApproveSchema = z.object({
  comments: z.string().max(1000).optional().nullable(),
  restockingFee: z
    .number()
    .nonnegative("Restocking fee must be non-negative")
    .default(0),
  shippingCost: z
    .number()
    .nonnegative("Shipping cost must be non-negative")
    .default(0),
});

/**
 * Schema for rejecting RMA
 */
export const rmaRejectSchema = z.object({
  reason: z
    .string()
    .min(10, "Rejection reason must be at least 10 characters")
    .max(1000),
});

/**
 * Schema for processing RMA
 */
export const rmaProcessSchema = z.object({
  supplierRMANumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for shipping RMA
 */
export const rmaShipSchema = z.object({
  trackingNumber: z.string().min(1, "Tracking number is required").max(100),
  carrier: z.string().min(1, "Carrier is required").max(100),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for marking RMA as received by supplier
 */
export const rmaReceiveSchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for issuing credit
 */
export const rmaCreditSchema = z.object({
  creditAmount: z.number().positive("Credit amount must be positive"),
  creditMethod: z.string().min(1, "Credit method is required"),
  creditReferenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for completing RMA
 */
export const rmaCompleteSchema = z.object({
  resolution: z
    .string()
    .min(10, "Resolution must be at least 10 characters")
    .max(2000),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for cancelling RMA
 */
export const rmaCancelSchema = z.object({
  reason: z
    .string()
    .min(10, "Cancellation reason must be at least 10 characters")
    .max(1000),
});

/**
 * Schema for inspecting returned items
 */
export const rmaInspectSchema = z.object({
  lineReturnId: z.string().uuid("Invalid line return ID"),
  condition: z.nativeEnum(ReturnCondition),
  disposition: z.nativeEnum(ReturnDisposition),
  inspectionNotes: z.string().max(2000).optional().nullable(),
  dispositionNotes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for restocking items
 */
export const rmaRestockSchema = z.object({
  lineReturnId: z.string().uuid("Invalid line return ID"),
  storeId: z.string().uuid("Invalid store ID"),
  quantityToRestock: z.number().positive("Quantity must be positive"),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for scrapping items
 */
export const rmaScrapSchema = z.object({
  lineReturnId: z.string().uuid("Invalid line return ID"),
  reason: z
    .string()
    .min(10, "Scrap reason must be at least 10 characters")
    .max(1000),
});

/**
 * Schema for a single line in a batch receive-items-back operation.
 * Used when items physically return to our facility from the supplier.
 */
export const rmaReceiveItemsBackLineSchema = z.object({
  lineReturnId: z.string().uuid("Invalid line return ID"),
  disposition: z.nativeEnum(ReturnDisposition),
  condition: z.nativeEnum(ReturnCondition),
  // Required for RESTOCK disposition
  storeId: z.string().uuid("Invalid store ID").optional().nullable(),
  bin: z.string().max(50).optional().default("MAIN"),
  quantityToReceive: z
    .number()
    .positive("Quantity must be positive")
    .optional(),
  // Required for SCRAP disposition
  scrapReason: z
    .string()
    .min(5, "Scrap reason required (min 5 chars)")
    .max(500)
    .optional()
    .nullable(),
  // Common
  inspectionNotes: z.string().max(2000).optional().nullable(),
  dispositionNotes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for the batch receive-items-back endpoint.
 * Processes multiple lines in a single request; auto-closes the RMA
 * when all lines are dispositioned.
 */
export const rmaReceiveItemsBackSchema = z.object({
  lines: z
    .array(rmaReceiveItemsBackLineSchema)
    .min(1, "At least one line is required"),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for filtering RMAs
 */
export const rmaFilterSchema = z.object({
  status: z.nativeEnum(RMAStatus).optional(),
  returnType: z.nativeEnum(RMAReturnType).optional(),
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().optional(),
  page: z.number().positive().optional(),
  limit: z.number().positive().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

export type ReturnLineItemDTO = z.infer<typeof returnLineItemSchema>;
export type RMACreateDTO = z.infer<typeof rmaCreateSchema>;
export type RMAUpdateDTO = z.infer<typeof rmaUpdateSchema>;
export type RMASubmitDTO = z.infer<typeof rmaSubmitSchema>;
export type RMAApproveDTO = z.infer<typeof rmaApproveSchema>;
export type RMARejectDTO = z.infer<typeof rmaRejectSchema>;
export type RMAProcessDTO = z.infer<typeof rmaProcessSchema>;
export type RMAShipDTO = z.infer<typeof rmaShipSchema>;
export type RMAReceiveDTO = z.infer<typeof rmaReceiveSchema>;
export type RMACreditDTO = z.infer<typeof rmaCreditSchema>;
export type RMACompleteDTO = z.infer<typeof rmaCompleteSchema>;
export type RMACancelDTO = z.infer<typeof rmaCancelSchema>;
export type RMAInspectDTO = z.infer<typeof rmaInspectSchema>;
export type RMARestockDTO = z.infer<typeof rmaRestockSchema>;
export type RMAScrapDTO = z.infer<typeof rmaScrapSchema>;
export type RMAReceiveItemsBackLineDTO = z.infer<
  typeof rmaReceiveItemsBackLineSchema
>;
export type RMAReceiveItemsBackDTO = z.infer<typeof rmaReceiveItemsBackSchema>;
export type RMAFilterDTO = z.infer<typeof rmaFilterSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * RMA with all relations
 */
export type RMAWithRelations = PurchaseOrderReturn & {
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: string;
    orderDate: Date;
    totalAmount: number;
  };
  supplier: {
    id: string;
    name: string;
    code: string | null;
    email: string | null;
    phone: string | null;
  };
  lines: (POLineReturn & {
    poLine: {
      id: string;
      description: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    };
    inventoryItem: {
      id: string;
      sku: string;
      description: string;
      unit: string;
    } | null;
    poLineReceipt: {
      id: string;
      storeId: string | null;
      receiptNumber: string;
    } | null;
  })[];
  approvalHistory: RMAApprovalHistory[];
};

/**
 * RMA statistics
 */
export interface RMAStats {
  totalCount: number;
  byStatus: {
    draft: number;
    submitted: number;
    pendingApproval: number;
    approved: number;
    rejected: number;
    processing: number;
    shipped: number;
    receivedBySupplier: number;
    creditIssued: number;
    completed: number;
    cancelled: number;
  };
  byReturnType: {
    defective: number;
    wrongItem: number;
    damagedInTransit: number;
    notAsDescribed: number;
    overstocked: number;
    expired: number;
    warrantyClaim: number;
    other: number;
  };
  financial: {
    totalReturnValue: number;
    totalRestockingFees: number;
    totalShippingCosts: number;
    totalCreditsIssued: number;
    netRefundAmount: number;
  };
  performance: {
    averageProcessingTime: number;
    approvalRate: number;
    restockRate: number;
    scrapRate: number;
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate RMA create data
 */
export function validateRMACreate(data: unknown): RMACreateDTO {
  return rmaCreateSchema.parse(data);
}

/**
 * Validate RMA update data
 */
export function validateRMAUpdate(data: unknown): RMAUpdateDTO {
  return rmaUpdateSchema.parse(data);
}

/**
 * Validate RMA filter data
 */
export function validateRMAFilter(data: unknown): RMAFilterDTO {
  return rmaFilterSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if RMA can be edited
 */
export function canEdit(status: RMAStatus): boolean {
  return status === RMAStatus.DRAFT;
}

/**
 * Check if RMA can be submitted
 */
export function canSubmit(status: RMAStatus): boolean {
  return status === RMAStatus.DRAFT;
}

/**
 * Check if RMA can be approved
 */
export function canApprove(status: RMAStatus): boolean {
  return (
    status === RMAStatus.SUBMITTED || status === RMAStatus.PENDING_APPROVAL
  );
}

/**
 * Check if RMA can be rejected
 */
export function canReject(status: RMAStatus): boolean {
  return (
    status === RMAStatus.SUBMITTED || status === RMAStatus.PENDING_APPROVAL
  );
}

/**
 * Check if RMA can be processed
 */
export function canProcess(status: RMAStatus): boolean {
  return status === RMAStatus.APPROVED;
}

/**
 * Check if RMA can be shipped
 */
export function canShip(status: RMAStatus): boolean {
  return status === RMAStatus.PROCESSING;
}

/**
 * Check if RMA can be marked as received
 */
export function canReceive(status: RMAStatus): boolean {
  return status === RMAStatus.SHIPPED;
}

/**
 * Check if RMA can have credit issued
 */
export function canIssueCredit(status: RMAStatus): boolean {
  return status === RMAStatus.RECEIVED_BY_SUPPLIER;
}

/**
 * Check if RMA can be completed
 */
export function canComplete(status: RMAStatus): boolean {
  return status === RMAStatus.CREDIT_ISSUED;
}

/**
 * Check if RMA can be cancelled
 */
export function canCancel(status: RMAStatus): boolean {
  const cancellableStatuses: RMAStatus[] = [
    RMAStatus.DRAFT,
    RMAStatus.SUBMITTED,
    RMAStatus.PENDING_APPROVAL,
    RMAStatus.APPROVED,
    RMAStatus.PROCESSING,
  ];
  return cancellableStatuses.includes(status);
}
// Aliases kept for backwards compatibility with service imports
export type CreateRMADTO = RMACreateDTO;
export type UpdateRMADTO = RMAUpdateDTO;
export type SubmitRMADTO = RMASubmitDTO;
export type ApproveRMADTO = RMAApproveDTO;
export type RejectRMADTO = RMARejectDTO;
export type ProcessRMADTO = RMAProcessDTO;
export type ShipRMADTO = RMAShipDTO;
export type ReceiveRMADTO = RMAReceiveDTO;
export type IssueCreditDTO = RMACreditDTO;
export type CompleteRMADTO = RMACompleteDTO;
export type CancelRMADTO = RMACancelDTO;
export type InspectLineItemDTO = RMAInspectDTO;
export type RestockLineItemDTO = RMARestockDTO;
export type ScrapLineItemDTO = RMAScrapDTO;

/**
 * Calculate total return value
 */
export function calculateReturnValue(
  lineReturns: Array<{
    quantityToReturn: number;
    poLine: { unitPrice: number };
  }>,
): number {
  return lineReturns.reduce((total, line) => {
    return total + line.quantityToReturn * Number(line.poLine.unitPrice);
  }, 0);
}

/**
 * Calculate net refund amount
 */
export function calculateNetRefund(
  totalAmount: number,
  restockingFee: number,
  shippingCost: number,
): number {
  return Math.max(0, totalAmount - restockingFee - shippingCost);
}
