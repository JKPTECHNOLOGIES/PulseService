/**
 * RMA Cancel API Route
 *
 * POST /api/purchasing/rma/[id]/cancel - Cancel RMA
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { cancelRMA } from "@/services/purchasing/rma/rma.service";
import { rmaCancelSchema } from "@/services/purchasing/rma/rma.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/rma/[id]/cancel
 * Cancel RMA
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    try {
    const body = await req.json() as Record<string, unknown>;
    const data = rmaCancelSchema.parse(body);

    const rma = await cancelRMA(
      prisma,
      context.serviceContext,
      context.params.id,
      data
    );

    return success(rma, "RMA cancelled successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
