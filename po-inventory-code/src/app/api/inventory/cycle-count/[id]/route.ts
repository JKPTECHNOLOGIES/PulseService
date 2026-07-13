/**
 * Master Cycle Count Single Resource API Routes
 *
 * Endpoints for individual cycle count operations.
 * GET - Get single cycle count with full details
 * PATCH - Update cycle count header information
 * DELETE - Cancel cycle count
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createApiHandler,
  createDeleteHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
import {
  updateCycleCountSchema,
} from "@/services/inventory/cycle-count/master-cycle-count.types";

/**
 * GET /api/inventory/cycle-count/:id
 * Get a single cycle count with full details including all items
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  // Call service
  const cycleCount = await masterCycleCountService.getCycleCount(
    context.params.id
  );

  return success(cycleCount, "Cycle count retrieved successfully");
});

/**
 * PATCH /api/inventory/cycle-count/:id
 * Update cycle count header information (only allowed when IN_PROGRESS)
 */
export const PATCH = createApiHandler(
  {
    bodySchema: updateCycleCountSchema,
    hasParams: true,
  },
  async (_req, context) => {
    try {
    const userId = context.serviceContext.userId;

    // Call service
    const cycleCount = await masterCycleCountService.updateCycleCount(
      context.params.id,
      context.data,
      userId
    );

    return success(cycleCount, "Cycle count updated successfully");
  
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
 * DELETE /api/inventory/cycle-count/:id
 * Cancel a cycle count (sets status to CANCELLED)
 */
export const DELETE = createDeleteHandler(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const userId = context.serviceContext.userId;

    // Call service
    await masterCycleCountService.deleteCycleCount(context.params.id, userId);

    return noContent();
  }
);
