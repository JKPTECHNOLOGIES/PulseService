/**
 * RMA Credit API Route
 *
 * POST /api/purchasing/rma/[id]/credit - Issue credit for RMA
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { issueCreditRMA } from "@/services/purchasing/rma/rma.service";
import { rmaCreditSchema } from "@/services/purchasing/rma/rma.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/rma/[id]/credit
 * Issue credit for RMA
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    try {
    const body = await req.json() as Record<string, unknown>;
    const data = rmaCreditSchema.parse(body);

    const rma = await issueCreditRMA(
      prisma,
      context.serviceContext,
      context.params.id,
      data
    );

    return success(rma, "Credit issued successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
