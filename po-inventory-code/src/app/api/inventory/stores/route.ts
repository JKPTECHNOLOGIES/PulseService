/**
 * Store API Routes
 *
 * Main CRUD endpoints for store/warehouse management.
 * Uses the store service layer for business logic.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { paginated, created } from "@/lib/api-response";
import { createApiHandler, createPostHandler } from "@/lib/api-middleware-v2";
import { storeService } from "@/services/inventory/store.service";
import {
  storeCreateSchema,
  StoreCreateDTO,
} from "@/services/inventory/store.types";
import { paginationSchema } from "@/lib/validation";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema for listing stores
 */
const listQuerySchema = paginationSchema.merge(
  z.object({
    locationId: z.string().min(1).optional(),
    isActive: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    search: z.string().optional(),
  })
);

/**
 * GET /api/inventory/stores
 * List all stores with pagination, filtering, and search
 */
export const GET = createApiHandler({}, async (req: NextRequest, context) => {
    try {
  // Parse and validate query parameters
  const { searchParams } = new URL(req.url);
  const queryParams = Object.fromEntries(searchParams.entries());
  const validatedQuery = listQuerySchema.parse(queryParams);

  const { page, limit, search, locationId, isActive } = validatedQuery;

  // Build filters
  const filters: Record<string, string | boolean> = {};
  if (locationId) filters.locationId = locationId;
  if (isActive !== undefined) filters.isActive = isActive;

  // Call service
  const result = await storeService.findAll(context.serviceContext, {
    pagination: { page, limit },
    filters,
    search,
    searchFields: ["name", "code", "description"],
  });

  return paginated(
    result.data,
    result.pagination,
    "Stores retrieved successfully"
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
 * POST /api/inventory/stores
 * Create a new store
 */
export const POST = createPostHandler<StoreCreateDTO>(
  storeCreateSchema,
  async (_req, context) => {
    const store = await storeService.create(
      context.serviceContext,
      context.data
    );
    return created(store, "Store created successfully");
  }
);
