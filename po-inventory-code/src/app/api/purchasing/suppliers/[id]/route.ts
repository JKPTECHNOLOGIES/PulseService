/**
 * Supplier Detail API Routes
 *
 * GET /api/purchasing/suppliers/:id - Get supplier details
 * PUT /api/purchasing/suppliers/:id - Update supplier
 * DELETE /api/purchasing/suppliers/:id - Delete supplier
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { supplierService } from "@/services/purchasing";
import {
  supplierUpdateSchema,
  SupplierUpdateDTO,
} from "@/services/purchasing/supplier.types";

/**
 * GET /api/purchasing/suppliers/:id
 * Get a single supplier by ID
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const supplier = await supplierService.getById(
      context.serviceContext,
      context.params.id,
      ["purchaseOrders", "inventoryItems"]
    );

    return success(supplier, "Supplier retrieved successfully");
  }
);

/**
 * PUT /api/purchasing/suppliers/:id
 * Update a supplier
 */
export const PUT = createPutHandler(
  supplierUpdateSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, SupplierUpdateDTO>,
  ) => {
    const supplier = await supplierService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(supplier, "Supplier updated successfully");
  }
);

/**
 * DELETE /api/purchasing/suppliers/:id
 * Delete a supplier
 */
export const DELETE = createDeleteHandler(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    await supplierService.delete(context.serviceContext, context.params.id);
    return noContent();
  }
);
