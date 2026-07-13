/**
 * Supplier Address Service Types
 *
 * DTOs, types, and Zod schemas for the SupplierAddress service.
 * These types define the shape of data for supplier address operations.
 */

import { z } from "zod";

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating a supplier address
 */
export const supplierAddressCreateSchema = z.object({
  addressCode: z.string().min(1, "Address code is required").max(10),
  label: z.string().max(200).optional().nullable(),
  address1: z.string().max(200).optional().nullable(),
  address2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  country: z.string().max(100).optional().nullable().default("USA"),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  isMailingAddress: z.boolean().default(false),
  isRemittanceAddress: z.boolean().default(false),
  isShippingAddress: z.boolean().default(false),
  isDefaultMailing: z.boolean().default(false),
  isDefaultRemittance: z.boolean().default(false),
  isDefaultShipping: z.boolean().default(false),
});

/**
 * Schema for updating a supplier address (all fields optional)
 */
export const supplierAddressUpdateSchema = supplierAddressCreateSchema.partial();

/**
 * Schema for the set-default request body
 */
export const setDefaultSchema = z.object({
  type: z.enum(["mailing", "remittance", "shipping"], {
    message: "type must be one of: mailing, remittance, shipping",
  }),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating a supplier address
 */
export type CreateSupplierAddressInput = z.infer<typeof supplierAddressCreateSchema>;

/**
 * DTO for updating a supplier address
 */
export type UpdateSupplierAddressInput = z.infer<typeof supplierAddressUpdateSchema>;

/**
 * DTO for the set-default request body
 */
export type SetDefaultInput = z.infer<typeof setDefaultSchema>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Snapshot of a supplier address for use on a Purchase Order.
 * Contains flattened vendor* fields suitable for embedding on a PO record.
 */
export interface POAddressSnapshot {
  supplierAddressId: string;
  vendorName: string | null;
  vendorAddress1: string | null;
  vendorAddress2: string | null;
  vendorCity: string | null;
  vendorState: string | null;
  vendorZip: string | null;
  vendorCountry: string | null;
}

/**
 * Default address type union
 */
export type AddressDefaultType = "mailing" | "remittance" | "shipping";
