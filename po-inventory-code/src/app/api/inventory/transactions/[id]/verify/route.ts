import { NextRequest } from "next/server";
import { createApiHandler, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { NotFoundError, ValidationError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/inventory/transactions/[id]/verify
 * Verify an individual inventory transaction
 */
export const POST = createApiHandler(
  { hasParams: true, permission: "work_orders:verify" },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
    const { notes } = await request.json() as Record<string, unknown>;
    const transactionId = context.params.id;

    // Get the transaction
    const transaction = await prisma.inventoryTransaction.findUnique({
      where: { id: transactionId },
      include: {
        inventoryItem: true,
      },
    });

    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    // Check if already verified
    if (transaction.verified) {
      throw new ValidationError("Transaction already verified");
    }

    // Check if this is a work order transaction
    if (
      transaction.transactionType !== "WO_PART_ISSUED" &&
      transaction.transactionType !== "WO_RESERVATION_CONSUMED"
    ) {
      throw new ValidationError("Only work order transactions can be verified");
    }

    // Verify the transaction
    const verifiedTransaction = await prisma.inventoryTransaction.update({
      where: { id: transactionId },
      data: {
        verified: true,
        verifiedBy: context.serviceContext.userId,
        verifiedAt: new Date(),
        verificationNotes: notes ?? null,
        updatedBy: context.serviceContext.userId,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
          },
        },
      },
    });

    return success({ transaction: verifiedTransaction });
  
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthorizationError
      ) {
        throw error;
      }
      
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
