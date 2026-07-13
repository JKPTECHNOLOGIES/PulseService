/**
 * Inventory Stock Issue API Route
 *
 * Endpoint for issuing stock to work orders.
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory";
import { InternalServerError } from "@/lib/api-errors";
import {
  stockIssueSchema,
  StockIssueDTO,
} from "@/services/inventory/inventory.types";

/**
 * POST /api/inventory/:id/issue
 * Issue stock to a work order
 */
export const POST = createApiHandler(
  {
    bodySchema: stockIssueSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, StockIssueDTO>,
  ) => {
    try {
    // Call service
    const item = await inventoryService.issueStock(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(item, "Stock issued successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
