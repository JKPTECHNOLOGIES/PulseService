/**
 * PO Invoice Approver Service
 *
 * Handles logic for determining and managing invoice approvers for Purchase Orders,
 * particularly for Service POs where invoice approval is required.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface POInvoiceApproverInfo {
  /** Whether this PO has service lines that require invoice approval */
  hasServiceLines: boolean;
  /** The designated invoice approver for this PO (if set) */
  invoiceApprover: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    displayName: string;
  } | null;
  /** Whether the invoice approver field should be read-only (PO has designated approver) */
  isApproverReadonly: boolean;
  /** Message explaining why the approver is pre-selected */
  approverMessage: string | null;
}

export class POInvoiceApproverService {
  /**
   * Get invoice approver information for a Purchase Order
   */
  static async getPOInvoiceApproverInfo(poId: string): Promise<POInvoiceApproverInfo> {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: {
          select: { lineType: true },
        },
        invoiceApprover: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
          },
        },
      },
    });

    if (!po) {
      throw new Error('Purchase order not found');
    }

    // Check if PO has service lines
    const hasServiceLines = po.lines.some(line => line.lineType === 'SERVICE');

    // Get the designated invoice approver (if set and active)
    let invoiceApprover: POInvoiceApproverInfo['invoiceApprover'] = null;
    if (po.invoiceApprover?.isActive) {
      const displayName = `${po.invoiceApprover.firstName} ${po.invoiceApprover.lastName}`.trim() 
        || po.invoiceApprover.email;
      
      invoiceApprover = {
        id: po.invoiceApprover.id,
        firstName: po.invoiceApprover.firstName,
        lastName: po.invoiceApprover.lastName,
        email: po.invoiceApprover.email,
        displayName,
      };
    } else if (po.invoiceApproverId && !po.invoiceApprover) {
      // PO has an invoice approver ID but user was not found (inactive/deleted)
      logger.warn(`[POInvoiceApprover] PO ${poId} has invoiceApproverId "${po.invoiceApproverId}" but user not found or inactive`);
    }

    // Determine if approver field should be readonly
    const isApproverReadonly = hasServiceLines && invoiceApprover !== null;

    // Generate appropriate message
    let approverMessage: string | null = null;
    if (hasServiceLines && invoiceApprover) {
      approverMessage = `Invoice approver is pre-set for this Service PO: ${invoiceApprover.displayName}`;
    } else if (hasServiceLines && !invoiceApprover) {
      approverMessage = 'This Service PO requires invoice approval. Please select an approver.';
    } else if (!hasServiceLines) {
      approverMessage = 'Invoice approval is not required for this PO (no service lines).';
    }

    return {
      hasServiceLines,
      invoiceApprover,
      isApproverReadonly,
      approverMessage,
    };
  }

  /**
   * Validate that a PO can have an invoice approver set
   */
  static async validatePOForInvoiceApprover(poId: string): Promise<{
    isValid: boolean;
    reason?: string;
  }> {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: {
          select: { lineType: true },
        },
      },
    });

    if (!po) {
      return { isValid: false, reason: 'Purchase order not found' };
    }

    // Check if PO has service lines
    const hasServiceLines = po.lines.some(line => line.lineType === 'SERVICE');

    if (!hasServiceLines) {
      return { 
        isValid: false, 
        reason: 'Invoice approver can only be set for POs with service lines' 
      };
    }

    return { isValid: true };
  }

  /**
   * Set the invoice approver for a Purchase Order
   */
  static async setPOInvoiceApprover(
    poId: string, 
    approverId: string | null
  ): Promise<void> {
    // Validate the PO can have an invoice approver
    const validation = await this.validatePOForInvoiceApprover(poId);
    if (!validation.isValid) {
      throw new Error(validation.reason);
    }

    // If setting an approver, validate the user exists and is active
    if (approverId) {
      const user = await prisma.user.findUnique({
        where: { id: approverId, isActive: true },
        select: { id: true },
      });

      if (!user) {
        throw new Error('Invoice approver not found or inactive');
      }
    }

    // Update the PO
    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        invoiceApproverId: approverId,
      },
    });

    logger.info(`[POInvoiceApprover] Updated PO ${poId} invoice approver: ${approverId ?? 'cleared'}`);
  }

  /**
   * Get all users who can be invoice approvers
   */
  static async getAvailableInvoiceApprovers(): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    displayName: string;
    role: string;
  }>> {
    // Get active users who have roles that can approve invoices
    // This typically includes managers, admin, and other approval roles
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        // Add role filter if needed based on your permission system
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        { lastName: 'asc' },
        { firstName: 'asc' },
      ],
    });

    return users.map(user => {
      const displayName = `${user.firstName} ${user.lastName}`.trim() || user.email;
      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        displayName,
        role: user.role.name,
      };
    });
  }
}

// Singleton instance
export const poInvoiceApproverService = new POInvoiceApproverService();