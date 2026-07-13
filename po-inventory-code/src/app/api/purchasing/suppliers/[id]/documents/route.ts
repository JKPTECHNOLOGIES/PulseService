/**
 * Supplier Documents API Routes
 *
 * GET /api/purchasing/suppliers/:id/documents - List documents for supplier
 * POST /api/purchasing/suppliers/:id/documents - Upload document to supplier
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { documentService } from "@/services/documents";
import { DocumentEntityType, SECURED_DOC_TYPES } from "@/lib/document-entity-registry";
import {
  handleDocumentUpload,
  formatDocumentsResponse,
} from "@/app/api/_helpers/document-api-helpers";
import { prisma } from "@/lib/prisma";
import { notifySupplierSecuredDocChanged } from "@/services/purchasing/supplier-notifications.service";

/**
 * GET /api/purchasing/suppliers/:id/documents
 * List all documents attached to supplier
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const documents = await documentService.getByRelatedEntity(
      context.serviceContext,
      DocumentEntityType.SUPPLIER,
      context.params.id
    );

    const formattedDocuments = formatDocumentsResponse(
      documents as unknown as Record<string, unknown>[]
    );
    return success(formattedDocuments, "Documents retrieved successfully");
  }
);

/**
 * POST /api/purchasing/suppliers/:id/documents
 * Upload a document to supplier.
 * Fires a notification to Finance + Purchasing roles when the document is
 * marked as secured (isSecured=true) or is a sensitive document type
 * (ACH Form, Bank Letter, W9).
 */
export const POST = createGetHandlerWithParams(
  async (req: NextRequest, context: ApiContextWithParams) => {
    const supplierId = context.params.id;

    // Clone the request before handleDocumentUpload consumes the body stream,
    // so we can peek at the metadata fields needed for the notification.
    const previewForm = await req.clone().formData();
    const isSecured    = previewForm.get("isSecured") === "true";
    const docType      = (previewForm.get("documentType") as string | null) ?? "Other";
    const docTitle     = (previewForm.get("title") as string | null) ?? "";
    const shouldNotify = isSecured || SECURED_DOC_TYPES.includes(docType);

    // Perform the actual upload with the original (unconsumed) request
    const response = await handleDocumentUpload(
      req,
      context.serviceContext,
      DocumentEntityType.SUPPLIER,
      supplierId,
      "Other",
    );

    // After a successful upload, notify Finance + Purchasing Managers (void — non-blocking)
    if (shouldNotify && response.status === 201) {
      void (async () => {
        const supplier = await prisma.supplier.findUnique({
          where: { id: supplierId },
          select: { name: true },
        });
        if (!supplier) return;
        await notifySupplierSecuredDocChanged(context.serviceContext, {
          supplierId,
          supplierName: supplier.name,
          documentId: "",  // not critical — notification links to the supplier page
          documentTitle: docTitle || docType,
          documentType: docType,
          changeType: "uploaded",
        });
      })();
    }

    return response;
  }
);
