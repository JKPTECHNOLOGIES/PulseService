/**
 * Supplier Service Types
 *
 * DTOs, types, and Zod schemas for the Supplier service.
 * These types define the shape of data for supplier operations.
 */

import { z } from "zod";

// Base types matching Prisma schema
interface Supplier {
  id: string;
  name: string;
  code: string | null;
  internalVendorCode: string | null; // Auto-generated vendor code for finance
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  
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
  
  // Financial Information
  taxId: string | null;
  ein: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  creditLimit: number | null; // Decimal
  creditTermsDays: number | null;
  discountPercent: number | null; // Decimal
  
  // Performance & Ratings
  rating: number | null;
  onTimeDeliveryRate: number | null; // Decimal
  qualityRating: number | null; // Decimal
  
  // Operational
  leadTimeDays: number | null;
  minimumOrderAmount: number | null; // Decimal
  shippingMethod: string | null;
  accountNumber: string | null;
  notes: string | null;
  isSupplier: boolean;
  isContractor: boolean;
  defaultRate: number | null; // Decimal
  rateUnit: string | null;
  parentSupplierId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  orderDate: Date;
  totalAmount: number; // Decimal
}

interface InventoryItem {
  id: string;
  sku: string;
  description: string;
  unitCost: number; // Decimal
}

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Supplier rating values (1-5 stars)
 */
export enum SupplierRating {
  ONE_STAR = 1,
  TWO_STARS = 2,
  THREE_STARS = 3,
  FOUR_STARS = 4,
  FIVE_STARS = 5,
}

/**
 * Payment terms
 */
export enum PaymentTerms {
  NET_15 = "Net 15",
  NET_30 = "Net 30",
  NET_45 = "Net 45",
  NET_60 = "Net 60",
  NET_90 = "Net 90",
  COD = "COD",
  PREPAID = "Prepaid",
  DUE_ON_RECEIPT = "Due on Receipt",
}

/**
 * Payment methods
 */
export enum PaymentMethod {
  CHECK = "Check",
  ACH = "ACH",
  WIRE = "Wire Transfer",
  CREDIT_CARD = "Credit Card",
  CASH = "Cash",
  OTHER = "Other",
}

/**
 * Shipping methods
 */
export enum ShippingMethod {
  GROUND = "Ground",
  EXPRESS = "Express",
  OVERNIGHT = "Overnight",
  FREIGHT = "Freight",
  PICKUP = "Pickup",
  OTHER = "Other",
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Base supplier shape (without validation refinements).
 * Used to derive both the create schema (with refine) and the
 * update schema (partial, no refine required for partial updates).
 */
const supplierBaseShape = {
  // Basic Information
  name: z.string().min(1, "Supplier name is required").max(200),
  code: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? null : val),
    z.string().max(50).nullable()
  ).optional(),
  contactPerson: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  fax: z.string().max(50).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  
  // Billing Address
  billingAddress: z.string().max(200).optional().nullable(),
  billingAddress2: z.string().max(200).optional().nullable(),
  billingCity: z.string().max(100).optional().nullable(),
  billingState: z.string().max(50).optional().nullable(),
  billingZip: z.string().max(20).optional().nullable(),
  billingCountry: z.string().max(100).optional().nullable(),
  
  // Shipping Address
  shippingAddress: z.string().max(200).optional().nullable(),
  shippingAddress2: z.string().max(200).optional().nullable(),
  shippingCity: z.string().max(100).optional().nullable(),
  shippingState: z.string().max(50).optional().nullable(),
  shippingZip: z.string().max(20).optional().nullable(),
  shippingCountry: z.string().max(100).optional().nullable(),
  
  // Financial Information
  taxId: z.string().max(50).optional().nullable(),
  ein: z.string().max(50).optional().nullable(),
  paymentTerms: z.string().max(100).optional().nullable(),
  paymentMethod: z.string().max(50).optional().nullable(),
  creditLimit: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().nonnegative("Credit limit must be non-negative").nullable()
    )
    .optional(),
  creditTermsDays: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().int().nonnegative("Credit terms must be non-negative").nullable()
    )
    .optional(),
  discountPercent: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().min(0, "Discount must be non-negative").max(100, "Discount cannot exceed 100%").nullable()
    )
    .optional(),
  
  // Performance & Ratings
  rating: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().int().min(0).max(5).nullable()
    )
    .optional(),
  onTimeDeliveryRate: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().min(0, "Rate must be between 0 and 100").max(100, "Rate must be between 0 and 100").nullable()
    )
    .optional(),
  qualityRating: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().min(0, "Rating must be between 0 and 100").max(100, "Rating must be between 0 and 100").nullable()
    )
    .optional(),
  
  // Operational
  leadTimeDays: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().int().nonnegative("Lead time must be non-negative").nullable()
    )
    .optional(),
  minimumOrderAmount: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().nonnegative("Minimum order amount must be non-negative").nullable()
    )
    .optional(),
  shippingMethod: z.string().max(100).optional().nullable(),
  accountNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isSupplier: z.boolean().optional().default(true),
  isContractor: z.boolean().optional().default(false),
  defaultRate: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
      z.number().nonnegative("Rate must be non-negative").nullable()
    )
    .optional(),
  rateUnit: z.enum(["hour", "day", "week", "month", "project", "unit"]).optional().nullable(),
  parentSupplierId: z.string().uuid().optional().nullable(),
};

