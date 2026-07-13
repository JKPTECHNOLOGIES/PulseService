/**
 * Invoice-Receipt Matching Service
 * Handles matching invoices with PO receipts for 3-way matching
 */

import { prisma } from '@/lib/prisma';
import { generateInvoiceInternalNumber } from './invoice-utils';
import {
  InvoiceMatchCriteria,
  ReceiptMatchScore,
  MatchResult,
  VarianceResult,
  LineVariance,
  CreateInvoiceFromReceiptsInput,
  CreateInvoiceFromReceiptsResult,
  ThreeWayMatchValidation,
  AutoMatchConfig,
} from './invoice-receipt-matching.types';
import { Prisma, type Invoice, type POLineReceipt } from '@prisma/client';

export class InvoiceReceiptMatchingService {
  // Default configuration for auto-matching
  private static readonly DEFAULT_CONFIG: AutoMatchConfig = {
    primaryMatch: {
      invoiceNumberMatch: true,
      invoiceDateMatch: true,
      supplierMatch: true,
      amountTolerance: 5, // 5%
    },
    secondaryMatch: {
      dateTolerance: 7, // 7 days
      supplierMatch: true,
      amountTolerance: 10, // 10%
    },
  };

  /**
   * Find potential receipt matches for an invoice
   *
   * Matching logic:
   * 1. Each receipt is checked against its PO line (line-level match)
   * 2. All receipts collectively are checked against invoice total (total-level match)
   * 3. Final score combines both line-level and total-level matching
   */
  static async findMatchingReceipts(
    criteria: InvoiceMatchCriteria
  ): Promise<ReceiptMatchScore[]> {
    const {
      invoiceNumber,
      invoiceDate,
      totalAmount,
      supplierId,
      purchaseOrderId,
      amountTolerance = 10,
      dateTolerance = 7,
    } = criteria;

    // Build query to find receipts.
    // PARTIAL INVOICING: We do NOT exclude receipts that already have an
    // invoiceId because vendors frequently send partial invoices against the
    // same receipt. All receipts should be scoreable/discoverable.
    const whereClause: Prisma.POLineReceiptWhereInput = {
      poLine: {
        purchaseOrder: {
          supplierId,
          ...(purchaseOrderId && { id: purchaseOrderId }),
        },
      },
      // Do not filter isReturn receipts or reversed receipts here — the caller
      // (UI dialog) already handles that filtering.
    };

    const receipts = await prisma.pOLineReceipt.findMany({
      where: whereClause,
      include: {
        poLine: {
          include: {
            purchaseOrder: true,
          },
        },
      },
      orderBy: {
        receivedAt: 'desc',
      },
    });

    // Calculate total of ALL receipts for collective matching
    const allReceiptsTotal = receipts.reduce((sum, r) => sum + Number(r.totalCost), 0);
    
    // Calculate collective match score (applies to all receipts)
    let collectiveScore = 0;
    let collectiveMatchReason = '';
    let collectiveMatchType: 'PRIMARY' | 'SECONDARY' | 'MANUAL' = 'MANUAL';

    // Total-level matching: Check if sum of all receipts matches invoice total
    if (totalAmount && allReceiptsTotal > 0) {
      const amountDiff = Math.abs(totalAmount - allReceiptsTotal);
      const amountDiffPercent = (amountDiff / totalAmount) * 100;

      if (amountDiffPercent <= this.DEFAULT_CONFIG.primaryMatch.amountTolerance) {
        collectiveScore += 30;
        collectiveMatchReason += `Total of all receipts ($${allReceiptsTotal.toFixed(2)}) matches invoice within ${amountDiffPercent.toFixed(2)}% tolerance. `;
        collectiveMatchType = 'PRIMARY';
      } else if (amountDiffPercent <= amountTolerance) {
        collectiveScore += 15;
        collectiveMatchReason += `Total of all receipts ($${allReceiptsTotal.toFixed(2)}) within ${amountDiffPercent.toFixed(2)}% tolerance. `;
        collectiveMatchType = 'SECONDARY';
      } else {
        collectiveMatchReason += `Total receipts ($${allReceiptsTotal.toFixed(2)}) vs invoice ($${totalAmount.toFixed(2)}): ${amountDiffPercent.toFixed(2)}% variance. `;
      }
    }

    // Score each receipt (line-level + collective)
    const scoredReceipts: ReceiptMatchScore[] = receipts.map((receipt) => {
      let score = collectiveScore; // Start with collective score
      let matchReason = collectiveMatchReason;
      let matchType = collectiveMatchType;

      // Line-level matching: Check if receipt matches its PO line
      const poLine = receipt.poLine;
      const receiptTotal = Number(receipt.totalCost);
      const poLineTotal = Number(poLine.totalPrice);
      const receiptQty = Number(receipt.quantityReceived);
      const poLineQty = Number(poLine.quantity);

      // Check quantity match
      if (receiptQty === poLineQty) {
        score += 20;
        matchReason += `Quantity matches PO line (${receiptQty}). `;
      } else {
        const qtyDiffPercent = Math.abs((receiptQty - poLineQty) / poLineQty) * 100;
        if (qtyDiffPercent <= 10) {
          score += 10;
          matchReason += `Quantity close to PO line (${receiptQty} vs ${poLineQty}). `;
        }
      }

      // Check amount match against PO line
      const lineDiff = Math.abs(receiptTotal - poLineTotal);
      const lineDiffPercent = poLineTotal > 0 ? (lineDiff / poLineTotal) * 100 : 0;
      
      if (lineDiffPercent <= 5) {
        score += 20;
        matchReason += `Receipt amount ($${receiptTotal.toFixed(2)}) matches PO line ($${poLineTotal.toFixed(2)}). `;
      } else if (lineDiffPercent <= 10) {
        score += 10;
        matchReason += `Receipt amount close to PO line (${lineDiffPercent.toFixed(2)}% diff). `;
      }

      // Add individual match criteria (invoice number, date)
      if (invoiceNumber && receipt.invoiceNumber === invoiceNumber) {
        score += 40;
        matchReason += 'Invoice number matches. ';
        matchType = 'PRIMARY';
      }

      if (invoiceDate && receipt.invoiceDate) {
        const daysDiff = Math.abs(
          (new Date(invoiceDate).getTime() - new Date(receipt.invoiceDate).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (daysDiff === 0) {
          score += 30;
          matchReason += 'Invoice date exact match. ';
        } else if (daysDiff <= dateTolerance) {
          score += 20;
          matchReason += `Invoice date within ${daysDiff} days. `;
        }
      }

      // Calculate variances (still show individual receipt details)
      const variances = this.calculateVariances(
        [receipt],
        Number(receipt.totalCost) // Individual receipt variance
      );

      return {
        receipt: receipt as ReceiptMatchScore['receipt'],
        matchScore: score,
        matchReason: matchReason || 'Manual match required',
        matchType,
        variances,
      };
    });

    // Sort by score (highest first)
    return scoredReceipts.sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Match an invoice to specific receipts
   */
  static async matchInvoiceToReceipts(
    invoiceId: string,
    receiptIds: string[]
  ): Promise<MatchResult> {
    try {
      // Get the invoice
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          supplier: true,
          purchaseOrder: true,
        },
      });

      if (!invoice) {
        return {
          invoice: null as unknown as Invoice,
          matchedReceipts: [],
          variances: null as unknown as VarianceResult,
          success: false,
          message: 'Invoice not found',
        };
      }

      // Get the receipts
      const receipts = await prisma.pOLineReceipt.findMany({
        where: {
          id: { in: receiptIds },
        },
        include: {
          poLine: {
            include: {
              purchaseOrder: true,
            },
          },
        },
      });

      // Validate supplier match
      const supplierMismatch = receipts.some(
        (r) => r.poLine.purchaseOrder.supplierId !== invoice.supplierId
      );

      if (supplierMismatch) {
        return {
          invoice,
          matchedReceipts: [],
          variances: null as unknown as VarianceResult,
          success: false,
          message: 'Supplier mismatch detected',
        };
      }

      // Calculate variances
      const variances = this.calculateVariances(receipts, Number(invoice.totalAmount));

      // Update receipts to link to invoice.
      // PARTIAL INVOICING: Only set invoiceId on receipts that don't already
      // have one linked. This preserves the first invoice's receipt link while
      // allowing the same receipt to be matched to subsequent partial invoices.
      await prisma.pOLineReceipt.updateMany({
        where: {
          id: { in: receiptIds },
          invoiceId: null, // Only update receipts not yet linked to an invoice
        },
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
        },
      });

      // Get updated receipts
      const updatedReceipts = await prisma.pOLineReceipt.findMany({
        where: {
          id: { in: receiptIds },
        },
      });

      return {
        invoice,
        matchedReceipts: updatedReceipts,
        variances,
        success: true,
        message: 'Invoice successfully matched to receipts',
      };
    } catch (error) {
      return {
        invoice: null as unknown as Invoice,
        matchedReceipts: [],
        variances: null as unknown as VarianceResult,
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Create an invoice from receipts
   */
  static async createInvoiceFromReceipts(
    input: CreateInvoiceFromReceiptsInput,
    _userId: string
  ): Promise<CreateInvoiceFromReceiptsResult> {
    try {
      const { purchaseOrderId, receiptIds, invoiceNumber, invoiceDate, dueDate, notes } =
        input;

      // Get receipts
      const receipts = await prisma.pOLineReceipt.findMany({
        where: {
          id: { in: receiptIds },
        },
        include: {
          poLine: {
            include: {
              purchaseOrder: true,
            },
          },
        },
      });

      if (receipts.length === 0) {
        throw new Error('No receipts found');
      }

      // Get PO
      const po = receipts[0]?.poLine.purchaseOrder;
      if (!po) {
        throw new Error("Purchase order not found for receipts");
      }

      // Calculate totals from receipts.
      // Tax on invoices is intentionally zero here: this path creates an invoice
      // from selected receipts (goods already received). The tax amount was already
      // captured on the Purchase Order (PO.taxAmount) at approval time via the tax
      // module and posted to GL via the PO_TAX GL event. Prorating PO tax across
      // partial-receipt invoices requires invoice-level tax lines and is out of
      // scope for the initial tax module rollout. When enabled, set tax from
      // po.taxAmount prorated by (receipt subtotal / po subtotal).
      const subtotal = receipts.reduce((sum, r) => sum + Number(r.totalCost), 0);
      const tax = 0;
      const shippingCost = 0;
      const totalAmount = subtotal + tax + shippingCost;

      // Generate internal tracking number
      const internalNumber = await generateInvoiceInternalNumber(prisma);

      // Create invoice
      const invoice = await prisma.invoice.create({
        data: {
          internalNumber,
          invoiceNumber,
          invoiceDate,
          dueDate,
          totalAmount,
          subtotal,
          tax,
          shippingCost,
          supplierId: po.supplierId,
          purchaseOrderId,
          notes,
          status: 'Pending',
        },
      });

      // Link receipts to invoice.
      // PARTIAL INVOICING: Only set invoiceId on receipts not yet linked.
      await prisma.pOLineReceipt.updateMany({
        where: {
          id: { in: receiptIds },
          invoiceId: null, // Only update receipts not yet linked to an invoice
        },
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
        },
      });

      // Get updated receipts
      const updatedReceipts = await prisma.pOLineReceipt.findMany({
        where: {
          id: { in: receiptIds },
        },
      });

      // Calculate variances
      const variances = this.calculateVariances(receipts, totalAmount);

      return {
        invoice,
        matchedReceipts: updatedReceipts,
        variances,
        success: true,
        message: 'Invoice created successfully',
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Validate 3-way match (PO → Receipt → Invoice)
   */
  static async validate3WayMatch(invoiceId: string): Promise<ThreeWayMatchValidation> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        supplier: true,
        purchaseOrder: true,
        receipts: {
          include: {
            poLine: {
              include: {
                purchaseOrder: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (!invoice.purchaseOrder) {
      throw new Error('Invoice not linked to a purchase order');
    }

    const receipts = invoice.receipts;
    const warnings: string[] = [];
    const errors: string[] = [];

    // Validate supplier match
    const supplierMatch = receipts.every(
      (r) => r.poLine.purchaseOrder.supplierId === invoice.supplierId
    );

    if (!supplierMatch) {
      errors.push('Supplier mismatch between invoice and receipts');
    }

    // Calculate variances
    const variances = this.calculateVariances(receipts, Number(invoice.totalAmount));

    // Validate amount match
    const amountMatch = variances.withinTolerance;
    if (!amountMatch) {
      warnings.push(
        `Amount variance of ${variances.variancePercent.toFixed(2)}% exceeds tolerance`
      );
    }

    // Validate quantity and price (simplified)
    const quantityMatch = true; // TODO: Implement detailed quantity matching
    const priceMatch = true; // TODO: Implement detailed price matching

    return {
      isValid: errors.length === 0 && amountMatch,
      purchaseOrder: invoice.purchaseOrder,
      receipts,
      invoice,
      validations: {
        supplierMatch,
        amountMatch,
        quantityMatch,
        priceMatch,
      },
      variances,
      warnings,
      errors,
    };
  }

  /**
   * Calculate variances between receipts and invoice
   */
  private static calculateVariances(
    receipts: Array<POLineReceipt & { poLine?: { description: string } | null }>,
    invoiceTotal: number
  ): VarianceResult {
    const receiptTotal = receipts.reduce((sum: number, r) => sum + Number(r.totalCost), 0);
    const variance = invoiceTotal - receiptTotal;
    const variancePercent = receiptTotal > 0 ? (variance / receiptTotal) * 100 : 0;
    const tolerancePercent = 10; // 10% tolerance
    const withinTolerance = Math.abs(variancePercent) <= tolerancePercent;

    // Calculate line-level variances
    const lineVariances: LineVariance[] = receipts.map((receipt) => ({
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      description: receipt.poLine?.description ?? 'N/A',
      receiptQuantity: Number(receipt.quantityReceived),
      receiptUnitCost: Number(receipt.unitCost),
      receiptTotal: Number(receipt.totalCost),
      // Invoice line details would be populated if we had invoice lines
      invoiceQuantity: undefined,
      invoiceUnitCost: undefined,
      invoiceTotal: undefined,
      quantityVariance: undefined,
      priceVariance: undefined,
      totalVariance: undefined,
      variancePercent: undefined,
    }));

    return {
      receiptTotal,
      invoiceTotal,
      variance,
      variancePercent,
      withinTolerance,
      tolerancePercent,
      lineVariances,
      hasSignificantVariance: Math.abs(variancePercent) > 10,
    };
  }

  /**
   * Get receipts for a purchase order that don't have an invoice
   */
  static getUnmatchedReceipts(purchaseOrderId: string) {
    return prisma.pOLineReceipt.findMany({
      where: {
        poLine: {
          purchaseOrderId,
        },
        invoiceId: null,
      },
      include: {
        poLine: {
          include: {
            purchaseOrder: true,
          },
        },
      },
      orderBy: {
        receivedAt: 'desc',
      },
    });
  }

  /**
   * Get all receipts linked to an invoice
   */
  static getInvoiceReceipts(invoiceId: string) {
    return prisma.pOLineReceipt.findMany({
      where: {
        invoiceId,
      },
      include: {
        poLine: {
          include: {
            purchaseOrder: true,
          },
        },
      },
      orderBy: {
        receivedAt: 'desc',
      },
    });
  }

  /**
   * Unmatch receipts from an invoice
   */
  static async unmatchReceipts(receiptIds: string[]): Promise<void> {
    await prisma.pOLineReceipt.updateMany({
      where: {
        id: { in: receiptIds },
      },
      data: {
        invoiceId: null,
      },
    });
  }
}
