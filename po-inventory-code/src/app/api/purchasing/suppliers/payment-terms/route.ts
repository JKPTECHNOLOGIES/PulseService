/**
 * Payment Terms API
 *
 * GET  /api/purchasing/suppliers/payment-terms  — list all managed terms
 * POST /api/purchasing/suppliers/payment-terms  — create a new term
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const createTermSchema = z.object({
  term: z.string().min(1).max(100).trim(),
  sortOrder: z.number().int().optional().default(0),
});

interface PaymentTermRow {
  id: string;
  term: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PaymentTermClient {
  findMany: (args?: object) => Promise<PaymentTermRow[]>;
  findFirst: (args: object) => Promise<PaymentTermRow | null>;
  create: (args: object) => Promise<PaymentTermRow>;
  update: (args: object) => Promise<PaymentTermRow>;
  delete: (args: object) => Promise<PaymentTermRow>;
}

function ptClient(): PaymentTermClient {
  return (prisma as unknown as { supplierPaymentTerm: PaymentTermClient }).supplierPaymentTerm;
}

/* ------------------------------------------------------------------ */
/* GET — list all payment terms from the managed table                 */
/* Auto-seeds from existing Supplier.paymentTerms on first call.       */
/* ------------------------------------------------------------------ */

export async function GET() {
  try {
    // Check if the managed table has any rows yet
    const existing = await ptClient().findMany();

    if (existing.length === 0) {
      // Auto-seed from distinct paymentTerms values on existing Supplier records
      const supplierRows = await prisma.supplier.findMany({
        where: { paymentTerms: { not: null } },
        select: { paymentTerms: true },
        distinct: ["paymentTerms"],
      });

      const seen = new Set<string>();
      const toCreate: string[] = [];
      for (const row of supplierRows) {
        const val = (row.paymentTerms ?? "").trim();
        if (val && !seen.has(val.toLowerCase())) {
          seen.add(val.toLowerCase());
          toCreate.push(val);
        }
      }

      // Insert them all
      if (toCreate.length > 0) {
        for (const term of toCreate) {
          // Use upsert-style: only create if not already there
          const already = await ptClient().findFirst({
            where: { term: { equals: term, mode: "insensitive" } },
          });
          if (!already) {
            await ptClient().create({ data: { term, sortOrder: 0 } });
          }
        }
      }
    }

    const rows = await ptClient().findMany({
      orderBy: [{ sortOrder: "asc" }, { term: "asc" }],
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    void error;
    return NextResponse.json(
      { error: "Failed to fetch payment terms" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/* POST — create a new payment term                                     */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const parseResult = createTermSchema.safeParse(body);
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

    // Check uniqueness (case-insensitive)
    const existing = await ptClient().findFirst({
      where: { term: { equals: term, mode: "insensitive" } },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A payment term "${existing.term}" already exists` },
        { status: 409 },
      );
    }

    const created = await ptClient().create({
      data: { term, sortOrder },
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    void error;
    return NextResponse.json(
      { error: "Failed to create payment term" },
      { status: 500 },
    );
  }
}
