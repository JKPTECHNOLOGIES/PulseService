/**
 * Direct Issues API Routes
 *
 * POST /api/inventory/direct-issues - Create direct issue (issue parts)
 * GET  /api/inventory/direct-issues - List direct issues with filters
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { createGetHandler, createPostHandler } from "@/lib/api-middleware-v2";
import { success, created, badRequest, serverError } from "@/lib/api-response";
import { directIssueService, type DirectIssueFilterDTO } from "@/services/inventory/direct-issue";
import { directIssueCreateSchema } from "@/services/inventory/direct-issue/direct-issue.types";
import { logger } from "@/lib/logger";
/**
 * POST /api/inventory/direct-issues
 * Issue inventory directly to department/account code
 */
export const POST = createPostHandler(
  directIssueCreateSchema,
  async (_req, context) => {
    const result = await directIssueService.issue(context.serviceContext, context.data);

    if (!result.success) {
      logger.error('[direct-issues POST] issue() failed:', result.errorCode, result.error);
      if (result.errorCode === "INSUFFICIENT_STOCK") {
        return badRequest(result.error ?? "Insufficient stock");
      }
      return serverError(result.error ?? "Failed to create direct issue");
    }

    // Include auto-requisition info in response if created
    const response: Record<string, unknown> = {
      directIssue: result.directIssue,
    };

    if (result.autoCreatedRequisition) {
      response.autoCreatedRequisition = result.autoCreatedRequisition;
      response.message = `Direct issue created successfully. Requisition ${result.autoCreatedRequisition.reqNumber} was auto-created due to low stock.`;
    }

    return created(response);
  }
);

/**
 * GET /api/inventory/direct-issues
 * List direct issues with filtering
 */
export const GET = createGetHandler(async (req, context) => {
  const searchParams = req.nextUrl.searchParams;

  // Build filters
  const filters: DirectIssueFilterDTO = {};
  const inventoryItemId = searchParams.get("inventoryItemId");
  const departmentId = searchParams.get("departmentId");
  const accountCodeId = searchParams.get("accountCodeId");
  const areaId = searchParams.get("areaId");
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (inventoryItemId) filters.inventoryItemId = inventoryItemId;
  if (departmentId) filters.departmentId = departmentId;
  if (accountCodeId) filters.accountCodeId = accountCodeId;
  if (areaId) filters.areaId = areaId;
  if (projectId) filters.projectId = projectId;
  if (status) filters.status = status as DirectIssueFilterDTO["status"];
  if (dateFrom) filters.dateFrom = new Date(dateFrom);
  if (dateTo) filters.dateTo = new Date(dateTo);

  // Get page and pageSize for pagination
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") ?? "50", 10);

  // Use findAll method from base CrudService
  const result = await directIssueService.findAll(context.serviceContext, {
    filters,
    pagination: {
      page,
      limit: pageSize,
    },
  });

  return success(result);
});
