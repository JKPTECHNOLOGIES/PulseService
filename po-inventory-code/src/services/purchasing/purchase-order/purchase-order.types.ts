/**
 * Purchase Order Service Types
 *
 * DTOs, types, and Zod schemas for the Purchase Order service.
 * These types define the shape of data for purchase order operations.
 */

import { z } from "zod";
import {
  inventoryLineItemSchema,
  serviceLineItemSchema,
  consumableLineItemSchema,
  nonStockLineItemSchema,
  repairableReturnLineItemSchema,
} from "./line-item.types";

// Base types matching Prisma schema
interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  status: string;
  orderDate: Date;
  expectedDate: Date | null;
  receivedDate: Date | null;
  sentAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  closedAt: Date | null;
  totalAmount: number; // Decimal
  notes: string | null;
  deliveryTerms: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  buyerId: string | null;
  invoiceApproverId: string | null;
  requisitionIds: string[];
  requisitionNumbers: string[];
  workOrderIds: string[];
  workOrderNumbers: string[];
  // Payment terms override (PO-level, takes precedence over supplier.paymentTerms)
  paymentTermsOverride?: string | null;
  // Cancellation fields
  cancelledReason?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: Date | string | null;
  // Vendor address snapshot (frozen at PO creation time)
  supplierAddressId: string | null;
  vendorName: string | null;
  vendorAddress1: string | null;
  vendorAddress2: string | null;
  vendorCity: string | null;
  vendorState: string | null;
  vendorZip: string | null;
  vendorCountry: string | null;
  // Ship To address override (null = default to company/branding address)
  shipToName: string | null;
  shipToAttention: string | null;
  shipToAddress1: string | null;
  shipToAddress2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToZip: string | null;
  shipToCountry: string | null;
}

interface POLineChargeAllocation {
  id: string;
  accountCodeId: string | null;
  departmentId: string | null;
  projectId: string | null;
  areaId: string | null;
  percentage: number;
  amount: number;
  accountCode?: {
    id: string;
    code: string;
    name: string;
    glAccountId: string | null;
  } | null;
  department?: {
    id: string;
    name: string;
  } | null;
  project?: {
    id: string;
    name: string;
    code: string;
  } | null;
  area?: {
    id: string;
    name: string;
  } | null;
}

interface POLine {
  id: string;
  purchaseOrderId: string;
  inventoryItemId: string | null;
  description: string;
  lineNumber: number;
  quantity: number; // Decimal
  unitPrice: number; // Decimal
  unitOfMeasure: string | null;
  totalPrice: number; // Decimal
  receivedQuantity: number; // Decimal
  notes: string | null;
  // PO-specific editable copy of the material's longText. null = fall back to inventoryItem.longText.
  longTextOverride: string | null;
  deliveryDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lineType: string; // LineItemType enum
  // Line-level cancellation (used by "scrap a repairable from the PO").
  // Populated automatically by buildPOInclude() (lines use `include`, so all
  // POLine scalars are returned). Optional here for backward compatibility.
  lineStatus?: string; // POLineStatus enum: OPEN | CANCELLED
  cancellationType?: string | null; // POLineCancellationType enum
  // Requisition tracking (line-level)
  requisitionId?: string | null;
  requisitionNumber?: string | null;
  // Work Order tracking (line-level)
  workOrderId: string | null;
  workOrderNumber: string | null;
  // Invoice approval fields
  requiresInvoiceMatch: boolean;
  invoiceMatched: boolean;
  canReceive: boolean;
  // Dollar-based invoice approval tracking
  approvedInvoiceAmount: number; // Decimal - Total approved invoice amount for this line
  receivedAmount: number; // Decimal - Total dollar amount received so far
  // SERVICE fields
  serviceType: string | null;
  serviceCategory: string | null;
  serviceProvider: string | null;
  serviceLocation: string | null;
  serviceStartDate: Date | null;
  serviceEndDate: Date | null;
  serviceWorkOrderId: string | null;
  serviceEquipmentId: string | null;
  estimatedHours: number | null; // Decimal
  hourlyRate: number | null; // Decimal
  deliverables: string | null;
  slaDetails: string | null;
  contractNumber: string | null;
  // CONSUMABLE fields
  consumableCategory: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  packageSize: string | null;
  monthlyUsageRate: number | null; // Decimal
  expirationTracking: boolean;
  sdsRequired: boolean;
  storageRequirements: string | null;
  // Budget charge allocations (populated when using buildPOInclude())
  chargeAllocations?: POLineChargeAllocation[];
  // Receipt records (populated when using buildPOInclude())
  // totalCost is a Prisma Decimal — callers must call Number() before arithmetic
  receipts?: {
    id: string;
    totalCost: unknown;
    status: string;
    isReturn: boolean;
  }[];
}

