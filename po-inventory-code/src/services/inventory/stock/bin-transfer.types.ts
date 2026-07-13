/**
 * Bin Transfer Types
 *
 * Type definitions for multi-bin inventory management.
 * Supports transferring inventory between bins within the same store.
 */

import { z } from "zod";
import { ServiceContext } from "@/types/service-types";

/**
 * Base schema fields (without refinements)
 */
const baseBinTransferFields = {
  storeId: z.string().uuid("Invalid store ID"),
  fromBin: z.string().min(1, "Source bin is required").max(50),
  toBin: z.string().min(1, "Destination bin is required").max(50),
  quantity: z.number().positive("Quantity must be positive"),
  notes: z.string().max(1000).optional().nullable(),
};

/**
 * Schema for bin transfer request body (inventoryItemId comes from URL path)
 */
export const binTransferRequestSchema = z
  .object(baseBinTransferFields)
  .refine((data) => data.fromBin !== data.toBin, {
    message: "Source and destination bins must be different",
    path: ["toBin"],
  });

/**
 * Schema for complete bin transfer data (including inventoryItemId)
 */
export const binTransferSchema = z
  .object({
    ...baseBinTransferFields,
    inventoryItemId: z.string().uuid("Invalid inventory item ID"),
  })
  .refine((data) => data.fromBin !== data.toBin, {
    message: "Source and destination bins must be different",
    path: ["toBin"],
  });

/**
 * DTO for bin transfer request (from API body)
 */
export type BinTransferRequestDTO = z.infer<typeof binTransferRequestSchema>;

/**
 * DTO for complete bin transfer operations
 */
export type BinTransferDTO = z.infer<typeof binTransferSchema>;

/**
 * Options for bin transfer operations
 */
export interface BinTransferOptions {
  /**
   * Service context with user information
   */
  context: ServiceContext;

  /**
   * Inventory item ID
   */
  inventoryItemId: string;

  /**
   * Store ID (transfers are within same store)
   */
  storeId: string;

  /**
   * Source bin location
   */
  fromBin: string;

  /**
   * Destination bin location
   */
  toBin: string;

  /**
   * Quantity to transfer
   */
  quantity: number;

  /**
   * User ID performing the transfer
   */
  userId: string;

  /**
   * User name performing the transfer
   */
  userName: string;

  /**
   * Additional notes
   */
  notes?: string;
}

/**
 * Result of bin transfer operation
 */
export interface BinTransferResult {
  /**
   * Whether the operation succeeded
   */
  success: boolean;

  /**
   * Source bin stock after transfer
   */
  sourceBinStock?: {
    bin: string;
    quantityOnHand: number;
    quantityReserved: number;
    available: number;
  };

  /**
   * Destination bin stock after transfer
   */
  destinationBinStock?: {
    bin: string;
    quantityOnHand: number;
    quantityReserved: number;
    available: number;
  };

  /**
   * Error message if operation failed
   */
  error?: string;

  /**
   * Error code for programmatic handling
   */
  errorCode?: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Bin stock information
 */
export interface BinStock {
  /**
   * Stock record ID (for direct updates like rename)
   */
  stockId?: string;

  /**
   * Bin location identifier
   */
  bin: string;

  /**
   * Quantity on hand in this bin
   */
  quantityOnHand: number;

  /**
   * Quantity reserved in this bin
   */
  quantityReserved: number;

  /**
   * Available quantity (onHand - reserved)
   */
  available: number;

  /**
   * Store ID
   */
  storeId: string;

  /**
   * Store name
   */
  storeName: string;
}

/**
 * Multi-bin stock summary
 */
export interface MultiBinStockSummary {
  /**
   * Inventory item ID
   */
  inventoryItemId: string;

  /**
   * Store ID
   */
  storeId: string;

  /**
   * Store name
   */
  storeName: string;

  /**
   * Total on-hand across all bins in this store
   */
  totalOnHand: number;

  /**
   * Total reserved across all bins in this store
   */
  totalReserved: number;

  /**
   * Total available across all bins in this store
   */
  totalAvailable: number;

  /**
   * Breakdown by bin
   */
  bins: BinStock[];
}

/**
 * Validate bin transfer data
 */
export function validateBinTransfer(data: unknown): BinTransferDTO {
  return binTransferSchema.parse(data);
}
