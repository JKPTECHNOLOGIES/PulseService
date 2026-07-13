import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import { join } from "path";
import { existsSync, promises as fs } from "fs";
import { PDFDocument } from "pdf-lib";
import {
  AgingBucket,
  AgingInvoiceRow,
  InvoiceCopiesExportRequest,
  computeAgingBucket,
  computeDaysOverdue,
} from "@/types/invoice-aging.types";
import { generateSeparatorPage } from "@/lib/pdf/invoice-aging-pdf";
import { logger } from "@/lib/logger";

/**
 * POST /api/purchasing/invoices/aging/export/copies
 *
 * Merges all uploaded invoice PDF attachments matching the filters into
 * a single combined PDF with optional separator pages.
 */

function resolveInvoiceDocumentPath(filePath: string): string {
  const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return join(process.cwd(), "public", normalized);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as InvoiceCopiesExportRequest;
    const {
      filters = {},
      includeSeparatorPages = true,
      sortBy = "supplier",
    } = body;

    const excludedStatuses = filters.excludeStatuses ?? ["Paid", "Void", "Cancelled"];
    const supplierId = filters.supplierId ?? null;
    const dueDateFrom = filters.dueDateFrom ?? null;
    const dueDateTo = filters.dueDateTo ?? null;
    const invoiceDateFrom = filters.invoiceDateFrom ?? null;
    const invoiceDateTo = filters.invoiceDateTo ?? null;
    const bucketFilter = filters.bucket ?? null;

    // Fetch invoices with their documents
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
        documents: {
          where: { mimeType: "application/pdf", isActive: true },
          select: { id: true, filePath: true, fileName: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1, // Use most recently uploaded PDF per invoice
        },
      },
      orderBy:
        sortBy === "dueDate"
          ? { dueDate: "asc" }
          : sortBy === "invoiceDate"
          ? { invoiceDate: "asc" }
          : [{ supplier: { name: "asc" } }, { dueDate: "asc" }],
    });

    const today = new Date();

    // Build aging rows
    const agingRows: AgingInvoiceRow[] = invoices.map((inv) => {
      const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
      const bucket: AgingBucket = computeAgingBucket(dueDate, today);
      const daysOverdue = computeDaysOverdue(dueDate, today);
      const balanceDue = Number(inv.totalAmount) - Number(inv.paidAmount);
      return {
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
    });

    // Apply bucket filter if specified
    const filteredRows = bucketFilter
      ? agingRows.filter((r) => r.bucket === bucketFilter)
      : agingRows;

    // Match aging rows back to their document paths
    const invoiceDocMap = new Map<string, string>();
    for (const inv of invoices) {
      if (inv.documents.length > 0) {
        const doc = inv.documents[0];
        if (doc?.filePath) {
          invoiceDocMap.set(inv.id, doc.filePath);
        }
      }
    }

    // Categorize: found vs missing
    const foundRows: AgingInvoiceRow[] = [];
    const missingRows: AgingInvoiceRow[] = [];

    for (const row of filteredRows) {
      const filePath = invoiceDocMap.get(row.id);
      if (!filePath) {
        missingRows.push(row);
        continue;
      }
      const absolutePath = resolveInvoiceDocumentPath(filePath);
      if (!existsSync(absolutePath)) {
        missingRows.push(row);
      } else {
        foundRows.push(row);
      }
    }

    if (foundRows.length === 0) {
      return NextResponse.json(
        {
          error: "No PDF attachments found matching the selected filters",
          invoiceCount: filteredRows.length,
          missingCount: missingRows.length,
        },
        { status: 422 }
      );
    }

    // Merge PDFs
    const merged = await PDFDocument.create();

    // Add cover page if there are missing files
    if (missingRows.length > 0) {
      const coverDoc = await PDFDocument.create();
      const page = coverDoc.addPage([612, 792]);
      const helvetica = await coverDoc.embedFont("Helvetica");
      const helveticaBold = await coverDoc.embedFont("Helvetica-Bold");

      page.drawText("Invoice Copies Export", {
        x: 72,
        y: 720,
        size: 18,
        font: helveticaBold,
      });
      page.drawText(`Generated: ${format(today, "yyyy-MM-dd HH:mm")}`, {
        x: 72,
        y: 694,
        size: 10,
        font: helvetica,
      });
      page.drawText("The following invoices had no PDF attachment on disk:", {
        x: 72,
        y: 660,
        size: 11,
        font: helveticaBold,
      });

      let lineY = 636;
      for (const row of missingRows) {
        if (lineY < 72) break;
        page.drawText(
          `  ${row.internalNumber} | ${row.invoiceNumber} | ${row.supplierName} | ${row.status}`,
          { x: 72, y: lineY, size: 9, font: helvetica }
        );
        lineY -= 14;
      }

      const [coverPage] = await merged.copyPages(coverDoc, [0]);
      merged.addPage(coverPage);
    }

    // Process each invoice
    for (const row of foundRows) {
      const filePath = invoiceDocMap.get(row.id);
      if (!filePath) continue;
      const absolutePath = resolveInvoiceDocumentPath(filePath);

      // Separator page
      if (includeSeparatorPages) {
        const sepBytes = await generateSeparatorPage(row);
        const sepPdf = await PDFDocument.load(sepBytes);
        const [sepPage] = await merged.copyPages(sepPdf, [0]);
        merged.addPage(sepPage);
      }

      // Invoice PDF
      const invoiceBytes = await fs.readFile(absolutePath);
      const invoicePdf = await PDFDocument.load(invoiceBytes);
      const pages = await merged.copyPages(invoicePdf, invoicePdf.getPageIndices());
      for (const p of pages) {
        merged.addPage(p);
      }
    }

    const mergedBytes = await merged.save();
    const filename = `invoice-copies-${format(today, "yyyy-MM-dd")}.pdf`;

    return new NextResponse(Buffer.from(mergedBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Invoices-Found": String(foundRows.length),
        "X-Invoices-Missing": String(missingRows.length),
      },
    });
  } catch (error) {
    logger.error("[invoice-aging-copies] Unexpected error:", String(error));
    const message = error instanceof Error ? error.message : "Failed to generate invoice copies PDF";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
