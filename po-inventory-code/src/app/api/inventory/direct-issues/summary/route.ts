/**
 * Direct Issues Summary API Route
 *
 * GET /api/inventory/direct-issues/summary - Get summary report with grouping
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { createGetHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { directIssueService , type DirectIssueSummaryFilterDTO } from "@/services/inventory/direct-issue";
/**
 * GET /api/inventory/direct-issues/summary
 * Get summary report with optional grouping
 */
export const GET = createGetHandler(async (req, context) => {
  const searchParams = req.nextUrl.searchParams;

  // Build filters
  const filters: DirectIssueSummaryFilterDTO = {};
  const departmentId = searchParams.get("departmentId");
  const accountCodeId = searchParams.get("accountCodeId");
  const areaId = searchParams.get("areaId");
  const projectId = searchParams.get("projectId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const groupBy = searchParams.get("groupBy");

  if (departmentId) filters.departmentId = departmentId;
  if (accountCodeId) filters.accountCodeId = accountCodeId;
  if (areaId) filters.areaId = areaId;
  if (projectId) filters.projectId = projectId;
  if (dateFrom) filters.dateFrom = new Date(dateFrom);
  if (dateTo) filters.dateTo = new Date(dateTo);
  if (groupBy)
    filters.groupBy = groupBy as DirectIssueSummaryFilterDTO["groupBy"];

  const result = await directIssueService.getSummary(
    context.serviceContext,
    filters
  );

  return success(result);
});
