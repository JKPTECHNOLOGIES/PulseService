/**
 * ABC Classification Report API Route
 *
 * GET - Get detailed classification report with filters
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { createGetHandler, parseQueryParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
import { classificationReportQuerySchema } from "@/services/inventory/abc-classification/abc-classification.types";
/**
 * Query parameters schema with coercion for boolean
 */
const querySchema = classificationReportQuerySchema.extend({
  includeHistory: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

/**
 * GET /api/inventory/abc-classification/report
 * Get detailed classification report
 * Query params: storeId?, classification?, includeHistory?
 */
export const GET = createGetHandler(async (req: NextRequest, _context) => {
  const queryParams = parseQueryParams(req, querySchema);

  const report =
    await abcClassificationService.getClassificationReport(queryParams);

  return success(report, "Classification report retrieved successfully");
});
