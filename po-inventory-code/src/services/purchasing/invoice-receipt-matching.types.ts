/**
 * Invoice-Receipt Matching Types
 * Types for matching invoices with PO receipts for 3-way matching
 */

import { Invoice, POLineReceipt, PurchaseOrder, Supplier } from '@prisma/client';

// ============================================================================
// Match Criteria & Results
// ============================================================================

export interface InvoiceMatchCriteria {
  invoiceNumber?: string;
  invoiceDate?: Date;
  totalAmount?: number;
  supplierId: string;
  purchaseOrderId?: string;
  amountTolerance?: number; // Percentage tolerance (default: 10%)
  dateTolerance?: number; // Days tolerance (default: 7)
}

export interface ReceiptMatchScore {
  receipt: POLineReceipt & {
    poLine: {
      purchaseOrder: PurchaseOrder;
      description: string;
    };
  };
  matchScore: number; // 0-100
  matchReason: string;
  matchType: 'PRIMARY' | 'SECONDARY' | 'MANUAL';
  variances: VarianceResult;
}

export interface MatchResult {
  invoice: Invoice;
  matchedReceipts: POLineReceipt[];
  variances: VarianceResult;
  success: boolean;
  message?: string;
}

// ============================================================================
// Variance Calculation
// ============================================================================

export interface LineVariance {
  receiptId: string;
  receiptNumber: string;
  description: string;
  receiptQuantity: number;
  receiptUnitCost: number;
  receiptTotal: number;
  invoiceQuantity?: number;
  invoiceUnitCost?: number;
  invoiceTotal?: number;
  quantityVariance?: number;
  priceVariance?: number;
  totalVariance?: number;
  variancePercent?: number;
}

export interface VarianceResult {
  receiptTotal: number;
  invoiceTotal: number;
  variance: number;
  variancePercent: number;
  withinTolerance: boolean;
  tolerancePercent: number;
  lineVariances: LineVariance[];
  hasSignificantVariance: boolean; // > 10%
}

// ============================================================================
// Invoice Creation from Receipts
// ============================================================================

export interface CreateInvoiceFromReceiptsInput {
  purchaseOrderId: string;
  receiptIds: string[];
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date;
  notes?: string;
  file?: File | Blob; // File object from browser or multer
}

export interface CreateInvoiceFromReceiptsResult {
  invoice: Invoice;
  document?: Record<string, unknown>; // Document record if file was uploaded
  matchedReceipts: POLineReceipt[];
  variances: VarianceResult;
  success: boolean;
  message?: string;
}

// ============================================================================
// Invoice Upload
// ============================================================================

export interface InvoiceUploadInput {
  purchaseOrderId: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO date string
  totalAmount: number;
  dueDate?: string; // ISO date string
  notes?: string;
  receiptIds?: string[]; // Optional pre-selected receipts
}

export interface InvoiceUploadResult {
  invoice: Invoice;
  document: Record<string, unknown>; // Document record
  matchedReceipts: POLineReceipt[];
  variances: VarianceResult;
  success: boolean;
  message?: string;
}

// ============================================================================
// 3-Way Match Validation
// ============================================================================

export interface ThreeWayMatchValidation {
  isValid: boolean;
  purchaseOrder: PurchaseOrder;
  receipts: POLineReceipt[];
  invoice: Invoice;
  validations: {
    supplierMatch: boolean;
    amountMatch: boolean;
    quantityMatch: boolean;
    priceMatch: boolean;
  };
  variances: VarianceResult;
  warnings: string[];
  errors: string[];
}

// ============================================================================
// Auto-Match Configuration
// ============================================================================

export interface AutoMatchConfig {
  primaryMatch: {
    invoiceNumberMatch: boolean;
    invoiceDateMatch: boolean;
    supplierMatch: boolean;
    amountTolerance: number; // Percentage (default: 5%)
  };
  secondaryMatch: {
    dateTolerance: number; // Days (default: 7)
    supplierMatch: boolean;
    amountTolerance: number; // Percentage (default: 10%)
  };
}

// ============================================================================
// Extended Types with Relations
// ============================================================================

export interface InvoiceWithRelations extends Invoice {
  supplier: Supplier;
  purchaseOrder?: PurchaseOrder;
  receipts?: POLineReceipt[];
  documents?: Record<string, unknown>[];
}

export interface POLineReceiptWithRelations extends POLineReceipt {
  poLine: {
    id: string;
    purchaseOrderId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    purchaseOrder: PurchaseOrder;
  };
  invoice?: Invoice;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PotentialMatchesResponse {
  receipts: ReceiptMatchScore[];
  totalReceipts: number;
  highConfidenceMatches: number;
  mediumConfidenceMatches: number;
  lowConfidenceMatches: number;
}

export interface MatchReceiptsRequest {
  receiptIds: string[];
}

export interface MatchReceiptsResponse {
  invoice: InvoiceWithRelations;
  matchedReceipts: POLineReceiptWithRelations[];
  variances: VarianceResult;
  success: boolean;
  message?: string;
}
