/**
 * ABC Classification Distribution API Route
 *
 * GET - Get classification distribution statistics
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
/**
 * GET /api/inventory/abc-classification/distribution
 * Get classification distribution statistics
 */
export const GET = createGetHandler(async (_req: NextRequest, _context) => {
  const distribution = await abcClassificationService.getDistribution();
  return success(
    distribution,
    "Distribution statistics retrieved successfully"
  );
});
