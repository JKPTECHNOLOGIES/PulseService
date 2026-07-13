/**
 * Receipt Reversal API Route
 *
 * POST /api/purchasing/purchase-orders/[id]/receipts/[receiptId]/reverse
 *
 * Reverses a specific goods receipt on a PO line.
 * Creates a reversal receipt, reverses GL entries (with budget corrections),
 * and updates PO status accordingly.
 *
 * Body: { reason: string }
 * Returns: { success: true, data: { reversalReceipt, glReversal } }
 */

import { success } from "@/lib/api-response";
import {
  createApiHandler,
  type ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { receiptReversalService } from "@/services/purchasing/purchase-order/receipt-reversal.service";
import { BadRequestError, NotFoundError, InternalServerError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/purchasing/purchase-orders/[id]/receipts/[receiptId]/reverse
 *
 * Reverse a specific receipt. Requires a reason in the request body.
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (
    req,
    context: ApiContextWithParams<{ id: string; receiptId: string }>,
  ) => {
    try {
      // Parse and validate the request body
      const body = (await req.json()) as Record<string, unknown>;
      const { reason } = body;

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        throw new BadRequestError("A reversal reason is required.");
      }

      // Verify the receipt belongs to the specified PO before proceeding
      const receipt = await prisma.pOLineReceipt.findUnique({
        where: { id: context.params.receiptId },
        include: {
          poLine: {
            select: { purchaseOrderId: true },
          },
        },
      });

      if (!receipt) {
        throw new NotFoundError("POLineReceipt", context.params.receiptId);
      }

      if (receipt.poLine.purchaseOrderId !== context.params.id) {
        throw new NotFoundError(
          "POLineReceipt",
          `${context.params.receiptId} on PO ${context.params.id}`,
        );
      }

      // Call the reversal service
      const result = await receiptReversalService.reverseReceipt(
        context.params.receiptId,
        reason.trim(),
        context.serviceContext.userId,
        context.serviceContext.userName,
      );

      return success(result, "Receipt reversed successfully");
    } catch (error) {
      // Re-throw known API errors (they have proper status codes)
      if (error instanceof BadRequestError || error instanceof NotFoundError) {
        throw error;
      }

      // Wrap unexpected errors
      throw new InternalServerError(
        "An error occurred while reversing the receipt",
        {
          suggestion:
            "Please try again. If the problem persists, contact support.",
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
);
