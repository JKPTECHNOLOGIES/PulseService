/**
 * ABC Classification Calculate API Route
 *
 * POST - Trigger manual classification calculation
 */

import { NextRequest } from "next/server";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/inventory/abc-classification/calculate
 * Trigger manual classification calculation
 */
export const POST = createApiHandler({}, async (_req: NextRequest, context) => {
    try {
  const userId = context.serviceContext.userId;

  const result =
    await abcClassificationService.triggerManualCalculation(userId);

  return success(result, "Classification calculation completed successfully");

    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
