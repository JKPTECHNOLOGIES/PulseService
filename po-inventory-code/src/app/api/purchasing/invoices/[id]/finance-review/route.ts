import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { InvoiceApprovalService } from '@/services/purchasing/invoice-approval.service';
import { z } from 'zod';

/**
 * Finance review endpoint for PENDING_REVIEW invoices.
 * Only Finance/Admin roles can approve or reject invoices flagged for variance review.
 */
const FINANCE_REVIEW_ROLES = [
  'admin',
  'finance manager',
  'finance',
  'plant manager',
];

const financeReviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comments: z.string().optional().nullable(),
  reason: z.string().optional(), // Required for reject
}).refine(
  (data) => data.action !== 'reject' || (data.reason && data.reason.length > 0),
  { message: 'Rejection reason is required', path: ['reason'] }
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userRole = (session.user.role || '').toLowerCase();
    if (!FINANCE_REVIEW_ROLES.includes(userRole)) {
      return NextResponse.json(
        { error: 'Forbidden: Only Finance/Admin roles can perform finance review' },
        { status: 403 }
      );
    }

    const { id: invoiceId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const validatedData = financeReviewSchema.parse(body);

    const context = {
      userId: session.user.id,
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
      userRole: session.user.role || 'User',
      roleId: session.user.roleId || '',
      permissions: [],
    };

    if (validatedData.action === 'approve') {
      const invoice = await InvoiceApprovalService.financeReviewApprove(
        context,
        invoiceId,
        { comments: validatedData.comments }
      );

      return NextResponse.json({
        success: true,
        data: invoice,
        message: 'Invoice approved after finance review',
      });
    } else {
      const reason = validatedData.reason ?? "";
      const invoice = await InvoiceApprovalService.financeReviewReject(
        context,
        invoiceId,
        { reason }
      );

      return NextResponse.json({
        success: true,
        data: invoice,
        message: 'Invoice rejected after finance review',
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process finance review' },
      { status: 500 }
    );
  }
}
