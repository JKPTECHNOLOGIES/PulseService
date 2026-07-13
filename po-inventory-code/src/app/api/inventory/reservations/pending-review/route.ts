/**
 * Pending Review Reservations API Route
 *
 * Endpoint for retrieving reservations pending review.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds


import { paginated } from "@/lib/api-response";
import { createApiHandler} from "@/lib/api-middleware-v2";
import { reservationReviewService } from "@/services/inventory/reservation/reservation-review.service";
import { pendingReviewFilterSchema } from "@/services/inventory/reservation/reservation-review.types";
import { logPlannerDashboard } from "@/lib/planner-dashboard-logger";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/inventory/reservations/pending-review
 * Get all reservations pending review with optional filters
 */
export const GET = createApiHandler(
  {
    anyPermissions: ["inventory:read", "inventory:reserve"],
  },
  async (req, context) => {
    try {
    const userId = context.serviceContext.userId;

    // Parse query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());

    logPlannerDashboard.apiCall(
      "/api/inventory/reservations/pending-review",
      queryParams,
      userId
    );

    // Convert string values to appropriate types
    const filters = {
      page: queryParams.page ? parseInt(queryParams.page, 10) : undefined,
      limit: queryParams.limit ? parseInt(queryParams.limit, 10) : undefined,
      userId: queryParams.userId ?? undefined,
      workOrderId: queryParams.workOrderId ?? undefined,
      itemId: queryParams.itemId ?? undefined,
      dueWithinDays: queryParams.dueWithinDays
        ? parseInt(queryParams.dueWithinDays, 10)
        : undefined,
    };

    logPlannerDashboard.reviewFetch(userId, filters);

    // Validate filters
    const validatedFilters = pendingReviewFilterSchema.parse(filters);

    // Get pending review reservations
    const result = await reservationReviewService.getPendingReview(
      context.serviceContext,
      validatedFilters
    );

    logPlannerDashboard.reviewFetchResult(
      userId,
      result.data.length,
      result.pagination
    );
    logPlannerDashboard.apiResponse(
      "/api/inventory/reservations/pending-review",
      200,
      result,
      userId
    );

    return paginated(
      result.data,
      result.pagination,
      "Pending review reservations retrieved successfully"
    );
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
