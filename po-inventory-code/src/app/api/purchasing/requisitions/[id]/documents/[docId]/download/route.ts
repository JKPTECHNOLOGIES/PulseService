/**
 * Requisition Document Download API Route
 *
 * GET /api/purchasing/requisitions/:id/documents/:docId/download - Download or view document
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { handleDocumentDownload } from "@/app/api/_helpers/document-api-helpers";

/**
 * GET /api/purchasing/requisitions/:id/documents/:docId/download
 * Download or view a document file
 *
 * Query params:
 * - view: 'true' to view inline (for PDFs/images), otherwise download
 */
export const GET = createGetHandlerWithParams<{ id: string; docId: string }>(
  async (
    req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    const { searchParams } = new URL(req.url);
    const isView = searchParams.get("view") === "true";

    const response = await handleDocumentDownload(
      context.serviceContext,
      context.params.docId,
      isView
    );
    
    return response;
  }
);
