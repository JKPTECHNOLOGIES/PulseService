/**
 * GET /api/inventory/reservations-summary
 *
 * Returns active/pending inventory reservations for the attention banner.
 * Includes work order linkage and requisition linkage where available.
 *
 * Accessible to authenticated sessions only.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface ReservationSummaryItem {
  id: string;
  inventoryItemId: string;
  itemSku: string;
  itemDescription: string;
  quantity: number;
  /** Name of the user who reserved */
  reservedByName: string;
  /** Work order number, if linked */
  workOrderId: string | null;
  workOrderNumber: string | null;
  /** Requisition id, if linked via work order */
  requisitionId: string | null;
  requisitionNumber: string | null;
  reservedAt: string;
  status: string;
  /** True if this reservation has a linked requisition */
  hasRequisition: boolean;
  /** True if this reservation has a linked work order */
  hasWorkOrder: boolean;
}

export interface ReservationsSummaryResponse {
  items: ReservationSummaryItem[];
  counts: {
    total: number;
    withRequisition: number;
    withWorkOrder: number;
    pending: number;
  };
}

export async function GET(): Promise<NextResponse<ReservationsSummaryResponse | { error: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reservations = await prisma.inventoryReservation.findMany({
      where: {
        status: { in: ["ACTIVE", "PENDING", "PENDING_REVIEW"] },
      },
      select: {
        id: true,
        inventoryItemId: true,
        quantity: true,
        reservedBy: true,
        status: true,
        createdAt: true,
        inventoryItem: {
          select: {
            sku: true,
            description: true,
          },
        },
        reservedByUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        // WorkOrderPart links reservation → work order → requisition budget
        workOrderPart: {
          select: {
            workOrderId: true,
            workOrder: {
              select: {
                woNumber: true,
                requisitionBudgets: {
                  select: {
                    requisitionId: true,
                    requisition: {
                      select: {
                        reqNumber: true,
                      },
                    },
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const items: ReservationSummaryItem[] = reservations.map((r) => {
      const workOrderId = r.workOrderPart?.workOrderId ?? null;
      const workOrderNumber = r.workOrderPart?.workOrder.woNumber ?? null;
      const reqBudget = r.workOrderPart?.workOrder.requisitionBudgets[0];
      const requisitionId = reqBudget?.requisitionId ?? null;
      const requisitionNumber = reqBudget?.requisition.reqNumber ?? null;

      return {
        id: r.id,
        inventoryItemId: r.inventoryItemId,
        itemSku: r.inventoryItem.sku,
        itemDescription: r.inventoryItem.description,
        quantity: Number(r.quantity),
        reservedByName: `${r.reservedByUser.firstName} ${r.reservedByUser.lastName}`.trim(),
        workOrderId,
        workOrderNumber,
        requisitionId,
        requisitionNumber,
        reservedAt: r.createdAt.toISOString(),
        status: r.status,
        hasRequisition: requisitionId !== null,
        hasWorkOrder: workOrderId !== null,
      };
    });

    const withRequisition = items.filter((i) => i.hasRequisition).length;
    const withWorkOrder = items.filter((i) => i.hasWorkOrder).length;
    const pending = items.filter((i) => i.status === "PENDING" || i.status === "PENDING_REVIEW").length;

    return NextResponse.json({
      items,
      counts: {
        total: items.length,
        withRequisition,
        withWorkOrder,
        pending,
      },
    });
  } catch (error) {
    logger.error("[reservations-summary] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reservations summary" },
      { status: 500 }
    );
  }
}
