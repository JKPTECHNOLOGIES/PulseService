/**
 * ABC Classification History API Route
 *
 * GET - Get classification history for a specific item
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createGetHandlerWithParams,
  parseQueryParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
/**
 * Query parameters schema
 */
const querySchema = z.object({
  limit: z
    .string()
    .optional()
    .default("10")
    .transform((val) => parseInt(val, 10)),
});

/**
 * GET /api/inventory/abc-classification/history/[itemId]
 * Get classification history for an item
 * Query params: limit? (default: 10)
 */
export const GET = createGetHandlerWithParams<{ itemId: string }>(
  async (req: NextRequest, context) => {
    const { itemId } = await context.params;
    const { limit } = parseQueryParams(req, querySchema);

    const history = await abcClassificationService.getClassificationHistory(
      itemId,
      limit
    );

    return success(history, "Classification history retrieved successfully");
  }
);
