/**
 * Purchase Order Close Info API Route
 *
 * Provides pre-close summary information for a purchase order,
 * including pending invoices, line-level receiving status, and totals.
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { NotFoundError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/purchasing/purchase-orders/[id]/close-info
 * Get pre-close summary for a purchase order
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    const poId = context.params.id;

    // Get PO with lines
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: {
          select: {
            id: true,
            description: true,
            quantity: true,
            unitPrice: true,
            receivedQuantity: true,
            receivedAmount: true,
            requiresInvoiceMatch: true,
            invoiceMatched: true,
          },
        },
      },
    });

    if (!po) {
      throw new NotFoundError("Purchase order", poId);
    }

    // Get pending invoices (not fully approved and not voided)
    const pendingInvoices = await prisma.invoice.findMany({
      where: {
        purchaseOrderId: poId,
        approvalStatus: {
          notIn: ["FULLY_APPROVED", "REQUESTOR_APPROVED"],
        },
        voidedAt: null,
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        approvalStatus: true,
      },
    });

    // Calculate summary
    const totalOrdered = po.lines.reduce(
      (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice),
      0,
    );
    const totalReceived = po.lines.reduce(
      (sum, line) => sum + Number(line.receivedAmount),
      0,
    );
    const unreceivedAmount = totalOrdered - totalReceived;
    const linesSummary = po.lines.map((line) => ({
      id: line.id,
      description: line.description,
      ordered: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      receivedQty: Number(line.receivedQuantity),
      receivedAmount: Number(line.receivedAmount),
      unreceived:
        Number(line.quantity) * Number(line.unitPrice) -
        Number(line.receivedAmount),
      requiresInvoiceMatch: line.requiresInvoiceMatch,
      invoiceMatched: line.invoiceMatched,
    }));

    return success({
      poNumber: po.poNumber,
      status: po.status,
      totalOrdered,
      totalReceived,
      unreceivedAmount,
      pendingInvoices,
      pendingInvoiceCount: pendingInvoices.length,
      pendingInvoiceTotal: pendingInvoices.reduce(
        (sum, inv) => sum + Number(inv.totalAmount),
        0,
      ),
      lines: linesSummary,
      lineCount: po.lines.length,
      fullyReceivedLineCount: po.lines.filter(
        (l) => Number(l.receivedQuantity) >= Number(l.quantity),
      ).length,
    });
  },
);
