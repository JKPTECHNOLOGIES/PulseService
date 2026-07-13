/**
 * Invoice PO Line Utilities
 *
 * Shared utility functions for adjusting PO line `approvedInvoiceAmount`
 * when invoices are deleted or voided. Used by both the purchasing invoice
 * service and the general/AP invoice service.
 *
 * The increment side lives in invoice-approval.service.ts -> requestorApprove().
 * This module provides the mirror decrement logic.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

/**
 * Prisma transaction client type -- compatible with both the full PrismaClient
 * and the limited client available inside $transaction() callbacks.
 */
type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface DecrementResult {
  /** Number of PO lines whose approvedInvoiceAmount was decremented */
  linesUpdated: number;
  /** Number of PO lines that were fully cleared (amount reached 0) */
  linesFullyCleared: number;
  /** Whether the operation was skipped (e.g. invoice was never approved) */
  skipped: boolean;
  /** Human-readable reason if skipped */
  skipReason?: string;
}

/**
 * Approval statuses that indicate the invoice's amount was actually applied
 * to PO line `approvedInvoiceAmount` during the requestorApprove() flow.
 */
const APPROVED_STATUSES = ['REQUESTOR_APPROVED', 'FULLY_APPROVED'] as const;

/**
 * Decrement `approvedInvoiceAmount` on SERVICE-type PO lines for a specific
 * invoice being deleted or voided.
 *
 * Strategy:
 * 1. Check the invoice's `approvalStatus` -- only decrement if the invoice
 *    actually went through approval (REQUESTOR_APPROVED or FULLY_APPROVED).
 * 2. Query `InvoiceLineItem` records for this invoice to find the affected
 *    SERVICE PO lines.
 * 3. For each affected SERVICE PO line, recalculate the proportional
 *    allocation (matching the increment logic in requestorApprove()) and
 *    atomically decrement `approvedInvoiceAmount` by that amount.
 * 4. If the resulting amount is <= 0, also clear `canReceive` and
 *    `invoiceMatched` flags.
 * 5. Fall back to proportional distribution if no `InvoiceLineItem` records
 *    exist (legacy data created before the junction table).
 *
 * Mirrors the increment logic in:
 *   invoice-approval.service.ts -> requestorApprove() (lines ~890-910)
 *
 * @param tx                    - Prisma client or transaction client
 * @param invoiceId             - The invoice being deleted/voided
 * @param purchaseOrderId       - The linked PO ID
 * @param invoiceTotalAmount    - The invoice's totalAmount (for proportional calc)
 * @param invoiceApprovalStatus - The invoice's approvalStatus field value
 */
