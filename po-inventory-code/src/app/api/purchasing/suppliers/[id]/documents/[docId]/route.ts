/**
 * Supplier Document Detail API Routes
 *
 * GET /api/purchasing/suppliers/:id/documents/:docId - Get single document metadata
 * PATCH /api/purchasing/suppliers/:id/documents/:docId - Update document metadata
 * DELETE /api/purchasing/suppliers/:id/documents/:docId - Delete document (ACH Form requires Admin or Finance Manager)
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  createGetHandlerWithParams,
  createDeleteHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success, handleError } from "@/lib/api-response";
import { documentService } from "@/services/documents";
import {
  handleDocumentDelete,
  formatDocumentResponse,
} from "@/app/api/_helpers/document-api-helpers";
import { prisma } from "@/lib/prisma";
import { resetDocumentReminders } from "@/services/compliance/supplier-compliance.service";
import { z } from "zod";
import { SECURED_DOC_TYPES } from "@/lib/document-entity-registry";
import { notifySupplierSecuredDocChanged } from "@/services/purchasing/supplier-notifications.service";

// Mirrors updateMetadataSchema in document-api-helpers.ts
const updateMetadataSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  documentType: z.string().min(1, "Document type cannot be empty").optional(),
  tags: z.array(z.string()).optional(),
  isSecured: z.boolean().optional(),
  expiryDate: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional(),
});

/**
 * Document types that only Finance/Purchasing privileged roles can delete for supplier records.
 * Secured documents (isSecured=true) carry the same restriction regardless of type.
 */
const ADMIN_ONLY_DOCUMENT_TYPES = ["ACH Form", "Bank Letter", "W9"];

/**
 * GET /api/purchasing/suppliers/:id/documents/:docId
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
 * PATCH /api/purchasing/suppliers/:id/documents/:docId
 * Update document metadata. If expiryDate is provided, upserts the
 * DocumentExpiration record and resets reminder tracking state.
 */
export const PATCH = createGetHandlerWithParams<{ id: string; docId: string }>(
  async (
    req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    const { docId } = context.params;
    const rawData = await req.json() as Record<string, unknown>;

    // Validate the incoming body
    const parsed = updateMetadataSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          issues: parsed.error.issues.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 422 },
      );
    }

    const { expiryDate, ...rest } = parsed.data;

    // Snapshot the pre-update doc to detect isSecured toggle
    const existingDoc = await documentService.getById(context.serviceContext, docId);
    const wasSecured = (existingDoc as unknown as { isSecured?: boolean }).isSecured ?? false;

    // Update core document metadata via service — expiryDate is NOT in DocumentUpdateDTO;
    // it is handled separately via the DocumentExpiration upsert below.
    const document = await documentService.update(
      context.serviceContext,
      docId,
      rest,
    );

    // Fire notification if isSecured was toggled (void — non-blocking)
    if (rest.isSecured !== undefined && rest.isSecured !== wasSecured) {
      void (async () => {
        const supplier = await prisma.supplier.findUnique({
          where: { id: context.params.id },
          select: { name: true },
        });
        if (!supplier) return;
        await notifySupplierSecuredDocChanged(context.serviceContext, {
          supplierId: context.params.id,
          supplierName: supplier.name,
          documentId: docId,
          documentTitle: (document as unknown as { title?: string }).title ?? existingDoc.documentType,
          documentType: (document as unknown as { documentType?: string }).documentType ?? existingDoc.documentType,
          changeType: rest.isSecured ? "secured" : "unsecured",
        });
      })();
    }

    // Handle DocumentExpiration upsert when expiryDate is provided
    if (expiryDate !== undefined) {
      if (expiryDate !== null) {
        // Upsert the DocumentExpiration record, resetting reminder tracking atomically
        // so the cron monitor re-fires reminders for the new expiry date.
        await prisma.documentExpiration.upsert({
          where: { documentId: docId },
          create: {
            documentId: docId,
            expiryDate: new Date(expiryDate),
            sentThresholds: [],
            notifyUserIds: [],
            isExpired: false,
            lastReminderSent: null,
          },
          update: {
            expiryDate: new Date(expiryDate),
            sentThresholds: [],
            isExpired: false,
            lastReminderSent: null,
          },
        });
        // resetDocumentReminders is a no-op here since the upsert already reset the
        // tracking fields, but we call it for defence-in-depth in case of partial updates.
        await resetDocumentReminders(prisma, docId);
      } else {
        // expiryDate set to null — reset reminder state only (don't delete the row)
        // updateMany is intentionally used: if no row exists this is a safe no-op.
        await resetDocumentReminders(prisma, docId);
      }
    }

    const formattedDocument = formatDocumentResponse(
      document as unknown as Record<string, unknown>
    );
    return success(formattedDocument, "Document updated successfully");
  }
);

/**
 * DELETE /api/purchasing/suppliers/:id/documents/:docId
 * Delete supplier document.
 * ACH Form documents are protected — only users with the ADMIN or FINANCE MANAGER role can delete them.
 */
export const DELETE = createDeleteHandler<{ id: string; docId: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ id: string; docId: string }>,
  ) => {
    try {
      // Fetch document first to check its type
      const document = await documentService.getById(
        context.serviceContext,
        context.params.docId
      );

      // Enforce role restriction for protected / secured documents
      const docIsSecured = (document as unknown as { isSecured?: boolean }).isSecured ?? false;
      const isProtectedType = ADMIN_ONLY_DOCUMENT_TYPES.includes(document.documentType);
      if (isProtectedType || docIsSecured) {
        const userRole = context.serviceContext.userRole.toUpperCase();
        const canDelete =
          userRole === "ADMIN" ||
          userRole === "FINANCE MANAGER" ||
          userRole === "PURCHASING MANAGER";
        if (!canDelete) {
          return NextResponse.json(
            {
              success: false,
              error: docIsSecured
                ? "Secured documents can only be deleted by Finance or Purchasing roles."
                : `${document.documentType} documents are protected and can only be deleted by Finance or Purchasing roles.`,
            },
            { status: 403 },
          );
        }
      }

      const response = await handleDocumentDelete(
        context.serviceContext,
        context.params.docId
      );

      // Notify Finance + Purchasing Managers when a secured/protected doc is deleted
      if (docIsSecured || SECURED_DOC_TYPES.includes(document.documentType)) {
        void (async () => {
          const supplier = await prisma.supplier.findUnique({
            where: { id: context.params.id },
            select: { name: true },
          });
          if (!supplier) return;
          await notifySupplierSecuredDocChanged(context.serviceContext, {
            supplierId: context.params.id,
            supplierName: supplier.name,
            documentId: context.params.docId,
            documentTitle: document.title,
            documentType: document.documentType,
            changeType: "deleted",
          });
        })();
      }

      return response;
    } catch (error) {
      return handleError(error);
    }
  }
);
