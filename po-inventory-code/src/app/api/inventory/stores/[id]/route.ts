/**
 * Store Detail API Routes
 *
 * Individual store CRUD endpoints (GET, PUT, DELETE).
 * Uses the store service layer for business logic.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
} from "@/lib/api-middleware-v2";
import { storeService } from "@/services/inventory/store.service";
import {
  storeUpdateSchema,
  StoreUpdateDTO,
} from "@/services/inventory/store.types";

/**
 * GET /api/inventory/stores/:id
 * Get a single store by ID
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  const store = await storeService.findById(
    context.serviceContext,
    context.params.id
  );
  return success(store, "Store retrieved successfully");
});

/**
 * PUT /api/inventory/stores/:id
 * Update a store
 */
export const PUT = createPutHandler<StoreUpdateDTO>(
  storeUpdateSchema,
  async (_req, context) => {
    const store = await storeService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );
    return success(store, "Store updated successfully");
  }
);

/**
 * DELETE /api/inventory/stores/:id
 * Delete a store
 */
export const DELETE = createDeleteHandler(async (_req, context) => {
  await storeService.delete(context.serviceContext, context.params.id);
  return noContent();
});
