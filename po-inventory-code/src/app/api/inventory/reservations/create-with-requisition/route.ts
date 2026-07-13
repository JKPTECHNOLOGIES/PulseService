/**
 * Create Reservation with Auto-Requisition API Route
 *
 * POST /api/inventory/reservations/create-with-requisition
 * Creates a reservation and automatically creates a requisition if needed
 * Also updates WorkOrderPart status to RESERVED when creating reservation for work order
 * (WorkOrderPart status update is handled automatically by reservationService.create())
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { created } from "@/lib/api-response";
import {
  createPostHandler,
  ApiContextWithData,
} from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { reservationService } from "@/services/inventory/reservation/reservation.service";
import { reservationAutomationService } from "@/services/inventory/reservation/reservation-automation.service";
import { ReservationReferenceType } from "@/services/inventory/reservation/reservation.types";

/**
 * Schema for creating reservation with auto-requisition
 */
const createWithRequisitionSchema = z.object({
  inventoryItemId: z.string().uuid("Invalid inventory item ID"),
  quantity: z.number().positive("Quantity must be positive"),
  reservedFor: z.nativeEnum(ReservationReferenceType).optional().nullable(),
  reservedForId: z.string().uuid().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  createRequisition: z.boolean().default(false),
  skipStockCheck: z.boolean().optional(), // Allow bypassing stock check
  allowZeroStock: z.boolean().optional(), // Allow reservation when stock is zero/insufficient (backorder)
  workOrderContext: z.object({
    woNumber: z.string(),
    title: z.string().optional(),
    equipmentId: z.string().uuid().optional(),
  }).optional(),
});

type CreateWithRequisitionDTO = z.infer<typeof createWithRequisitionSchema>;

/**
 * POST /api/inventory/reservations/create-with-requisition
 * Create a reservation and optionally create an auto-requisition
 */
export const POST = createPostHandler(
  createWithRequisitionSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithData<CreateWithRequisitionDTO>,
  ) => {
    const { createRequisition, workOrderContext, allowZeroStock, ...reservationData } = context.data;

    // When allowZeroStock is true, always create a requisition (the whole point is to order the part)
    const shouldCreateRequisition = createRequisition || (allowZeroStock === true);

    // 1. Create the reservation
    // IMPORTANT: Skip stock check since user already confirmed via dialog
    // NOTE: reservationService.create() will automatically update WorkOrderPart status to RESERVED
    // When allowZeroStock is true, the reservation will be created with PENDING status
    const reservation = await reservationService.create(
      context.serviceContext,
      {
        ...reservationData,
        expiresAt: reservationData.expiresAt ? new Date(reservationData.expiresAt) : undefined,
        skipStockCheck: true, // User already confirmed, bypass PROMPT_BASED check
        allowZeroStock: allowZeroStock ?? false,
      },
    );

    // 2. If createRequisition is true (or allowZeroStock forces it), create auto-requisition
    if (shouldCreateRequisition) {
      try {
        // Get full inventory item details
        const inventoryItem = await prisma.inventoryItem.findUnique({
          where: { id: reservationData.inventoryItemId },
          include: {
            stock: true,
          },
        });

        if (!inventoryItem) {
          // Return success for reservation but note requisition failure
          return created(
            reservation,
            "Reservation created successfully, but requisition creation failed (item not found)",
          );
        }

        // Calculate available quantity after reservation
        const totalOnHand = inventoryItem.stock.reduce(
          (sum, s) => sum + Number(s.quantityOnHand),
          0,
        );
        const totalReserved = inventoryItem.stock.reduce(
          (sum, s) => sum + Number(s.quantityReserved),
          0,
        );
        const availableQty = totalOnHand - totalReserved;

        // Create auto-requisition using the service
        await reservationAutomationService.createAutoRequisition(
          context.serviceContext,
          {
            id: inventoryItem.id,
            sku: inventoryItem.sku,
            description: inventoryItem.description,
            maxQuantity: Number(inventoryItem.maxQuantity),
            minQuantity: Number(inventoryItem.minQuantity),
            unitCost: Number(inventoryItem.unitCost),
            unit: inventoryItem.unit,
          },
          availableQty,
          reservationData.reservedForId ?? undefined,
          {
            quantityReserved: reservationData.quantity,
            currentOnHand: totalOnHand,
            workOrderNumber: workOrderContext?.woNumber,
            workOrderTitle: workOrderContext?.title,
            equipmentId: workOrderContext?.equipmentId,
          }
        );

      } catch (_reqError) {
        // Don't fail the whole operation - reservation was already created
        // Just return success with a note about requisition failure
        return created(
          reservation,
          "Reservation created successfully, but requisition creation failed. Please create requisition manually.",
        );
      }
    }

    return created(
      reservation,
      shouldCreateRequisition
        ? allowZeroStock
          ? "Backorder reservation and requisition created successfully"
          : "Reservation and requisition created successfully"
        : "Reservation created successfully",
    );
  },
);
