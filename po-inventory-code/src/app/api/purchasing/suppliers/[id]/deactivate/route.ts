/**
 * Supplier Deactivate API Route
 *
 * POST /api/purchasing/suppliers/:id/deactivate - Deactivate a supplier
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { supplierService } from "@/services/purchasing";
import { InternalServerError } from "@/lib/api-errors";
import {
  supplierDeactivateSchema,
  SupplierDeactivateDTO,
} from "@/services/purchasing/supplier.types";

/**
 * POST /api/purchasing/suppliers/:id/deactivate
 * Deactivate a supplier with reason
 */
export const POST = createApiHandler(
  { hasParams: true, bodySchema: supplierDeactivateSchema },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, SupplierDeactivateDTO>,
  ) => {
    try {
    const supplier = await supplierService.deactivate(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(supplier, "Supplier deactivated successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
