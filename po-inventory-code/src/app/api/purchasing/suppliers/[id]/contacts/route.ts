/**
 * Supplier Contacts API
 *
 * GET  /api/purchasing/suppliers/[id]/contacts  — list contacts
 * POST /api/purchasing/suppliers/[id]/contacts  — create contact
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { success, created, handleError } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/api-errors";

const contactCreateSchema = z.object({
  contactType: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  title: z.string().max(100).optional().nullable(),
  email: z.string().email().or(z.literal("")).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  phone2: z.string().max(50).optional().nullable(),
  fax: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isPrimary: z.boolean().optional(),
});

/**
 * GET — list all contacts for a supplier
 */
export const GET = createGetHandlerWithParams<{ id: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ id: string }>
  ) => {
    const { id } = context.params;

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundError("Supplier not found");

    const contacts = await (prisma as unknown as { supplierContact: { findMany: (args: unknown) => Promise<unknown[]> } }).supplierContact.findMany({
      where: { supplierId: id },
      orderBy: [{ isPrimary: "desc" }, { contactType: "asc" }, { name: "asc" }],
    });

    return success(contacts, "Contacts retrieved successfully");
  }
);

/**
 * POST — create a new contact for a supplier
 */
export const POST = createGetHandlerWithParams<{ id: string }>(
  async (
    req: NextRequest,
    context: ApiContextWithParams<{ id: string }>
  ) => {
    try {
      const { id } = context.params;

      const supplier = await prisma.supplier.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!supplier) throw new NotFoundError("Supplier not found");

      const body: unknown = await req.json();
      const parseResult = contactCreateSchema.safeParse(body);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        throw new ValidationError("Validation failed", fields);
      }
      const data = parseResult.data;

      const sc = (prisma as unknown as { supplierContact: {
        updateMany: (args: unknown) => Promise<unknown>;
        create: (args: unknown) => Promise<unknown>;
      } }).supplierContact;

      // If new contact is primary, clear existing primary for same type
      if (data.isPrimary === true) {
        await sc.updateMany({
          where: { supplierId: id, contactType: data.contactType, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const contact = await sc.create({
        data: {
          supplierId: id,
          contactType: data.contactType,
          name: data.name,
          title: data.title ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          phone2: data.phone2 ?? null,
          fax: data.fax ?? null,
          notes: data.notes ?? null,
          isPrimary: data.isPrimary ?? false,
        },
      });

      return created(contact, "Contact created successfully");
    } catch (error) {
      return handleError(error);
    }
  }
);
