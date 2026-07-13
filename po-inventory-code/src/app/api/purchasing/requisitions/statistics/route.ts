/**
 * Requisition Statistics API Route
 *
 * GET /api/purchasing/requisitions/statistics - Get comprehensive requisition statistics
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success } from "@/lib/api-response";
import { createGetHandler } from "@/lib/api-middleware-v2";
import { requisitionStatisticsService } from "@/services/purchasing/requisition";
/**
 * GET /api/purchasing/requisitions/statistics
 * Get comprehensive requisition statistics
 */
export const GET = createGetHandler(async (req, context) => {
  const url = new URL(req.url);

  const startDateParam = url.searchParams.get("startDate");
  const endDateParam = url.searchParams.get("endDate");
  const requestorIdParam = url.searchParams.get("requestorId");
  const departmentIdParam = url.searchParams.get("departmentId");

  const filters = {
    startDate: startDateParam ? new Date(startDateParam) : undefined,
    endDate: endDateParam ? new Date(endDateParam) : undefined,
    requestorId: requestorIdParam ?? undefined,
    departmentId: departmentIdParam ?? undefined,
  };

  const stats = await requisitionStatisticsService.getStatistics(
    context.serviceContext,
    filters
  );

  return success(stats, "Requisition statistics retrieved successfully");
});
