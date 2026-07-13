/**
 * Reservation Review History API Route
 *
 * Endpoint for retrieving the review history of a reservation.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { reservationReviewService } from "@/services/inventory/reservation/reservation-review.service";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/inventory/reservations/[id]/review-history
 * Get review history for a reservation
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    try {
    const history = await reservationReviewService.getReviewHistory(
      context.serviceContext,
      context.params.id
    );
    return success(history, "Review history retrieved successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
