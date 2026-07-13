/**
 * Supplier Addresses API Routes
 *
 * GET  /api/purchasing/suppliers/:id/addresses - List all addresses for a supplier
 * POST /api/purchasing/suppliers/:id/addresses - Create a new address for a supplier
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success, created } from "@/lib/api-response";
import { supplierAddressService } from "@/services/purchasing/supplier-address.service";
import {
  supplierAddressCreateSchema,
  type CreateSupplierAddressInput,
} from "@/services/purchasing/supplier-address.types";

/**
 * GET /api/purchasing/suppliers/:id/addresses
 * List all addresses for a supplier
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const addresses = await supplierAddressService.getBySupplier(
      context.params.id,
    );

    return success(addresses, "Supplier addresses retrieved successfully");
  },
);

/**
 * POST /api/purchasing/suppliers/:id/addresses
 * Create a new address for a supplier
 */
export const POST = createApiHandler<CreateSupplierAddressInput>(
  { hasParams: true, bodySchema: supplierAddressCreateSchema },
  async (_req: NextRequest, context) => {
    const address = await supplierAddressService.create(
      context.params.id,
      context.data,
    );

    return created(address, "Supplier address created successfully");
  },
);
