/**
 * Requisitions API Routes
 *
 * GET /api/purchasing/requisitions - List requisitions
 * POST /api/purchasing/requisitions - Create requisition
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { created, paginated } from "@/lib/api-response";
import {
  createApiHandler,
  createPostHandler,
  BaseApiContext,
  ApiContextWithData,
} from "@/lib/api-middleware-v2";
import { requisitionService, requisitionCreateSchema, type RequisitionCreateDTO } from "@/services/purchasing/requisition";
import { paginationSchema } from "@/lib/validation";
import { InternalServerError, isApiError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
/**
 * Query parameters schema for listing requisitions
 */
const listQuerySchema = paginationSchema.merge(
  z.object({
    search: z.string().optional(),
    status: z.string().optional(),
    requestedById: z.string().optional(),
    supplierId: z.string().optional(),
    priority: z.string().optional(),
    excludeCancelled: z.string().optional(), // "true" or "false"
    activeOnly: z.string().optional(), // "true" or "false"
    // Budget header filters
    budgetType: z
      .enum(["CHARGE_TO_ACCOUNT", "CHARGE_TO_WORK_ORDER", "CHARGE_TO_PROJECT", "ADD_TO_REORDER"])
      .optional(),
    accountCodeId: z.string().optional(),
    workOrderId: z.string().optional(),
    projectId: z.string().optional(),
    budgetNotes: z.string().optional(),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).optional(),
    /** Filter by assigned Purchasing Manager. Only relevant when buyerAssignmentEnabled = true. */
    assignedBuyerId: z.string().optional(),
  })
);

/**
 * GET /api/purchasing/requisitions
 * List all requisitions with pagination and filtering
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
    // Parse and validate query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const validatedQuery = listQuerySchema.parse(queryParams);

    const {
      page,
      limit,
      search,
      status,
      requestedById,
      supplierId,
      priority,
      excludeCancelled,
      activeOnly,
      budgetType,
      accountCodeId,
      workOrderId,
      projectId,
      budgetNotes,
      sort,
      order,
      assignedBuyerId,
    } = validatedQuery;

    // Build filters
    const filters: Record<string, string | boolean> = {};
    if (status) filters.status = status;
    if (requestedById) filters.requestedById = requestedById;
    if (supplierId) filters.supplierId = supplierId;
    if (priority) filters.priority = priority;
    if (excludeCancelled !== undefined) {
      filters.excludeCancelled = excludeCancelled === 'true';
    }
    if (activeOnly !== undefined) {
      filters.activeOnly = activeOnly === 'true';
    }
    if (budgetType) filters.budgetType = budgetType;
    if (accountCodeId) filters.accountCodeId = accountCodeId;
    if (workOrderId) filters.workOrderId = workOrderId;
    if (projectId) filters.projectId = projectId;
    if (budgetNotes) filters.budgetNotes = budgetNotes;
    if (assignedBuyerId) filters.assignedBuyerId = assignedBuyerId;

    // Call service
    const result = await requisitionService.list(context.serviceContext, {
      page,
      limit,
      filters,
      search,
      sort: sort ?? "createdAt",
      order: order ?? "desc",
      include: ["lines", "requestedBy", "budgetHeader"],
    });

    // Batch-fetch PO statuses for requisitions that have a purchaseOrderId
    const poIds = result.data
      .map((r) => r.purchaseOrderId)
      .filter((id): id is string => !!id);

    let poStatusMap: Record<string, string> = {};
    if (poIds.length > 0) {
      const pos = await prisma.purchaseOrder.findMany({
        where: { id: { in: poIds } },
        select: { id: true, status: true },
      });
      poStatusMap = Object.fromEntries(pos.map((po) => [po.id, po.status]));
    }

    // Attach poStatus to each requisition
    const dataWithPoStatus = result.data.map((r) => ({
      ...r,
      poStatus: r.purchaseOrderId ? (poStatusMap[r.purchaseOrderId] ?? null) : null,
    }));

    return paginated(
      dataWithPoStatus,
      result.pagination,
      "Requisitions retrieved successfully"
    );
  
    } catch (error) {
      if (isApiError(error)) {
        throw error; // Preserve AuthorizationError, NotFoundError, ValidationError, etc.
      }
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/purchasing/requisitions
 * Create a new requisition
 */
export const POST = createPostHandler(
  requisitionCreateSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithData<RequisitionCreateDTO>,
  ) => {
    // Always override requestedById with the authenticated user's ID from the session.
    // This prevents client-side spoofing and fixes the bug where 89% of reqs
    // were attributed to admin@crn.com because the dialog sent an empty/wrong UUID.
    const requisition = await requisitionService.create(
      context.serviceContext,
      {
        ...context.data,
        requestedById: context.serviceContext.userId,
      }
    );
    return created(requisition, "Requisition created successfully");
  }
);
