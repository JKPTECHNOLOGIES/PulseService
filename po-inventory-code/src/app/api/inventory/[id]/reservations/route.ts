/**
 * Inventory Item Reservations API
 * 
 * GET /api/inventory/[id]/reservations - Get active reservations for an inventory item
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { createGetHandlerWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
/**
 * GET /api/inventory/[id]/reservations
 * Get active reservations for an inventory item
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  // Get active reservations for this inventory item
  const reservations = await prisma.inventoryReservation.findMany({
    where: {
      inventoryItemId: context.params.id,
      status: "ACTIVE",
      reservedFor: "WorkOrder",
    },
    include: {
      reservedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Get work order details for each reservation
  const reservationsWithWorkOrders = await Promise.all(
    reservations.map(async (reservation) => {
      if (reservation.reservedForId) {
        const workOrder = await prisma.workOrder.findUnique({
          where: { id: reservation.reservedForId },
          select: {
            id: true,
            woNumber: true,
            title: true,
            status: true,
            priority: true,
            equipment: {
              select: {
                tag: true,
                description: true,
              },
            },
          },
        });

        return {
          id: reservation.id,
          quantity: Number(reservation.quantity),
          reservedBy: `${reservation.reservedByUser.firstName} ${reservation.reservedByUser.lastName}`,
          reservedAt: reservation.createdAt,
          workOrder: workOrder ?? null,
        };
      }
      return null;
    })
  );

  // Filter out null values
  const validReservations = reservationsWithWorkOrders.filter(
    (r) => r !== null && r.workOrder !== null
  );

  return success({
    reservations: validReservations,
    totalReserved: validReservations.reduce(
      (sum, r) => sum + (r?.quantity ?? 0),
      0,
    ),
  });
});
