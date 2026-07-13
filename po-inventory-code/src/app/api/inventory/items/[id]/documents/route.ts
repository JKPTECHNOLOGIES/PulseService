/**
 * Inventory Item Documents API Routes
 *
 * GET /api/inventory/items/:id/documents - List documents for inventory item
 * POST /api/inventory/items/:id/documents - Upload document to inventory item
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { documentService } from "@/services/documents";
import { DocumentEntityType } from "@/lib/document-entity-registry";
import { InternalServerError } from "@/lib/api-errors";
import {
  handleDocumentUpload,
  formatDocumentsResponse,
} from "@/app/api/_helpers/document-api-helpers";

/**
 * GET /api/inventory/items/:id/documents
 * List all documents attached to inventory item
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const documents = await documentService.getByRelatedEntity(
      context.serviceContext,
      DocumentEntityType.INVENTORY_ITEM,
      context.params.id
    );

    const formattedDocuments = formatDocumentsResponse(
      documents as unknown as Record<string, unknown>[]
    );
    return success(formattedDocuments, "Documents retrieved successfully");
  }
);

/**
 * POST /api/inventory/items/:id/documents
 * Upload a document to inventory item
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (_req, context) => {
    try {
    return await handleDocumentUpload(
      _req,
      context.serviceContext,
      DocumentEntityType.INVENTORY_ITEM,
      context.params.id,
      "Specification", // Default for inventory items
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
