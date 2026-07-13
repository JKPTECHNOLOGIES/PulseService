/**
 * Supplier Address Detail API Routes
 *
 * GET    /api/purchasing/suppliers/:id/addresses/:addressId - Get a single address
 * PUT    /api/purchasing/suppliers/:id/addresses/:addressId - Update an address
 * DELETE /api/purchasing/suppliers/:id/addresses/:addressId - Delete an address
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { success, noContent } from "@/lib/api-response";
import { supplierAddressService } from "@/services/purchasing/supplier-address.service";
import {
  supplierAddressUpdateSchema,
  type UpdateSupplierAddressInput,
} from "@/services/purchasing/supplier-address.types";

/** Route params for this nested endpoint */
type RouteParams = { id: string; addressId: string };

/**
 * GET /api/purchasing/suppliers/:id/addresses/:addressId
 * Get a single supplier address
 */
export const GET = createGetHandlerWithParams<RouteParams>(
  async (_req: NextRequest, context: ApiContextWithParams<RouteParams>) => {
    const address = await supplierAddressService.getById(
      context.params.addressId,
    );

    return success(address, "Supplier address retrieved successfully");
  },
);

/**
 * PUT /api/purchasing/suppliers/:id/addresses/:addressId
 * Update a supplier address
 */
export const PUT = createPutHandler<UpdateSupplierAddressInput, RouteParams>(
  supplierAddressUpdateSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<RouteParams, UpdateSupplierAddressInput>,
  ) => {
    const address = await supplierAddressService.update(
      context.params.addressId,
      context.data,
    );

    return success(address, "Supplier address updated successfully");
  },
);

/**
 * DELETE /api/purchasing/suppliers/:id/addresses/:addressId
 * Delete a supplier address
 */
export const DELETE = createDeleteHandler<RouteParams>(
  async (_req: NextRequest, context: ApiContextWithParams<RouteParams>) => {
    await supplierAddressService.delete(context.params.addressId);
    return noContent();
  },
);
