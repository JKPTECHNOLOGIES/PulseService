import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { InvoiceApprovalService } from '@/services/purchasing/invoice-approval.service';

/**
 * GET /api/purchasing/invoices/check-duplicate?supplierId=X&invoiceNumber=Y
 *
 * Pre-upload duplicate invoice check.
 * Returns a warning if an active invoice with the same vendor invoice number
 * already exists for the given supplier.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get('supplierId');
    const invoiceNumber = searchParams.get('invoiceNumber');

    if (!supplierId || !invoiceNumber) {
      return NextResponse.json(
        { error: 'supplierId and invoiceNumber are required' },
        { status: 400 }
      );
    }

    const warning = await InvoiceApprovalService.checkDuplicateInvoice(
      supplierId,
      invoiceNumber
    );

    return NextResponse.json({
      isDuplicate: warning !== null,
      warning,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check for duplicates' },
      { status: 500 }
    );
  }
}
