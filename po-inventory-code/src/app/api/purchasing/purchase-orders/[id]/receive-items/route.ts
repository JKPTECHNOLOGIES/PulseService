/**
 * Purchase Order Batch Receive Items API Route
 *
 * Enhanced receiving endpoint that supports INVENTORY, SERVICE, and CONSUMABLE line items.
 * This endpoint uses the new lineItemReceivingService for unified receiving across all types.
 *
 * DUPLICATE PREVENTION:
 * - Supports idempotency keys via X-Idempotency-Key header
 * - Prevents duplicate receipts from double-clicks or network retries
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { lineItemReceivingService } from "@/services/purchasing/purchase-order/line-item-receiving.service";
import { batchReceiveItemsSchema } from "@/services/purchasing/purchase-order/line-item.types";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/purchasing/purchase-orders/[id]/receive-items
 *
 * Batch receive items from a purchase order with support for:
 * - INVENTORY items (traditional inventory with stock tracking)
 * - SERVICE items (external services, labor, contracts)
 * - CONSUMABLE items (non-tracked supplies)
 *
 * Request Body:
 * {
 *   items: [
 *     {
 *       itemId: string;              // PO line item ID
 *       lineType: 'INVENTORY' | 'SERVICE' | 'CONSUMABLE';
 *       quantityReceived: number;
 *       receivedBy: string;          // User ID
 *       receivedByName: string;      // User name
 *       receivedAt?: Date;           // Optional, defaults to now
 *       invoiceNumber?: string;
 *       invoiceDate?: Date;
 *       notes?: string;
 *
 *       // INVENTORY specific fields
 *       storeId?: string;            // Required for INVENTORY
 *       bin?: string;
 *       lotNumber?: string;
 *       serialNumbers?: string[];
 *
 *       // SERVICE specific fields
 *       serviceDate?: Date;          // Required for SERVICE
 *       serviceProvider?: string;
 *       hoursOrUnits?: number;
 *       completionNotes?: string;
 *       qualityRating?: number;      // 1-5
 *
 *       // CONSUMABLE specific fields
 *       usedBy?: string;             // User ID
 *       usedByName?: string;
 *       departmentId?: string;
 *       areaId?: string;
 *       purpose?: string;
 *     }
 *   ];
 *   notes?: string;                  // Overall receiving notes
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   receipts: ReceiveLineItemResult[];
 *   totalCost: number;
 *   errors: Array<{ itemId: string; error: string; }>;
 * }
 */
export const POST = createApiHandler(
  {
    hasParams: true,
    bodySchema: batchReceiveItemsSchema,
  },
  async (req, context) => {
    // Check for idempotency key to prevent duplicate receipts
    const idempotencyKey = req.headers.get("x-idempotency-key");
    if (idempotencyKey) {
      // Check if we've already processed this request
      const existingReceipt = await prisma.pOLineReceipt.findFirst({
        where: {
          poLine: {
            purchaseOrderId: context.params.id,
          },
          notes: {
            contains: `[IDEMPOTENCY:${idempotencyKey}]`,
          },
        },
        include: {
          poLine: true,
        },
        orderBy: {
          receivedAt: "desc",
        },
      });
      
      if (existingReceipt) {
        // Return the existing result
        return success(
          {
            success: true,
            receipts: [{
              poLineId: existingReceipt.poLineId,
              lineType: existingReceipt.poLine.lineType,
              receiptId: existingReceipt.id,
              receiptNumber: existingReceipt.receiptNumber,
              quantityReceived: Number(existingReceipt.quantityReceived),
              totalCost: Number(existingReceipt.totalCost),
              budgetCharged: true,
              budgetTransactionIds: [],
            }],
            totalCost: Number(existingReceipt.totalCost),
            errors: [],
          },
          "Receipt already processed (idempotency)"
        );
      }
    }
    
    // Batch receive items using the enhanced service
    const result = await lineItemReceivingService.batchReceive(
      context.serviceContext,
      context.params.id,
      context.data,
      idempotencyKey ?? undefined
    );

    // Return success with detailed results (HTTP 200 even for result.success === false,
    // so the frontend receives structured pre-validation error messages)
    return success(result, `Successfully received ${result.receipts.length} items`);
  }
);
