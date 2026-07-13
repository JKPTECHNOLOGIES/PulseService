/**
 * Master Cycle Count API Routes
 *
 * Main CRUD endpoints for cycle count management.
 * GET - List cycle counts with filtering
 * POST - Create new cycle count
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
  parseQueryParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
import {
  createCycleCountSchema,
  CreateCycleCountDTO,
  CycleCountStatus,
} from "@/services/inventory/cycle-count/master-cycle-count.types";

/**
 * Query parameters schema for listing cycle counts
 */
const listQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .default("1")
    .transform((val) => parseInt(val, 10)),
  limit: z
    .string()
    .optional()
    .default("10")
    .transform((val) => parseInt(val, 10)),
  status: z.nativeEnum(CycleCountStatus).optional(),
  storeId: z.string().uuid().optional(),
  createdById: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
});

/**
 * GET /api/inventory/cycle-count
 * List cycle counts with filtering and pagination
 */
export const GET = createApiHandler(
  {},
  async (_req: NextRequest, _context: BaseApiContext) => {
    try {
    // Parse and validate query parameters
    const queryParams = parseQueryParams(_req, listQuerySchema);

    const { page, limit, ...filters } = queryParams;

    // Map createdById to startedBy for service layer
    const serviceFilters = {
      ...filters,
      startedBy: filters.createdById,
    };

    // Call service
    const cycleCounts =
      await masterCycleCountService.listCycleCounts(serviceFilters);

    // Calculate pagination
    const total = cycleCounts.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedData = cycleCounts.slice(startIndex, endIndex);

    return paginated(
      paginatedData,
      { page, limit, total },
      "Cycle counts retrieved successfully"
    );
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/inventory/cycle-count
 * Create a new cycle count
 */
export const POST = createPostHandler(
  createCycleCountSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithData<CreateCycleCountDTO>,
  ) => {
    const userId = context.serviceContext.userId;

    // Call service
    const cycleCount = await masterCycleCountService.createCycleCount(
      context.data,
      userId
    );

    return created(cycleCount, "Cycle count created successfully");
  }
);
