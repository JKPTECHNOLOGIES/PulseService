/**
 * Inventory Item Direct Issues API Route
 *
 * GET /api/inventory/items/[id]/direct-issues - Get all direct issues for an inventory item
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { createGetHandlerWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { directIssueService , type DirectIssueFilterDTO } from "@/services/inventory/direct-issue";
/**
 * GET /api/inventory/items/[id]/direct-issues
 * Get all direct issues for an inventory item
 */
export const GET = createGetHandlerWithParams(async (req, context) => {
  const searchParams = req.nextUrl.searchParams;

  // Build filters
  const filters: DirectIssueFilterDTO = {};
  const status = searchParams.get("status");
  const departmentId = searchParams.get("departmentId");
  const accountCodeId = searchParams.get("accountCodeId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (status) filters.status = status as DirectIssueFilterDTO["status"];
  if (departmentId) filters.departmentId = departmentId;
  if (accountCodeId) filters.accountCodeId = accountCodeId;
  if (dateFrom) filters.dateFrom = new Date(dateFrom);
  if (dateTo) filters.dateTo = new Date(dateTo);

  const result = await directIssueService.getByInventoryItem(
    context.serviceContext,
    context.params.id,
    filters
  );

  return success(result);
});
