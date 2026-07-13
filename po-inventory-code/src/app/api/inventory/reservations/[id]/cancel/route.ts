/**
 * Reservation Cancel API Route
 *
 * Endpoint for cancelling a reservation (marking as cancelled and restoring available quantity).
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { reservationLifecycleService } from "@/services/inventory/reservation";
import {
  reservationCancelSchema,
  ReservationCancelDTO,
} from "@/services/inventory/reservation/reservation.types";

/**
 * POST /api/inventory/reservations/[id]/cancel
 * Cancel a reservation
 */
export const POST = createApiHandler<ReservationCancelDTO>(
  { bodySchema: reservationCancelSchema, hasParams: true },
  async (_req, context) => {
    const reservation = await reservationLifecycleService.cancel(
      context.serviceContext,
      context.params.id,
      context.data
    );
    return success(reservation, "Reservation cancelled successfully");
  }
);