export async function decrementApprovedInvoiceAmountForInvoice(
  tx: PrismaTx,
  invoiceId: string,
  purchaseOrderId: string,
  invoiceTotalAmount: number,
  invoiceApprovalStatus: string,
): Promise<DecrementResult> {
  // Guard: only decrement if this invoice's approval actually incremented the amount
  const wasApproved = (APPROVED_STATUSES as readonly string[]).includes(invoiceApprovalStatus);
  if (!wasApproved) {
    const reason =
      `Invoice ${invoiceId} approvalStatus is "${invoiceApprovalStatus}" -- ` +
      `not in [${APPROVED_STATUSES.join(', ')}], skipping PO line decrement`;
    logger.info('[Invoice PO Line Utils] ' + reason);
    return { linesUpdated: 0, linesFullyCleared: 0, skipped: true, skipReason: reason };
  }

  let linesUpdated = 0;
  let linesFullyCleared = 0;

  // 1. Query InvoiceLineItem records for this specific invoice
  const invoiceLineItems = await tx.invoiceLineItem.findMany({
    where: { invoiceId },
    include: { poLine: true },
  });

  // 2. Filter to SERVICE lines only (same filter as requestorApprove)
  const serviceLineItems = invoiceLineItems.filter(
    (ili) => ili.poLine.lineType === 'SERVICE',
  );

  if (serviceLineItems.length > 0) {
    // -- Primary path: use proportional distribution matching requestorApprove() --
    // requestorApprove() computes: proportion = lineValue / totalLineValue
    // and allocatedAmount = invoiceAmount * proportion
    // We must use the same formula so decrement exactly matches increment.

    const invoicedServiceLines = serviceLineItems.map((ili) => ili.poLine);

    const totalLineValue = invoicedServiceLines.reduce(
      (sum, line) => sum + Number(line.totalPrice),
      0,
    );

    for (const ili of serviceLineItems) {
      const lineValue = Number(ili.poLine.totalPrice);
      const proportion =
        totalLineValue > 0
          ? lineValue / totalLineValue
          : 1 / invoicedServiceLines.length;
      const decrementAmount = invoiceTotalAmount * proportion;
      const currentApproved = Number(ili.poLine.approvedInvoiceAmount);
      const newAmount = Math.max(0, currentApproved - decrementAmount);

      if (decrementAmount <= 0) {
        logger.info(
          `[Invoice PO Line Utils] Skipping PO line ${ili.poLineId} -- ` +
          `proportional decrement amount is ${decrementAmount}`,
        );
        continue;
      }

      // Clamp: if decrement would overshoot, just set to 0 instead of going negative
      const safeDecrement = Math.min(decrementAmount, currentApproved);

      if (safeDecrement < decrementAmount) {
        logger.warn(
          `[Invoice PO Line Utils] Clamping decrement for PO line ${ili.poLineId}: ` +
          `would decrement ${decrementAmount.toFixed(2)} but current approvedInvoiceAmount is only ` +
          `${currentApproved.toFixed(2)}. Setting to 0 instead.`,
        );
      }

      const updateData: Prisma.POLineUpdateInput = {
        approvedInvoiceAmount: { decrement: safeDecrement },
      };

      // Only clear flags if this was the last contributing invoice (amount reaches 0)
      if (newAmount <= 0) {
        updateData.invoiceMatched = false;
        updateData.canReceive = false;
      }

      await tx.pOLine.update({
        where: { id: ili.poLineId },
        data: updateData,
      });

      const clearedMsg = newAmount <= 0 ? ' -- cleared canReceive/invoiceMatched flags' : '';
      logger.info(
        `[Invoice PO Line Utils] Decremented PO line ${ili.poLineId}: ` +
        `approvedInvoiceAmount ${currentApproved.toFixed(2)} -> ${newAmount.toFixed(2)} ` +
        `(decremented by ${safeDecrement.toFixed(2)}, proportion ${(proportion * 100).toFixed(1)}% for invoice ${invoiceId})` +
        clearedMsg,
      );

      linesUpdated++;
      if (newAmount <= 0) linesFullyCleared++;
    }
  } else {
    // -- Fallback path: no InvoiceLineItem records (legacy data) --
    // Distribute the invoice's total amount proportionally across all SERVICE
    // lines of the PO, weighted by each line's totalPrice. This mirrors the
    // proportional allocation in requestorApprove().
    logger.info(
      `[Invoice PO Line Utils] No InvoiceLineItem records for invoice ${invoiceId} -- ` +
      `falling back to proportional distribution across PO ${purchaseOrderId} service lines`,
    );

    const serviceLines = await tx.pOLine.findMany({
      where: {
        purchaseOrderId,
        lineType: 'SERVICE',
      },
    });

    if (serviceLines.length > 0) {
      const totalLineValue = serviceLines.reduce(
        (sum, line) => sum + Number(line.totalPrice),
        0,
      );

      for (const line of serviceLines) {
        const lineValue = Number(line.totalPrice);
        const proportion =
          totalLineValue > 0
            ? lineValue / totalLineValue
            : 1 / serviceLines.length;
        const decrementAmount = invoiceTotalAmount * proportion;
        const currentApproved = Number(line.approvedInvoiceAmount);
        const newAmount = Math.max(0, currentApproved - decrementAmount);
        const safeDecrement = Math.min(decrementAmount, currentApproved);

        if (safeDecrement <= 0) continue;

        const updateData: Prisma.POLineUpdateInput = {
          approvedInvoiceAmount: { decrement: safeDecrement },
        };

        if (newAmount <= 0) {
          updateData.invoiceMatched = false;
          updateData.canReceive = false;
        }

        await tx.pOLine.update({
          where: { id: line.id },
          data: updateData,
        });

        logger.info(
          `[Invoice PO Line Utils] (fallback) Decremented PO line ${line.id}: ` +
          `approvedInvoiceAmount ${currentApproved.toFixed(2)} -> ${newAmount.toFixed(2)} ` +
          `(decremented by ${safeDecrement.toFixed(2)}, proportion ${(proportion * 100).toFixed(1)}%)`,
        );

        linesUpdated++;
        if (newAmount <= 0) linesFullyCleared++;
      }
    } else {
      logger.info(
        '[Invoice PO Line Utils] No SERVICE lines found on PO ' +
        purchaseOrderId + ' -- nothing to decrement',
      );
    }
  }

  logger.info(
    `[Invoice PO Line Utils] Completed: decremented ${linesUpdated} PO line(s) ` +
    `for invoice ${invoiceId}, ${linesFullyCleared} line(s) fully cleared`,
  );

  return { linesUpdated, linesFullyCleared, skipped: false };
}
