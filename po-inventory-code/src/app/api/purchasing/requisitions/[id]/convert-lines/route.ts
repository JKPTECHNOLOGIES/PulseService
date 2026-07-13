/**
 * API Route: Convert Selected Requisition Lines to PO
 * POST /api/purchasing/requisitions/[id]/convert-lines
 */

import { NextRequest } from "next/server";
import {
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { convertLinesToPO } from "@/services/purchasing/requisition/partial-po-conversion.service";
import { validateConvertLinesToPO } from "@/services/purchasing/requisition/requisition.types";
import { InternalServerError, isApiError } from "@/lib/api-errors";
/**
 * Permission: purchase_orders:create (dedicated PO-creation permission)
 * Roles with this permission: Finance Manager, Purchasing Manager, Admin
 */
export const POST = createApiHandler(
  {
    hasParams: true,
    permission: "purchase_orders:create",
  },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
      const { id } = context.params;

      // Parse and validate request body
      const body = (await request.json()) as Record<string, unknown>;
      const validatedData = validateConvertLinesToPO({
        ...body,
        requisitionId: id,
        convertedBy: context.serviceContext.userId,
        convertedByName:
          context.serviceContext.userName || context.serviceContext.userEmail,
      });

      // Convert lines to PO
      const result = await convertLinesToPO({
        ...validatedData,
        notes: validatedData.notes ?? undefined,
      });

      return success(result, result.message);
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new InternalServerError(
        "An error occurred while processing your request",
        {
          suggestion:
            "Please try again. If the problem persists, contact support.",
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
);
