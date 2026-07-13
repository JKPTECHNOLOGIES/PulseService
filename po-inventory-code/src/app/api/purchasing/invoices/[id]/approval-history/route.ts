/**
 * Invoice Approval History API Route
 * GET /api/purchasing/invoices/[id]/approval-history
 * 
 * Fetches the complete approval history for an invoice
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { InvoiceApprovalService } from '@/services/purchasing/invoice-approval.service';

/**
 * GET /api/purchasing/invoices/[id]/approval-history
 * Fetch approval history for an invoice
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authenticate user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: invoiceId } = await params;

    // Fetch approval history
    const history = await InvoiceApprovalService.getApprovalHistory(invoiceId);

    return NextResponse.json({
      success: true,
      data: history,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch approval history',
      },
      { status: 500 }
    );
  }
}
