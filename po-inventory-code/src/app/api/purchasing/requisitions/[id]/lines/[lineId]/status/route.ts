/**
 * API Route: Update Requisition Line Status
 * PUT /api/purchasing/requisitions/[id]/lines/[lineId]/status
 */

import { NextRequest } from "next/server";
import { createApiHandler, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import {
  updateLineStatus,
  validateStatusTransition,
} from "@/services/purchasing/requisition/line-status.service";
import {
  validateUpdateLineStatus,
  RequisitionLineStatus,
} from "@/services/purchasing/requisition/requisition.types";
import { ValidationError, InternalServerError, isApiError } from "@/lib/api-errors";

export const PUT = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
    const { lineId } = context.params as { id: string; lineId: string };

    // Parse and validate request body
    const body = await request.json() as Record<string, unknown>;
    const validatedData = validateUpdateLineStatus({
      ...body,
      lineId,
      updatedBy: context.serviceContext.userId,
    });

    // Update line status
    const updatedLine = await updateLineStatus({
      ...validatedData,
      reason: validatedData.reason ?? undefined,
    });

    return success(updatedLine, `Line status updated to ${validatedData.newStatus}`);
  
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * API Route: Validate Line Status Transition
 * POST /api/purchasing/requisitions/[id]/lines/[lineId]/status/validate
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, _context: ApiContextWithParams) => {
    try {
      // Parse request body
      const body = await request.json() as Record<string, unknown>;
      const currentStatus = body.currentStatus as string | undefined;
      const newStatus = body.newStatus as string | undefined;

      if (!currentStatus || !newStatus) {
        throw new ValidationError("currentStatus and newStatus are required");
      }

      // Validate transition
      const validation = validateStatusTransition(
        currentStatus as RequisitionLineStatus,
        newStatus as RequisitionLineStatus
      );

      return success(validation);

    } catch (error) {
      if (isApiError(error)) throw error;
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
