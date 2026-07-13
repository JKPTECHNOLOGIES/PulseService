/**
 * Requisition Submit API Route
 *
 * POST /api/purchasing/requisitions/:id/submit - Submit a requisition for approval
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
 * POST /api/purchasing/requisitions/:id/submit
 * Submit a requisition for approval
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
      const requisition = await requisitionWorkflowService.submit(
        context.serviceContext,
        context.params.id
      );

      return success(requisition, "Requisition submitted successfully");

    } catch (error) {
      if (isApiError(error)) throw error;
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
