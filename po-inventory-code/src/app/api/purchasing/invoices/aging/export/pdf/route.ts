import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import {
  AgingBucket,
  AgingInvoiceRow,
  AgingSupplierGroup,
  AgingBucketTotals,
  AgingPdfExportRequest,
  AgingReportData,
  computeAgingBucket,
  computeDaysOverdue,
  emptyBucketTotals,
  addToBucketTotals,
} from "@/types/invoice-aging.types";
import { generateAgingReportPdf } from "@/lib/pdf/invoice-aging-pdf";
import { logger } from "@/lib/logger";

/**
 * POST /api/purchasing/invoices/aging/export/pdf
 *
 * Generates a formatted PDF aging report using pdfkit.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as AgingPdfExportRequest;
    const { filters = {}, includeDetail = true, title = "Invoice Aging Report" } = body;

    const excludedStatuses = filters.excludeStatuses ?? ["Paid", "Void", "Cancelled"];
    const supplierId = filters.supplierId ?? null;
    const dueDateFrom = filters.dueDateFrom ?? null;
    const dueDateTo = filters.dueDateTo ?? null;
    const invoiceDateFrom = filters.invoiceDateFrom ?? null;
    const invoiceDateTo = filters.invoiceDateTo ?? null;

    // Fetch invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { notIn: excludedStatuses },
        ...(supplierId ? { supplierId } : {}),
        ...(dueDateFrom || dueDateTo
          ? {
              dueDate: {
                ...(dueDateFrom ? { gte: new Date(`${dueDateFrom}T00:00:00Z`) } : {}),
                ...(dueDateTo ? { lte: new Date(`${dueDateTo}T23:59:59Z`) } : {}),
              },
            }
          : {}),
        ...(invoiceDateFrom || invoiceDateTo
          ? {
              invoiceDate: {
                ...(invoiceDateFrom ? { gte: new Date(`${invoiceDateFrom}T00:00:00Z`) } : {}),
                ...(invoiceDateTo ? { lte: new Date(`${invoiceDateTo}T23:59:59Z`) } : {}),
              },
            }
          : {}),
      },
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        purchaseOrder: { select: { poNumber: true } },
      },
      orderBy: [
        { supplier: { name: "asc" } },
        { dueDate: "asc" },
      ],
    });

    const today = new Date();
    const supplierMap = new Map<string, AgingSupplierGroup>();
    const grandTotals: AgingBucketTotals = emptyBucketTotals();

    for (const inv of invoices) {
      const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
      const bucket: AgingBucket = computeAgingBucket(dueDate, today);
      const daysOverdue = computeDaysOverdue(dueDate, today);
      const balanceDue = Number(inv.totalAmount) - Number(inv.paidAmount);

      const row: AgingInvoiceRow = {
        id: inv.id,
        internalNumber: inv.internalNumber,
        invoiceNumber: inv.invoiceNumber,
        supplierId: inv.supplierId,
        supplierName: inv.supplier.name,
        supplierCode: inv.supplier.code ?? "",
        poNumber: inv.purchaseOrder?.poNumber ?? null,
        invoiceDate: format(new Date(inv.invoiceDate), "yyyy-MM-dd"),
        dueDate: dueDate ? format(dueDate, "yyyy-MM-dd") : null,
        daysOverdue,
        subtotal: Number(inv.subtotal),
        tax: Number(inv.tax),
        shippingCost: Number(inv.shippingCost),
        totalAmount: Number(inv.totalAmount),
        paidAmount: Number(inv.paidAmount),
        balanceDue,
        status: inv.status,
        bucket,
        hasPdfAttachment: false,
      };

      const sid = inv.supplierId;
      if (!supplierMap.has(sid)) {
        supplierMap.set(sid, {
          supplierId: sid,
          supplierName: inv.supplier.name,
          supplierCode: inv.supplier.code ?? "",
          invoices: [],
          bucketTotals: emptyBucketTotals(),
        });
      }
      const group = supplierMap.get(sid);
      if (!group) continue;
      group.invoices.push(row);
      addToBucketTotals(group.bucketTotals, bucket, balanceDue);
      addToBucketTotals(grandTotals, bucket, balanceDue);
    }

    const reportData: AgingReportData = {
      asOf: new Date().toISOString(),
      filters: {
        excludedStatuses,
        supplierId,
        dueDateFrom,
        dueDateTo,
        invoiceDateFrom,
        invoiceDateTo,
      },
      supplierGroups: Array.from(supplierMap.values()),
      grandTotals,
      totalInvoiceCount: invoices.length,
    };

    const pdfBuffer = await generateAgingReportPdf(reportData, { includeDetail, title });
    const filename = `invoice-aging-${format(today, "yyyy-MM-dd")}.pdf`;

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("[invoice-aging-pdf] Unexpected error:", String(error));
    const message = error instanceof Error ? error.message : "Failed to generate PDF";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
