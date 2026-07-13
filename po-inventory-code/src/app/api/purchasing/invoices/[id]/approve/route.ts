import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { InvoiceApprovalService } from '@/services/purchasing/invoice-approval.service';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { autoTransformDecimals } from '@/lib/decimal-helpers';

/**
 * Roles that are permitted to approve service PO invoices.
 * Mirrors INVOICE_APPROVAL_ROLES on the front-end plus Plant Manager.
 * Role check is done directly from the session to avoid DB permission mismatches.
 */
const INVOICE_APPROVE_ROLES = [
  'admin',
  'finance manager',
  'finance',
  'maintenance manager',
  'plant manager',
];

const approveInvoiceSchema = z.object({
  comments: z.string().optional(),
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

    // Role-based approval gate — uses session role so no DB permission mapping required
    const userRole = (session.user.role || '').toLowerCase();
    const canApproveByRole = INVOICE_APPROVE_ROLES.includes(userRole);

    const { id: invoiceId } = await params;

    if (!canApproveByRole) {
      // Check if user is the assigned approver for this specific invoice
      const invoiceRecord = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { requestorApprovedBy: true, approvalStatus: true },
      });
      const isAssignedApprover = invoiceRecord?.requestorApprovedBy === session.user.id;
      if (!isAssignedApprover) {
        return NextResponse.json(
          { error: 'Forbidden: You do not have permission to approve invoices' },
          { status: 403 }
        );
      }
    }
    const body = await request.json() as Record<string, unknown>;
    const validatedData = approveInvoiceSchema.parse(body);

    const context = {
      userId: session.user.id,
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
      userRole: session.user.role || 'User',
      roleId: session.user.roleId || '',
      permissions: [],
    };

    const result = await InvoiceApprovalService.requestorApprove(
      context,
      invoiceId,
      {
        approvedBy: session.user.id,
        approvedByName: session.user.name || session.user.email,
        comments: validatedData.comments,
      }
    );

    // Return only the invoice object (not the full InvoiceApprovalResult which contains
    // unblockedLines with Prisma Decimal fields that can cause JSON serialization issues).
    // autoTransformDecimals converts Prisma Decimal fields to plain JS numbers.
    const serializedInvoice = autoTransformDecimals(result.invoice as unknown as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      data: serializedInvoice,
      message: 'Invoice approved successfully',
    });
  } catch (error) {
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to approve invoice' },
      { status: 500 }
    );
  }
}
