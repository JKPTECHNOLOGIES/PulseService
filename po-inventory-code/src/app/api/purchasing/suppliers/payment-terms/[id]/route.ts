/**
 * Individual Payment Term API
 *
 * PUT    /api/purchasing/suppliers/payment-terms/[id]  — rename a term
 * DELETE /api/purchasing/suppliers/payment-terms/[id]  — delete a term
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

interface PaymentTermRow {
  id: string;
  term: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PaymentTermClient {
  findFirst: (args: object) => Promise<PaymentTermRow | null>;
  update: (args: object) => Promise<PaymentTermRow>;
  delete: (args: object) => Promise<PaymentTermRow>;
}

function ptClient(): PaymentTermClient {
  return (prisma as unknown as { supplierPaymentTerm: PaymentTermClient })
    .supplierPaymentTerm;
}

/* ------------------------------------------------------------------ */
/* Schema                                                               */
/* ------------------------------------------------------------------ */

const updateTermSchema = z.object({
  term: z.string().min(1).max(100).trim().optional(),
  sortOrder: z.number().int().optional(),
});

/* ------------------------------------------------------------------ */
/* PUT — rename / reorder a term                                        */
/* ------------------------------------------------------------------ */

export async function PUT(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const params = await Promise.resolve(context.params);
    const { id } = params;

    const existing = await ptClient().findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Payment term not found" },
        { status: 404 },
      );
    }

    const body: unknown = await req.json();
    const parseResult = updateTermSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          issues: parseResult.error.issues.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 422 },
      );
    }

    const { term, sortOrder } = parseResult.data;

    // Check uniqueness if renaming (case-insensitive, exclude self)
    if (term !== undefined && term.toLowerCase() !== existing.term.toLowerCase()) {
      const duplicate = await ptClient().findFirst({
        where: {
          term: { equals: term, mode: "insensitive" as const },
          NOT: [{ id }],
        },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: `A payment term "${duplicate.term}" already exists` },
          { status: 409 },
        );
      }
    }

    const updateData: Partial<{ term: string; sortOrder: number }> = {};
    if (term !== undefined) updateData.term = term;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updated = await ptClient().update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    void error;
    return NextResponse.json(
      { error: "Failed to update payment term" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/* DELETE — remove a term                                               */
/* ------------------------------------------------------------------ */

export async function DELETE(
  _req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const params = await Promise.resolve(context.params);
    const { id } = params;

    const existing = await ptClient().findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Payment term not found" },
        { status: 404 },
      );
    }

    await ptClient().delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    void error;
    return NextResponse.json(
      { error: "Failed to delete payment term" },
      { status: 500 },
    );
  }
}
