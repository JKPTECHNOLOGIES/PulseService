/**
 * Transparency Check API Route
 *
 * POST /api/inventory/reservations/transparency-check
 * Provides complete transparency for work order part reservations including:
 * - Existing reservations for the same work order + part
 * - All open requisitions containing the part
 * - Stock impact analysis
 * - Recommendations for action
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createPostHandler,
  ApiContextWithData,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { ValidationError, InternalServerError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
import { requisitionService } from "@/services/purchasing/requisition";
import { calculateTotalValue , type TransparencyCheckResult } from "@/services/purchasing/requisition/requisition.types";

/**
 * Request schema for transparency check
 */
const transparencyCheckSchema = z.object({
  inventoryItemId: z.string().uuid("Invalid inventory item ID"),
  workOrderId: z.string().uuid("Invalid work order ID").optional(),
  requestedQuantity: z.number().positive("Requested quantity must be positive"),
});

type TransparencyCheckRequest = z.infer<typeof transparencyCheckSchema>;

/**
 * POST /api/inventory/reservations/transparency-check
 * Check transparency for part reservation
 */
export const POST = createPostHandler(
  transparencyCheckSchema,
  async (_req: NextRequest, context: ApiContextWithData<TransparencyCheckRequest>) => {
    try {
      // Get validated data from context (already parsed by middleware)
      const validated = context.data;

      // Get inventory item with current stock
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: { id: validated.inventoryItemId },
        select: {
          id: true,
          sku: true,
          description: true,
          minQuantity: true,
          unit: true,
          stock: {
            select: {
              quantityOnHand: true,
              quantityReserved: true,
            },
          },
        },
      });

      if (!inventoryItem) {
        throw new ValidationError("Inventory item not found");
      }

      // Get existing reservation for this work order + part (if workOrderId provided)
      let existingReservation = null;
      if (validated.workOrderId) {
        const workOrderPart = await prisma.workOrderPart.findFirst({
          where: {
            workOrderId: validated.workOrderId,
            inventoryItemId: validated.inventoryItemId,
          },
          include: {
            reservation: true,
          },
        });

        if (workOrderPart?.reservation?.status === "ACTIVE") {
          existingReservation = workOrderPart.reservation;
        }
      }

      // Get all open requisitions containing this part
      const openRequisitions = await requisitionService.findOpenRequisitionsByItem(
        context.serviceContext,
        validated.inventoryItemId,
      );

      // Get requisition summary
      const requisitionSummary = await requisitionService.getRequisitionSummary(
        context.serviceContext,
        validated.inventoryItemId,
      );

      // Calculate stock impact - sum up stock from all stores
      const currentStock = inventoryItem.stock.reduce(
        (sum, s) => sum + Number(s.quantityOnHand),
        0
      );
      const minQty = Number(inventoryItem.minQuantity) || 0;
      const existingReservedQty = existingReservation
        ? Number(existingReservation.quantity)
        : 0;

      // Net change in reservation (new quantity - existing quantity)
      const netReservationChange =
        validated.requestedQuantity - existingReservedQty;

      // Stock after this reservation
      const stockAfterReservation = currentStock - netReservationChange;

      // Check if we'll hit min qty or go negative
      const willHitMinQty = stockAfterReservation <= minQty;
      const willGoNegative = stockAfterReservation < 0;

      // Determine recommendation
      let recommendation: "PROCEED" | "CREATE_REQ" | "REVIEW_EXISTING";
      let recommendationReason: string;

      if (willGoNegative) {
        recommendation = "CREATE_REQ";
        recommendationReason = `Insufficient stock. Current: ${currentStock}, Requested: ${validated.requestedQuantity}, Would result in negative stock.`;
      } else if (willHitMinQty) {
        if (requisitionSummary.requisitionCount > 0) {
          recommendation = "REVIEW_EXISTING";
          recommendationReason = `Stock will hit minimum quantity (${minQty}). ${requisitionSummary.requisitionCount} open requisition(s) already exist for this part with ${requisitionSummary.totalQuantityOnOrder} units on order.`;
        } else {
          recommendation = "CREATE_REQ";
          recommendationReason = `Stock will hit minimum quantity (${minQty}). Consider creating a requisition to reorder.`;
        }
      } else {
        if (requisitionSummary.requisitionCount > 0) {
          recommendation = "REVIEW_EXISTING";
          recommendationReason = `${requisitionSummary.requisitionCount} open requisition(s) exist for this part. Review before creating new requisitions.`;
        } else {
          recommendation = "PROCEED";
          recommendationReason = "Stock levels are adequate. Safe to proceed with reservation.";
        }
      }

      // Transform requisitions to include computed fields
      const requisitionsWithDetails = openRequisitions.map((req) => ({
        ...req,
        totalValue: calculateTotalValue(req.lines),
        lineCount: req.lines.length,
        statusDisplay: req.status,
      }));

      // Build result
      const result: TransparencyCheckResult = {
        inventoryItem: {
          id: inventoryItem.id,
          sku: inventoryItem.sku,
          description: inventoryItem.description,
          currentStock,
          minQty,
          unit: inventoryItem.unit,
        },
        requestedQuantity: validated.requestedQuantity,
        stockAfterReservation,
        willHitMinQty,
        willGoNegative,
        existingReservation: existingReservation
          ? {
              id: existingReservation.id,
              quantity: Number(existingReservation.quantity),
              reservedAt: existingReservation.createdAt.toISOString(),
              status: existingReservation.status,
            }
          : null,
        openRequisitions: requisitionsWithDetails,
        requisitionSummary,
        recommendation,
        recommendationReason,
      };

      return success(result);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new InternalServerError("Failed to perform transparency check");
    }
  },
);
