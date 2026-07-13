/**
 * GET /api/purchasing/suppliers/payment-terms/[id]/usage
 *
 * Returns a list of suppliers that currently have their paymentTerms field
 * set to the term identified by [id]. Used by the settings page to warn
 * admins before they delete a term that is still in use.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface PaymentTermRow {
  id: string;
  term: string;
}

interface PaymentTermClient {
  findFirst: (args: object) => Promise<PaymentTermRow | null>;
}

function ptClient(): PaymentTermClient {
  return (prisma as unknown as { supplierPaymentTerm: PaymentTermClient })
    .supplierPaymentTerm;
}

export async function GET(
  _req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const params = await Promise.resolve(context.params);
    const { id } = params;

    const termRow = await ptClient().findFirst({ where: { id } });
    if (!termRow) {
      return NextResponse.json(
        { error: "Payment term not found" },
        { status: 404 },
      );
    }

    // Find all suppliers whose paymentTerms field matches this term (case-insensitive)
    const usedBy = await prisma.supplier.findMany({
      where: {
        paymentTerms: {
          equals: termRow.term,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        name: true,
        code: true,
        paymentTerms: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      data: {
        term: termRow.term,
        usedBy,
        count: usedBy.length,
      },
    });
  } catch (error) {
    void error;
    return NextResponse.json(
      { error: "Failed to check payment term usage" },
      { status: 500 },
    );
  }
}
