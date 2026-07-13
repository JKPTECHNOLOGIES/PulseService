/**
 * Direct Issue Detail API Routes
 *
 * GET    /api/inventory/direct-issues/[id] - Get direct issue details
 * PUT    /api/inventory/direct-issues/[id] - Update direct issue (notes only)
 * DELETE /api/inventory/direct-issues/[id] - Cancel direct issue
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
} from "@/lib/api-middleware-v2";
import { success, noContent } from "@/lib/api-response";
import { directIssueService } from "@/services/inventory/direct-issue";
import { directIssueUpdateSchema } from "@/services/inventory/direct-issue/direct-issue.types";
/**
 * GET /api/inventory/direct-issues/[id]
 * Get direct issue details
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  const result = await directIssueService.findById(
    context.serviceContext,
    context.params.id
  );

  return success(result);
});

/**
 * PUT /api/inventory/direct-issues/[id]
 * Update direct issue (notes/purpose only)
 */
export const PUT = createPutHandler(
  directIssueUpdateSchema,
  async (_req, context) => {
    const result = await directIssueService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(result);
  }
);

/**
 * DELETE /api/inventory/direct-issues/[id]
 * Cancel direct issue (only if no returns)
 */
export const DELETE = createDeleteHandler(async (_req, context) => {
  await directIssueService.delete(context.serviceContext, context.params.id);

  return noContent();
});
