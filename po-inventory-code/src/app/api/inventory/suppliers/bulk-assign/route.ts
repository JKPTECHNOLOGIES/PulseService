/**
 * Bulk Supplier Assignment API Route
 *
 * Endpoint for assigning a supplier to multiple inventory items at once.
 */

import { success } from "@/lib/api-response";
import { createPostHandler } from "@/lib/api-middleware-v2";
import { inventoryItemSupplierService } from "@/services/inventory";
import { bulkSupplierAssignmentSchema } from "@/services/inventory/inventory-item-supplier.types";
/**
 * POST /api/inventory/suppliers/bulk-assign
 * Assign a supplier to multiple inventory items
 */
export const POST = createPostHandler(
  bulkSupplierAssignmentSchema,
  async (_req, context) => {
    const result = await inventoryItemSupplierService.bulkAssignSupplier(
      context.serviceContext,
      context.data
    );

    return success(
      result,
      `Successfully assigned supplier to ${result.created} item(s)${result.errors.length > 0 ? ` with ${result.errors.length} error(s)` : ""}`
    );
  }
);
