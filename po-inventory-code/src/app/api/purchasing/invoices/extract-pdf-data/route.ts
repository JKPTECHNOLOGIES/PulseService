/**
 * Extract Invoice Data from PDF API
 * POST /api/purchasing/invoices/extract-pdf-data
 * Extracts invoice data from uploaded PDF using OCR
 */

import { NextRequest } from 'next/server';
import { createApiHandler, BaseApiContext } from '@/lib/api-middleware-v2';
import { success } from '@/lib/api-response';
import { ValidationError, NotFoundError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import { InvoicePDFParserService } from '@/services/purchasing/invoice-pdf-parser.service';

/**
 * POST /api/purchasing/invoices/extract-pdf-data
 * Extract invoice data from PDF file
 */
export const POST = createApiHandler(
  {},
  async (req: NextRequest, _context: BaseApiContext) => {
    try {
    // Get the form data
    const formData = await req.formData();
    const fileEntry = formData.get('file');

    if (!fileEntry) {
      throw new ValidationError('No file provided');
    }
    const file = fileEntry as File;

    // Validate file type
    if (file.type !== 'application/pdf') {
      throw new ValidationError('Only PDF files are allowed');
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract invoice data from PDF
    const extractedData = await InvoicePDFParserService.extractInvoiceData(buffer);

    return success(extractedData);
  
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
