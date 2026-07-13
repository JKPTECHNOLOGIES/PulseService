/**
 * Inventory Item Total Reserved API
 * 
 * GET /api/inventory/[id]/total-reserved - Get total reserved quantity across ALL active reservations
 * (work orders, PM schedules, manual reservations, etc.)
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 30; // Cache for 30 seconds

import { createGetHandlerWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { ReservationStatus } from "@prisma/client";

/**
 * GET /api/inventory/[id]/total-reserved
 * Get total reserved quantity across ALL active reservations
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  // Get ALL active reservations for this inventory item (not just work orders)
  const reservations = await prisma.inventoryReservation.findMany({
    where: {
      inventoryItemId: context.params.id,
      status: ReservationStatus.ACTIVE,
    },
    select: {
      quantity: true,
      reservedFor: true,
    },
  });

  // Calculate total reserved quantity
  const totalReserved = reservations.reduce(
    (sum, r) => sum + Number(r.quantity),
    0,
  );

  // Count reservations by type for additional context
  const byType = reservations.reduce((acc, r) => {
    const type = r.reservedFor ?? "Unknown";
    acc[type] = (acc[type] ?? 0) + Number(r.quantity);
    return acc;
  }, {} as Record<string, number>);

  return success({
    totalReserved,
    reservationCount: reservations.length,
    byType,
  });
});
