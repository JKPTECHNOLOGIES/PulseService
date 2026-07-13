import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { InvoiceApprovalService } from "@/services/purchasing/invoice-approval.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { Decimal } from "@prisma/client/runtime/library";
import { logger } from "@/lib/logger";
import { invoiceDateStringSchema, parseInvoiceDate } from "@/lib/validation";
import {
  saveInvoicePdfAtomic,
  deletePdfOnRollback,
  InvoicePdfValidationError,
} from "@/lib/invoice-pdf-storage";

interface InvoiceLineItem {
  quantity?: Decimal | number | null;
  unitPrice?: Decimal | number | null;
  totalPrice?: Decimal | number | null;
  matchedQuantity?: Decimal | number | null;
  [key: string]: unknown;
}

interface InvoiceRecord {
  subtotal?: Decimal | number | null;
  totalAmount?: Decimal | number | null;
  tax?: Decimal | number | null;
  shippingCost?: Decimal | number | null;
  paidAmount?: Decimal | number | null;
  balanceAmount?: Decimal | number | null;
  lineItems?: InvoiceLineItem[];
  [key: string]: unknown;
}

// Helper to serialize Prisma Decimal types to numbers for JSON response
function serializeInvoice(invoice: InvoiceRecord) {
  return {
    ...invoice,
    subtotal: invoice.subtotal ? Number(invoice.subtotal) : 0,
    totalAmount: invoice.totalAmount ? Number(invoice.totalAmount) : 0,
    tax: invoice.tax ? Number(invoice.tax) : 0,
    shippingCost: invoice.shippingCost ? Number(invoice.shippingCost) : 0,
    paidAmount: invoice.paidAmount ? Number(invoice.paidAmount) : 0,
    balanceAmount: invoice.balanceAmount ? Number(invoice.balanceAmount) : 0,
    lineItems: invoice.lineItems?.map((item: InvoiceLineItem) => ({
      ...item,
      quantity: item.quantity ? Number(item.quantity) : 0,
      unitPrice: item.unitPrice ? Number(item.unitPrice) : 0,
      totalPrice: item.totalPrice ? Number(item.totalPrice) : 0,
      matchedQuantity: item.matchedQuantity ? Number(item.matchedQuantity) : 0,
    })),
  };
}

