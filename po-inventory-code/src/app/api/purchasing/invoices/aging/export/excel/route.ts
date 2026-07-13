import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import {
  AgingBucket,
  AgingInvoiceRow,
  AgingSupplierGroup,
  AgingBucketTotals,
  AgingExcelExportRequest,
  computeAgingBucket,
  computeDaysOverdue,
  emptyBucketTotals,
  addToBucketTotals,
  BUCKET_CONFIG,
} from "@/types/invoice-aging.types";
import { logger } from "@/lib/logger";
import { getBrandingSettings } from "@/services/admin/branding.service";

/**
 * POST /api/purchasing/invoices/aging/export/excel
 *
 * Generates an .xlsx file with three sheets:
 *   - Summary: report metadata + grand totals
 *   - Aging by Supplier: pivot by supplier vs bucket
 *   - Invoice Detail: all matching invoices with aging columns
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as AgingExcelExportRequest;
    const branding = await getBrandingSettings();
    const { filters = {} } = body;

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
    const rows: AgingInvoiceRow[] = [];

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
        hasPdfAttachment: false, // not needed for Excel
      };
      rows.push(row);

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
    const generatedDate = format(new Date(), "yyyy-MM-dd HH:mm:ss");

    // Build filter description
    const filterDesc: string[] = [];
    if (supplierId) filterDesc.push(`Supplier ID: ${supplierId}`);
    if (excludedStatuses.length) filterDesc.push(`Excluded: ${excludedStatuses.join(", ")}`);
    if (dueDateFrom || dueDateTo) filterDesc.push(`Due Date: ${dueDateFrom ?? "—"} to ${dueDateTo ?? "—"}`);
    if (invoiceDateFrom || invoiceDateTo) filterDesc.push(`Invoice Date: ${invoiceDateFrom ?? "—"} to ${invoiceDateTo ?? "—"}`);

    // -----------------------------------------------------------------------
    // Sheet 1: Summary
    // -----------------------------------------------------------------------
    const summaryData: (string | number)[][] = [
      ["Invoice Aging Report"],
      ["Generated:", generatedDate],
      ["As of:", format(today, "yyyy-MM-dd")],
      ["Filters:", filterDesc.join(" | ") || "None"],
      ["Total Invoices:", rows.length],
      [],
      ["Grand Totals by Aging Bucket"],
      ["Bucket", "Balance Due"],
      ["Current", grandTotals.current],
      ["1–30 Days", grandTotals.days1_30],
      ["31–60 Days", grandTotals.days31_60],
      ["61–90 Days", grandTotals.days61_90],
      ["90+ Days", grandTotals.days90Plus],
      ["No Due Date", grandTotals.noDueDate],
      ["TOTAL OUTSTANDING", grandTotals.total],
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet["!cols"] = [{ wch: 25 }, { wch: 18 }];

    // -----------------------------------------------------------------------
    // Sheet 2: Aging by Supplier
    // -----------------------------------------------------------------------
    const pivotHeaders = [
      "Supplier",
      "Code",
      "Invoice Count",
      "Current",
      "1–30 Days",
      "31–60 Days",
      "61–90 Days",
      "90+ Days",
      "No Due Date",
      "Total Outstanding",
    ];

    const pivotRows = supplierGroups.map((g) => [
      g.supplierName,
      g.supplierCode,
      g.invoices.length,
      g.bucketTotals.current,
      g.bucketTotals.days1_30,
      g.bucketTotals.days31_60,
      g.bucketTotals.days61_90,
      g.bucketTotals.days90Plus,
      g.bucketTotals.noDueDate,
      g.bucketTotals.total,
    ]);

    // Grand totals row
    pivotRows.push([
      "GRAND TOTAL",
      "",
      rows.length,
      grandTotals.current,
      grandTotals.days1_30,
      grandTotals.days31_60,
      grandTotals.days61_90,
      grandTotals.days90Plus,
      grandTotals.noDueDate,
      grandTotals.total,
    ]);

    const pivotSheet = XLSX.utils.aoa_to_sheet([pivotHeaders, ...pivotRows]);
    pivotSheet["!cols"] = pivotHeaders.map(() => ({ wch: 18 }));
    pivotSheet["!cols"][0] = { wch: 36 };

    // -----------------------------------------------------------------------
    // Sheet 3: Invoice Detail
    // -----------------------------------------------------------------------
    const detailHeaders = [
      "Invoice #",
      `${branding.companyShortName} #`,
      "Supplier",
      "Supplier Code",
      "PO #",
      "Invoice Date",
      "Due Date",
      "Days Overdue",
      "Subtotal",
      "Tax",
      "Shipping",
      "Total Amount",
      "Amount Paid",
      "Balance Due",
      "Status",
      "Aging Bucket",
    ];

    const detailRows = rows.map((r) => [
      r.invoiceNumber,
      r.internalNumber,
      r.supplierName,
      r.supplierCode,
      r.poNumber ?? "",
      r.invoiceDate,
      r.dueDate ?? "",
      r.dueDate === null ? "" : r.daysOverdue,
      r.subtotal,
      r.tax,
      r.shippingCost,
      r.totalAmount,
      r.paidAmount,
      r.balanceDue,
      r.status,
      BUCKET_CONFIG[r.bucket].label,
    ]);

    const detailSheet = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
    detailSheet["!cols"] = detailHeaders.map(() => ({ wch: 16 }));
    detailSheet["!cols"][2] = { wch: 36 }; // Supplier wide

    // -----------------------------------------------------------------------
    // Build workbook
    // -----------------------------------------------------------------------
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(workbook, pivotSheet, "Aging by Supplier");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Invoice Detail");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `invoice-aging-${format(today, "yyyy-MM-dd")}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("[invoice-aging-excel] Unexpected error:", String(error));
    const message = error instanceof Error ? error.message : "Failed to export aging data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
