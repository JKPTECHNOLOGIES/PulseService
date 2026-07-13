/**
 * RMA Submit API Route
 *
 * POST /api/purchasing/rma/[id]/submit - Submit RMA for approval
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { submitRMA } from "@/services/purchasing/rma/rma.service";
import { rmaSubmitSchema } from "@/services/purchasing/rma/rma.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/rma/[id]/submit
 * Submit RMA for approval
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    try {
    // Parse and validate request body
    const body = await req.json() as Record<string, unknown>;
    const data = rmaSubmitSchema.parse(body);

    const rma = await submitRMA(
      prisma,
      context.serviceContext,
      context.params.id,
      data
    );

    return success(rma, "RMA submitted for approval successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
