/**
 * Inventory Item Document Detail API Routes
 *
 * GET /api/inventory/items/:id/documents/:docId - Get single document metadata
 * PATCH /api/inventory/items/:id/documents/:docId - Update document metadata
 * DELETE /api/inventory/items/:id/documents/:docId - Delete document
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  createDeleteHandler,
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { documentService } from "@/services/documents";
import { InternalServerError } from "@/lib/api-errors";
import {
  handleDocumentUpdate,
  handleDocumentDelete,
  formatDocumentResponse,
} from "@/app/api/_helpers/document-api-helpers";

/**
 * GET /api/inventory/items/:id/documents/:docId
 * Get single document metadata
 */
export const GET = createGetHandlerWithParams<{ id: string; docId: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    const document = await documentService.getById(
      context.serviceContext,
      context.params.docId
    );

    const formattedDocument = formatDocumentResponse(
      document as unknown as Record<string, unknown>
    );
    return success(formattedDocument, "Document retrieved successfully");
  }
);

/**
 * PATCH /api/inventory/items/:id/documents/:docId
 * Update document metadata
 */
export const PATCH = createApiHandler(
  { hasParams: true },
  async (req: NextRequest, context: ApiContextWithParams<{ id: string; docId: string }>) => {
    try {
    const data = await req.json() as Record<string, unknown>;
    return await handleDocumentUpdate(
      context.serviceContext,
      context.params.docId,
      data
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

/**
 * DELETE /api/inventory/items/:id/documents/:docId
 * Delete document
 */
export const DELETE = createDeleteHandler<{ id: string; docId: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    return await handleDocumentDelete(
      context.serviceContext,
      context.params.docId
    );
  }
);
