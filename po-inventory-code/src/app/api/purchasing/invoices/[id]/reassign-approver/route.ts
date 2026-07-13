import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { getEmailBaseUrl } from '@/lib/email/get-base-url';

/**
 * Roles allowed to override/reassign the approver on a PENDING_REQUESTOR invoice.
 */
const REASSIGN_ALLOWED_ROLES = [
  'admin',
  'plant manager',
  'finance manager',
  'finance',
  'maintenance manager',
];

const reassignSchema = z.object({
  newApproverId: z.string().min(1, 'New approver user ID is required'),
  reason: z.string().min(1, 'Reason is required').max(500),
});

/**
 * POST /api/purchasing/invoices/[id]/reassign-approver
 *
 * Allows privileged roles (Admin, Plant Manager, Finance Manager, Maintenance Manager)
 * to reassign which user is expected to approve a PENDING_REQUESTOR invoice.
 *
 * The invoice's requestorApprovedBy / requestorApprovedByName fields are updated
 * to reflect the new approver and an audit entry is written to InvoiceApprovalHistory.
 * No schema changes are needed — we reuse the existing requestorApprovedBy column
 * as the "designated approver" pointer and write the audit trail to history.
 *
 * NOTE: The invoice approvalStatus stays PENDING_REQUESTOR so the workflow continues
 * normally; the new approver will receive a notification and can approve/reject.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check
    const callerRole = session.user.role.toLowerCase();
    const isAllowed = REASSIGN_ALLOWED_ROLES.some((r) => r === callerRole);
    if (!isAllowed) {
      return NextResponse.json(
        { error: 'Forbidden: Only Admin, Plant Manager, Finance Manager, or Maintenance Manager can reassign approvers' },
        { status: 403 }
      );
    }

    const { id: invoiceId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const { newApproverId, reason } = reassignSchema.parse(body);

    // Fetch invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        purchaseOrder: { select: { poNumber: true } },
        supplier: { select: { name: true } },
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Only PENDING_REQUESTOR invoices can have their approver reassigned
    if (invoice.approvalStatus !== 'PENDING_REQUESTOR') {
      return NextResponse.json(
        {
          error: `Cannot reassign approver: invoice is in status "${invoice.approvalStatus}". Only PENDING_REQUESTOR invoices can be reassigned.`,
        },
        { status: 422 }
      );
    }

    // Look up the new approver
    const newApprover = await prisma.user.findUnique({
      where: { id: newApproverId },
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
    });

    if (!newApprover) {
      return NextResponse.json({ error: 'New approver user not found' }, { status: 404 });
    }

    if (!newApprover.isActive) {
      return NextResponse.json({ error: 'New approver is not an active user' }, { status: 422 });
    }

    const newApproverName = `${newApprover.firstName} ${newApprover.lastName}`.trim() || newApprover.email;
    const callerName = session.user.name || session.user.email;

    // Record previous designated approver (if any) for the audit trail
    const previousApproverName = invoice.requestorApprovedByName ?? '(unassigned)';

    // Update the invoice: set requestorApprovedBy to the new approver
    // (this field doubles as "designated approver" while status is PENDING_REQUESTOR)
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        requestorApprovedBy: newApproverId,
        requestorApprovedByName: newApproverName,
      },
    });

    // Write audit history entry
    await prisma.invoiceApprovalHistory.create({
      data: {
        invoiceId,
        approverType: 'OVERRIDE',
        approvedBy: session.user.id,
        approvedByName: callerName,
        action: 'REASSIGNED',
        comments: `Approver changed from "${previousApproverName}" to "${newApproverName}" by ${callerName} (${session.user.role}). Reason: ${reason}`,
        previousStatus: invoice.approvalStatus,
        newStatus: invoice.approvalStatus, // Status does not change
      },
    });

    // Send notification to the new approver
    try {
      const { notificationService } = await import('@/services/notifications/notification.service');
      const { NotificationCategory, NotificationPriority } = await import('@/services/notifications/notification.types');
      const { PURCHASING_NOTIFICATIONS } = await import('@/services/notifications/notification-types-registry');

      const serviceContext = {
        userId: session.user.id,
        userName: callerName,
        userEmail: session.user.email,
        userRole: session.user.role,
        roleId: session.user.roleId,
        permissions: [],
      };

      // Fetch other pending invoices for the new approver (non-fatal if it fails)
      let otherPendingInvoices: Array<{
        id: string;
        invoiceNumber: string;
        internalNumber: string;
        totalAmount: number;
        vendorName: string;
        poNumber?: string;
        approvalUrl: string;
      }> = [];
      try {
        const baseUrl = getEmailBaseUrl();
        const [createdReqs, approvedReqs] = await Promise.all([
          prisma.requisition.findMany({
            where: { requestedById: newApproverId },
            select: { purchaseOrderId: true },
          }),
          prisma.requisition.findMany({
            where: { approvals: { some: { approverId: newApproverId, status: 'APPROVED' } } },
            select: { purchaseOrderId: true },
          }),
        ]);
        const poIds = new Set<string>();
        for (const r of [...createdReqs, ...approvedReqs]) {
          if (r.purchaseOrderId) poIds.add(r.purchaseOrderId);
        }
        if (poIds.size > 0) {
          const pendingInvoices = await prisma.invoice.findMany({
            where: {
              purchaseOrderId: { in: [...poIds] },
              approvalStatus: 'PENDING_REQUESTOR',
              id: { not: invoiceId },
            },
            select: {
              id: true,
              invoiceNumber: true,
              internalNumber: true,
              totalAmount: true,
              supplier: { select: { name: true } },
              purchaseOrder: { select: { poNumber: true } },
            },
            orderBy: { uploadedAt: 'asc' },
            take: 10,
          });
          otherPendingInvoices = pendingInvoices.map(inv => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            internalNumber: inv.internalNumber,
            totalAmount: Number(inv.totalAmount),
            vendorName: inv.supplier.name,
            poNumber: inv.purchaseOrder?.poNumber,
            approvalUrl: `${baseUrl}/purchasing/invoices/${inv.id}/approve`,
          }));
        }
      } catch {
        // Non-fatal: other pending invoices are optional enrichment
      }

      await notificationService.sendNotification(serviceContext, {
        userId: newApproverId,
        type: PURCHASING_NOTIFICATIONS.INVOICE_APPROVAL_REQUIRED.type,
        category: NotificationCategory.PURCHASING,
        title: 'Invoice Approval Required (Reassigned)',
        message: `Invoice ${invoice.invoiceNumber} for PO ${invoice.purchaseOrder?.poNumber ?? 'N/A'} has been assigned to you for approval by ${callerName}.`,
        priority: NotificationPriority.HIGH,
        actionUrl: `/purchasing/invoices/${invoice.id}/approve`,
        actionLabel: 'Review & Approve Invoice',
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.supplier.name,
          amount: Number(invoice.totalAmount),
          currency: 'USD',
          poNumber: invoice.purchaseOrder?.poNumber ?? '',
          poId: invoice.purchaseOrderId ?? '',
          otherPendingInvoices,
        },
      });
    } catch {
      // Notification failure is non-fatal
    }

    return NextResponse.json({
      success: true,
      message: `Approver reassigned to ${newApproverName}`,
      data: {
        invoiceId,
        newApproverId,
        newApproverName,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reassign approver' },
      { status: 500 }
    );
  }
}
