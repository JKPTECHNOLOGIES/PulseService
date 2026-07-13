/**
 * Inventory Archive API Routes
 *
 * POST /api/inventory/:id/archive   - Archive an inventory item (requires zero stock)
 * DELETE /api/inventory/:id/archive - Unarchive an inventory item
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  createDeleteHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory";

/**
 * POST /api/inventory/:id/archive
 * Archive an inventory item - only allowed when total stock is 0
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const item = await inventoryService.archive(
      context.serviceContext,
      context.params.id
    );
    return success(item, "Inventory item archived successfully");
  }
);

/**
 * DELETE /api/inventory/:id/archive
 * Unarchive an inventory item (restore to active)
 */
export const DELETE = createDeleteHandler(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const item = await inventoryService.unarchive(
      context.serviceContext,
      context.params.id
    );
    return success(item, "Inventory item unarchived successfully");
  }
);
