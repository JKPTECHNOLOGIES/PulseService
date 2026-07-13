/**
 * Individual Inventory Item Supplier API Routes
 *
 * CRUD endpoints for individual supplier relationship operations.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 300; // Cache for 300 seconds

import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createApiHandler,
  createDeleteHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryItemSupplierService } from "@/services/inventory";
import {
  inventoryItemSupplierUpdateSchema,
  InventoryItemSupplierUpdateDTO,
} from "@/services/inventory/inventory-item-supplier.types";
import { NextRequest } from "next/server";
/**
 * Route params type
 */
type RouteParams = {
  id: string;
  supplierId: string;
};

/**
 * GET /api/inventory/items/[id]/suppliers/[supplierId]
 * Get a specific supplier relationship
 */
export const GET = createGetHandlerWithParams<RouteParams>(
  async (_req, context) => {
    const supplier = await inventoryItemSupplierService.getById(
      context.serviceContext,
      context.params.supplierId
    );
    return success(supplier, "Supplier relationship retrieved successfully");
  }
);

/**
 * PATCH /api/inventory/items/[id]/suppliers/[supplierId]
 * Update a supplier relationship
 */
export const PATCH = createApiHandler<
  InventoryItemSupplierUpdateDTO,
  RouteParams
>(
  { bodySchema: inventoryItemSupplierUpdateSchema, hasParams: true },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<
      RouteParams,
      InventoryItemSupplierUpdateDTO
    >,
  ) => {
    const supplier = await inventoryItemSupplierService.update(
      context.serviceContext,
      context.params.supplierId,
      context.data
    );
    return success(supplier, "Supplier relationship updated successfully");
  }
);

/**
 * DELETE /api/inventory/items/[id]/suppliers/[supplierId]
 * Delete a supplier relationship
 */
export const DELETE = createDeleteHandler<RouteParams>(
  async (_req, context) => {
    await inventoryItemSupplierService.delete(
      context.serviceContext,
      context.params.supplierId
    );
    return noContent();
  }
);
