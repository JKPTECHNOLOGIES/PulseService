/**
 * Invoice Pay API Route
 *
 * Record payment for an invoice.
 *
 * Migrated: 2025-11-18
 * Part of: Phase 3.4 - Purchasing Routes Migration
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { invoiceService } from "@/services/purchasing";
import { invoicePaySchema } from "@/services/purchasing/invoice.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/purchasing/invoices/[id]/pay
 * Record payment for an invoice
 */
export const POST = createApiHandler(
  {
    bodySchema: invoicePaySchema,
    hasParams: true,
  },
  async (_req, context) => {
    try {
    const invoice = await invoiceService.pay(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(invoice, "Payment recorded successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
