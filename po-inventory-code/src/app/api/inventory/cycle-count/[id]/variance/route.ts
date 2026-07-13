/**
 * Master Cycle Count Variance Report API Route
 *
 * Endpoint for retrieving detailed variance report.
 * GET - Get variance report
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
 * GET /api/inventory/cycle-count/:id/variance
 * Get detailed variance report
 *
 * Returns comprehensive variance analysis including:
 * - Cycle count summary
 * - Overall variance statistics
 * - Detailed variance list for each item
 * - Variance grouped by bin
 * - Variance grouped by category
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    // Call service
    const report = await masterCycleCountService.getVarianceReport(
      context.params.id
    );

    return success(report, "Variance report retrieved successfully");
  }
);
