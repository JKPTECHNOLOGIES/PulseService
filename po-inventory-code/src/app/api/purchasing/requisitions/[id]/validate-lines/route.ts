/**
 * API Route: Validate Line Selection for PO Conversion
 * POST /api/purchasing/requisitions/[id]/validate-lines
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createApiHandler, createGetHandlerWithParams, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import {
  validateLineSelection,
  getConversionSummary,
} from "@/services/purchasing/requisition/partial-po-conversion.service";
import { ValidationError, InternalServerError, isApiError } from "@/lib/api-errors";

/**
 * Validate selected lines for PO conversion
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, _context: ApiContextWithParams) => {
    try {
    // Parse request body
    const body: unknown = await request.json();
    const bodyRecord = body as Record<string, unknown>;
    const { lineIds } = bodyRecord;

    if (!lineIds || !Array.isArray(lineIds) || lineIds.length === 0) {
      throw new ValidationError("lineIds array is required and must not be empty");
    }

    // Validate all elements are strings
    const stringLineIds = lineIds.filter((id): id is string => typeof id === "string");
    if (stringLineIds.length !== lineIds.length) {
      throw new ValidationError("All lineIds must be strings");
    }

    // Validate line selection
    const validation = await validateLineSelection(stringLineIds);

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

/**
 * Get conversion summary for requisition
 */
export const GET = createGetHandlerWithParams(
  async (_request: NextRequest, context: ApiContextWithParams) => {
    const { id } = context.params;

    // Get conversion summary
    const summary = await getConversionSummary(id);

    return success(summary);
  }
);
