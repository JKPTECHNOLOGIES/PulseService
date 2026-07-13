/**
 * ABC Classification Items API Route
 *
 * GET - Get items by classification
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { ABCClassification } from "@prisma/client";
import { createGetHandler, parseQueryParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
/**
 * Query parameters schema
 */
const querySchema = z.object({
  classification: z.nativeEnum(ABCClassification),
  storeId: z.string().uuid("Invalid store ID").optional(),
});

/**
 * GET /api/inventory/abc-classification/items
 * Get items by classification
 * Query params: classification (required), storeId?
 */
export const GET = createGetHandler(async (req: NextRequest, _context) => {
  const { classification, storeId } = parseQueryParams(req, querySchema);

  const items = await abcClassificationService.getItemsByClassification(
    classification,
    storeId
  );

  return success(items, "Items retrieved successfully");
});
