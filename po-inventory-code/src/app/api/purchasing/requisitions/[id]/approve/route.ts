/**
 * Requisition Approve API Route
 *
 * POST /api/purchasing/requisitions/:id/approve - Approve a requisition
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { requisitionWorkflowService } from "@/services/purchasing/requisition";
import { InternalServerError, isApiError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/requisitions/:id/approve
 * Approve a requisition
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
      const requisition = await requisitionWorkflowService.approve(
        context.serviceContext,
        context.params.id
      );

      return success(requisition, "Requisition approved successfully");

    } catch (error) {
      // Re-throw known API errors (ForbiddenError, BadRequestError, NotFoundError, etc.)
      // so the middleware returns the correct HTTP status code and the client gets
      // a meaningful error message (e.g. "You do not have permission to approve purchasing").
      if (isApiError(error)) throw error;
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
