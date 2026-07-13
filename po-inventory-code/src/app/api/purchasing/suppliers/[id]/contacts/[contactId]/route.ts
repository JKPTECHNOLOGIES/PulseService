/**
 * Individual Supplier Contact API
 *
 * PUT    /api/purchasing/suppliers/[id]/contacts/[contactId]  — update
 * DELETE /api/purchasing/suppliers/[id]/contacts/[contactId]  — delete
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { success, handleError } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createDeleteHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/api-errors";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

interface SupplierContactRow {
  id: string;
  supplierId: string;
  contactType: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  fax: string | null;
  notes: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ContactClient {
  findFirst: (args: object) => Promise<SupplierContactRow | null>;
  updateMany: (args: object) => Promise<{ count: number }>;
  update: (args: object) => Promise<SupplierContactRow>;
  delete: (args: object) => Promise<SupplierContactRow>;
}

function scClient(): ContactClient {
  return (prisma as unknown as { supplierContact: ContactClient }).supplierContact;
}

async function requireContact(supplierId: string, contactId: string): Promise<SupplierContactRow> {
  const row = await scClient().findFirst({ where: { id: contactId, supplierId } });
  if (!row) throw new NotFoundError("Contact not found");
  return row;
}

/* ------------------------------------------------------------------ */
/* Schema                                                               */
/* ------------------------------------------------------------------ */

const contactUpdateSchema = z.object({
  contactType: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200).optional(),
  title: z.string().max(100).optional().nullable(),
  email: z.string().email().or(z.literal("")).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  phone2: z.string().max(50).optional().nullable(),
  fax: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isPrimary: z.boolean().optional(),
});

/* ------------------------------------------------------------------ */
/* PUT — update                                                         */
/* ------------------------------------------------------------------ */

export const PUT = createGetHandlerWithParams<{ id: string; contactId: string }>(
  async (
    req: NextRequest,
    context: ApiContextWithParams<{ id: string; contactId: string }>
  ) => {
    try {
      const supplierId = context.params.id;
      const contactId = context.params.contactId;
      const existing = await requireContact(supplierId, contactId);

      const body: unknown = await req.json();
      const parseResult = contactUpdateSchema.safeParse(body);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        throw new ValidationError("Validation failed", fields);
      }

      const data = parseResult.data;
      const newType: string = data.contactType ?? existing.contactType;

      if (data.isPrimary === true) {
        await scClient().updateMany({
          where: {
            supplierId,
            contactType: newType,
            isPrimary: true,
            NOT: { id: contactId },
          },
          data: { isPrimary: false },
        });
      }

      const updateData: Record<string, unknown> = {};
      if (data.contactType !== undefined) updateData.contactType = data.contactType;
      if (data.name !== undefined) updateData.name = data.name;
      if ("title" in data) updateData.title = data.title ?? null;
      if ("email" in data) updateData.email = data.email ?? null;
      if ("phone" in data) updateData.phone = data.phone ?? null;
      if ("phone2" in data) updateData.phone2 = data.phone2 ?? null;
      if ("fax" in data) updateData.fax = data.fax ?? null;
      if ("notes" in data) updateData.notes = data.notes ?? null;
      if (data.isPrimary !== undefined) updateData.isPrimary = data.isPrimary;

      const updated = await scClient().update({
        where: { id: contactId },
        data: updateData,
      });

      return success(updated, "Contact updated");
    } catch (error) {
      return handleError(error);
    }
  }
);

/* ------------------------------------------------------------------ */
/* DELETE — remove                                                      */
/* ------------------------------------------------------------------ */

export const DELETE = createDeleteHandler<{ id: string; contactId: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ id: string; contactId: string }>
  ) => {
    try {
      const supplierId = context.params.id;
      const contactId = context.params.contactId;
      await requireContact(supplierId, contactId);
      await scClient().delete({ where: { id: contactId } });
      return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
      return handleError(error);
    }
  }
);
