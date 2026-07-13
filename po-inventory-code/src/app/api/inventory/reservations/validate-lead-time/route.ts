/**
 * Lead Time Validation API Route
 *
 * Endpoint for validating lead times when creating reservations.
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createPostHandler, ApiContextWithData } from "@/lib/api-middleware-v2";
import { leadTimeValidationService } from "@/services/inventory/reservation";
import {
  leadTimeValidationRequestSchema,
  LeadTimeValidationRequestDTO,
} from "@/services/inventory/reservation/lead-time-validation.types";

/**
 * POST /api/inventory/reservations/validate-lead-time
 * Validate lead time for a reservation
 */
export const POST = createPostHandler(
  leadTimeValidationRequestSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithData<LeadTimeValidationRequestDTO>,
  ) => {
    // Call service
    const validation = await leadTimeValidationService.validateLeadTime(
      context.serviceContext,
      context.data
    );

    return success(validation, "Lead time validated successfully");
  }
);
