import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { InvoiceApprovalService } from '@/services/purchasing/invoice-approval.service';

/**
 * GET /api/purchasing/invoices/pending-approvals
 * Get all pending invoice approvals for the current user
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const invoices = await InvoiceApprovalService.getPendingApprovalsForUser(session.user.id, session.user.role);

    return NextResponse.json({
      success: true,
      data: invoices,
      message: 'Pending approvals retrieved successfully',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch pending approvals' },
      { status: 500 }
    );
  }
}
