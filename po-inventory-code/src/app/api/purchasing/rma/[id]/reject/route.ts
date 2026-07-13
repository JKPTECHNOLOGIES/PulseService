/**
 * RMA Reject API Route
 *
 * POST /api/purchasing/rma/[id]/reject - Reject RMA
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { rejectRMA } from "@/services/purchasing/rma/rma.service";
import { rmaRejectSchema } from "@/services/purchasing/rma/rma.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/rma/[id]/reject
 * Reject RMA
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    try {
    const body = await req.json() as Record<string, unknown>;
    const data = rmaRejectSchema.parse(body);

    const rma = await rejectRMA(
      prisma,
      context.serviceContext,
      context.params.id,
      data
    );

    return success(rma, "RMA rejected successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
