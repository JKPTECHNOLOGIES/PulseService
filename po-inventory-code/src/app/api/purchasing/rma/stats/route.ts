/**
 * RMA Statistics API Route
 *
 * GET /api/purchasing/rma/stats - Get RMA statistics
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { getRMAStats } from "@/services/purchasing/rma/rma.service";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/purchasing/rma/stats
 * Get RMA statistics with optional filters
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
      const url = new URL(req.url);
      const startDate = url.searchParams.get("startDate");
      const endDate = url.searchParams.get("endDate");
      const supplierId = url.searchParams.get("supplierId");

      const filters: {
        startDate?: Date;
        endDate?: Date;
        supplierId?: string;
      } = {};

      if (startDate) {
        const d = new Date(startDate);
        d.setHours(0, 0, 0, 0);
        filters.startDate = d;
      }
      if (endDate) {
        const d = new Date(endDate);
        d.setHours(23, 59, 59, 999);
        filters.endDate = d;
      }
      if (supplierId) filters.supplierId = supplierId;

      const stats = await getRMAStats(context.serviceContext, filters);

      return success(stats, "RMA statistics retrieved successfully");
    } catch (error) {
      // Handle unexpected errors
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
