/**
 * Invoice Approval Service Types
 *
 * DTOs, types, and Zod schemas for the Invoice Approval service.
 * These types define the shape of data for invoice approval workflow operations.
 */

import { z } from "zod";
import {
  Invoice,
  POLine,
  POLineReceipt,
  PurchaseOrder,
  Supplier,
  User,
  InvoiceApprovalHistory,
  InvoiceMatchStatus,
  InvoiceApprovalStatus,
  LineItemType,
} from "@prisma/client";
import { invoiceDateStringSchema } from "@/lib/validation";

// Re-export Prisma enums for convenience
export { InvoiceMatchStatus, InvoiceApprovalStatus };

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Approver type for history tracking
 */
export enum ApproverType {
  REQUESTOR = "REQUESTOR",
  INVENTORY_MANAGER = "INVENTORY_MANAGER",
  FINANCE = "FINANCE",
  SYSTEM = "SYSTEM",
}

/**
 * Approval action for history tracking
 */
export enum ApprovalAction {
  UPLOADED = "UPLOADED",
  MATCHED = "MATCHED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  UNBLOCKED = "UNBLOCKED",
}

/**
 * Canonical display-status values written to Invoice.status by syncInvoiceStatusFields().
 * Every consumer of Invoice.status should reference this enum — not string literals.
 * B8-1: Unified to replace competing InvoiceStatus enums in invoice.types.ts files.
 */
