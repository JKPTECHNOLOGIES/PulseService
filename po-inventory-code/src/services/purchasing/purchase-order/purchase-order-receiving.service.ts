/**
 * Purchase Order Receiving Service
 *
 * Handles all item receiving operations for Purchase Orders.
 * Responsibilities:
 * - Receive items from purchase orders
 * - Update inventory stock levels
 * - Track receiving history via audit log
 * - Update PO status based on received quantities
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { AuditAction } from "@/services/audit/audit.types";
import { checkPermission } from "@/services/shared/permissions";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import type {
  PurchaseOrderWithRelations,
  ReceiveItemsInput,
  ReceivingHistoryEntry,
} from "./purchase-order.types";

/**
 * Purchase Order Receiving Service
 *
 * Manages the receiving process for purchase orders including:
 * - Item receipt processing
 * - Inventory stock updates via inventoryStockService
 * - Receiving history tracking via audit log
 * - Status updates based on received quantities
 */
class PurchaseOrderReceivingService {
  private readonly resource = PermissionResource.PURCHASING;

  /**
   * Receive items from a purchase order
   *
   * This method:
   * 1. Validates permissions and PO status
   * 2. Processes each item being received
   * 3. Updates inventory stock levels via inventoryStockService
   * 4. Updates PO item received quantities
   * 5. Updates PO status (ORDERED → PARTIALLY_RECEIVED → RECEIVED)
   * 6. Logs comprehensive audit trail
   *
   * @param ctx - Service context with user and permissions
   * @param id - Purchase order ID
   * @param input - Receiving input with items and metadata
   * @returns Updated purchase order with relations
   * @throws NotFoundError if PO not found
   * @throws BadRequestError if PO cannot receive items or quantities invalid
   */
  /**
   * @deprecated Use lineItemReceivingService.batchReceive() instead.
   *
   * This method was the original receiving path. It has a critical flaw:
   * it calls inventoryStockService.receive() (which commits immediately)
   * BEFORE updating POLine.receivedQuantity. If the latter fails, inventory
   * is incremented but no POLineReceipt record is created, leaving the system
   * in an inconsistent state.
   *
   * The new path (lineItemReceivingService.batchReceive) runs everything in a
   * single Prisma transaction and always creates a POLineReceipt record.
   *
   * This method now throws immediately to prevent accidental use.
   */
  receiveItems(
    ctx: ServiceContext,
    id: string,
    input: ReceiveItemsInput,
  ): PurchaseOrderWithRelations {
    // SAFETY GUARD: This method is deprecated and must not be called.
    //
    // Root cause of customer complaint (item #28578, PO P000001444-0000-001):
    //   This method called inventoryStockService.receive() (which commits immediately)
    //   BEFORE updating POLine.receivedQuantity. If the latter failed, inventory was
    //   incremented but no POLineReceipt record was created, leaving receipts visible
    //   in the Transactions tab but invisible in the PO receipt box.
    //
    // Fix applied 2026-03-04: All receiving must go through
    //   lineItemReceivingService.batchReceive() which runs everything in a single
    //   Prisma transaction and always creates a POLineReceipt record.
    //
    // Data repair: scripts/fix-missing-po-receipt-28578.ts
    logger.error(
      `[PO Receiving] DEPRECATED receiveItems() called for PO ${id} by user ${ctx.userId} (${ctx.userName}). ` +
      `This method does not create POLineReceipt records. ` +
      `Caller must be updated to use lineItemReceivingService.batchReceive().`,
      { poId: id, userId: ctx.userId, userName: ctx.userName, input }
    );
    throw new BadRequestError(
      "receiveItems() is deprecated. Use the /receive-items API endpoint which calls lineItemReceivingService.batchReceive(). " +
      "This method does not create POLineReceipt records and will leave receipts invisible in the PO receipt box."
    );
  }

  /**
   * Get receiving history for a purchase order
   *
   * Retrieves receiving transactions from the audit log.
   * Since there's no PurchaseOrderReceiving table, we extract receiving
   * information from audit log entries.
   *
   * @param ctx - Service context with user and permissions
   * @param id - Purchase order ID
   * @returns Array of receiving history entries
   * @throws NotFoundError if PO not found
   */
  async getReceivingHistory(
    ctx: ServiceContext,
    id: string,
  ): Promise<ReceivingHistoryEntry[]> {
    try {
      const permission = buildPermissionString(
        this.resource,
        PermissionAction.READ,
      );
      await checkPermission(ctx, permission);

      // Verify PO exists
      const po = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          lines: {
            include: {
              inventoryItem: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
        },
      });

      if (!po) {
        throw new NotFoundError("PurchaseOrder", id);
      }

      // Get receiving audit log entries
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          entityType: "PurchaseOrder",
          entityId: id,
          action: AuditAction.UPDATE,
        },
        orderBy: { timestamp: "desc" },
      });

      // Filter and transform audit logs to receiving history
      const receivingEntries: ReceivingHistoryEntry[] = [];

      for (const log of auditLogs) {
        const changes = log.changes as Record<string, unknown>;

        // Check if this is a receiving operation
        if (changes.newValues && typeof changes.newValues === "object") {
          const newValues = changes.newValues as Record<string, unknown>;

          if (
            newValues.receivingResults &&
            Array.isArray(newValues.receivingResults)
          ) {
            const results = newValues.receivingResults as Array<{
              itemId: string;
              inventoryItemId?: string;
              quantityReceived: number;
              location?: string;
            }>;

            const receivedBy = newValues.receivedBy as string;
            const receivedDate = newValues.receivedDate
              ? new Date(newValues.receivedDate as string)
              : log.timestamp;

            // Map results to items with inventory details
            const items = results.map((result) => {
              const poLine = po.lines.find((l) => l.id === result.itemId);
              return {
                itemId: result.itemId,
                inventoryItemId: result.inventoryItemId ?? "",
                inventoryItem: poLine?.inventoryItem
                  ? {
                      name: poLine.inventoryItem.name ?? "",
                      partNumber: poLine.inventoryItem.sku || "",
                    }
                  : undefined,
                quantityReceived: result.quantityReceived,
                location: result.location,
                notes: undefined,
              };
            });

            receivingEntries.push({
              id: log.id,
              receivedDate,
              receivedBy,
              receivedByUser: log.userName
                ? {
                    id: receivedBy,
                    name: log.userName,
                  }
                : undefined,
              items,
              notes: undefined,
            });
          }
        }
      }

      return receivingEntries;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new Error(
        `Failed to get receiving history: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

}

export const purchaseOrderReceivingService =
  new PurchaseOrderReceivingService();