interface SupplierAddress {
  id: string;
  supplierId: string;
  addressCode: string;
  label: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  isMailingAddress: boolean;
  isRemittanceAddress: boolean;
  isShippingAddress: boolean;
  isDefaultMailing: boolean;
  isDefaultRemittance: boolean;
  isDefaultShipping: boolean;
}

interface Supplier {
  id: string;
  name: string;
  code: string | null;
  internalVendorCode: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  rating: number | null;
  paymentTerms?: string | null;
  // Billing Address
  billingAddress: string | null;
  billingAddress2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  billingCountry: string | null;
  // Shipping Address
  shippingAddress: string | null;
  shippingAddress2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZip: string | null;
  shippingCountry: string | null;
  // Addresses relation (always included via buildPOInclude)
  addresses: SupplierAddress[];
}

interface InventoryItem {
  id: string;
  sku: string;
  description: string;
  name?: string | null;
  category?: string | null;
  unit: string;
  unitCost: number; // Decimal
  longText?: string | null;
}

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Purchase Order status values
 */
export enum PurchaseOrderStatus {
  DRAFT = "Draft",
  SUBMITTED = "Submitted",
  APPROVED = "Approved",
  ORDERED = "Ordered",
  PARTIALLY_RECEIVED = "PartiallyReceived",
  RECEIVED = "Received",
  INVOICED = "Invoiced",
  CLOSED = "Closed",
  CANCELLED = "Cancelled",
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for purchase order item (supports INVENTORY, SERVICE, CONSUMABLE, NON_STOCK)
 *
 * This schema uses a discriminated union based on lineType to ensure
 * type-specific fields are validated correctly.
 *
 * lineType is REQUIRED - no defaults, no shortcuts.
 */
export const purchaseOrderItemSchema = z.discriminatedUnion("lineType", [
  // INVENTORY line item - extend the base schema with PO-specific fields
  inventoryLineItemSchema.extend({
    id: z.string().uuid().optional(),
    unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  }),
  // SERVICE line item - extend the base schema with PO-specific fields
  serviceLineItemSchema.extend({
    id: z.string().uuid().optional(),
    unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  }),
  // CONSUMABLE line item - extend the base schema with PO-specific fields
  consumableLineItemSchema.extend({
    id: z.string().uuid().optional(),
    unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  }),
  // NON_STOCK line item - extend the base schema with PO-specific fields
  nonStockLineItemSchema.extend({
    id: z.string().uuid().optional(),
    unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  }),
  // REPAIRABLE_RETURN line item - physical part returning from vendor repair
  repairableReturnLineItemSchema.extend({
    id: z.string().uuid().optional(),
    unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  }),
]);

/**
 * Schema for creating purchase orders
 */
/**
 * Reusable Ship-To override fields. Each is an optional, nullable string; an
 * empty string is normalised to null so clearing a field in the UI clears the
 * override. When all are null the printed PO falls back to the company address.
 */
const shipToString = (max: number) =>
  z.preprocess(
    (val) => (val === "" ? null : val),
    z.string().max(max).optional().nullable(),
  );

export const shipToFieldsSchema = {
  shipToName: shipToString(200),
  shipToAttention: shipToString(200),
  shipToAddress1: shipToString(200),
  shipToAddress2: shipToString(200),
  shipToCity: shipToString(100),
  shipToState: shipToString(100),
  shipToZip: shipToString(20),
  shipToCountry: shipToString(100),
};

export const purchaseOrderCreateSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID"),
  supplierAddressId: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string().min(1).optional(),
  ),
  requisitionId: z
    .string()
    .uuid("Invalid requisition ID")
    .optional()
    .nullable(),
  orderDate: z.string().datetime().optional(),
  expectedDeliveryDate: z.string().datetime().optional().nullable(),
  items: z
    .array(purchaseOrderItemSchema)
    .min(1, "At least one item is required"),
  shippingCost: z
    .number()
    .nonnegative("Shipping cost must be non-negative")
    .default(0),
  /**
   * Legacy ad-hoc tax field for direct PO creation.
   * When a PO is created from a Requisition (the normal path), tax is driven by
   * the Tax Module and stored in PurchaseOrder.taxAmount (schema column).
   * This field is kept for backward compatibility with direct-PO-create flows.
   */
  tax: z.number().nonnegative("Tax must be non-negative").default(0),
  notes: z.string().max(2000).optional().nullable(),
  deliveryTerms: z.string().max(500).optional().nullable(),
  onBehalfOfId: z.string().uuid("Invalid user ID").optional().nullable(),
  invoiceApproverId: z
    .string()
    .uuid("Invalid invoice approver ID")
    .optional()
    .nullable(),
  ...shipToFieldsSchema,
});

