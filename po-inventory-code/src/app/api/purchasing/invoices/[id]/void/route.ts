/**
 * Invoice Void API Route
 *
 * POST /api/purchasing/invoices/[id]/void
 *
 * Voids an invoice (Approved, Paid, Disputed, Pending Approval, or Pending Review) by:
 *  1. Reversing all posted GL transactions for the invoice
 *  2. Resetting PO service-line invoice match flags
 *  3. Setting invoice status to VOIDED and clearing paid amount
 *
 * Finance team uses this when an invoice was uploaded to the wrong PO
 * or needs to be fully reversed after approval/payment.
 *
 * Requires: purchasing:update permission (Admin / Finance / Finance Manager roles)
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { invoiceService } from "@/services/purchasing";
import { buildServiceContext } from "@/lib/route-helpers";
import { handleError } from "@/lib/api-response";
import { z } from "zod";

const voidBodySchema = z.object({
  reason: z.string().min(1, "Void reason is required").max(1000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await buildServiceContext();

    const { id: invoiceId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const { reason } = voidBodySchema.parse(body);

    const voidedInvoice = await invoiceService.voidInvoice(
      context,
      invoiceId,
      reason,
    );

    return NextResponse.json({
      success: true,
      data: voidedInvoice,
      message:
        "Invoice voided successfully. All GL entries have been reversed.",
    });
  } catch (error) {
    return handleError(error);
  }
}
