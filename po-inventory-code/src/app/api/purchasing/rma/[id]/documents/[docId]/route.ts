/**
 * RMA Document Detail API Routes
 *
 * GET /api/purchasing/rma/:id/documents/:docId - Get single document metadata
 * PATCH /api/purchasing/rma/:id/documents/:docId - Update document metadata
 * DELETE /api/purchasing/rma/:id/documents/:docId - Delete document
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  createDeleteHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { documentService } from "@/services/documents";
import {
  handleDocumentUpdate,
  handleDocumentDelete,
  formatDocumentResponse,
} from "@/app/api/_helpers/document-api-helpers";

/**
 * GET /api/purchasing/rma/:id/documents/:docId
 * Get single document metadata
 */
export const GET = createGetHandlerWithParams<{ id: string; docId: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    const document = await documentService.getById(
      context.serviceContext,
      context.params.docId,
    );

    const formattedDocument = formatDocumentResponse(
      document as unknown as Record<string, unknown>,
    );
    return success(formattedDocument, "Document retrieved successfully");
  },
);

/**
 * PATCH /api/purchasing/rma/:id/documents/:docId
 * Update document metadata
 */
export const PATCH = createGetHandlerWithParams<{ id: string; docId: string }>(
  async (
    req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    const data = (await req.json()) as Record<string, unknown>;
    return await handleDocumentUpdate(
      context.serviceContext,
      context.params.docId,
      data,
    );
  },
);

/**
 * DELETE /api/purchasing/rma/:id/documents/:docId
 * Delete document
 */
export const DELETE = createDeleteHandler<{ id: string; docId: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    return await handleDocumentDelete(
      context.serviceContext,
      context.params.docId,
    );
  },
);
