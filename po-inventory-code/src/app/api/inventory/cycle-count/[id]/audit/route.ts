/**
 * Master Cycle Count Audit Trail API Route
 *
 * Endpoint for retrieving complete audit trail.
 * GET - Get audit trail
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
/**
 * GET /api/inventory/cycle-count/:id/audit
 * Get complete audit trail for cycle count
 *
 * Returns chronological list of all actions performed on the cycle count including:
 * - Who performed the action
 * - When it was performed
 * - What action was taken
 * - Previous and new values (where applicable)
 * - Associated notes
 * - Related item information (for item-level actions)
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    // Call service
    const auditTrail = await masterCycleCountService.getAuditTrail(
      context.params.id
    );

    return success(auditTrail, "Audit trail retrieved successfully");
  }
);
