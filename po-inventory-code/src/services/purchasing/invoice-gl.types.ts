/**
 * Invoice GL Service Types
 * 
 * TypeScript interfaces for Invoice GL transaction operations.
 */

/**
 * Parameters for creating an invoice payment GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface InvoicePaymentGLParams {
  // Invoice information
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;

  // Payment information
  paymentAmount: number;
  paymentDate: Date;
  paymentMethod?: string;
  paymentReference?: string;

  // Purchase order information (if linked)
  purchaseOrderId?: string;
  poNumber?: string;

  // Account resolution (from PO or invoice)
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)

  // Price variance (if any)
  priceVariance?: number; // Positive = overpayment, Negative = underpayment
}

/**
 * Result of invoice payment GL transaction creation
 */
export interface InvoicePaymentGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  varianceGLTransactionId?: string; // Separate GL transaction for price variance if significant
}

/**
 * Parameters for creating a price variance GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface PriceVarianceGLParams {
  // Invoice information
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;

  // Variance information
  varianceAmount: number; // Positive = overpayment, Negative = underpayment
  description: string;

  // Account resolution
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string; // Location ID (budget area)
}

/**
 * Result of price variance GL transaction creation
 */
export interface PriceVarianceGLResult {
  glTransactionId: string;
  accountCodeId: string;
  budgetPeriodId: string;
}
