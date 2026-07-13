/**
 * Purchase Order Receipt Detail API Route
 *
 * Get detailed information for a specific receipt.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { success } from "@/lib/api-response";
import {
  createApiHandler,
  type ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";

/**
 * GET /api/purchasing/purchase-orders/[id]/receipts/[receiptId]
 *
 * Get detailed information for a specific receipt including:
 * - Receipt details
 * - PO line information
 * - Service receipt details (if SERVICE type)
 * - Consumable usage details (if CONSUMABLE type)
 * - Budget transactions
 *
 * Response:
 * {
 *   id: string;
 *   receiptNumber: string;
 *   poLineId: string;
 *   lineType: 'INVENTORY' | 'SERVICE' | 'CONSUMABLE';
 *   quantityReceived: number;
 *   unitCost: number;
 *   totalCost: number;
 *   receivedBy: string;
 *   receivedByName: string;
 *   receivedAt: Date;
 *   invoiceNumber?: string;
 *   invoiceDate?: Date;
 *   notes?: string;
 *   metadata?: any;
 *
 *   poLine: {
 *     id: string;
 *     description: string;
 *     quantity: number;
 *     receivedQuantity: number;
 *     unitPrice: number;
 *     purchaseOrder: {
 *       id: string;
 *       poNumber: string;
 *       status: string;
 *     };
 *   };
 *
 *   serviceReceipt?: {
 *     id: string;
 *     serviceDate: Date;
 *     serviceProvider?: string;
 *     hoursOrUnits?: number;
 *     completionNotes?: string;
 *     qualityRating?: number;
 *     metadata?: any;
 *   };
 *
 *   consumableUsage?: {
 *     id: string;
 *     usedBy?: string;
 *     usedByName?: string;
 *     usedAt: Date;
 *     departmentId?: string;
 *     areaId?: string;
 *     purpose?: string;
 *     notes?: string;
 *     metadata?: any;
 *   };
 *
 *   budgetTransactions: Array<{
 *     id: string;
 *     budgetType: string;
 *     transactionType: string;
 *     amount: number;
 *     description: string;
 *     createdAt: Date;
 *   }>;
 * }
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (
    _req,
    context: ApiContextWithParams<{ id: string; receiptId: string }>,
  ) => {
    try {
    // Check permission
    const permission = buildPermissionString(
      PermissionResource.PURCHASING,
      PermissionAction.READ
    );
    await checkPermission(context.serviceContext, permission);

    // Get receipt with all related data
    const receipt = await prisma.pOLineReceipt.findUnique({
      where: { id: context.params.receiptId },
      include: {
        poLine: {
          include: {
            purchaseOrder: {
              select: {
                id: true,
                poNumber: true,
                status: true,
              },
            },
          },
        },
        serviceReceipts: true,
        consumableUsages: true,
      },
    });

    if (!receipt) {
      throw new NotFoundError("POLineReceipt", context.params.receiptId);
    }

    // Verify receipt belongs to the specified PO
    if (receipt.poLine.purchaseOrderId !== context.params.id) {
      throw new NotFoundError("POLineReceipt", context.params.receiptId);
    }

    // Get related budget transactions
    const budgetTransactions = await prisma.budgetTransaction.findMany({
      where: {
        referenceType: "POLineReceipt",
        referenceNumber: receipt.receiptNumber,
      },
      select: {
        id: true,
        budgetType: true,
        transactionType: true,
        amount: true,
        description: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Transform to response format
    const response = {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      poLineId: receipt.poLineId,
      lineType: receipt.poLine.lineType,
      quantityReceived: Number(receipt.quantityReceived),
      unitCost: Number(receipt.unitCost),
      totalCost: Number(receipt.totalCost),
      receivedBy: receipt.receivedBy,
      receivedByName: receipt.receivedByName,
      receivedAt: receipt.receivedAt,
      invoiceNumber: receipt.invoiceNumber,
      invoiceDate: receipt.invoiceDate,
      notes: receipt.notes,
      // metadata field removed - use proper typed columns instead
      storeId: receipt.storeId,
      bin: receipt.bin,
      lotNumber: receipt.lotNumber,
      serialNumbers: receipt.serialNumbers,
      poLine: {
        id: receipt.poLine.id,
        description: receipt.poLine.description,
        quantity: Number(receipt.poLine.quantity),
        receivedQuantity: Number(receipt.poLine.receivedQuantity),
        unitPrice: Number(receipt.poLine.unitPrice),
        purchaseOrder: receipt.poLine.purchaseOrder,
      },
      serviceReceipt: receipt.serviceReceipts[0]
        ? {
            id: receipt.serviceReceipts[0].id,
            serviceDate: receipt.serviceReceipts[0].serviceDate,
            serviceProvider: receipt.serviceReceipts[0].serviceProvider,
            hoursOrUnits: receipt.serviceReceipts[0].hoursOrUnits
              ? Number(receipt.serviceReceipts[0].hoursOrUnits)
              : null,
            completionNotes: receipt.serviceReceipts[0].completionNotes,
            qualityRating: receipt.serviceReceipts[0].qualityRating,
            // metadata field removed - service details are in proper columns
          }
        : undefined,
      consumableUsage: receipt.consumableUsages[0]
        ? {
            id: receipt.consumableUsages[0].id,
            usedBy: receipt.consumableUsages[0].usedBy,
            usedByName: receipt.consumableUsages[0].usedByName,
            usedAt: receipt.consumableUsages[0].usedAt,
            departmentId: receipt.consumableUsages[0].departmentId,
            areaId: receipt.consumableUsages[0].areaId,
            purpose: receipt.consumableUsages[0].purpose,
            notes: receipt.consumableUsages[0].notes,
            // metadata field removed - consumable details are in proper columns
          }
        : undefined,
      budgetTransactions: budgetTransactions.map((bt) => ({
        id: bt.id,
        budgetType: bt.budgetType,
        transactionType: bt.transactionType,
        amount: Number(bt.amount),
        description: bt.description,
        createdAt: bt.createdAt,
      })),
    };

    return success(response, "Receipt details retrieved successfully");
  
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
