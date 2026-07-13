/**
 * API Route: Create Cycle Count from ABC Classification
 *
 * POST /api/inventory/cycle-count/create-from-abc
 *
 * Creates a new cycle count automatically populated with items due for count
 * based on ABC classification criteria.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { created } from "@/lib/api-response";
import { createPostHandler, ApiContextWithData } from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count";
import { ABCClassification } from "@prisma/client";
/**
 * Request body schema for creating cycle count from ABC classification
 */
const createFromABCSchema = z.object({
  storeId: z.string().uuid("Store ID must be a valid UUID"),
  classification: z
    .enum(["A", "B", "C", "D", "UNCLASSIFIED"])
    .optional()
    .describe("Optional: filter by specific ABC classification"),
  overdueDays: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional: only include items overdue by X days"),
  maxItems: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Optional: limit number of items (max 1000)"),
});

type CreateFromABCDTO = z.infer<typeof createFromABCSchema>;

/**
 * POST /api/inventory/cycle-count/create-from-abc
 *
 * Create a new cycle count from ABC classification due items
 *
 * @example
 * ```typescript
 * // Create count for all due items in a store
 * POST /api/inventory/cycle-count/create-from-abc
 * {
 *   "storeId": "store-uuid"
 * }
 *
 * // Create count for specific classification
 * POST /api/inventory/cycle-count/create-from-abc
 * {
 *   "storeId": "store-uuid",
 *   "classification": "A"
 * }
 *
 * // Create count for overdue items only
 * POST /api/inventory/cycle-count/create-from-abc
 * {
 *   "storeId": "store-uuid",
 *   "classification": "A",
 *   "overdueDays": 7,
 *   "maxItems": 100
 * }
 * ```
 */
export const POST = createPostHandler(
  createFromABCSchema,
  async (_req: NextRequest, context: ApiContextWithData<CreateFromABCDTO>) => {
    const userId = context.serviceContext.userId;

    // Create cycle count from ABC classification
    const cycleCount =
      await masterCycleCountService.createFromABCClassification(
        {
          storeId: context.data.storeId,
          classification: context.data.classification as
            | ABCClassification
            | undefined,
          overdueDays: context.data.overdueDays,
          maxItems: context.data.maxItems,
        },
        userId
      );

    return created(
      cycleCount,
      "Cycle count created from ABC classification successfully"
    );
  }
);
