/**
 * GET /api/inventory/:id/requisitions
 *
 * Returns all requisition lines linked to a specific inventory item,
 * including the parent requisition details, requester, and supplier.
 * Used by the Orders tab on the inventory detail page.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { createGetHandlerWithParams, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// Helper to convert Prisma Decimal to number
const toNumber = (value: Prisma.Decimal | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return value.toNumber();
};

export const GET = createGetHandlerWithParams(
  async (_request: NextRequest, context: ApiContextWithParams) => {
    const inventoryItemId = context.params.id;

    // Fetch all requisition lines for this inventory item.
    // We join through poLine -> purchaseOrder to get the *correct* PO for each line
    // (the denormalized RequisitionLine.purchaseOrderId/Number fields may reference a
    // header-level PO that differs from what was actually ordered for this specific line).
    const reqLines = await prisma.requisitionLine.findMany({
      where: {
        inventoryItemId: inventoryItemId,
        // Exclude cancelled lines at the line level
        lineStatus: { not: "CANCELLED" },
        // Exclude lines whose parent requisition has been cancelled or rejected
        requisition: {
          approvalStatus: { notIn: ["CANCELLED", "REJECTED"] },
        },
      },
      include: {
        requisition: {
          include: {
            requestedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            supplier: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        // Join the actual PO line to get the correct PO for this specific line
        poLine: {
          select: {
            id: true,
            purchaseOrderId: true,
            purchaseOrder: {
              select: {
                id: true,
                poNumber: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Serialize Decimals
    // For "Linked PO": prefer the PO resolved through the actual poLine relation
    // (which is the authoritative link for this specific inventory line item).
    // Fall back to the denormalized purchaseOrderId/Number on the req line only
    // if no poLine join is available.
    const serialized = reqLines.map((line) => {
      // Resolve the correct PO for this specific line via the poLine relation
      const resolvedPOId = line.poLine?.purchaseOrder.id ?? line.purchaseOrderId;
      const resolvedPONumber = line.poLine?.purchaseOrder.poNumber ?? line.purchaseOrderNumber;

      return {
        id: line.id,
        requisitionId: line.requisitionId,
        description: line.description,
        quantity: toNumber(line.quantity),
        unit: line.unit,
        estimatedPrice: toNumber(line.estimatedPrice),
        lineStatus: line.lineStatus,
        lineType: line.lineType,
        // Use the authoritative PO resolved via poLine relation
        purchaseOrderId: resolvedPOId,
        purchaseOrderNumber: resolvedPONumber,
        poLineId: line.poLineId,
        convertedToPOAt: line.convertedToPOAt,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
        supplier: line.supplier,
        requisition: {
          id: line.requisition.id,
          reqNumber: line.requisition.reqNumber,
          status: line.requisition.status,
          approvalStatus: line.requisition.approvalStatus,
          priority: line.requisition.priority,
          neededByDate: line.requisition.neededByDate,
          createdAt: line.requisition.createdAt,
          submittedAt: line.requisition.submittedAt,
          approvedAt: line.requisition.approvedAt,
          convertedToPOAt: line.requisition.convertedToPOAt,
          purchaseOrderId: line.requisition.purchaseOrderId,
          purchaseOrderNumber: line.requisition.purchaseOrderNumber,
          requestedBy: line.requisition.requestedBy,
          supplier: line.requisition.supplier,
        },
      };
    });

    // Calculate summary stats
    const openStatuses = ["PENDING", "APPROVED"];
    const openLines = serialized.filter((l) => openStatuses.includes(l.lineStatus));
    const orderedLines = serialized.filter((l) => l.lineStatus === "ORDERED" || l.lineStatus === "PARTIALLY_FULFILLED");
    const fulfilledLines = serialized.filter((l) => l.lineStatus === "FULFILLED");
    const cancelledLines = serialized.filter((l) => l.lineStatus === "CANCELLED");

    const stats = {
      totalLines: serialized.length,
      openLines: openLines.length,
      orderedLines: orderedLines.length,
      fulfilledLines: fulfilledLines.length,
      cancelledLines: cancelledLines.length,
      totalQtyRequested: serialized.reduce((sum, l) => sum + l.quantity, 0),
      totalQtyOpen: openLines.reduce((sum, l) => sum + l.quantity, 0),
      totalQtyOrdered: orderedLines.reduce((sum, l) => sum + l.quantity, 0),
    };

    return success({
      reqLines: serialized,
      stats,
    });
  }
);