/**
 * Schema for creating suppliers
 * Includes cross-field validation: at least one of isSupplier / isContractor must be true.
 */
export const supplierCreateSchema = z.object(supplierBaseShape).refine(
  (data) => data.isSupplier || data.isContractor,
  {
    message: "At least one type (Supplier or Contractor) must be selected",
    path: ["isSupplier"],
  }
);

/**
 * Schema for updating suppliers (all fields optional).
 * Derived from the base shape so we can safely call .partial() without
 * hitting Zod v4's restriction that .partial() is only on ZodObject
 * (not on the ZodPipe returned by .refine()).
 */
export const supplierUpdateSchema = z.object(supplierBaseShape).partial();

/**
 * Schema for filtering suppliers
 */
export const supplierFilterSchema = z.object({
  isActive: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  minRating: z.number().int().min(1).max(5).optional(),
  search: z.string().optional(),
});

/**
 * Schema for updating supplier rating
 */
export const supplierRatingUpdateSchema = z.object({
  rating: z
    .number()
    .int()
    .min(1, "Rating must be between 1 and 5")
    .max(5, "Rating must be between 1 and 5"),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Schema for deactivating supplier
 */
export const supplierDeactivateSchema = z.object({
  reason: z.string().min(1, "Deactivation reason is required").max(1000),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating suppliers
 */
export type SupplierCreateDTO = z.infer<typeof supplierCreateSchema>;

/**
 * DTO for updating suppliers
 */
export type SupplierUpdateDTO = z.infer<typeof supplierUpdateSchema>;

/**
 * DTO for filtering suppliers
 */
export type SupplierFilterDTO = z.infer<typeof supplierFilterSchema>;

/**
 * DTO for updating supplier rating
 */
export type SupplierRatingUpdateDTO = z.infer<
  typeof supplierRatingUpdateSchema
>;

/**
 * DTO for deactivating supplier
 */
export type SupplierDeactivateDTO = z.infer<typeof supplierDeactivateSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Supplier with purchase orders
 */
export type SupplierWithPurchaseOrders = Supplier & {
  purchaseOrders: PurchaseOrder[];
};

/**
 * Supplier with inventory items
 */
export type SupplierWithInventoryItems = Supplier & {
  inventoryItems: InventoryItem[];
};

/**
 * Supplier with all relations
 */
export type SupplierWithRelations = Supplier & {
  purchaseOrders: PurchaseOrder[];
  inventoryItems: InventoryItem[];
};

/**
 * Supplier statistics
 */
export interface SupplierStats {
  totalOrders: number;
  openOrders: number;
  completedOrders: number;
  totalOrderValue: number;
  averageOrderValue: number;
  onTimeDeliveryRate: number;
  averageLeadTime: number; // in days
  lastOrderDate: Date | null;
  itemsSupplied: number;
  defectRate: number;
}

/**
 * Supplier performance metrics
 */
export interface SupplierPerformance {
  supplierId: string;
  supplierName: string;
  rating: number | null;
  totalOrders: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  onTimeRate: number;
  averageLeadTime: number;
  qualityScore: number;
  totalSpend: number;
}

/**
 * Address structure
 */
export interface Address {
  address: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

/**
 * Supplier with structured addresses
 */
export interface SupplierWithAddresses extends Supplier {
  billingAddressFormatted: string;
  shippingAddressFormatted: string;
}

/**
 * Financial summary for supplier
 */
export interface SupplierFinancialSummary {
  supplierId: string;
  supplierName: string;
  creditLimit: number | null;
  creditUsed: number;
  creditAvailable: number;
  totalSpend: number;
  averageOrderValue: number;
  paymentTerms: string | null;
  discountPercent: number | null;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate supplier create data
 */
export function validateSupplierCreate(data: unknown): SupplierCreateDTO {
  return supplierCreateSchema.parse(data);
}

/**
 * Validate supplier update data
 */
export function validateSupplierUpdate(data: unknown): SupplierUpdateDTO {
  return supplierUpdateSchema.parse(data);
}

/**
 * Validate supplier filter data
 */
export function validateSupplierFilter(data: unknown): SupplierFilterDTO {
  return supplierFilterSchema.parse(data);
}

/**
 * Validate supplier rating update data
 */
export function validateSupplierRatingUpdate(
  data: unknown,
): SupplierRatingUpdateDTO {
  return supplierRatingUpdateSchema.parse(data);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if supplier has purchase orders
 */
export function hasPurchaseOrders(
  supplier: Supplier | SupplierWithPurchaseOrders,
): supplier is SupplierWithPurchaseOrders {
  return "purchaseOrders" in supplier && Array.isArray(supplier.purchaseOrders);
}

/**
 * Check if supplier has inventory items
 */
export function hasInventoryItems(
  supplier: Supplier | SupplierWithInventoryItems,
): supplier is SupplierWithInventoryItems {
  return "inventoryItems" in supplier && Array.isArray(supplier.inventoryItems);
}

/**
 * Check if supplier has all relations
 */
export function hasAllRelations(
  supplier: Supplier | SupplierWithRelations,
): supplier is SupplierWithRelations {
  return "purchaseOrders" in supplier && "inventoryItems" in supplier;
}

/**
 * Check if supplier is active
 */
export function isActive(supplier: Supplier): boolean {
  return supplier.isActive === true;
}

/**
 * Check if supplier is preferred (high rating)
 */
export function isPreferred(supplier: Supplier): boolean {
  return supplier.rating !== null && supplier.rating >= 4;
}

/**
 * Check if supplier has good rating
 */
export function hasGoodRating(supplier: Supplier): boolean {
  return supplier.rating !== null && supplier.rating >= 3;
}

/**
 * Get rating description
 */
export function getRatingDescription(rating: number | null): string {
  if (rating === null) return "Not Rated";
  if (rating >= 5) return "Excellent";
  if (rating >= 4) return "Very Good";
  if (rating >= 3) return "Good";
  if (rating >= 2) return "Fair";
  return "Poor";
}

/**
 * Calculate on-time delivery rate
 */
export function calculateOnTimeRate(onTime: number, total: number): number {
  if (total === 0) return 0;
  return (onTime / total) * 100;
}

/**
 * Calculate average order value
 */
export function calculateAverageOrderValue(
  totalValue: number,
  orderCount: number,
): number {
  if (orderCount === 0) return 0;
  return totalValue / orderCount;
}

/**
 * Format address as single string
 */
export function formatAddress(address: Address): string {
  const parts: string[] = [];
  
  if (address.address) parts.push(address.address);
  if (address.address2) parts.push(address.address2);
  
  const cityStateZip: string[] = [];
  if (address.city) cityStateZip.push(address.city);
  if (address.state) cityStateZip.push(address.state);
  if (address.zip) cityStateZip.push(address.zip);
  
  if (cityStateZip.length > 0) {
    parts.push(cityStateZip.join(", "));
  }
  
  if (address.country && address.country !== "USA") {
    parts.push(address.country);
  }
  
  return parts.join("\n");
}

/**
 * Format billing address from supplier
 */
export function formatBillingAddress(supplier: Supplier): string {
  return formatAddress({
    address: supplier.billingAddress,
    address2: supplier.billingAddress2,
    city: supplier.billingCity,
    state: supplier.billingState,
    zip: supplier.billingZip,
    country: supplier.billingCountry,
  });
}

/**
 * Format shipping address from supplier
 */
export function formatShippingAddress(supplier: Supplier): string {
  return formatAddress({
    address: supplier.shippingAddress,
    address2: supplier.shippingAddress2,
    city: supplier.shippingCity,
    state: supplier.shippingState,
    zip: supplier.shippingZip,
    country: supplier.shippingCountry,
  });
}

/**
 * Check if supplier has billing address
 */
export function hasBillingAddress(supplier: Supplier): boolean {
  return !!(
    supplier.billingAddress ??
    supplier.billingCity ??
    supplier.billingState ??
    supplier.billingZip
  );
}

/**
 * Check if supplier has shipping address
 */
export function hasShippingAddress(supplier: Supplier): boolean {
  return !!(
    supplier.shippingAddress ??
    supplier.shippingCity ??
    supplier.shippingState ??
    supplier.shippingZip
  );
}

/**
 * Check if supplier has financial information
 */
export function hasFinancialInfo(supplier: Supplier): boolean {
  return !!(
    supplier.taxId ??
    supplier.ein ??
    supplier.creditLimit ??
    supplier.paymentMethod
  );
}

/**
 * Calculate credit available
 */
export function calculateCreditAvailable(
  creditLimit: number | null,
  creditUsed: number,
): number {
  if (creditLimit === null) return 0;
  return Math.max(0, creditLimit - creditUsed);
}

/**
 * Check if supplier is over credit limit
 */
export function isOverCreditLimit(
  creditLimit: number | null,
  creditUsed: number,
): boolean {
  if (creditLimit === null) return false;
  return creditUsed > creditLimit;
}

/**
 * Get quality rating description
 */
export function getQualityRatingDescription(rating: number | null): string {
  if (rating === null) return "Not Rated";
  if (rating >= 4.5) return "Excellent";
  if (rating >= 3.5) return "Very Good";
  if (rating >= 2.5) return "Good";
  if (rating >= 1.5) return "Fair";
  return "Poor";
}

/**
 * Get on-time delivery description
 */
export function getOnTimeDeliveryDescription(rate: number | null): string {
  if (rate === null) return "No Data";
  if (rate >= 95) return "Excellent";
  if (rate >= 85) return "Very Good";
  if (rate >= 75) return "Good";
  if (rate >= 60) return "Fair";
  return "Poor";
}
