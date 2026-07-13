/**
 * Pending Approval Requisitions API Route
 * GET /api/purchasing/requisitions/pending-approval
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { createGetHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { requisitionService } from "@/services/purchasing/requisition";
export const GET = createGetHandler(async (_req, context) => {
  const requisitions = await requisitionService.getPendingApproval(
    context.serviceContext
  );

  return success(
    requisitions,
    "Pending approval requisitions retrieved successfully"
  );
});
