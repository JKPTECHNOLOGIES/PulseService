/**
 * Reservation Confirm API Route
 *
 * Endpoint for confirming a pending review reservation.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { reservationReviewService } from "@/services/inventory/reservation/reservation-review.service";
import {
  reservationConfirmSchema,
  ReservationConfirmDTO,
} from "@/services/inventory/reservation/reservation-review.types";

/**
 * POST /api/inventory/reservations/[id]/confirm
 * Confirm a pending review reservation
 */
export const POST = createApiHandler<ReservationConfirmDTO>(
  { bodySchema: reservationConfirmSchema, hasParams: true },
  async (_req, context) => {
    const result = await reservationReviewService.confirmReservation(
      context.serviceContext,
      context.params.id,
      context.data
    );
    return success(result, "Reservation confirmed successfully");
  }
);
