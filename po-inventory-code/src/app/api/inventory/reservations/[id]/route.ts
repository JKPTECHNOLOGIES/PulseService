/**
 * Individual Inventory Reservation API Routes
 *
 * CRUD endpoints for individual reservation operations.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createApiHandler,
  createDeleteHandler,
} from "@/lib/api-middleware-v2";
import { reservationService } from "@/services/inventory/reservation";
import {
  reservationUpdateSchema,
  ReservationUpdateDTO,
} from "@/services/inventory/reservation/reservation.types";

/**
 * GET /api/inventory/reservations/[id]
 * Get a single reservation by ID
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  const reservation = await reservationService.getById(
    context.serviceContext,
    context.params.id
  );
  return success(reservation, "Reservation retrieved successfully");
});

/**
 * PATCH /api/inventory/reservations/[id]
 * Update a reservation (notes, expiry date)
 */
export const PATCH = createApiHandler<ReservationUpdateDTO>(
  { bodySchema: reservationUpdateSchema, hasParams: true },
  async (_req, context) => {
    const reservation = await reservationService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );
    return success(reservation, "Reservation updated successfully");
  }
);

/**
 * DELETE /api/inventory/reservations/[id]
 * Delete a reservation (only active reservations)
 */
export const DELETE = createDeleteHandler(async (_req, context) => {
  await reservationService.delete(context.serviceContext, context.params.id);
  return noContent();
});
