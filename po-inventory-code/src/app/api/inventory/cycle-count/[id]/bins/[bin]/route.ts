/**
 * Master Cycle Count Bin Items API Route
 *
 * GET - Get items for a specific bin
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
  parseQueryParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { CountItemStatus } from "@/services/inventory/cycle-count/master-cycle-count.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Params type for this route
 */
type BinRouteParams = {
  id: string;
  bin: string;
};

/**
 * Query parameters schema
 */
const querySchema = z.object({
  status: z.nativeEnum(CountItemStatus).optional(),
});

/**
 * GET /api/inventory/cycle-count/[id]/bins/[bin]
 * Get all items for a specific bin in this cycle count
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams<BinRouteParams>) => {
    try {
    const { id, bin } = await context.params;
    const queryParams = parseQueryParams(_req, querySchema);

    // Get items filtered by bin
    const items = await masterCycleCountService.getCountItems(id, {
      bin: decodeURIComponent(bin),
      status: queryParams.status,
    });

    return success(items, `Items for bin ${bin} retrieved successfully`);
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
