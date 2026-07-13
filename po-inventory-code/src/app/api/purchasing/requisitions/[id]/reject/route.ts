/**
 * Requisition Reject API Route
 *
 * POST /api/purchasing/requisitions/:id/reject - Reject a requisition
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { requisitionWorkflowService, requisitionRejectSchema, RequisitionRejectDTO } from "@/services/purchasing/requisition";
import { InternalServerError, isApiError } from "@/lib/api-errors";

/**
 * POST /api/purchasing/requisitions/:id/reject
 * Reject a requisition with reason
 */
export const POST = createApiHandler(
  { hasParams: true, bodySchema: requisitionRejectSchema },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, RequisitionRejectDTO>,
  ) => {
    try {
      const requisition = await requisitionWorkflowService.reject(
        context.serviceContext,
        context.params.id,
        context.data
      );

      return success(requisition, "Requisition rejected successfully");

    } catch (error) {
      if (isApiError(error)) throw error;
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
