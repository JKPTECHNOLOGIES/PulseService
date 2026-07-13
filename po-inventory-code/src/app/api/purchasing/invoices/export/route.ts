import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { logger } from "@/lib/logger";

/**
 * POST /api/purchasing/invoices/export
 *
 * Accepts a JSON body:
 * {
 *   dateFrom?: string;   // ISO date string (invoice date >=)
 *   dateTo?: string;     // ISO date string (invoice date <=)
 *   fields: string[];    // array of field keys to include in the export
 * }
 *
 * Returns an .xlsx file as a downloadable response.
 */

// All recognised field keys → column header label
const FIELD_LABELS: Record<string, string> = {
  invoiceNumber: "Invoice Number",
  internalNumber: "Internal Number",
  invoiceDate: "Invoice Date",
  dueDate: "Due Date",
  status: "Status",
  approvalStatus: "Approval Status",
  supplierName: "Supplier Name",
  supplierCode: "Supplier Code",
  poNumber: "PO Number",
  poLineDescription: "PO Line Description",
  subtotal: "Subtotal",
  taxAmount: "Tax Amount",
  shippingCost: "Shipping Cost",
  totalAmount: "Total Amount",
  paidAmount: "Amount Paid",
  balanceDue: "Balance Due",
  createdAt: "Created Date",
  createdBy: "Created By",
  updatedAt: "Last Updated",
};

// Ordered list so the sheet columns follow a logical sequence
const FIELD_ORDER = Object.keys(FIELD_LABELS);

interface ExportRequestBody {
  dateFrom?: string;
  dateTo?: string;
  fields: string[];
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as ExportRequestBody;
    const { dateFrom, dateTo, fields } = body;

    if (!Array.isArray(fields) || fields.length === 0) {
      return NextResponse.json(
        { error: "At least one field must be selected" },
        { status: 400 },
      );
    }

    // Only keep valid field keys, maintaining the logical column order
    const requestedFields = FIELD_ORDER.filter((k) => fields.includes(k));

    // Build date range filter on invoiceDate
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) {
      dateFilter.gte = new Date(`${dateFrom}T00:00:00`);
    }
    if (dateTo) {
      dateFilter.lte = new Date(`${dateTo}T23:59:59`);
    }

    // Fetch invoices from DB
    // NOTE: `uploadedBy` is a scalar String? field (not a relation), so we do NOT include it.
    // `uploadedByName` is the denormalized display name stored directly on Invoice.
    const invoices = await prisma.invoice.findMany({
      where: {
        ...(Object.keys(dateFilter).length > 0
          ? { invoiceDate: dateFilter }
          : {}),
      },
      orderBy: { invoiceDate: "desc" },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            lines: {
              select: {
                id: true,
                description: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    // Build worksheet rows
    // Row 1: headers
    const headers = requestedFields.map((k) => FIELD_LABELS[k] ?? k);

    // Data rows
    const rows = invoices.map((inv) => {
      const balance = Number(inv.totalAmount) - Number(inv.paidAmount);

      const poLineDesc = inv.purchaseOrder?.lines[0]?.description ?? "";

      // `uploadedByName` is the denormalized display-name scalar stored on Invoice.
      // `uploadedBy` is a plain String? FK — not a User relation — so we read the name directly.
      const createdByName = inv.uploadedByName ?? "";

      const rowMap: Record<string, string | number> = {
        invoiceNumber: inv.invoiceNumber,
        internalNumber: inv.internalNumber,
        invoiceDate: format(new Date(inv.invoiceDate), "yyyy-MM-dd"),
        dueDate: inv.dueDate ? format(new Date(inv.dueDate), "yyyy-MM-dd") : "",
        status: inv.status,
        approvalStatus: String(inv.approvalStatus),
        supplierName: inv.supplier.name,
        supplierCode: inv.supplier.code ?? "",
        poNumber: inv.purchaseOrder?.poNumber ?? "",
        poLineDescription: poLineDesc,
        // `subtotal` is a real field on the Invoice model (Decimal)
        subtotal: Number(inv.subtotal),
        // The schema field is `tax`, not `taxAmount`
        taxAmount: Number(inv.tax),
        // Vendor-added freight / shipping surcharge (separate from PO line totals)
        shippingCost: Number(inv.shippingCost),
        totalAmount: Number(inv.totalAmount),
        paidAmount: Number(inv.paidAmount),
        balanceDue: balance,
        createdAt: format(new Date(inv.createdAt), "yyyy-MM-dd"),
        createdBy: createdByName,
        updatedAt: format(new Date(inv.updatedAt), "yyyy-MM-dd"),
      };

      return requestedFields.map((k) => rowMap[k] ?? "");
    });

    // Build XLSX workbook
    const workbook = XLSX.utils.book_new();

    // Summary sheet
    const dateRangeLabel =
      dateFrom && dateTo
        ? `${dateFrom} to ${dateTo}`
        : dateFrom
          ? `From ${dateFrom}`
          : dateTo
            ? `To ${dateTo}`
            : "All dates";

    const summaryData: (string | number)[][] = [
      ["Invoices Export"],
      ["Generated:", format(new Date(), "yyyy-MM-dd HH:mm:ss")],
      ["Date Range:", dateRangeLabel],
      ["Total Records:", invoices.length],
      [
        "Fields Exported:",
        requestedFields.map((k) => FIELD_LABELS[k]).join(", "),
      ],
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet["!cols"] = [{ wch: 20 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    // Invoices sheet
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Auto-size columns
    ws["!cols"] = headers.map(() => ({ wch: 18 }));

    XLSX.utils.book_append_sheet(workbook, ws, "Invoices");

    // Generate buffer
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    const filename = `invoices-export-${format(new Date(), "yyyy-MM-dd")}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("[invoice-export] Unexpected error:", String(error));
    const message =
      error instanceof Error ? error.message : "Failed to export invoices";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
