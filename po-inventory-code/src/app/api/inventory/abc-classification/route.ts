/**
 * ABC Classification API Routes
 *
 * Main endpoint for ABC classification overview.
 * GET - Get classification overview/report
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
/**
 * GET /api/inventory/abc-classification
 * Get classification overview (report)
 */
export const GET = createGetHandler(async (_req: NextRequest, _context) => {
  const report = await abcClassificationService.getClassificationReport();
  return success(report, "Classification report retrieved successfully");
});
