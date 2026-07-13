/**
 * Requisition Documents API Routes
 *
 * GET /api/purchasing/requisitions/:id/documents - List documents for requisition
 * POST /api/purchasing/requisitions/:id/documents - Upload document to requisition
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { documentService } from "@/services/documents";
import { DocumentEntityType } from "@/lib/document-entity-registry";
import {
  handleDocumentUpload,
  formatDocumentsResponse,
} from "@/app/api/_helpers/document-api-helpers";

/**
 * GET /api/purchasing/requisitions/:id/documents
 * List all documents attached to requisition
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const documents = await documentService.getByRelatedEntity(
      context.serviceContext,
      DocumentEntityType.REQUISITION,
      context.params.id
    );

    const formattedDocuments = formatDocumentsResponse(
      documents as unknown as Record<string, unknown>[]
    );
    return success(formattedDocuments, "Documents retrieved successfully");
  }
);

/**
 * POST /api/purchasing/requisitions/:id/documents
 * Upload a document to requisition
 */
export const POST = createGetHandlerWithParams(
  async (req: NextRequest, context: ApiContextWithParams) => {
    return await handleDocumentUpload(
      req,
      context.serviceContext,
      DocumentEntityType.REQUISITION,
      context.params.id,
      "Quote", // Default for requisitions
    );
  }
);
