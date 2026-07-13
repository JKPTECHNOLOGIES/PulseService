import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import {
  AgingBucket,
  AgingBucketTotals,
  AgingInvoiceRow,
  AgingReportData,
  AgingSupplierGroup,
  computeAgingBucket,
  computeDaysOverdue,
  emptyBucketTotals,
  addToBucketTotals,
} from "@/types/invoice-aging.types";
import { logger } from "@/lib/logger";

/**
 * GET /api/purchasing/invoices/aging
 *
 * Returns full aging report data as JSON.
 *
 * Query Parameters:
 *   supplierId        - filter to single supplier ID
 *   excludeStatuses   - CSV of statuses to exclude (default: Paid,Void,Cancelled)
 *   dueDateFrom       - YYYY-MM-DD lower bound on dueDate
 *   dueDateTo         - YYYY-MM-DD upper bound on dueDate
 *   invoiceDateFrom   - YYYY-MM-DD lower bound on invoiceDate
 *   invoiceDateTo     - YYYY-MM-DD upper bound on invoiceDate
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parse filters
    const supplierId = searchParams.get("supplierId") ?? null;
    const excludeStatusesParam = searchParams.get("excludeStatuses");
    const excludedStatuses = excludeStatusesParam
      ? excludeStatusesParam.split(",").map((s) => s.trim()).filter(Boolean)
      : ["Paid", "Void", "Cancelled"];

    const dueDateFrom = searchParams.get("dueDateFrom") ?? null;
    const dueDateTo = searchParams.get("dueDateTo") ?? null;
    const invoiceDateFrom = searchParams.get("invoiceDateFrom") ?? null;
    const invoiceDateTo = searchParams.get("invoiceDateTo") ?? null;

    // Fetch invoices with flexible filter building
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
        supplier: {
          select: { id: true, name: true, code: true },
        },
        purchaseOrder: {
          select: { poNumber: true },
        },
        documents: {
          where: { mimeType: "application/pdf", isActive: true },
          select: { id: true, filePath: true, fileName: true },
        },
      },
      orderBy: [
        { supplier: { name: "asc" } },
        { dueDate: "asc" },
      ],
    });

    // Compute aging in JavaScript (more flexible than SQL)
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
        hasPdfAttachment: inv.documents.length > 0,
      };

      // Group by supplier
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

    const supplierGroups = Array.from(supplierMap.values());

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
      supplierGroups,
      grandTotals,
      totalInvoiceCount: invoices.length,
    };

    return NextResponse.json(reportData);
  } catch (error) {
    logger.error("[invoice-aging] Unexpected error:", String(error));
    const message = error instanceof Error ? error.message : "Failed to load aging data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
