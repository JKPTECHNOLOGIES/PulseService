/**
 * Receipt Reversal Service
 *
 * Reverses a specific POLineReceipt, creating:
 * - A reversal receipt record (negative quantity, isReturn=true)
 * - GL reversal entries via the canonical glReversalService
 * - Inventory stock decrements (for INVENTORY line type)
 * - Updated PO line receivedQuantity
 * - Updated PO status based on new received quantities
 */

import { prisma } from "@/lib/prisma";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import { Decimal } from "@prisma/client/runtime/library";
import { LineItemType, type PrismaClient } from "@prisma/client";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";

type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface ReceiptReversalResult {
  reversalReceipt: {
    id: string;
    receiptNumber: string;
    poLineId: string;
    quantityReceived: number;
    totalCost: number;
    isReturn: boolean;
    originalReceiptId: string;
    notes: string | null;
  };
  glReversal: {
    reversalTransactionId: string;
    budgetCorrected: boolean;
  } | null;
}

class ReceiptReversalService {
  async reverseReceipt(
    receiptId: string,
    reason: string,
    userId: string,
    userName: string,
  ): Promise<ReceiptReversalResult> {
    // Step 1: Load the receipt with relations
    const receipt = await prisma.pOLineReceipt.findUnique({
      where: { id: receiptId },
      include: {
        poLine: {
          include: {
            purchaseOrder: true,
            chargeAllocations: true,
            inventoryItem: true,
          },
        },
        returnReceipts: true,
      },
    });

    // Step 2: Validate
    if (!receipt) {
      throw new NotFoundError("POLineReceipt", receiptId);
    }

    if (receipt.isReturn) {
      throw new BadRequestError(
        "Cannot reverse a return receipt. Only original receipts can be reversed.",
      );
    }

    if (receipt.returnReceipts.length > 0) {
      throw new BadRequestError(
        "Receipt has already been reversed.",
      );
    }

    // Also check receipt status field for REVERSED/VOIDED
    if (receipt.status === "REVERSED" || receipt.status === "VOIDED") {
      throw new BadRequestError(
        "Receipt has already been reversed/voided.",
      );
    }

    const po = receipt.poLine.purchaseOrder;
    if (po.status === "Cancelled") {
      throw new BadRequestError(
        "Cannot reverse receipt on a Cancelled purchase order.",
      );
    }

    // Step 3: Execute reversal in a Prisma transaction
    const txResult = await prisma.$transaction(async (tx: PrismaTx) => {
      // 3a. Generate receipt number
      const receiptNumber = await this.generateReceiptNumber(tx, "REV");

      // 3b. Create reversal receipt record (marked REVERSED since it's a reversal entry)
      const reversalReceipt = await tx.pOLineReceipt.create({
        data: {
          poLineId: receipt.poLineId,
          receiptNumber,
          quantityReceived: -Number(receipt.quantityReceived),
          unitCost: Number(receipt.unitCost),
          totalCost: -Number(receipt.totalCost),
          receivedBy: userId,
          receivedByName: userName,
          receivedAt: new Date(),
          isReturn: true,
          originalReceiptId: receiptId,
          notes: "Reversal: " + reason,
          storeId: receipt.storeId,
          bin: receipt.bin,
          status: "REVERSED",
        },
      });

      // 3b-ii. Mark the ORIGINAL receipt as REVERSED so it is no longer
      // counted in receivedQuantity calculations or duplicate checks.
      await tx.pOLineReceipt.update({
        where: { id: receiptId },
        data: {
          status: "REVERSED",
          notes: `[REVERSED] ${reason} (Reversed at ${new Date().toISOString()})${receipt.notes ? ` | Original notes: ${receipt.notes}` : ""}`,
        },
      });

      // 3c. Reverse inventory stock (INVENTORY type only)
      if (
        receipt.poLine.lineType === LineItemType.INVENTORY &&
        receipt.poLine.inventoryItemId &&
        receipt.storeId
      ) {
        const currentStock = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: receipt.poLine.inventoryItemId,
              storeId: receipt.storeId,
              bin: receipt.bin ?? "MAIN",
            },
          },
        });

