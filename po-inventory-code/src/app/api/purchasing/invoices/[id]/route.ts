/**
 * Invoice Detail API Routes
 *
 * Individual invoice CRUD endpoints.
 *
 * Migrated: 2025-11-18
 * Part of: Phase 3.4 - Purchasing Routes Migration
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success, noContent, handleError } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
} from "@/lib/api-middleware-v2";
import { buildServiceContext, getRouteParams } from "@/lib/route-helpers";
import { invoiceService } from "@/services/purchasing";
import { invoiceUpdateSchema } from "@/services/purchasing/invoice.types";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
/**
 * GET /api/purchasing/invoices/[id]
 * Get a single invoice by ID
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  const invoice = await invoiceService.findById(
    context.serviceContext,
    context.params.id,
    {
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: {
          include: {
            lines: true,
            supplier: true,
          },
        },
        receipts: true,
        approvalHistory: {
          orderBy: { approvedAt: "desc" as const },
        },
        // Per-line invoice allocation amounts set by Finance at upload time.
        // Returned to the approval page so the approver can see exactly how
        // much of this invoice is charged to each PO line before approving.
        invoiceLineItems: {
          include: {
            poLine: {
              select: {
                id: true,
                lineNumber: true,
                description: true,
                lineType: true,
              },
            },
          },
          orderBy: { createdAt: "asc" as const },
        },
      },
    }
  );

  return success(invoice, "Invoice retrieved successfully");
});

/**
 * PUT /api/purchasing/invoices/[id]
 * Update an invoice
 */
export const PUT = createPutHandler(
  invoiceUpdateSchema,
  async (_req, context) => {
    const invoice = await invoiceService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );

    return success(invoice, "Invoice updated successfully");
  }
);

/**
 * PATCH /api/purchasing/invoices/[id]
 * Partial update of an invoice.
 * If the request body contains only `dueDate`, bypass status restrictions
 * and directly update the dueDate field.
 */
const patchDueDateSchema = z.object({
  dueDate: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  routeContext: { params: Promise<{ id: string }> | { id: string } }
): Promise<NextResponse> {
  try {
    await buildServiceContext();
    const { id } = await getRouteParams<{ id: string }>(routeContext);
    const body: unknown = await req.json();

    // Check if this is a dueDate-only patch
    const parsed = patchDueDateSchema.safeParse(body);
    const bodyKeys = body && typeof body === "object" ? Object.keys(body) : [];

    if (
      parsed.success &&
      bodyKeys.length === 1 &&
      bodyKeys[0] === "dueDate"
    ) {
      // Bypass status restrictions — directly update dueDate
      const dueDateValue = parsed.data.dueDate
        ? new Date(parsed.data.dueDate)
        : null;
      const updated = await prisma.invoice.update({
        where: { id },
        data: { dueDate: dueDateValue },
      });
      return success(updated, "Due date updated successfully");
    }

    // For all other patches, fall through to the service update
    const updateResult = await invoiceService.update(
      await buildServiceContext(),
      id,
      body as Parameters<typeof invoiceService.update>[2],
    );
    return success(updateResult, "Invoice updated successfully");
  } catch (error) {
    return handleError(error);
  }
}

/**
 * DELETE /api/purchasing/invoices/[id]
 * Delete an invoice
 */
export const DELETE = createDeleteHandler(async (_req, context) => {
  await invoiceService.delete(context.serviceContext, context.params.id);

  return noContent();
});
