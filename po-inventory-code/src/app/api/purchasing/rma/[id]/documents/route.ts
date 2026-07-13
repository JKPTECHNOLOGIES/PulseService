/**
 * RMA Documents API Routes
 *
 * GET /api/purchasing/rma/:id/documents - List documents for an RMA
 * POST /api/purchasing/rma/:id/documents - Upload document to an RMA
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
 * GET /api/purchasing/rma/:id/documents
 * List all documents attached to an RMA
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const documents = await documentService.getByRelatedEntity(
      context.serviceContext,
      DocumentEntityType.RMA,
      context.params.id,
    );

    const formattedDocuments = formatDocumentsResponse(
      documents as unknown as Record<string, unknown>[],
    );
    return success(formattedDocuments, "Documents retrieved successfully");
  },
);

/**
 * POST /api/purchasing/rma/:id/documents
 * Upload a document to an RMA
 */
export const POST = createGetHandlerWithParams(
  async (req: NextRequest, context: ApiContextWithParams) => {
    return await handleDocumentUpload(
      req,
      context.serviceContext,
      DocumentEntityType.RMA,
      context.params.id,
      "Credit Memo", // Default document type for RMAs
    );
  },
);
