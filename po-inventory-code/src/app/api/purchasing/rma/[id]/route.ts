/**
 * RMA Detail API Routes
 *
 * Individual RMA CRUD endpoints.
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
import {
  getRMAById,
  updateRMA,
  deleteRMA,
} from "@/services/purchasing/rma/rma.service";
import { rmaUpdateSchema } from "@/services/purchasing/rma/rma.types";
/**
 * GET /api/purchasing/rma/[id]
 * Get a single RMA by ID
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  const rma = await getRMAById(context.serviceContext, context.params.id);

  return success(rma, "RMA retrieved successfully");
});

/**
 * PUT /api/purchasing/rma/[id]
 * Update an RMA (only in DRAFT status)
 */
export const PUT = createPutHandler(rmaUpdateSchema, async (_req, context) => {
  const rma = await updateRMA(
    context.serviceContext,
    context.params.id,
    context.data
  );

  return success(rma, "RMA updated successfully");
});

/**
 * DELETE /api/purchasing/rma/[id]
 * Delete an RMA (only in DRAFT status)
 */
export const DELETE = createDeleteHandler(async (_req, context) => {
  await deleteRMA(context.serviceContext, context.params.id);

  return noContent();
});