export enum InvoiceDisplayStatus {
  PENDING = 'Pending',
  PENDING_APPROVAL = 'Pending Approval',
  PENDING_REVIEW = 'Pending Review',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
  ON_HOLD = 'On Hold',
  PAID = 'Paid',
  CANCELLED = 'Cancelled',
  VOIDED = 'Voided',
  DISPUTED = 'Disputed',
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for uploading an invoice
 */
export const invoiceUploadSchema = z.object({
  purchaseOrderId: z.string().uuid("Invalid purchase order ID"),
  invoiceNumber: z.string().min(1, "Invoice number is required").max(100),
  // invoiceDateStringSchema enforces MIN_INVOICE_YEAR — rejects year<2000 (1926 bug)
  // and year>now+10 (fat-finger 9999 / 2526). Accepts YYYY-MM-DD or full ISO.
  invoiceDate: invoiceDateStringSchema,
  totalAmount: z.number().positive("Total amount must be positive"),
  dueDate: invoiceDateStringSchema.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  receiptIds: z.array(z.string().uuid()).optional(), // Optional pre-selected receipts
  lineIds: z.array(z.string().uuid()).optional(), // Optional pre-selected PO lines (for SERVICE-only matching)
  lineAmounts: z.record(z.string(), z.number().min(0)).optional(), // Per-line dollar amounts keyed by PO line ID (SERVICE invoices)
  filePath: z.string().optional(), // File path for uploaded PDF
  fileName: z.string().optional(), // Original file name
  fileSize: z.number().optional(), // File size in bytes
  mimeType: z.string().optional(), // MIME type
  approverId: z.string().uuid("Invalid approver ID").optional(), // Explicit approver override (only if not readonly)
});

/**
 * Schema for matching invoice to receipts
 */
export const invoiceMatchSchema = z.object({
  receiptIds: z
    .array(z.string().uuid("Invalid receipt ID"))
    .min(1, "At least one receipt is required"),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for requestor approval
 */
export const requestorApproveSchema = z.object({
  comments: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for requestor rejection
 */
export const requestorRejectSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required").max(1000),
});

/**
 * B1-5: Schema for resubmitting a rejected invoice
 */
export const resubmitInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  notes: z.string().optional(),
});

// B1-8 (TD-014): managerApproveSchema and managerRejectSchema removed — no manager approval workflow exists.

/**
 * Schema for filtering pending approvals
 */
export const pendingApprovalsFilterSchema = z.object({
  status: z.nativeEnum(InvoiceApprovalStatus).optional(),
  supplierId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for uploading invoices
 */
export type InvoiceUploadDTO = z.infer<typeof invoiceUploadSchema>;

/**
 * DTO for matching invoices to receipts
 */
export type InvoiceMatchDTO = z.infer<typeof invoiceMatchSchema>;

/**
 * DTO for requestor approval
 */
export type RequestorApproveDTO = z.infer<typeof requestorApproveSchema>;

/**
 * DTO for requestor rejection
 */
export type RequestorRejectDTO = z.infer<typeof requestorRejectSchema>;

// B1-8 (TD-014): ManagerApproveDTO and ManagerRejectDTO removed — no manager approval workflow exists.

/**
 * DTO for filtering pending approvals
 */
export type PendingApprovalsFilterDTO = z.infer<typeof pendingApprovalsFilterSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Per-line allocation record as returned on the approval page.
 * Each record represents how much of the invoice Finance allocated to one PO line.
 */
export type InvoiceLineItemWithPOLine = {
  id: string;
  invoiceId: string;
  poLineId: string;
  description: string;
  quantity: number | { toNumber: () => number };
  unitPrice: number | { toNumber: () => number };
  totalAmount: number | { toNumber: () => number };
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  poLine: {
    id: string;
    lineNumber: number;
    description: string | null;
    lineType: LineItemType;
  };
};

/**
 * Invoice with approval workflow relations
 *
 * NOTE: purchaseOrder is nullable — the Invoice schema has `purchaseOrderId String?`.
 * All UI code accessing purchaseOrder must guard against null (e.g. `invoice.purchaseOrder?.poNumber`).
 */
export type InvoiceWithApprovalRelations = Invoice & {
  supplier: Supplier | null;
  purchaseOrder: (PurchaseOrder & {
    lines?: POLine[];
    requisition?: {
      id: string;
      requestorId: string;
      requestor: User;
    } | null;
  }) | null;
  receipts: POLineReceipt[];
  uploadedByUser?: User | null;
  requestorApprovedByUser?: User | null;
  requestorRejectedByUser?: User | null;
  managerApprovedByUser?: User | null;
  managerRejectedByUser?: User | null;
  approvalHistory: InvoiceApprovalHistory[];
  /**
   * Per-line invoice allocation amounts set by Finance at upload time.
   * Present when the invoice was uploaded for a SERVICE PO — each record shows
   * exactly how much of the invoice total is charged to one PO line.
   * Approvers use this to cross-reference the invoice PDF line by line.
   */
  invoiceLineItems?: InvoiceLineItemWithPOLine[];
};

/**
 * PO Line with invoice matching status
 */
export type POLineWithInvoiceStatus = POLine & {
  purchaseOrder: PurchaseOrder;
  receipts: POLineReceipt[];
  matchedInvoice?: Invoice | null;
};

/**
 * Blocked service line information
 */
export interface BlockedServiceLine {
  poLineId: string;
  poNumber: string;
  description: string;
  lineType: string;
  requiresInvoiceMatch: boolean;
  invoiceMatched: boolean;
  canReceive: boolean;
  blockReason: string;
}

/**
 * Invoice approval summary
 */
export interface InvoiceApprovalSummary {
  invoice: InvoiceWithApprovalRelations;
  matchStatus: InvoiceMatchStatus;
  approvalStatus: InvoiceApprovalStatus;
  canRequestorApprove: boolean;
  canManagerApprove: boolean;
  blockedServiceLines: BlockedServiceLine[];
  approvalHistory: InvoiceApprovalHistory[];
  nextAction: string;
  nextApprover?: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
}

/**
 * Duplicate invoice warning info
 */
export interface DuplicateInvoiceWarning {
  message: string;
  existingInvoiceId: string;
}

/**
 * Invoice upload result
 */
export interface InvoiceUploadResult {
  invoice: Invoice;
  matchStatus: InvoiceMatchStatus;
  approvalStatus: InvoiceApprovalStatus;
  requestorNotified: boolean;
  message: string;
  duplicateWarning: DuplicateInvoiceWarning | null;
}

/**
 * Invoice match result
 */
export interface InvoiceMatchResult {
  invoice: Invoice;
  matchedReceipts: POLineReceipt[];
  matchStatus: InvoiceMatchStatus;
  approvalStatus: InvoiceApprovalStatus;
  requestorNotified: boolean;
  message: string;
}

/**
 * Invoice approval result
 */
export interface InvoiceApprovalResult {
  invoice: Invoice;
  approvalStatus: InvoiceApprovalStatus;
  unblockedLines: POLine[];
  managerNotified: boolean;
  message: string;
}

/**
 * Invoice rejection result
 */
export interface InvoiceRejectionResult {
  invoice: Invoice;
  approvalStatus: InvoiceApprovalStatus;
  financeNotified: boolean;
  message: string;
}

/**
 * Service line receipt validation
 */
export interface ServiceLineReceiptValidation {
  canReceive: boolean;
  poLineId: string;
  lineType: string;
  requiresInvoiceMatch: boolean;
  invoiceMatched: boolean;
  blockReason?: string;
  invoice?: {
    id: string;
    invoiceNumber: string;
    approvalStatus: InvoiceApprovalStatus;
  } | null;
}

/**
 * Pending approval item
 */
export interface PendingApprovalItem {
  invoice: InvoiceWithApprovalRelations;
  purchaseOrder: PurchaseOrder;
  supplier: Supplier;
  totalAmount: number;
  daysWaiting: number;
  isUrgent: boolean;
  canApprove: boolean;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate invoice upload data
 */
export function validateInvoiceUpload(data: unknown): InvoiceUploadDTO {
  return invoiceUploadSchema.parse(data);
}

/**
 * Validate invoice match data
 */
export function validateInvoiceMatch(data: unknown): InvoiceMatchDTO {
  return invoiceMatchSchema.parse(data);
}

/**
 * Validate requestor approve data
 */
export function validateRequestorApprove(data: unknown): RequestorApproveDTO {
  return requestorApproveSchema.parse(data);
}

/**
 * Validate requestor reject data
 */
export function validateRequestorReject(data: unknown): RequestorRejectDTO {
  return requestorRejectSchema.parse(data);
}

// B1-8 (TD-014): validateManagerApprove and validateManagerReject removed — no manager approval workflow exists.

/**
 * Validate pending approvals filter data
 */
export function validatePendingApprovalsFilter(
  data: unknown,
): PendingApprovalsFilterDTO {
  return pendingApprovalsFilterSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if invoice has approval relations
 */
export function hasApprovalRelations(
  invoice: Invoice | InvoiceWithApprovalRelations,
): invoice is InvoiceWithApprovalRelations {
  return "supplier" in invoice && "purchaseOrder" in invoice;
}

/**
 * Check if invoice can be matched to receipts
 */
export function canMatchToReceipts(invoice: Invoice): boolean {
  return (
    invoice.matchStatus === InvoiceMatchStatus.UNMATCHED ||
    invoice.matchStatus === InvoiceMatchStatus.PARTIALLY_MATCHED
  );
}

/**
 * Check if invoice can be approved by requestor
 */
export function canRequestorApprove(invoice: Invoice): boolean {
  return (
    invoice.matchStatus === InvoiceMatchStatus.FULLY_MATCHED &&
    invoice.approvalStatus === InvoiceApprovalStatus.PENDING_REQUESTOR
  );
}

/**
 * Check if invoice can be rejected by requestor
 */
export function canRequestorReject(invoice: Invoice): boolean {
  return invoice.approvalStatus === InvoiceApprovalStatus.PENDING_REQUESTOR;
}

// B1-6 (TD-010, TD-011): canManagerApprove and canManagerReject removed — no manager approval workflow exists.

/**
 * Check if invoice is fully approved
 */
export function isFullyApproved(invoice: Invoice): boolean {
  return invoice.approvalStatus === InvoiceApprovalStatus.FULLY_APPROVED;
  // B1-6: MANAGER_APPROVED case removed — dead enum value
}

/**
 * Check if invoice is rejected
 */
export function isRejected(invoice: Invoice): boolean {
  return invoice.approvalStatus === InvoiceApprovalStatus.REQUESTOR_REJECTED;
  // B1-6: REJECTED and MANAGER_REJECTED cases removed — dead enum values
}

/**
 * Check if invoice approval is pending
 */
export function isApprovalPending(invoice: Invoice): boolean {
  return (
    invoice.approvalStatus === InvoiceApprovalStatus.PENDING_REQUESTOR ||
    // B1-6: PENDING_MANAGER case removed — dead enum value
    invoice.approvalStatus === InvoiceApprovalStatus.PENDING_REVIEW
  );
}

/**
 * Check if PO line requires invoice match
 */
export function requiresInvoiceMatch(poLine: POLine): boolean {
  return poLine.lineType === "SERVICE" && poLine.requiresInvoiceMatch === true;
}

/**
 * Check if PO line can receive
 */
export function canReceiveLine(poLine: POLine): boolean {
  // INVENTORY and CONSUMABLE can always receive
  if (poLine.lineType === "INVENTORY" || poLine.lineType === "CONSUMABLE") {
    return true;
  }

  // SERVICE requires invoice match and approval
  return poLine.canReceive === true;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate days waiting for approval
 */
export function calculateDaysWaiting(uploadedAt: Date | null): number {
  if (!uploadedAt) return 0;
  const now = new Date();
  const uploaded = new Date(uploadedAt);
  const diffTime = now.getTime() - uploaded.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Determine if approval is urgent (> 3 days waiting)
 */
export function isApprovalUrgent(uploadedAt: Date | null): boolean {
  return calculateDaysWaiting(uploadedAt) > 3;
}

/**
 * Get next approval step description
 */
export function getNextApprovalStep(
  approvalStatus: InvoiceApprovalStatus,
): string {
  switch (approvalStatus) {
    case InvoiceApprovalStatus.PENDING_REQUESTOR:
      return "Waiting for requisition requestor approval";
    case InvoiceApprovalStatus.PENDING_REVIEW:
      return "Waiting for finance review — amount variance detected";
    case InvoiceApprovalStatus.REQUESTOR_APPROVED:
      return "Approved by requestor — services can be received";
    // B1-6: PENDING_MANAGER, MANAGER_APPROVED, MANAGER_REJECTED, REJECTED cases removed — dead enum values
    case InvoiceApprovalStatus.FULLY_APPROVED:
      return "Approved - Services can be received";
    case InvoiceApprovalStatus.REQUESTOR_REJECTED:
      return "Rejected by requestor";
    default:
      return "Unknown status";
  }
}

/**
 * Get approval status display name
 */
export function getApprovalStatusDisplay(
  status: InvoiceApprovalStatus,
): string {
  switch (status) {
    case InvoiceApprovalStatus.PENDING_REQUESTOR:
      return "Pending Requestor";
    case InvoiceApprovalStatus.PENDING_REVIEW:
      return "Pending Finance Review";
    case InvoiceApprovalStatus.REQUESTOR_APPROVED:
      return "Requestor Approved";
    case InvoiceApprovalStatus.REQUESTOR_REJECTED:
      return "Requestor Rejected";
    // B1-6: PENDING_MANAGER, MANAGER_APPROVED, MANAGER_REJECTED, REJECTED cases removed — dead enum values
    case InvoiceApprovalStatus.FULLY_APPROVED:
      return "Fully Approved";
    default:
      return status;
  }
}

/**
 * Get match status display name
 */
export function getMatchStatusDisplay(status: InvoiceMatchStatus): string {
  switch (status) {
    case InvoiceMatchStatus.UNMATCHED:
      return "Unmatched";
    case InvoiceMatchStatus.PARTIALLY_MATCHED:
      return "Partially Matched";
    case InvoiceMatchStatus.FULLY_MATCHED:
      return "Fully Matched";
    case InvoiceMatchStatus.MATCH_APPROVED:
      return "Match Approved";
    case InvoiceMatchStatus.OVER_MATCHED:
      return "Over-Matched";
    default:
      return status;
  }
}

/**
 * Get approval status display info with label, color, and description
 */
export function getApprovalStatusDisplayInfo(
  status: InvoiceApprovalStatus,
): { label: string; color: string; description: string } {
  switch (status) {
    case InvoiceApprovalStatus.PENDING_REQUESTOR:
      return { label: 'Pending Requestor', color: 'warning', description: 'Invoice awaiting requisition requestor approval' };
    case InvoiceApprovalStatus.PENDING_REVIEW:
      return { label: 'Pending Finance Review', color: 'warning', description: 'Invoice requires manual finance review due to amount variance' };
    case InvoiceApprovalStatus.REQUESTOR_APPROVED:
      return { label: 'Requestor Approved', color: 'success', description: 'Requestor has approved the invoice' };
    case InvoiceApprovalStatus.REQUESTOR_REJECTED:
      return { label: 'Requestor Rejected', color: 'destructive', description: 'Requestor has rejected the invoice' };
    // B1-6: PENDING_MANAGER, MANAGER_APPROVED, MANAGER_REJECTED, REJECTED cases removed — dead enum values
    case InvoiceApprovalStatus.FULLY_APPROVED:
      return { label: 'Fully Approved', color: 'success', description: 'Invoice is fully approved' };
    default:
      return { label: status, color: 'secondary', description: 'Unknown approval status' };
  }
}

/**
 * Get match status display info with label, color, and description
 */
export function getMatchStatusDisplayInfo(
  status: InvoiceMatchStatus,
): { label: string; color: string; description: string } {
  switch (status) {
    case InvoiceMatchStatus.UNMATCHED:
      return { label: 'Unmatched', color: 'secondary', description: 'Invoice has not been matched to receipts' };
    case InvoiceMatchStatus.PARTIALLY_MATCHED:
      return { label: 'Partially Matched', color: 'warning', description: 'Invoice partially matched to receipts' };
    case InvoiceMatchStatus.FULLY_MATCHED:
      return { label: 'Fully Matched', color: 'success', description: 'Invoice fully matched to receipts' };
    case InvoiceMatchStatus.MATCH_APPROVED:
      return { label: 'Match Approved', color: 'success', description: 'Invoice match has been approved' };
    case InvoiceMatchStatus.OVER_MATCHED:
      return { label: 'Over-Matched', color: 'destructive', description: 'Cumulative invoicing exceeds PO total beyond tolerance' };
    default:
      return { label: status, color: 'secondary', description: 'Unknown match status' };
  }
}
