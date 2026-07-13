/**
 * Supplier Activate API Route
 *
 * POST /api/purchasing/suppliers/:id/activate - Activate a supplier
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { supplierService } from "@/services/purchasing";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/suppliers/:id/activate
 * Activate a supplier
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
    const supplier = await supplierService.activate(
      context.serviceContext,
      context.params.id
    );

    return success(supplier, "Supplier activated successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
