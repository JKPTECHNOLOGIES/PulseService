/**
 * Expired Reservations API Route
 *
 * Endpoint for retrieving and managing expired reservations.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createGetHandler, createPostHandler } from "@/lib/api-middleware-v2";
import { reservationLifecycleService } from "@/services/inventory/reservation";
import { ReservationStatus } from "@/services/inventory/reservation/reservation.types";
import { z } from "zod";
/**
 * GET /api/inventory/reservations/expired
 * Get all expired reservations
 */
export const GET = createGetHandler(async () => {
  // Get all reservations and filter for expired ones
  // Note: ReservationServiceV2 doesn't have a generic findAll method
  // Instead, we need to query the database directly or use a specific method
  const now = new Date();
  const expiredReservations = await reservationLifecycleService[
    "prisma"
  ].inventoryReservation.findMany({
    where: {
      status: ReservationStatus.ACTIVE,
      expiresAt: {
        lte: now,
      },
    },
    include: {
      inventoryItem: {
        select: {
          id: true,
          sku: true,
          description: true,
          unit: true,
          unitCost: true,
        },
      },
      reservedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
    take: 100,
    orderBy: { expiresAt: "asc" },
  });

  return success(
    expiredReservations,
    `Found ${expiredReservations.length} expired reservation(s)`
  );
});

/**
 * POST /api/inventory/reservations/expired
 * Expire all reservations that have passed their expiration date
 */
export const POST = createPostHandler(
  z.object({}),
  async (_req: NextRequest, context) => {
    // Expire reservations
    const count = await reservationLifecycleService.expire(
      context.serviceContext
    );

    return success({ expiredCount: count }, `Expired ${count} reservation(s)`);
  }
);
