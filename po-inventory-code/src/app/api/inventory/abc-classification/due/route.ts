/**
 * ABC Classification Due Items API Route
 *
 * GET - Get items due for cycle count
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { createGetHandler, parseQueryParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
import { itemsDueQuerySchema } from "@/services/inventory/abc-classification/abc-classification.types";
/**
 * Query parameters schema with coercion for numeric values
 */
const querySchema = itemsDueQuerySchema.extend({
  overdueDays: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
});

/**
 * GET /api/inventory/abc-classification/due
 * Get items due for cycle count
 * Query params: storeId?, classification?, overdueDays?
 */
export const GET = createGetHandler(async (req: NextRequest, _context) => {
  const queryParams = parseQueryParams(req, querySchema);

  const items = await abcClassificationService.getItemsDueForCount(queryParams);

  return success(items, "Due items retrieved successfully");
});