/**
 * Schema for updating purchase orders (all fields optional)
 */
export const purchaseOrderUpdateSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID").optional(),
  supplierAddressId: z.preprocess(
    (val) => (val === "" ? null : val),
    z.string().min(1).optional().nullable(),
  ),
  buyerId: z.string().uuid("Invalid buyer ID").optional().nullable(),
  invoiceApproverId: z
    .string()
    .uuid("Invalid invoice approver ID")
    .optional()
    .nullable(),
  onBehalfOfId: z.string().uuid("Invalid user ID").optional().nullable(),
  orderDate: z.string().datetime().optional(),
  expectedDeliveryDate: z.string().datetime().optional().nullable(),
  items: z.array(purchaseOrderItemSchema).optional(),
  shippingCost: z
    .number()
    .nonnegative("Shipping cost must be non-negative")
    .optional(),
  /** Legacy ad-hoc tax field — see purchaseOrderCreateSchema.tax for details. */
  tax: z.number().nonnegative("Tax must be non-negative").optional(),
  notes: z.string().max(2000).optional().nullable(),
  deliveryTerms: z.string().max(500).optional().nullable(),
  paymentTermsOverride: z.string().max(500).optional().nullable(),
  ...shipToFieldsSchema,
});

/**
 * Schema for filtering purchase orders
 */
export const purchaseOrderFilterSchema = z.object({
  status: z.nativeEnum(PurchaseOrderStatus).optional(),
  supplierId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().optional(),
});

/**
 * Schema for receiving items
 */
export const receiveItemsSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().uuid("Invalid item ID"),
        quantityReceived: z
          .number()
          .positive("Quantity received must be positive"),
        storeId: z.string().min(1, "Store ID is required"), // Allow any string, not just UUID
        notes: z.string().max(500).optional().nullable(),
      }),
    )
    .min(1, "At least one item is required"),
  receivedBy: z.string().min(1, "Received by is required"), // Allow any string, not just UUID
  receivedDate: z.coerce.date().optional(), // Coerce string to Date
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for cancelling purchase orders
 */
export const purchaseOrderCancelSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required").max(1000),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for purchase order items
 */
export type PurchaseOrderItemDTO = z.infer<typeof purchaseOrderItemSchema>;

/**
 * DTO for creating purchase orders
 */
export type PurchaseOrderCreateDTO = z.infer<typeof purchaseOrderCreateSchema>;

/**
 * DTO for updating purchase orders
 */
export type PurchaseOrderUpdateDTO = z.infer<typeof purchaseOrderUpdateSchema>;

/**
 * DTO for filtering purchase orders
 */
export type PurchaseOrderFilterDTO = z.infer<typeof purchaseOrderFilterSchema>;

/**
 * DTO for receiving items
 */
export type ReceiveItemsDTO = z.infer<typeof receiveItemsSchema>;

/**
 * DTO for cancelling purchase orders
 */
export type PurchaseOrderCancelDTO = z.infer<typeof purchaseOrderCancelSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Purchase order with items
 */
export type PurchaseOrderWithItems = PurchaseOrder & {
  lines: POLine[];
};

/**
 * Purchase order with all relations
 */
export type PurchaseOrderWithRelations = PurchaseOrder & {
  lines: (POLine & {
    inventoryItem: InventoryItem | null;
  })[];
  supplier: Supplier;
  creator?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  } | null;
  buyer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  invoiceApprover?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  requisitions?: Array<{
    id: string;
    reqNumber: string;
    status: string;
    requestedBy?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
    budgetHeader?: {
      budgetType: string;
      accountCodeId: string | null;
      workOrderId: string | null;
      totalAmount: number;
      accountCode?: {
        code: string;
        name: string;
      } | null;
      workOrder?: {
        woNumber: string;
      } | null;
    } | null;
    lineAllocations?: Array<{
      id: string;
      requisitionLineId: string | null;
      accountCodeId: string | null;
      departmentId: string | null;
      areaId: string | null;
      projectId: string | null;
      amount: number;
      percentage: number;
      accountCode?: {
        code: string;
        name: string;
      } | null;
      department?: {
        name: string;
      } | null;
      area?: {
        name: string;
      } | null;
      project?: {
        name: string;
      } | null;
      requisitionLine?: {
        description: string;
        quantity: number;
        estimatedPrice: number;
      } | null;
    }>;
  }>;
  workOrders?: Array<{
    id: string;
    woNumber: string;
    title: string;
  }>;
};

