/**
 * GET /api/inventory/attention-items
 *
 * Returns items that require the inventory manager's attention on the
 * main inventory dashboard. Currently surfaces:
 *
 *   1. Service PO lines with an approved invoice that are ready to be
 *      received (canReceive = true, invoiceMatched = true) but have not
 *      yet been fully received (receivedQuantity < quantity).
 *
 * Only surfaces items where the PO has at least one approved invoice that
 * has NOT yet been received against (no active, non-return receipts).
 *
 * Accessible to any authenticated session.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface AttentionItem {
  type: "service_receipt_ready";
  poLineId: string;
  poId: string;
  poNumber: string;
  lineDescription: string;
  vendorName: string;
  /** ISO date string of when the invoice was approved */
  invoiceApprovedAt: string | null;
  /** Name of the user who approved the invoice */
  invoiceApprovedByName: string | null;
  invoiceNumber: string;
  invoiceId: string;
  quantityOrdered: number;
  quantityReceived: number;
  /** Name of the user who submitted/requested the requisition, if linked */
  requestedBy: string | null;
}

export interface AttentionItemsResponse {
  items: AttentionItem[];
  counts: {
    serviceReceiptReady: number;
  };
}

/**
 * Count active (non-reversed, non-voided, non-return) receipts for an invoice.
 * Mirrors the frontend `countActiveReceipts()` helper on the receive page.
 */
function countActiveReceipts(
  receipts: Array<{ status: string; isReturn: boolean }> | undefined
): number {
  if (!receipts || receipts.length === 0) return 0;
  return receipts.filter(
    (r) => r.status === "ACTIVE" && !r.isReturn
  ).length;
}

export async function GET(): Promise<NextResponse<AttentionItemsResponse | { error: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const readyLines = await prisma.pOLine.findMany({
      where: {
        lineType: "SERVICE",
        canReceive: true,
        invoiceMatched: true,
        // Pre-filter: exclude POs that are already Received, Closed, or Cancelled
        // so take: 200 returns 200 *relevant* rows instead of 200 arbitrary rows
        purchaseOrder: {
          status: { notIn: ["Received", "Closed", "Cancelled"] },
        },
      },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            status: true,
            updatedAt: true,
            supplier: {
              select: { name: true },
            },
            invoices: {
              where: {
                approvalStatus: {
                  in: ["REQUESTOR_APPROVED", "FULLY_APPROVED"],
                },
                voidedAt: null,
              },
              select: {
                id: true,
                invoiceNumber: true,
                requestorApprovedAt: true,
                requestorApprovedByName: true,
                // Include receipts so we can check if the invoice has already been received
                receipts: {
                  select: {
                    id: true,
                    status: true,
                    isReturn: true,
                  },
                },
              },
              orderBy: { requestorApprovedAt: "desc" },
            },
          },
        },
        requisition: {
          select: {
            requestedBy: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
      take: 200,
    });

    // Filter in-memory: only lines still outstanding AND with at least one
    // approved invoice that has NOT yet been received against.
    // Also exclude lines on POs that are Closed/Cancelled/Received.
    const outstanding = readyLines.filter((line) => {
      // Must still have remaining quantity
      if (Number(line.receivedQuantity) >= Number(line.quantity)) return false;

      // Exclude POs that are already fully Received, Closed, or Cancelled
      const poStatus = line.purchaseOrder.status;
      if (["Received", "Closed", "Cancelled"].includes(poStatus)) return false;

      // Must have at least one approved invoice with NO active receipts
      const unreceived = line.purchaseOrder.invoices.find(
        (inv) => countActiveReceipts(inv.receipts) === 0
      );
      return !!unreceived;
    });

    // Sort by most recently approved invoice first
    outstanding.sort((a, b) => {
      // Pick the first unreceived invoice for sorting
      const aInv = a.purchaseOrder.invoices.find(
        (inv) => countActiveReceipts(inv.receipts) === 0
      );
      const bInv = b.purchaseOrder.invoices.find(
        (inv) => countActiveReceipts(inv.receipts) === 0
      );
      const aDate = aInv?.requestorApprovedAt?.getTime() ?? 0;
      const bDate = bInv?.requestorApprovedAt?.getTime() ?? 0;
      return bDate - aDate;
    });

    const items: AttentionItem[] = outstanding.map((line) => {
      // Pick the first unreceived approved invoice (most recently approved)
      const invoice = line.purchaseOrder.invoices.find(
        (inv) => countActiveReceipts(inv.receipts) === 0
      ) ?? line.purchaseOrder.invoices[0];
      const supplierName = line.purchaseOrder.supplier.name;
      return {
        type: "service_receipt_ready",
        poLineId: line.id,
        poId: line.purchaseOrder.id,
        poNumber: line.purchaseOrder.poNumber,
        lineDescription: line.description,
        vendorName: supplierName,
        invoiceApprovedAt:
          invoice?.requestorApprovedAt?.toISOString() ?? null,
        invoiceApprovedByName: invoice?.requestorApprovedByName ?? null,
        invoiceNumber: invoice?.invoiceNumber ?? "",
        invoiceId: invoice?.id ?? "",
        quantityOrdered: Number(line.quantity),
        quantityReceived: Number(line.receivedQuantity),
        requestedBy: line.requisition?.requestedBy
          ? `${line.requisition.requestedBy.firstName} ${line.requisition.requestedBy.lastName}`.trim()
          : null,
      };
    });

    return NextResponse.json({
      items,
      counts: {
        serviceReceiptReady: items.length,
      },
    });
  } catch (error) {
    logger.error("[attention-items] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch attention items" },
      { status: 500 }
    );
  }
}
