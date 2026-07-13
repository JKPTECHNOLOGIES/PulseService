/**
 * Match Invoice to Receipts API
 * POST /api/purchasing/invoices/[id]/match-receipts
 * Match an existing invoice to specific receipts
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from 'next/server';
import { createGetHandlerWithParams, createApiHandler, ApiContextWithParams } from '@/lib/api-middleware-v2';
import { success } from '@/lib/api-response';
import { ValidationError, NotFoundError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import { InvoiceReceiptMatchingService } from '@/services/purchasing/invoice-receipt-matching.service';

export const POST = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
    const invoiceId = context.params.id;
    const body = await request.json() as Record<string, unknown>;
    const receiptIds = body.receiptIds as string[] | undefined;

    // Validate input
    if (!receiptIds || !Array.isArray(receiptIds) || receiptIds.length === 0) {
      throw new ValidationError('Receipt IDs are required');
    }

    // Match invoice to receipts
    const result = await InvoiceReceiptMatchingService.matchInvoiceToReceipts(
      invoiceId,
      receiptIds
    );

    if (!result.success) {
      throw new ValidationError(result.message ?? 'Failed to match receipts');
    }

    return success({
      invoice: result.invoice,
      matchedReceipts: result.matchedReceipts,
      variances: result.variances,
      message: result.message,
    });
  
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthorizationError
      ) {
        throw error;
      }
      
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// GET endpoint to retrieve currently matched receipts
export const GET = createGetHandlerWithParams(
  async (_request: NextRequest, context: ApiContextWithParams) => {
    const invoiceId = context.params.id;

    // Get matched receipts
    const receipts = await InvoiceReceiptMatchingService.getInvoiceReceipts(invoiceId);

    return success({ receipts });
  }
);

// DELETE endpoint to unmatch receipts from invoice
export const DELETE = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, _context: ApiContextWithParams) => {
    try {
    const body = await request.json() as Record<string, unknown>;
    const receiptIds = body.receiptIds as string[] | undefined;

    // Validate input
    if (!receiptIds || !Array.isArray(receiptIds) || receiptIds.length === 0) {
      throw new ValidationError('Receipt IDs are required');
    }

    // Unmatch receipts
    await InvoiceReceiptMatchingService.unmatchReceipts(receiptIds);

    return success({ message: 'Receipts unmatched successfully' });
  
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthorizationError
      ) {
        throw error;
      }
      
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