/**
 * Purchase order statistics
 * Used by the statistics service for reporting and analytics
 */
export interface PurchaseOrderStats {
  totalCount: number;
  byStatus: {
    draft: number;
    submitted: number;
    approved: number;
    ordered: number;
    partiallyReceived: number;
    received: number;
    invoiced: number;
    closed: number;
    cancelled: number;
  };
  financial: {
    totalValue: number;
    averageValue: number;
    totalByStatus: {
      [key: string]: number;
    };
  };
  performance: {
    onTimeDeliveryRate: number;
    averageLeadTime: number;
    approvalRate: number;
  };
  topSuppliers: Array<{
    supplierId: string;
    supplierName: string;
    orderCount: number;
    totalValue: number;
  }>;
  overdueOrders: number;
}

/**
 * Receive item result
 */
export interface ReceiveItemResult {
  itemId: string;
  quantityReceived: number;
  quantityRemaining: number;
  fullyReceived: boolean;
}

/**
 * Document attachment result
 */
export interface DocumentAttachmentResult {
  success: boolean;
  message: string;
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
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate purchase order create data
 */
export function validatePurchaseOrderCreate(
  data: unknown,
): PurchaseOrderCreateDTO {
  return purchaseOrderCreateSchema.parse(data);
}

/**
 * Validate purchase order update data
 */
export function validatePurchaseOrderUpdate(
  data: unknown,
): PurchaseOrderUpdateDTO {
  return purchaseOrderUpdateSchema.parse(data);
}

/**
 * Validate purchase order filter data
 */
export function validatePurchaseOrderFilter(
  data: unknown,
): PurchaseOrderFilterDTO {
  return purchaseOrderFilterSchema.parse(data);
}

/**
 * Validate purchase order item data
 */
export function validatePurchaseOrderItem(data: unknown): PurchaseOrderItemDTO {
  return purchaseOrderItemSchema.parse(data);
}

/**
 * Validate receive items data
 */
export function validateReceiveItems(data: unknown): ReceiveItemsDTO {
  return receiveItemsSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if purchase order has items
 */
export function hasItems(
  po: PurchaseOrder | PurchaseOrderWithItems,
): po is PurchaseOrderWithItems {
  return "lines" in po && Array.isArray(po.lines);
}

/**
 * Check if purchase order has all relations
 */
export function hasAllRelations(
  po: PurchaseOrder | PurchaseOrderWithRelations,
): po is PurchaseOrderWithRelations {
  return "lines" in po && "supplier" in po;
}

/**
 * Check if purchase order can be edited
 * Allows editing in Draft, Submitted, Approved, Ordered, and PartiallyReceived statuses.
 * Financial changes on non-Draft POs will trigger the cancel-for-edit workflow.
 */
export function canEdit(po: PurchaseOrder): boolean {
  return [
    PurchaseOrderStatus.DRAFT,
    PurchaseOrderStatus.SUBMITTED,
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.ORDERED,
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
  ].includes(po.status as PurchaseOrderStatus);
}

/**
 * Check if purchase order can receive items
 */
export function canReceiveItems(po: PurchaseOrder): boolean {
  return [
    PurchaseOrderStatus.ORDERED,
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
  ].includes(po.status as PurchaseOrderStatus);
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
 * Calculate remaining quantity to receive
 */
export function calculateRemainingQuantity(line: POLine): number {
  const quantity = Number(line.quantity);
  const received = Number(line.receivedQuantity);
  return Math.max(0, quantity - received);
}

// ============================================================================
// RECEIVING TYPES
// ============================================================================

/**
 * Input for receiving items from a purchase order
 */
export interface ReceiveItemsInput {
  items: ReceiveItemInput[];
  receivedBy: string;
  receivedDate?: Date;
  notes?: string | null;
}

/**
 * Input for a single item being received
 */
export interface ReceiveItemInput {
  itemId: string;
  quantityReceived: number;
  storeId: string;
  location?: string;
  notes?: string | null;
}

/**
 * Receiving history entry
 */
export interface ReceivingHistoryEntry {
  id: string;
  receivedDate: Date;
  receivedBy: string;
  receivedByUser?: {
    id: string;
    name: string;
  };
  items: {
    itemId: string;
    inventoryItemId: string;
    inventoryItem?: {
      name: string;
      partNumber: string;
    };
    quantityReceived: number;
    location?: string;
    notes?: string;
  }[];
  notes?: string;
}
