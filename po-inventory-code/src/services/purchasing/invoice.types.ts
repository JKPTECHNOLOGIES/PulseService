/**
 * Invoice Service Types
 *
 * DTOs, types, and Zod schemas for the Invoice service.
 * These types define the shape of data for invoice operations.
 */

import { z } from "zod";
import { InvoiceDisplayStatus } from "@/services/purchasing/invoice-approval.types";
import { invoiceDateStringSchema } from "@/lib/validation";

// Base types matching Prisma schema
interface Invoice {
  id: string;
  internalNumber: string;
  invoiceNumber: string;
  supplierId: string;
  purchaseOrderId: string | null;
  invoiceDate: Date;
  dueDate: Date | null;
  subtotal: number; // Decimal
  tax: number; // Decimal
  shippingCost: number; // Decimal
  totalAmount: number; // Decimal
  paidAmount: number; // Decimal
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Invoice approval workflow fields
  approvalStatus: string;
  matchStatus: string;
  uploadedByName: string | null;
  uploadedAt: Date | null;
  requestorApprovedBy: string | null;
  requestorApprovedByName: string | null;
  requestorApprovedAt: Date | null;
  requestorRejectedAt: Date | null;
  requestorRejectionReason: string | null;
}

interface InvoiceLine {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number; // Decimal
  unitPrice: number; // Decimal
  totalPrice: number; // Decimal
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Supplier {
  id: string;
  name: string;
  code: string | null;
  email: string | null;
  phone: string | null;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  totalAmount: number; // Decimal
  /** User who created this PO — the requestor for service invoice approvals */
  creator?: { id: string; firstName: string; lastName: string } | null;
  /** Assigned buyer/purchasing manager */
  buyer?: { id: string; firstName: string; lastName: string } | null;
}

// ============================================================================
// ENUMS (B8-1: deprecated InvoiceStatus removed — use InvoiceDisplayStatus)
// ============================================================================

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for invoice line item
 */
export const invoiceLineSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.number().positive("Quantity must be positive"),
  unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for creating invoices
 */
export const invoiceCreateSchema = z.object({
  invoiceNumber: z.string().min(1, "Invoice number is required").max(100),
  supplierId: z.string().uuid("Invalid supplier ID"),
  purchaseOrderId: z
    .string()
    .uuid("Invalid purchase order ID")
    .optional()
    .nullable(),
  // invoiceDateStringSchema enforces MIN_INVOICE_YEAR (blocks 1926-bug and fat-finger years)
  invoiceDate: invoiceDateStringSchema,
  dueDate: invoiceDateStringSchema.optional().nullable(),
  lines: z
    .array(invoiceLineSchema)
    .min(1, "At least one line item is required"),
  tax: z.number().nonnegative("Tax must be non-negative").default(0),
  shippingCost: z
    .number()
    .nonnegative("Shipping cost must be non-negative")
    .default(0),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for updating invoices (all fields optional)
 */
export const invoiceUpdateSchema = z.object({
  invoiceNumber: z.string().min(1).max(100).optional(),
  supplierId: z.string().uuid("Invalid supplier ID").optional(),
  purchaseOrderId: z
    .string()
    .uuid("Invalid purchase order ID")
    .optional()
    .nullable(),
  // Year range enforced via invoiceDateStringSchema
  invoiceDate: invoiceDateStringSchema.optional(),
  dueDate: invoiceDateStringSchema.optional().nullable(),
  lines: z.array(invoiceLineSchema).optional(),
  tax: z.number().nonnegative("Tax must be non-negative").optional(),
  shippingCost: z
    .number()
    .nonnegative("Shipping cost must be non-negative")
    .optional(),
  /** Direct total amount override — used when no lines are provided (e.g., uploaded invoices) */
  totalAmount: z
    .number()
    .nonnegative("Total amount must be non-negative")
    .optional(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for filtering invoices
 */
export const invoiceFilterSchema = z.object({
  status: z.nativeEnum(InvoiceDisplayStatus).optional(),
  supplierId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  overdue: z.boolean().optional(),
  search: z.string().optional(),
});

/**
 * Schema for approving invoices
 */
export const invoiceApproveSchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for paying invoices
 */
export const invoicePaySchema = z.object({
  amount: z.number().positive("Payment amount must be positive"),
  paymentDate: z.string().datetime(),
  paymentMethod: z.string().max(100).optional().nullable(),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for disputing invoices
 */
export const invoiceDisputeSchema = z.object({
  reason: z.string().min(1, "Dispute reason is required").max(1000),
});

/**
 * Schema for 3-way matching
 */
export const invoice3WayMatchSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice ID"),
  purchaseOrderId: z.string().uuid("Invalid purchase order ID"),
  tolerance: z
    .number()
    .nonnegative("Tolerance must be non-negative")
    .default(0),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for invoice line items
 */
export type InvoiceLineDTO = z.infer<typeof invoiceLineSchema>;

/**
 * DTO for creating invoices
 */
export type InvoiceCreateDTO = z.infer<typeof invoiceCreateSchema>;

/**
 * DTO for updating invoices
 */
export type InvoiceUpdateDTO = z.infer<typeof invoiceUpdateSchema>;

/**
 * DTO for filtering invoices
 */
export type InvoiceFilterDTO = z.infer<typeof invoiceFilterSchema>;

/**
 * DTO for approving invoices
 */
export type InvoiceApproveDTO = z.infer<typeof invoiceApproveSchema>;

/**
 * DTO for paying invoices
 */
export type InvoicePayDTO = z.infer<typeof invoicePaySchema>;

/**
 * DTO for disputing invoices
 */
export type InvoiceDisputeDTO = z.infer<typeof invoiceDisputeSchema>;

/**
 * DTO for 3-way matching
 */
export type Invoice3WayMatchDTO = z.infer<typeof invoice3WayMatchSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Invoice with lines
 */
export type InvoiceWithLines = Invoice & {
  lines: InvoiceLine[];
};

/**
 * Invoice with all relations
 */
export type InvoiceWithRelations = Invoice & {
  lines: InvoiceLine[];
  supplier: Supplier | null;
  purchaseOrder: PurchaseOrder | null;
  /**
   * Distinct projects derived from the invoice's PO line charge allocations.
   * Populated by the list API route via a batch query — not present on
   * individual invoice fetches (detail page).  An invoice with any project
   * entries is considered CAPEX-coded.
   */
  projects?: Array<{ id: string; code: string; name: string }>;
};

/**
 * Invoice statistics
 */
export interface InvoiceStats {
  totalInvoices: number;
  pendingInvoices: number;
  approvedInvoices: number;
  paidInvoices: number;
  overdueInvoices: number;
  totalValue: number;
  totalPaid: number;
  totalOutstanding: number;
  averagePaymentTime: number; // in days
}

/**
 * 3-way match result
 */
export interface ThreeWayMatchResult {
  matched: boolean;
  discrepancies: {
    field: string;
    invoiceValue: number;
    poValue: number;
    difference: number;
    percentDifference: number;
  }[];
  totalDiscrepancy: number;
  withinTolerance: boolean;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate invoice create data
 */
export function validateInvoiceCreate(data: unknown): InvoiceCreateDTO {
  return invoiceCreateSchema.parse(data);
}

/**
 * Validate invoice update data
 */
export function validateInvoiceUpdate(data: unknown): InvoiceUpdateDTO {
  return invoiceUpdateSchema.parse(data);
}

/**
 * Validate invoice filter data
 */
export function validateInvoiceFilter(data: unknown): InvoiceFilterDTO {
  return invoiceFilterSchema.parse(data);
}

/**
 * Validate invoice line data
 */
export function validateInvoiceLine(data: unknown): InvoiceLineDTO {
  return invoiceLineSchema.parse(data);
}

/**
 * Validate invoice approve data
 */
export function validateInvoiceApprove(data: unknown): InvoiceApproveDTO {
  return invoiceApproveSchema.parse(data);
}

/**
 * Validate invoice pay data
 */
export function validateInvoicePay(data: unknown): InvoicePayDTO {
  return invoicePaySchema.parse(data);
}

/**
 * Validate 3-way match data
 */
export function validateInvoice3WayMatch(data: unknown): Invoice3WayMatchDTO {
  return invoice3WayMatchSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if invoice has lines
 */
export function hasLines(
  invoice: Invoice | InvoiceWithLines,
): invoice is InvoiceWithLines {
  return "lines" in invoice && Array.isArray(invoice.lines);
}

/**
 * Check if invoice has all relations
 */
export function hasAllRelations(
  invoice: Invoice | InvoiceWithRelations,
): invoice is InvoiceWithRelations {
  return "lines" in invoice && "supplier" in invoice;
}

/**
 * Check if invoice can be edited
 */
export function canEdit(invoice: Invoice): boolean {
  return invoice.status === InvoiceDisplayStatus.PENDING;
}

/**
 * Check if invoice can be approved
 */
export function canApprove(invoice: Invoice): boolean {
  return invoice.status === InvoiceDisplayStatus.PENDING;
}

/**
 * Check if invoice can be paid
 */
export function canPay(invoice: Invoice): boolean {
  return [
    InvoiceDisplayStatus.PENDING as string,
    InvoiceDisplayStatus.APPROVED as string,
  ].includes(invoice.status);
}

/**
 * Check if invoice can be disputed
 */
export function canDispute(invoice: Invoice): boolean {
  return [
    InvoiceDisplayStatus.PENDING as string,
    InvoiceDisplayStatus.APPROVED as string,
  ].includes(invoice.status);
}

/**
 * Check if invoice is overdue
 */
export function isOverdue(invoice: Invoice): boolean {
  if (!invoice.dueDate || invoice.status === InvoiceDisplayStatus.PAID) {
    return false;
  }
  return new Date(invoice.dueDate) < new Date();
}

/**
 * Check if invoice is fully paid
 */
export function isFullyPaid(invoice: Invoice): boolean {
  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  return paid >= total;
}

/**
 * Calculate remaining balance
 */
export function calculateRemainingBalance(invoice: Invoice): number {
  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  return Math.max(0, total - paid);
}

/**
 * Calculate line total price
 */
export function calculateLineTotal(
  quantity: number,
  unitPrice: number,
): number {
  return quantity * unitPrice;
}

/**
 * Calculate invoice totals
 */
export function calculateInvoiceTotals(
  lines: InvoiceLine[],
  tax: number = 0,
  shippingCost: number = 0,
): { subtotal: number; total: number } {
  const subtotal = lines.reduce((total, line) => {
    return total + Number(line.totalPrice);
  }, 0);
  const total = subtotal + tax + shippingCost;
  return { subtotal, total };
}

/**
 * Calculate days overdue
 */
export function calculateDaysOverdue(invoice: Invoice): number {
  if (!invoice.dueDate || !isOverdue(invoice)) {
    return 0;
  }
  const dueDate = new Date(invoice.dueDate);
  const today = new Date();
  const diffTime = today.getTime() - dueDate.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
