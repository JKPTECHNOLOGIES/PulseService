/**
 * Bulk Confirm Reservations API Route
 *
 * Endpoint for confirming multiple pending review reservations at once.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { reservationReviewService } from "@/services/inventory/reservation/reservation-review.service";
import {
  reservationBulkConfirmSchema,
  ReservationBulkConfirmDTO,
} from "@/services/inventory/reservation/reservation-review.types";

/**
 * POST /api/inventory/reservations/bulk-confirm
 * Confirm multiple pending review reservations
 */
export const POST = createApiHandler<ReservationBulkConfirmDTO>(
  { bodySchema: reservationBulkConfirmSchema },
  async (_req, context) => {
    const result = await reservationReviewService.bulkConfirmReservations(
      context.serviceContext,
      context.data
    );
    return success(
      result,
      `Bulk confirmation completed: ${result.confirmed} confirmed, ${result.failed} failed`
    );
  }
);
