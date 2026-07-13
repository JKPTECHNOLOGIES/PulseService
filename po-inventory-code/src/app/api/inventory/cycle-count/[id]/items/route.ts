/**
 * Master Cycle Count Items API Routes
 *
 * Endpoints for managing count items within a cycle count.
 * GET - Get count items with optional filtering
 * POST - Bulk enter counts for multiple items
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
  parseQueryParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
import {
  countItemInputSchema,
  CountItemStatus,
} from "@/services/inventory/cycle-count/master-cycle-count.types";

/**
 * Query parameters schema for filtering count items
 */
const itemsQuerySchema = z.object({
  bin: z.string().optional(),
  status: z.nativeEnum(CountItemStatus).optional(),
});

/**
 * Schema for bulk count entry
 */
const bulkCountSchema = z.object({
  items: z
    .array(
      countItemInputSchema.extend({
        countItemId: z.string().uuid("Invalid item ID"),
      }),
    )
    .min(1, "At least one item is required"),
});

type BulkCountDTO = z.infer<typeof bulkCountSchema>;

/**
 * GET /api/inventory/cycle-count/:id/items
 * Get count items for a cycle count with optional filtering
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
    // Parse query parameters
    const queryParams = parseQueryParams(_req, itemsQuerySchema);

    // Call service
    const items = await masterCycleCountService.getCountItems(
      context.params.id,
      queryParams
    );

    return success(items, "Count items retrieved successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/inventory/cycle-count/:id/items
 * Bulk enter counts for multiple items
 */
export const POST = createApiHandler(
  {
    bodySchema: bulkCountSchema,
    hasParams: true,
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, BulkCountDTO>,
  ) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service with items that already have countItemId
    const items = await masterCycleCountService.bulkEnterCounts(
      context.params.id,
      context.data.items,
      userId
    );

    return success(items, "Counts entered successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
