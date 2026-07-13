/**
 * Invoice Utilities
 *
 * Shared utility functions for invoice operations.
 */

import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Generate unique internal invoice number
 * Format: INV-NNNNNN (6 digits, zero-padded)
 *
 * This is the CRN internal tracking number, separate from the vendor's invoice number.
 * Uses an atomic documentCounter increment — no scans, no race conditions.
 *
 * @param prisma - Prisma client instance
 * @returns Generated internal number (e.g., "INV-001295")
 */
export async function generateInvoiceInternalNumber(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<string> {
  const counter = await prisma.documentCounter.update({
    where: { name: "INV" },
    data: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return `INV-${String(counter.nextValue).padStart(6, "0")}`;
}
