/**
 * Inventory Bulk Operations API
 *
 * Handles bulk operations on inventory items (delete, status change, etc.)
 */

import { success } from "@/lib/api-response";
import { createPostHandler } from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory/inventory.service";
import { BadRequestError } from "@/lib/api-errors";
import { z } from "zod";

const bulkOperationSchema = z.object({
  action: z.enum(["delete", "updateStatus"]),
  ids: z.array(z.string()).min(1),
  data: z
    .object({
      isActive: z.boolean().optional(),
    })
    .optional(),
});

type BulkOperationDTO = z.infer<typeof bulkOperationSchema>;

/**
 * POST /api/inventory/bulk
 * Perform bulk operations on inventory items
 */
export const POST = createPostHandler<BulkOperationDTO>(
  bulkOperationSchema,
  async (_req, context) => {
    const { action, ids, data } = context.data;

    let successCount = 0;
    let failureCount = 0;
    const errors: Array<{ id: string; error: string }> = [];

    // Process each inventory item
    for (const id of ids) {
      try {
        switch (action) {
          case "delete":
            await inventoryService.delete(context.serviceContext, id);
            successCount++;
            break;

          case "updateStatus":
            if (data?.isActive === undefined) {
              throw new BadRequestError("Status is required");
            }
            await inventoryService.update(context.serviceContext, id, {
              isActive: data.isActive,
            });
            successCount++;
            break;

          default:
            throw new BadRequestError(`Unknown action: ${action}`);
        }
      } catch (error: unknown) {
        failureCount++;
        errors.push({
          id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return success({
      action,
      totalCount: ids.length,
      successCount,
      failureCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  }
);
