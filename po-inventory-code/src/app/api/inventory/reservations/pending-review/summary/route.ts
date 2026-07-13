import { createGetHandler } from "@/lib/api-middleware-v2";
// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success } from "@/lib/api-response";
import { reservationReviewService } from "@/services/inventory/reservation/reservation-review.service";
/**
 * GET /api/inventory/reservations/pending-review/summary
 * Get summary statistics for pending reservation reviews
 */
export const GET = createGetHandler(async (req, context) => {
  // Get userId from query params (optional - for planner-specific summary)
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? undefined;

  const summary = await reservationReviewService.getPendingReviewSummary(
    context.serviceContext,
    userId
  );

  return success(summary);
});
