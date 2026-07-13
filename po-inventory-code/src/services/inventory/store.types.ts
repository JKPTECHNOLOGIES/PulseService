/**
 * Store Service Types
 *
 * DTOs, types, and Zod schemas for the Store service.
 * These types define the shape of data for store/warehouse operations.
 */

import { z } from "zod";

// Base types matching Prisma schema
export interface Store {
  id: string;
  name: string;
  code: string;
  locationId: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  description: string | null;
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for creating stores
 */
export const storeCreateSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  code: z.string().min(1, "Store code is required").max(20),
  locationId: z.string().uuid("Invalid location ID").optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

/**
 * Schema for updating stores (all fields optional)
 */
export const storeUpdateSchema = storeCreateSchema.partial();

/**
 * Schema for filtering stores
 */
export const storeFilterSchema = z.object({
  locationId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  search: z.string().optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for creating stores
 */
export type StoreCreateDTO = z.infer<typeof storeCreateSchema>;

/**
 * DTO for updating stores
 */
export type StoreUpdateDTO = z.infer<typeof storeUpdateSchema>;

/**
 * DTO for filtering stores
 */
export type StoreFilterDTO = z.infer<typeof storeFilterSchema>;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Store with location relation
 */
export type StoreWithRelations = Store & {
  location?: Location | null;
  _count?: {
    stock: number;
  };
};

/**
 * Store statistics
 */
export interface StoreStats {
  totalStores: number;
  activeStores: number;
  inactiveStores: number;
  totalInventoryItems: number;
  totalStockValue: number;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate store create data
 */
export function validateStoreCreate(data: unknown): StoreCreateDTO {
  return storeCreateSchema.parse(data);
}

/**
 * Validate store update data
 */
export function validateStoreUpdate(data: unknown): StoreUpdateDTO {
  return storeUpdateSchema.parse(data);
}

/**
 * Validate store filter data
 */
export function validateStoreFilter(data: unknown): StoreFilterDTO {
  return storeFilterSchema.parse(data);
}
