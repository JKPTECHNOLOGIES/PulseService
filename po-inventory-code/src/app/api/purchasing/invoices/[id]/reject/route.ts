import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { InvoiceApprovalService } from '@/services/purchasing/invoice-approval.service';
import { z } from 'zod';

/**
 * Roles that are permitted to reject/dispute service PO invoices.
 * Includes Admin, Finance, and managerial roles.
 * The assigned approver (requestorApprovedBy) can also reject regardless of role.
 * Role check is done directly from the session to avoid DB permission mismatches.
 */
const INVOICE_REJECT_ROLES = [
  'admin',
  'finance manager',
  'finance',
  'maintenance manager',
  'plant manager',
  'manager',
  'supervisor',
];

/** Roles that perform a true "rejection" (not an approver hold) */
const FINANCE_ADMIN_ROLES = ['admin', 'finance manager', 'finance'];

const rejectInvoiceSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: invoiceId } = await params;

    // Fetch the invoice to check if the current user is the assigned approver
    const invoiceRecord = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { requestorApprovedBy: true, approvalStatus: true },
    });

    if (!invoiceRecord) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Permission gate: role-based OR assigned-approver
    const userRole = (session.user.role || '').toLowerCase();
    const isAssignedApprover = invoiceRecord.requestorApprovedBy === session.user.id;
    const canRejectByRole = INVOICE_REJECT_ROLES.includes(userRole);

    if (!canRejectByRole && !isAssignedApprover) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to reject this invoice' },
        { status: 403 }
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const validatedData = rejectInvoiceSchema.parse(body);

    // Determine if this is an approver "hold" vs a finance/admin "rejection".
    // If the user is the assigned approver and NOT a finance/admin role, it's a hold.
    const isApproverHold = isAssignedApprover && !FINANCE_ADMIN_ROLES.includes(userRole);

    const context = {
      userId: session.user.id,
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
      userRole: session.user.role || 'User',
      roleId: session.user.roleId || '',
      permissions: [],
    };

    const invoice = await InvoiceApprovalService.requestorReject(
      context,
      invoiceId,
      {
        rejectedBy: session.user.id,
        rejectedByName: session.user.name || session.user.email,
        reason: validatedData.reason,
      },
      isApproverHold
    );

    return NextResponse.json({
      success: true,
      data: invoice,
      message: isApproverHold ? 'Invoice placed on hold' : 'Invoice rejected successfully',
    });
  } catch (error) {
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reject invoice' },
      { status: 500 }
    );
  }
}
