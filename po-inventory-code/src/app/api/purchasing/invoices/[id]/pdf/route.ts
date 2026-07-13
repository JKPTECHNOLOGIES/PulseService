/**
 * Invoice PDF Re-Upload API Route
 *
 * POST /api/purchasing/invoices/[id]/pdf
 *
 * Allows re-uploading a PDF for an existing invoice. Used when the original
 * upload failed (e.g. network drop produced a 0-byte file) and the invoice
 * detail page shows "No Invoice PDF Found".
 *
 * Created 2026-04-20 in response to the INV-001468 incident.
 *
 * Flow:
 *   1. Validate session + role gate (same roles as primary upload)
 *   2. Verify the invoice exists
 *   3. Reject if invoice already has an active PDF Document (to avoid
 *      ambiguity — user must first delete the old one via documents API)
 *   4. Atomic PDF write with validation via saveInvoicePdfAtomic()
 *   5. Insert Document row linked to invoice + PO
 *   6. On DB insert failure, delete the file we just wrote
 *
 * Does NOT modify the Invoice row itself — only attaches a PDF.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  saveInvoicePdfAtomic,
  deletePdfOnRollback,
  InvoicePdfValidationError,
} from "@/lib/invoice-pdf-storage";

const UPLOAD_ALLOWED_ROLES = [
  "admin",
  "finance manager",
  "finance",
  "plant manager",
  "maintenance manager",
  "purchasing manager",
  "purchasing agent",
  "purchasing",
];

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user.role || "").toLowerCase();
    if (!UPLOAD_ALLOWED_ROLES.includes(userRole)) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to upload invoice PDFs" },
        { status: 403 },
      );
    }

    const { id: invoiceId } = await context.params;
    if (!invoiceId) {
      return NextResponse.json({ error: "Invoice id is required" }, { status: 400 });
    }

    // Verify invoice exists
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        internalNumber: true,
        purchaseOrderId: true,
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Reject if there's already an active INVOICE-type Document linked.
    // The user must explicitly delete the existing PDF first — this avoids
    // silent overwrites.
    const existing = await prisma.document.findFirst({
      where: {
        invoiceId: invoice.id,
        isActive: true,
        documentType: "INVOICE",
      },
      select: { id: true, fileName: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error:
            `Invoice already has a PDF attached (${existing.fileName}). ` +
            `Delete it first via the Supporting Documents tab before re-uploading.`,
          existingDocumentId: existing.id,
        },
        { status: 409 },
      );
    }

    // Parse uploaded file
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate + atomic write
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const saved = await saveInvoicePdfAtomic(file.name, buffer);

    // Insert Document row; clean up file if insert fails
    let document;
    try {
      document = await prisma.document.create({
        data: {
          title: `Invoice ${invoice.internalNumber ?? invoice.invoiceNumber}`,
          description: `Invoice PDF (re-uploaded ${new Date().toISOString()})`,
          fileName: saved.fileName,
          filePath: saved.relativePath,
          fileSize: saved.fileSize,
          mimeType: saved.mimeType,
          documentType: "INVOICE",
          invoiceId: invoice.id,
          purchaseOrderId: invoice.purchaseOrderId,
          uploadedById: session.user.id,
          tags: ["invoice", "purchasing", "re-upload"],
          isActive: true,
        },
        select: { id: true, fileName: true, fileSize: true, createdAt: true },
      });
    } catch (err) {
      await deletePdfOnRollback(saved.absolutePath);
      throw err;
    }

    logger.info("[Invoice PDF Re-Upload] Success", {
      invoiceId: invoice.id,
      invoiceNumber: invoice.internalNumber ?? invoice.invoiceNumber,
      documentId: document.id,
      fileName: document.fileName,
      fileSize: document.fileSize,
    });

    return NextResponse.json({
      success: true,
      message: `PDF uploaded successfully for ${invoice.internalNumber ?? invoice.invoiceNumber}`,
      document,
    });
  } catch (error) {
    if (error instanceof InvoicePdfValidationError) {
      return NextResponse.json({ error: error.userSafeMessage }, { status: 400 });
    }

    logger.error("[Invoice PDF Re-Upload Error]", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : undefined,
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload invoice PDF" },
      { status: 500 },
    );
  }
}
