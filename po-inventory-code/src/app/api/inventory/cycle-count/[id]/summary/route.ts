/**
 * Master Cycle Count Summary API Route
 *
 * Endpoint for retrieving cycle count summary statistics.
 * GET - Get summary statistics
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
/**
 * GET /api/inventory/cycle-count/:id/summary
 * Get cycle count summary statistics
 *
 * Returns comprehensive statistics including:
 * - Total items, items counted, items pending
 * - Items with variance
 * - Total variance value
 * - Average variance percentage
 * - Count progress percentage
 * - Progress by bin
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    // Call service
    const summary = await masterCycleCountService.getCycleCountSummary(
      context.params.id
    );

    return success(summary, "Cycle count summary retrieved successfully");
  }
);