const uploadInvoiceSchema = z
  .object({
    purchaseOrderId: z.string().min(1, "purchaseOrderId is required"),
    invoiceNumber: z.string().min(1, "invoiceNumber is required"),
    // MIN_INVOICE_YEAR guard: rejects 2-digit-year parses like "1926" at the edge.
    invoiceDate: invoiceDateStringSchema,
    dueDate: invoiceDateStringSchema.optional(),
    totalAmount: z.number().positive("totalAmount must be positive"),
    subtotal: z.number().min(0).optional(),
    tax: z.number().min(0).optional(),
    shippingCost: z.number().min(0).optional(),
    notes: z.string().optional(),
    // Prepayment / pre-shipment approval (customer 2026-04-20)
    paymentApprovalRequired: z.boolean().optional(),
    paymentApprovalReason: z.string().optional(),
  })
  .refine(
    (d) =>
      !d.paymentApprovalRequired ||
      (d.paymentApprovalReason?.trim().length ?? 0) > 0,
    {
      message: "Reason is required when Payment Approval is checked",
      path: ["paymentApprovalReason"],
    },
  );

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

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Role-based upload gate
    const userRole = (session.user.role || "").toLowerCase();
    if (!UPLOAD_ALLOWED_ROLES.includes(userRole)) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to upload invoices" },
        { status: 403 },
      );
    }

    // Parse FormData from request
    const formData = await request.formData();

    // Extract file
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Extract fields from FormData
    const invoiceDate = formData.get("invoiceDate") as string;
    const dueDate = formData.get("dueDate") as string | null;
    const notes = formData.get("notes") as string | null;
    const receiptIdsStr = formData.get("receiptIds") as string | null;
    const lineIdsStr = formData.get("lineIds") as string | null;
    const purchaseOrderId = formData.get("purchaseOrderId") as string;
    const approverId = formData.get("approverId") as string | null;

    // Prepayment flag (customer 2026-04-20) — FormData strings, parse booleans
    const paymentApprovalRequired =
      formData.get("paymentApprovalRequired") === "true";
    const paymentApprovalReasonRaw = formData.get("paymentApprovalReason") as
      | string
      | null;
    const paymentApprovalReason = paymentApprovalReasonRaw?.trim() ?? undefined;

    // Extract variance adjustment fields
    const shippingCostStr = formData.get("shippingCost") as string | null;
    const taxStr = formData.get("tax") as string | null;
    const otherAdjustmentStr = formData.get("otherAdjustment") as string | null;
    const otherAdjustmentDescription = formData.get(
      "otherAdjustmentDescription",
    ) as string | null;

    // Parse variance amounts safely (fallback to 0)
    const parsedShippingCost = shippingCostStr
      ? parseFloat(shippingCostStr) || 0
      : 0;
    const parsedTax = taxStr ? parseFloat(taxStr) || 0 : 0;
    const parsedOtherAdjustment = otherAdjustmentStr
      ? parseFloat(otherAdjustmentStr) || 0
      : 0;

    // Convert date strings — use parseInvoiceDate which enforces MIN_INVOICE_YEAR
    // and anchors to local midnight. Throws ValidationError for year<2000 or NaN
    // so a bogus "1926" value is stopped before it reaches the DB.
    const invoiceDateISO = invoiceDate
      ? parseInvoiceDate(invoiceDate, "invoiceDate").toISOString()
      : "";
    const dueDateISO = dueDate
      ? parseInvoiceDate(dueDate, "dueDate").toISOString()
      : undefined;

    // Calculate subtotal: totalAmount minus shipping, tax, and other adjustments
    const totalAmountNum = parseFloat(formData.get("totalAmount") as string);
    const calculatedSubtotal =
      totalAmountNum - parsedShippingCost - parsedTax - parsedOtherAdjustment;

    // Build enhanced notes with other adjustment info appended
    const formatCurrency = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }).format(n);
    const enhancedNotes =
      [
        notes,
        parsedOtherAdjustment
          ? `Variance Adjustment: ${formatCurrency(parsedOtherAdjustment)}${otherAdjustmentDescription ? ` - ${otherAdjustmentDescription}` : ""}`
          : null,
      ]
        .filter(Boolean)
        .join("\n") || null;

    const body = {
      purchaseOrderId,
      invoiceNumber: formData.get("invoiceNumber") as string,
      invoiceDate: invoiceDateISO,
      totalAmount: totalAmountNum,
      subtotal: calculatedSubtotal,
      shippingCost: parsedShippingCost,
      tax: parsedTax,
      dueDate: dueDateISO,
      notes: enhancedNotes ?? undefined,
      paymentApprovalRequired,
      paymentApprovalReason,
    };

    const validatedData = uploadInvoiceSchema.parse(body);

    // --- Amount validation: compare invoice amount against PO total ---
    let amountWarning: string | null = null;
    let previouslyInvoiced = 0;
    let existingInvoiceCount = 0;

    if (validatedData.purchaseOrderId && validatedData.totalAmount) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: validatedData.purchaseOrderId },
        select: {
          totalAmount: true,
          poNumber: true,
          lines: { select: { lineType: true } },
        },
      });

      if (po?.totalAmount) {
        const poTotal = Number(po.totalAmount);

        // Use subtotal (freight-excluded) for the ratio — same rule as the approval service.
        // shippingCost is a vendor add-on not included in PO line totals.
        const invoiceAmount = calculatedSubtotal + parsedTax; // = totalAmount - shippingCost

        // SERVICE and CONSUMABLE POs are designed for partial/progressive invoicing.
        // Showing a "too low" warning for these is always misleading — suppress it.
        const isPartialBillingPO =
          po.lines.length > 0 &&
          po.lines.every(
            (l) => l.lineType === "SERVICE" || l.lineType === "CONSUMABLE",
          );

        if (poTotal > 0) {
          const ratio = invoiceAmount / poTotal;

          if (ratio > 1.1) {
            // Always warn on over-billing regardless of PO type
            amountWarning = `Warning: Invoice amount $${invoiceAmount.toFixed(2)} exceeds PO ${po.poNumber} total $${poTotal.toFixed(2)} by ${((ratio - 1) * 100).toFixed(1)}%.`;
          } else if (ratio < 0.25 && !isPartialBillingPO) {
            // Only warn about low ratio for product POs —
            // SERVICE and CONSUMABLE POs are designed for partial/progressive billing
            amountWarning = `Warning: Invoice amount $${invoiceAmount.toFixed(2)} is only ${(ratio * 100).toFixed(1)}% of PO ${po.poNumber} total $${poTotal.toFixed(2)}.`;
          }
        }
      }

      // Check existing invoices for this PO
      const existingInvoices = await prisma.invoice.aggregate({
        where: {
          purchaseOrderId: validatedData.purchaseOrderId,
          voidedAt: null,
        },
        _sum: { totalAmount: true },
        _count: true,
      });

      previouslyInvoiced = Number(existingInvoices._sum.totalAmount ?? 0);
      existingInvoiceCount = existingInvoices._count;
    }

    const context = {
      userId: session.user.id,
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
      userRole: session.user.role || "User",
      roleId: session.user.roleId || "",
      permissions: [],
    };

    // Parse receipt IDs, line IDs, and per-line amounts
    const receiptIds = receiptIdsStr
      ? (JSON.parse(receiptIdsStr) as string[])
      : undefined;
    const lineIds = lineIdsStr
      ? (JSON.parse(lineIdsStr) as string[])
      : undefined;
    const lineAmountsStr = formData.get("lineAmounts") as string | null;
    const lineAmounts = lineAmountsStr
      ? (JSON.parse(lineAmountsStr) as Record<string, number>)
      : undefined;

    // --- Save the PDF file ATOMICALLY with validation ------------------------
    // Sequence:
    //   1. Read buffer from FormData
    //   2. Validate non-empty + PDF magic bytes + stat size-on-disk via
    //      saveInvoicePdfAtomic() — rejects truncated/empty/non-PDF uploads
    //      BEFORE they hit the final path.
    //   3. Run the DB transaction (InvoiceApprovalService.uploadInvoice).
    //   4. If the DB tx throws, call deletePdfOnRollback() to clean up the
    //      orphaned file. Previously, a failed DB tx left the file stranded
    //      (the INV-001468 incident 2026-04-16).
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const saved = await saveInvoicePdfAtomic(file.name, buffer);

    let result;
    try {
      result = await InvoiceApprovalService.uploadInvoice(context, {
        purchaseOrderId: validatedData.purchaseOrderId,
        invoiceNumber: validatedData.invoiceNumber,
        invoiceDate: validatedData.invoiceDate,
        dueDate: validatedData.dueDate ?? undefined,
        totalAmount: validatedData.totalAmount,
        subtotal: validatedData.subtotal,
        shippingCost: validatedData.shippingCost,
        tax: validatedData.tax,
        notes: validatedData.notes,
        uploadedBy: session.user.id,
        uploadedByName: session.user.name || session.user.email,
        receiptIds,
        lineIds,
        lineAmounts,
        filePath: saved.relativePath,
        fileName: file.name,
        fileSize: saved.fileSize, // verified stat size, not reported size
        mimeType: saved.mimeType,
        approverId: approverId ?? undefined,
        paymentApprovalRequired: validatedData.paymentApprovalRequired,
        paymentApprovalReason: validatedData.paymentApprovalReason,
      });
    } catch (err) {
      // DB transaction failed — remove the orphan file we just wrote.
      await deletePdfOnRollback(saved.absolutePath);
      throw err;
    }

    // --- Build structured amount warning from Batch 0 validation fields ---
    // The invoice approval service now populates poTotalAtUpload,
    // cumulativeInvoicedAmount, matchVariancePercent, matchValidationNotes,
    // and autoApprovalEligible on the Invoice record during upload.
    // Surface these as a structured amountWarning when PENDING_REVIEW or OVER_MATCHED.
    const inv = result.invoice as InvoiceRecord & {
      approvalStatus?: string;
      matchStatus?: string;
      poTotalAtUpload?: Decimal | number | null;
      cumulativeInvoicedAmount?: Decimal | number | null;
      matchVariancePercent?: Decimal | number | null;
      matchValidationNotes?: string | null;
      autoApprovalEligible?: boolean | null;
    };

    let structuredAmountWarning: {
      status: string;
      message: string;
      poTotal: number;
      cumulativeInvoiced: number;
      variancePercent: string;
    } | null = null;

    if (
      inv.approvalStatus === "PENDING_REVIEW" ||
      inv.matchStatus === "OVER_MATCHED"
    ) {
      const poTotal = inv.poTotalAtUpload ? Number(inv.poTotalAtUpload) : 0;
      const cumulativeInvoiced = inv.cumulativeInvoicedAmount
        ? Number(inv.cumulativeInvoicedAmount)
        : 0;
      const variancePct = inv.matchVariancePercent
        ? Number(inv.matchVariancePercent)
        : 0;

      structuredAmountWarning = {
        status: String(
          inv.approvalStatus === "PENDING_REVIEW"
            ? "PENDING_REVIEW"
            : "OVER_MATCHED",
        ),
        message:
          inv.matchValidationNotes ??
          "Invoice flagged for review due to amount variance.",
        poTotal,
        cumulativeInvoiced,
        variancePercent: `${(variancePct * 100).toFixed(1)}%`,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        invoice: serializeInvoice(result.invoice as InvoiceRecord),
      },
      message: result.message,
      duplicateWarning: result.duplicateWarning ?? null,
      amountWarning: structuredAmountWarning ?? amountWarning,
      previouslyInvoiced,
      existingInvoiceCount,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 },
      );
    }

    // PDF validation errors (empty file, wrong magic bytes, truncated upload)
    // are user-facing — return 400 with the user-safe message.
    if (error instanceof InvoicePdfValidationError) {
      return NextResponse.json(
        { error: error.userSafeMessage },
        { status: 400 },
      );
    }

    // Log detailed error info for debugging
    const prismaError = error as { code?: string; meta?: unknown };
    logger.error("[Invoice Upload Error]", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown",
      stack:
        error instanceof Error
          ? error.stack?.split("\n").slice(0, 5).join("\n")
          : undefined,
      code: prismaError.code,
      meta: prismaError.meta,
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload invoice",
      },
      { status: 500 },
    );
  }
}
