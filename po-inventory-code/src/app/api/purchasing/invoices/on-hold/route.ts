/**
 * GET /api/purchasing/invoices/on-hold
 *
 * Returns invoices that the current user (as assigned approver) has placed
 * on hold. These are invoices with approvalStatus = REQUESTOR_REJECTED and
 * display status = "On Hold".
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { InvoiceDisplayStatus } from '@/services/purchasing/invoice-approval.types';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const onHoldInvoices = await prisma.invoice.findMany({
    where: {
      approvalStatus: 'REQUESTOR_REJECTED',
      status: InvoiceDisplayStatus.ON_HOLD,
      requestorApprovedBy: session.user.id,
    },
    include: {
      supplier: { select: { name: true, code: true } },
      purchaseOrder: { select: { poNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    // Cap at 50 — the on-hold panel is a compact notice strip, not a full list.
    take: 50,
  });

  return NextResponse.json(onHoldInvoices);
}
