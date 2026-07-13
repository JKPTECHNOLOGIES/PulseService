/**
 * RMA (Return Merchandise Authorization) API Routes
 *
 * GET /api/purchasing/rma - List RMAs with pagination and filtering
 * POST /api/purchasing/rma - Create a new RMA
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
import {
  listRMAs,
  createRMA,
} from "@/services/purchasing/rma/rma.service";
import {
  rmaCreateSchema,
  CreateRMADTO,
} from "@/services/purchasing/rma/rma.types";
import { paginationSchema } from "@/lib/validation";
import { ValidationError, NotFoundError, AuthorizationError, InternalServerError } from "@/lib/api-errors";

/**
 * Query parameters schema for listing RMAs
 */
const listQuerySchema = paginationSchema.merge(
  z.object({
    search: z.string().optional(),
    status: z.string().optional(),
    returnType: z.string().optional(),
    purchaseOrderId: z.string().optional(),
    supplierId: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
);

/**
 * GET /api/purchasing/rma
 * List all RMAs with pagination and filtering
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
    // Parse and validate query parameters
    const url = new URL(req.url);
    const rawParams = {
      page: url.searchParams.get("page") ?? "1",
      limit: url.searchParams.get("limit") ?? "10",
      search: url.searchParams.get("search") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      returnType: url.searchParams.get("returnType") ?? undefined,
      purchaseOrderId: url.searchParams.get("purchaseOrderId") ?? undefined,
      supplierId: url.searchParams.get("supplierId") ?? undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      sortBy: url.searchParams.get("sortBy") ?? undefined,
      sortOrder: url.searchParams.get("sortOrder") ?? undefined,
    };

    const validationResult = listQuerySchema.safeParse(rawParams);

    if (!validationResult.success) {
      const { ValidationError } = await import("@/lib/api-errors");
      throw ValidationError.fromZodError(validationResult.error);
    }

    const {
      page,
      limit,
      search,
      status,
      returnType,
      purchaseOrderId,
      supplierId,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder,
    } = validationResult.data;

    // Build filters
    const filters: Record<string, string> = {};
    if (status) filters.status = status;
    if (returnType) filters.returnType = returnType;
    if (purchaseOrderId) filters.purchaseOrderId = purchaseOrderId;
    if (supplierId) filters.supplierId = supplierId;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    // Call service
    const result = await listRMAs(context.serviceContext, {
      page,
      limit,
      search,
      sortBy: sortBy ?? "createdAt",
      sortOrder: sortOrder ?? "desc",
      ...filters,
    });

    return paginated(
      result.data,
      result.pagination,
      "RMAs retrieved successfully"
    );
  
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthorizationError
      ) {
        throw error;
      }
      
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/purchasing/rma
 * Create a new RMA
 */
export const POST = createPostHandler(
  rmaCreateSchema,
  async (_req: NextRequest, context: ApiContextWithData<CreateRMADTO>) => {
    const rma = await createRMA(context.serviceContext, context.data);
    return created(rma, "RMA created successfully");
  }
);