        if (currentStock) {
          const newQty = Math.max(
            0,
            Number(currentStock.quantityOnHand) - Number(receipt.quantityReceived),
          );
          await tx.inventoryStock.update({
            where: {
              inventoryItemId_storeId_bin: {
                inventoryItemId: receipt.poLine.inventoryItemId,
                storeId: receipt.storeId,
                bin: receipt.bin ?? "MAIN",
              },
            },
            data: { quantityOnHand: newQty },
          });
        }
      }

      // 3d. Update POLine.receivedQuantity AND receivedAmount
      // Fetch current values first so we can clamp to 0 and never go negative.
      // A raw `decrement` could produce a negative value if the receipt was
      // imported without incrementing receivedQuantity (e.g. Tabware imports).
      const currentLine = await tx.pOLine.findUnique({
        where: { id: receipt.poLineId },
        select: { receivedQuantity: true, receivedAmount: true },
      });
      const currentReceivedQty = new Decimal(currentLine?.receivedQuantity ?? 0);
      const decrementQty = new Decimal(Number(receipt.quantityReceived));
      const newReceivedQty = Decimal.max(0, currentReceivedQty.minus(decrementQty));

      // Also decrement receivedAmount (tracks cumulative dollar amounts received)
      const currentReceivedAmt = new Decimal(currentLine?.receivedAmount ?? 0);
      const decrementAmt = new Decimal(Number(receipt.totalCost));
      const newReceivedAmt = Decimal.max(0, currentReceivedAmt.minus(decrementAmt));

      await tx.pOLine.update({
        where: { id: receipt.poLineId },
        data: {
          receivedQuantity: newReceivedQty,
          receivedAmount: newReceivedAmt,
        },
      });

      // 3e. Update PO status based on new received quantities
      // For Closed POs, preserve the Closed status — reversals are GL corrections only
      if (po.status !== "Closed") {
        const updatedLines = await tx.pOLine.findMany({
          where: { purchaseOrderId: po.id },
          select: { quantity: true, receivedQuantity: true },
        });

        const allFullyReceived = updatedLines.every(
          (line: { quantity: Decimal | number; receivedQuantity: Decimal | number }) =>
            new Decimal(line.receivedQuantity).greaterThanOrEqualTo(
              new Decimal(line.quantity),
            ),
        );

        const anyReceived = updatedLines.some(
          (line: { quantity: Decimal | number; receivedQuantity: Decimal | number }) =>
            new Decimal(line.receivedQuantity).greaterThan(0),
        );

        let newStatus = po.status;
        if (allFullyReceived) {
          newStatus = "Received";
        } else if (anyReceived) {
          newStatus = "PartiallyReceived";
        } else {
          newStatus = "Ordered";
        }

        if (newStatus !== po.status) {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              status: newStatus,
              receivedDate: newStatus === "Received" ? po.receivedDate : null,
            },
          });
        }
      }

      return {
        reversalReceipt: {
          id: reversalReceipt.id,
          receiptNumber: reversalReceipt.receiptNumber,
          poLineId: reversalReceipt.poLineId,
          quantityReceived: Number(reversalReceipt.quantityReceived),
          totalCost: Number(reversalReceipt.totalCost),
          isReturn: reversalReceipt.isReturn,
          originalReceiptId: reversalReceipt.originalReceiptId as string,
          notes: reversalReceipt.notes,
        },
      };
    });

    // Step 4a: Create InventoryTransaction audit record for the reversal.
    // Both reversal paths previously omitted this — the stock return was invisible in the inventory log.
    if (
      receipt.poLine.lineType === LineItemType.INVENTORY &&
      receipt.poLine.inventoryItemId &&
      receipt.storeId &&
      txResult.reversalReceipt
    ) {
      try {
        await prisma.inventoryTransaction.create({
          data: {
            inventoryItemId: receipt.poLine.inventoryItemId,
            storeId: receipt.storeId,
            transactionType: 'RECEIVE',        // negative quantity = return back to PO
            quantity: -Number(receipt.quantityReceived),
            unitCost: Number(receipt.unitCost),
            referenceType: 'PurchaseOrder',
            referenceId: receipt.poLine.purchaseOrderId,
            referenceNumber: txResult.reversalReceipt.receiptNumber,
            notes: `Receipt reversal: ${reason}`,
            performedBy: userId,
            performedByName: userName,
            transactionDate: new Date(),
            isReversed: false,
          },
        });
      } catch (_err) {
        // Non-fatal — audit gap is better than blocking the reversal
      }
    }

    // Step 4b: Reverse GL transaction (outside prisma.$transaction to avoid nested tx issues)
    let glReversal: ReceiptReversalResult["glReversal"] = null;

    try {
      const glTransaction = await prisma.gLTransaction.findFirst({
        where: {
          referenceType: "POLineReceipt",
          referenceId: receiptId,
          status: "POSTED",
          reversedAt: null,
        },
        select: { id: true },
      });

      if (glTransaction) {
        const reversalResult = await glReversalService.reverseTransaction(
          glTransaction.id,
          "Receipt reversal: " + reason,
          userId,
        );
        glReversal = {
          reversalTransactionId: reversalResult.reversalTransactionId,
          budgetCorrected: reversalResult.budgetCorrected,
        };
      }
    } catch (_error) {
      // GL reversal is non-fatal - log but don't fail the overall operation
    }

    return {
      reversalReceipt: txResult.reversalReceipt,
      glReversal,
    };
  }

  private async generateReceiptNumber(
    tx: PrismaTx,
    prefix: string,
  ): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    const rawResult = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('receipt_number_seq')`;

    const sequenceNumber = Number(rawResult[0]?.nextval ?? 0);
    const sequence = String(sequenceNumber).padStart(4, "0");
    return prefix + "-" + year + month + "-" + sequence;
  }
}

// Export singleton instance
const globalForReceiptReversal = globalThis as unknown as { receiptReversalService: ReceiptReversalService | undefined };
export const receiptReversalService = globalForReceiptReversal.receiptReversalService ?? (globalForReceiptReversal.receiptReversalService = new ReceiptReversalService());
