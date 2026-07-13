import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Fetch invoices for this PO
    const invoices = await prisma.invoice.findMany({
      where: {
        purchaseOrderId: id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        internalNumber: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        subtotal: true,
        tax: true,
        shippingCost: true,
        balanceAmount: true,
        status: true,
        approvalStatus: true,
        matchStatus: true,
        uploadedAt: true,
        uploadedByName: true,
        requestorApprovedAt: true,
        requestorApprovedBy: true,
        requestorApprovedByName: true,
        notes: true,
        // Void metadata — used by invoices tab, receive page, and receipts tab
        // to show void status and display the original (un-suffixed) number.
        voidedAt: true,
        voidReason: true,
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            receivedByName: true,
            receivedAt: true,
            quantityReceived: true,
            status: true,
            isReturn: true,
            poLineId: true,   // needed for per-line duplicate-receipt filtering on the receive page
          },
        },
      },
    });

    // Strip the -VOID-<timestamp> suffix that voidInvoice() appends to
    // invoiceNumber.  internalNumber (INV-XXXXXX) is never renamed, so it
    // is always safe to display as-is.  The raw invoiceNumber is kept so
    // clients that need the DB value still have it.
    const invoicesWithDisplay = invoices.map((inv) => ({
      ...inv,
      isVoided: inv.voidedAt !== null,
      displayInvoiceNumber: inv.invoiceNumber
        .replace(/-VOID-\d+$/, '')
        .replace(/-REJECTED-\d+$/, ''),
    }));

    return NextResponse.json({
      success: true,
      invoices: invoicesWithDisplay,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}
