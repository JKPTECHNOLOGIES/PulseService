/**
 * Reservation Consume API Route
 *
 * Endpoint for consuming a reservation (marking as consumed and updating inventory).
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { reservationLifecycleService } from "@/services/inventory/reservation";
import {
  reservationConsumeSchema,
  ReservationConsumeDTO,
} from "@/services/inventory/reservation/reservation.types";

/**
 * POST /api/inventory/reservations/[id]/consume
 * Consume a reservation
 */
export const POST = createApiHandler<ReservationConsumeDTO>(
  { bodySchema: reservationConsumeSchema, hasParams: true },
  async (_req, context) => {
    const reservation = await reservationLifecycleService.consume(
      context.serviceContext,
      context.params.id,
      context.data
    );
    return success(reservation, "Reservation consumed successfully");
  }
);
