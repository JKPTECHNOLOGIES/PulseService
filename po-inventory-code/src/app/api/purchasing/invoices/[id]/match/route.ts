/**
 * Invoice Match API Route
 *
 * Match invoice to PO and receipt (3-way matching).
 * POST /api/purchasing/invoices/:id/match
 *
 * Migrated: 2025-11-18
 * Part of: Phase 3.4 - Purchasing Routes Migration
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { invoiceService } from "@/services/purchasing";
import { z } from "zod";
import { BadRequestError, InternalServerError } from "@/lib/api-errors";

/**
 * Schema for invoice matching request
 */
const invoiceMatchSchema = z.object({
  purchaseOrderId: z.string().uuid("Invalid purchase order ID").optional(),
  quantityTolerance: z.number().min(0).max(100).default(5), // Percentage
  priceTolerance: z.number().min(0).max(100).default(2), // Percentage
  autoApprove: z.boolean().default(false), // Auto-approve if within tolerance
});

/**
 * POST /api/purchasing/invoices/[id]/match
 * Match invoice to PO and receiving records
 */
export const POST = createApiHandler(
  {
    bodySchema: invoiceMatchSchema,
    hasParams: true,
  },
  async (_req, context) => {
    try {
    const invoiceId = context.params.id;
    const data = context.data;

    // Get invoice to find PO
    const invoice = await invoiceService.findById(
      context.serviceContext,
      invoiceId
    );

    if (!invoice.purchaseOrderId && !data.purchaseOrderId) {
      throw new BadRequestError(
        "Invoice must be linked to a purchase order for matching"
      );
    }

    const poId = data.purchaseOrderId ?? (invoice.purchaseOrderId as string);

    // Perform 3-way match
    const matchResult = await invoiceService.perform3WayMatch(
      context.serviceContext,
      {
        invoiceId,
        purchaseOrderId: poId,
        tolerance: data.quantityTolerance,
      }
    );

    // Auto-approve if requested and within tolerance
    let updatedInvoice = invoice;
    if (
      data.autoApprove &&
      matchResult.matched &&
      matchResult.withinTolerance
    ) {
      updatedInvoice = await invoiceService.approve(
        context.serviceContext,
        invoiceId,
        {
          notes: "Auto-approved after successful 3-way match",
        }
      );
    }

    return success(
      {
        invoice: updatedInvoice,
        matchResult,
        autoApproved:
          data.autoApprove &&
          matchResult.matched &&
          matchResult.withinTolerance,
      },
      matchResult.matched
        ? "Invoice matched successfully"
        : "Invoice matching completed with discrepancies"
    );
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
