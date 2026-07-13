/**
 * Inventory Stock Service
 *
 * Centralized service for all inventory stock operations.
 * Implements the 24 documented stock update patterns throughout the system.
 *
 * Key Features:
 * - Transaction-based operations for data integrity
 * - Audit trail via inventory transaction service
 * - Store-specific or multi-store operations
 * - Multi-bin support for inventory locations
 * - Proper Decimal to number conversion
 * - Comprehensive error handling
 *
 * Based on analysis of:
 * - 8 RESERVE operations
 * - 4 UNRESERVE operations
 * - 6 ISSUE operations
 * - 2 RECEIVE operations
 * - 1 TRANSFER operation
 * - 3 ADJUST operations
 * - BIN TRANSFER operations (new)
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { BadRequestError, NotFoundError } from "@/lib/api-errors";
import { inventoryTransactionService } from "@/services/inventory/transaction.service";
import { inventoryGLService } from "@/services/inventory/inventory-gl.service";
import {
  InventoryTransactionType,
  ReferenceType,
} from "@/services/inventory/transaction.types";
import { toNumber } from "@/lib/decimal-helpers";
import { notificationService } from "@/services/notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { INVENTORY_NOTIFICATIONS } from "@/services/notifications/notification-types-registry";
import type { ServiceContext } from "@/services/base/types";
import { generateRepairableTrackingId } from "@/services/inventory/repairable-tracking-id";

import {
  ReserveOptions,
  UnreserveOptions,
  IssueOptions,
  ReceiveOptions,
  TransferOptions,
  AdjustOptions,
  StockValidationResult,
  StockSummary,
  StockOperationResult,
} from "./inventory-stock.types";

import {
  BinTransferOptions,
  BinTransferResult,
  MultiBinStockSummary,
} from "./bin-transfer.types";

/**
 * Inventory Stock Service Class
 *
 * Provides centralized stock management operations with:
 * - Transactional integrity
 * - Audit trail recording
 * - Multi-store support
 * - Validation and error handling
 */
class InventoryStockService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // RESERVE OPERATIONS (8 locations analyzed)
  // ============================================================================

  /**
   * Reserve inventory stock
   *
   * Increments quantityReserved for the specified inventory item.
   * If storeId provided: Updates only that store
   * If storeId NOT provided: Updates ALL stores proportionally
   *
   * Pattern from: reservation.service.ts, work-order-part.service.ts
   *
   * @param inventoryItemId - Inventory item to reserve
   * @param quantity - Quantity to reserve
   * @param options - Reserve options including context and store targeting
   * @returns Operation result with updated stock summary
   */
  async reserve(
    inventoryItemId: string,
    quantity: number,
    options: ReserveOptions,
  ): Promise<StockOperationResult> {
    try {
      // Validate inputs
      if (quantity <= 0) {
        throw new BadRequestError("Quantity must be positive");
      }

      // Check availability
      const validation = await this.validateAvailability(
        inventoryItemId,
        quantity,
        options.storeId,
      );

      // Get inventory item
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: {
          unitCost: true,
          sku: true,
          minQuantity: true,
          maxQuantity: true,
        },
      });

      if (!item) {
        throw new NotFoundError("Inventory Item", inventoryItemId);
      }

      const unitCost = toNumber(item.unitCost) ?? 0;

      // 🔧 ALLOW OVER-RESERVATION: Reserve the full requested quantity regardless of availability
      await this.prisma.$transaction(async (tx) => {
        const whereClause: Prisma.InventoryStockWhereInput = options.storeId
          ? { inventoryItemId, storeId: options.storeId }
          : { inventoryItemId };

        // Reserve the full requested quantity (may exceed available stock)
        await tx.inventoryStock.updateMany({
          where: whereClause,
          data: {
            quantityReserved: { increment: quantity },
          },
        });
      });

      // Record transaction for audit trail
      const affectedStores = options.storeId
        ? [options.storeId]
        : (validation.stores ?? []).map((s) => s.storeId);

      for (const storeId of affectedStores) {
        await inventoryTransactionService.recordWorkOrderTransaction(
          options.context,
          {
            inventoryItemId,
            storeId,
            transactionType: InventoryTransactionType.RESERVE,
            quantity: quantity,
            unitCost,
            workOrderId: options.referenceId ?? "",
            workOrderNumber: options.reason ?? "Stock Reserved",
            userId: options.context.userId,
            userName: options.context.userName,
            notes: options.reason ?? "Stock reserved",
          },
        );
      }

      // Get updated stock summary
      const stockSummary = await this.getStock(
        inventoryItemId,
        options.storeId,
      );

      return {
        success: true,
        stockSummary,
        metadata: {
          operation: "RESERVE",
          quantity: quantity,
          storeId: options.storeId,
          referenceType: options.referenceType,
          referenceId: options.referenceId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to reserve stock",
        errorCode: "RESERVE_FAILED",
      };
    }
  }

  // ============================================================================
  // UNRESERVE OPERATIONS (4 locations analyzed)
  // ============================================================================

  /**
   * Unreserve inventory stock
   *
   * Decrements quantityReserved for the specified inventory item.
   * If storeId provided: Updates only that store
   * If storeId NOT provided: Updates ALL stores proportionally
   *
   * Pattern from: reservation.service.ts (cancel), work-order-part.service.ts
   *
   * @param inventoryItemId - Inventory item to unreserve
   * @param quantity - Quantity to unreserve
   * @param options - Unreserve options including context and store targeting
   * @returns Operation result with updated stock summary
   */
  async unreserve(
    inventoryItemId: string,
    quantity: number,
    options: UnreserveOptions,
  ): Promise<StockOperationResult> {
    try {
      // Validate inputs
      if (quantity <= 0) {
        throw new BadRequestError("Quantity must be positive");
      }

      // Get inventory item for unit cost
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: { unitCost: true, sku: true },
      });

      if (!item) {
        throw new NotFoundError("Inventory Item", inventoryItemId);
      }

      const unitCost = toNumber(item.unitCost) ?? 0;

      // Perform unreservation in transaction
      let affectedStores: string[] = [];
      await this.prisma.$transaction(async (tx) => {
        // Build where clause based on store targeting
        const whereClause: Prisma.InventoryStockWhereInput = options.storeId
          ? { inventoryItemId, storeId: options.storeId }
          : { inventoryItemId };

        // Get current stock to validate
        const stocks = await tx.inventoryStock.findMany({
          where: whereClause,
        });

        affectedStores = stocks.map((s) => s.storeId);

        const totalReserved = stocks.reduce(
          (sum, s) => sum + (toNumber(s.quantityReserved) ?? 0),
          0,
        );

        if (totalReserved < quantity) {
          throw new BadRequestError(
            `Cannot unreserve more than reserved. Reserved: ${totalReserved}, Requested: ${quantity}`,
          );
        }

        // Update reserved quantity (decrement, but don't go below 0)
        await tx.inventoryStock.updateMany({
          where: whereClause,
          data: {
            quantityReserved: { decrement: quantity },
          },
        });

        // Ensure no negative reserved quantities
        await tx.inventoryStock.updateMany({
          where: {
            ...whereClause,
            quantityReserved: { lt: 0 },
          },
          data: {
            quantityReserved: 0,
          },
        });
      });

      // CRITICAL: Record transaction for audit trail
      for (const storeId of affectedStores) {
        await inventoryTransactionService.recordWorkOrderTransaction(
          options.context,
          {
            inventoryItemId,
            storeId,
            transactionType: InventoryTransactionType.UNRESERVE,
            quantity,
            unitCost,
            workOrderId: options.referenceId ?? "",
            workOrderNumber: options.reason ?? "Stock Unreserved",
            userId: options.context.userId,
            userName: options.context.userName,
            notes: `${options.reason ?? "Stock unreserved"}${options.referenceType ? ` (${options.referenceType})` : ""}${options.referenceId ? ` - Ref: ${options.referenceId}` : ""}`,
          },
        );
      }

      // Get updated stock summary
      const stockSummary = await this.getStock(
        inventoryItemId,
        options.storeId,
      );

      return {
        success: true,
        stockSummary,
        metadata: {
          operation: "UNRESERVE",
          quantity,
          storeId: options.storeId,
          reason: options.reason,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to unreserve stock",
        errorCode: "UNRESERVE_FAILED",
      };
    }
  }

  // ============================================================================
  // ISSUE OPERATIONS (6 locations analyzed)
  // ============================================================================

  /**
   * Issue inventory stock
   *
   * CRITICAL: Decrements BOTH quantityOnHand AND quantityReserved
   * This is the physical distribution of parts from inventory.
   * MUST create transaction record for audit trail.
   *
   * Two modes of operation:
   * 1. With reservationId: Validates against reservation quantity and marks it CONSUMED
   * 2. Without reservationId: Validates against available stock (for WorkOrderPart.status-based tracking)
   *
   * Pattern from: reservation.service.ts (consume), work-order-part.service.ts (issue)
   *
   * @param inventoryItemId - Inventory item to issue
   * @param quantity - Quantity to issue
   * @param options - Issue options including REQUIRED storeId and work order context
   * @returns Operation result with updated stock summary
   */
  async issue(
    inventoryItemId: string,
    quantity: number,
    options: IssueOptions,
  ): Promise<StockOperationResult> {
    try {
      // Validate inputs
      if (quantity <= 0) {
        throw new BadRequestError("Quantity must be positive");
      }

      if (!options.storeId) {
        throw new BadRequestError("Store ID is required for issue operations");
      }

      // Validate reservation if provided
      let reservation = null;
      if (options.reservationId) {
        reservation = await this.prisma.inventoryReservation.findUnique({
          where: { id: options.reservationId },
        });

        if (!reservation) {
          throw new NotFoundError("Reservation", options.reservationId);
        }

        if (reservation.status !== "ACTIVE") {
          throw new BadRequestError(
            `Cannot issue from reservation with status: ${reservation.status}`,
          );
        }

        if (reservation.inventoryItemId !== inventoryItemId) {
          throw new BadRequestError(
            "Reservation inventory item does not match requested item",
          );
        }

        const reservedQty = toNumber(reservation.quantity) ?? 0;
        if (quantity > reservedQty) {
          throw new BadRequestError(
            `Cannot issue ${quantity} - only ${reservedQty} reserved`,
          );
        }
      }
      // When issuing without reservation (WorkOrderPart.status-based),
      // we rely on the caller to have already validated the reservation via status

      // Get inventory item for unit cost
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: { unitCost: true },
      });

      if (!item) {
        throw new NotFoundError("Inventory Item", inventoryItemId);
      }

      const unitCost = toNumber(item.unitCost) ?? 0;

      // Perform issue in transaction
      await this.prisma.$transaction(async (tx) => {
        // Use provided bin or default to "MAIN"
        const binLocation = options.bin ?? "MAIN";

        // Get current stock - MUST exist
        const stock = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId,
              storeId: options.storeId,
              bin: binLocation,
            },
          },
        });

        // NO PHANTOM STOCK - if it doesn't exist, fail
        if (!stock) {
          throw new BadRequestError(
            `No stock record found for this item in store ${options.storeId}, bin ${binLocation}. Cannot issue.`,
          );
        }

        const reserved = toNumber(stock.quantityReserved) ?? 0;
        const onHand = toNumber(stock.quantityOnHand) ?? 0;

        // Validate we have enough on hand (always required)
        if (onHand < quantity) {
          throw new BadRequestError(
            `Insufficient stock on hand. Available: ${onHand}, Requested: ${quantity}`,
          );
        }

        // For reserved parts, we trust the reservation and don't check reserved quantity
        // because the reservation was made across all stores/bins
        if (!options.reservationId && !options.skipReservedCheck) {
          // Only validate reserved quantity for non-reserved (direct) issues
          if (reserved < quantity) {
            throw new BadRequestError(
              `Insufficient reserved stock. Reserved: ${reserved}, Requested: ${quantity}`,
            );
          }
        }

        // Issue: decrement onHand and (unless skipReservedDecrement) reserved.
        // skipReservedDecrement is set for PLANNED parts (no InventoryReservation) so
        // we don't corrupt quantityReserved with a decrement that has no matching
        // reservation to release (GAP 2 FIX — eliminates the external compensation hack).
        await tx.inventoryStock.update({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId,
              storeId: options.storeId,
              bin: binLocation,
            },
          },
          data: {
            quantityOnHand: { decrement: quantity },
            ...(options.skipReservedDecrement
              ? {}
              : { quantityReserved: { decrement: quantity } }),
          },
        });

        // If issuing from InventoryReservation, mark it as consumed
        if (reservation && options.reservationId) {
          await tx.inventoryReservation.update({
            where: { id: options.reservationId },
            data: {
              status: "CONSUMED",
              consumedAt: new Date(),
            },
          });
        }
      });

      // Record transaction for audit trail
      // Build transaction data, omitting undefined optional fields for Zod validation
      const transactionData: {
        inventoryItemId: string;
        storeId: string;
        transactionType: InventoryTransactionType;
        quantity: number;
        unitCost: number;
        workOrderId: string;
        workOrderNumber: string;
        userId: string;
        userName: string;
        notes?: string;
        equipmentId?: string;
        equipmentTag?: string;
        reservationId?: string;
      } = {
        inventoryItemId,
        storeId: options.storeId,
        transactionType: InventoryTransactionType.WO_PART_ISSUED,
        quantity,
        unitCost,
        workOrderId: options.workOrderId ?? "",
        workOrderNumber: options.workOrderNumber ?? "",
        userId: options.userId,
        userName: options.userName,
      };

      // Only add optional fields if they have values
      if (options.notes) transactionData.notes = options.notes;
      if (options.equipmentId)
        transactionData.equipmentId = options.equipmentId;
      if (options.equipmentTag)
        transactionData.equipmentTag = options.equipmentTag;
      if (options.reservationId)
        transactionData.reservationId = options.reservationId;

      await inventoryTransactionService.recordWorkOrderTransaction(
        options.context,
        transactionData,
      );

      // Get updated stock summary
      const stockSummary = await this.getStock(
        inventoryItemId,
        options.storeId,
      );

      // Check stock levels and send notifications if needed
      await this.checkStockLevelsAndNotify(
        inventoryItemId,
        options.storeId,
        options.context,
      );

      return {
        success: true,
        stockSummary,
        metadata: {
          operation: "ISSUE",
          quantity,
          storeId: options.storeId,
          workOrderId: options.workOrderId,
          unitCost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to issue stock",
        errorCode:
          error instanceof BadRequestError
            ? "INSUFFICIENT_STOCK"
            : "ISSUE_FAILED",
      };
    }
  }

  // ============================================================================
  // RECEIVE OPERATIONS (2 locations analyzed)
  // ============================================================================

  /**
   * Receive inventory stock
   *
   * Increments quantityOnHand for the specified store.
   * May create stock record if it doesn't exist.
   * MUST create transaction record for audit trail.
   *
   * Pattern from: inventory-create-dialog.tsx, inventory-edit-dialog.tsx
   *
   * @param inventoryItemId - Inventory item to receive
   * @param quantity - Quantity to receive
   * @param options - Receive options including REQUIRED storeId and PO context
   * @returns Operation result with updated stock summary
   */
  async receive(
    inventoryItemId: string,
    quantity: number,
    options: ReceiveOptions,
  ): Promise<StockOperationResult> {
    try {
      // Validate inputs
      if (quantity <= 0) {
        throw new BadRequestError("Quantity must be positive");
      }

      if (!options.storeId) {
        throw new BadRequestError(
          "Store ID is required for receive operations",
        );
      }

      // Verify inventory item exists and collect repairable flag
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: {
          unitCost: true,
          sku: true,
          isRepairable: true,
        },
      });

      if (!item) {
        throw new NotFoundError("Inventory Item", inventoryItemId);
      }

      const unitCost = options.unitCost ?? toNumber(item.unitCost) ?? 0;

      // Pre-generate tracking IDs for repairable items BEFORE entering the
      // transaction. generateRepairableTrackingId() issues its own queries with
      // retry/back-off logic and cannot safely run inside a long-lived
      // interactive transaction (risk of transaction timeout / lock contention).
      // Only whole-unit quantities produce serial records; fractional quantities
      // (e.g. 2.5 litres) are truncated — e.g. 2.5 → 2 serials.
      //
      // skipSerialGeneration=true is used by callers that are returning previously-
      // issued parts to inventory (e.g. work-order-part.service.ts beforeDelete).
      // Those units already have RepairableItem records (status=IN_USE); creating
      // new serials would produce duplicates and diverge the count further.
      const serialCount =
        item.isRepairable && !options.skipSerialGeneration
          ? Math.floor(quantity)
          : 0;
      const preGeneratedTrackingIds: string[] = [];
      if (serialCount > 0) {
        for (let i = 0; i < serialCount; i++) {
          const trackingId = await generateRepairableTrackingId(
            this.prisma,
            inventoryItemId,
          );
          preGeneratedTrackingIds.push(trackingId);
        }
      }

      // Perform receive in transaction
      const binLocation = options.bin ?? "MAIN";
      logger.info(
        `[InventoryStock.receive] itemId=${inventoryItemId}, qty=${quantity}, options.bin="${options.bin}", resolved binLocation="${binLocation}", storeId="${options.storeId}", isRepairable=${item.isRepairable}, serialsToCreate=${serialCount}`,
      );
      await this.prisma.$transaction(async (tx) => {
        // Try to get existing stock record
        const existingStock = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId,
              storeId: options.storeId,
              bin: binLocation,
            },
          },
        });

        if (existingStock) {
          // Update existing stock
          await tx.inventoryStock.update({
            where: {
              inventoryItemId_storeId_bin: {
                inventoryItemId,
                storeId: options.storeId,
                bin: binLocation,
              },
            },
            data: {
              quantityOnHand: { increment: quantity },
            },
          });
        } else {
          // Create new stock record with specified bin
          await tx.inventoryStock.create({
            data: {
              inventoryItemId,
              storeId: options.storeId,
              bin: binLocation,
              quantityOnHand: quantity,
              quantityReserved: 0,
            },
          });
        }

        // Auto-generate RepairableItem serial records for repairable items.
        // Each received unit gets its own serial record so that
        // quantityOnHand always stays in sync with the count of AVAILABLE serials.
        //
        // Provenance: embed WO/PO/reference context in notes so operators can
        // trace which receive event created each serial without a schema migration.
        if (preGeneratedTrackingIds.length > 0) {
          const createdBy = options.userId;

          // Build a provenance note string from whatever context is available.
          const provenanceParts: string[] = ["Auto-generated on stock receive"];
          const refType =
            options.referenceType ??
            (options.workOrderId
              ? "WorkOrder"
              : options.purchaseOrderId
                ? "PurchaseOrder"
                : null);
          if (refType) provenanceParts.push(`refType=${refType}`);
          if (options.workOrderId)
            provenanceParts.push(`workOrderId=${options.workOrderId}`);
          if (options.workOrderNumber)
            provenanceParts.push(`woNumber=${options.workOrderNumber}`);
          if (options.purchaseOrderId)
            provenanceParts.push(`purchaseOrderId=${options.purchaseOrderId}`);
          if (options.purchaseOrderNumber)
            provenanceParts.push(`poNumber=${options.purchaseOrderNumber}`);
          const provenanceNote = provenanceParts.join("; ");

          for (const trackingId of preGeneratedTrackingIds) {
            await tx.repairableItem.create({
              data: {
                serialNumber: trackingId,
                inventoryItemId,
                condition: "GOOD",
                status: "AVAILABLE",
                isAutoGenerated: true,
                notes: provenanceNote,
                createdBy,
                lastModifiedBy: createdBy,
              },
            });
          }
        }
      });

      // Record transaction for audit trail
      await inventoryTransactionService.recordWorkOrderTransaction(
        options.context,
        {
          inventoryItemId,
          storeId: options.storeId,
          transactionType: InventoryTransactionType.RECEIVE,
          quantity,
          unitCost,
          // For a PO receipt, store the PO as the transaction reference so the
          // Reference column on the Transactions tab can show the PO# (SUG-000007).
          // referenceId = PO id, referenceNumber = human PO number (falls back to
          // the id only if the number wasn't supplied). When there's no PO (manual
          // receive) this stays the previous WORK_ORDER default with empty refs.
          workOrderId: options.purchaseOrderId ?? "",
          workOrderNumber:
            options.purchaseOrderNumber ?? options.purchaseOrderId ?? "",
          referenceType: options.purchaseOrderId
            ? ReferenceType.PURCHASE_ORDER
            : undefined,
          userId: options.userId,
          userName: options.userName,
          notes: options.notes,
        },
      );

      // Get updated stock summary
      const stockSummary = await this.getStock(
        inventoryItemId,
        options.storeId,
      );

      return {
        success: true,
        stockSummary,
        metadata: {
          operation: "RECEIVE",
          quantity,
          storeId: options.storeId,
          purchaseOrderId: options.purchaseOrderId,
          unitCost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to receive stock",
        errorCode: "RECEIVE_FAILED",
      };
    }
  }

  // ============================================================================
  // TRANSFER OPERATIONS (1 location analyzed)
  // ============================================================================

  /**
   * Transfer inventory between stores
   *
   * Two-step operation:
   * 1. Decrement source store quantityOnHand
   * 2. Increment destination store quantityOnHand
   * MUST create transaction records for audit trail.
   *
   * Pattern from: inventory-edit-dialog.tsx
   *
   * @param options - Transfer options including from/to stores and quantity
   * @returns Operation result with updated stock summary
   */
  async transfer(options: TransferOptions): Promise<StockOperationResult> {
    try {
      // Validate inputs
      if (options.quantity <= 0) {
        throw new BadRequestError("Quantity must be positive");
      }

      if (options.fromStoreId === options.toStoreId) {
        throw new BadRequestError("Cannot transfer to the same store");
      }

      // Validate both stores exist
      const [fromStore, toStore] = await Promise.all([
        this.prisma.store.findUnique({
          where: { id: options.fromStoreId },
          select: { id: true, name: true, isActive: true },
        }),
        this.prisma.store.findUnique({
          where: { id: options.toStoreId },
          select: { id: true, name: true, isActive: true },
        }),
      ]);

      if (!fromStore) {
        throw new BadRequestError(
          `Source store not found (ID: ${options.fromStoreId}). The store may have been deleted.`,
        );
      }

      if (!toStore) {
        throw new BadRequestError(
          `Destination store not found (ID: ${options.toStoreId}). The store may have been deleted.`,
        );
      }

      // Validate source has sufficient stock
      const validation = await this.validateAvailability(
        options.inventoryItemId,
        options.quantity,
        options.fromStoreId,
      );

      if (!validation.valid) {
        throw new BadRequestError(
          validation.message ??
            `Insufficient stock in source store. Available: ${validation.available}, Requested: ${options.quantity}`,
        );
      }

      // Get inventory item for unit cost
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: options.inventoryItemId },
        select: { unitCost: true },
      });

      if (!item) {
        throw new NotFoundError("Inventory Item", options.inventoryItemId);
      }

      const unitCost = toNumber(item.unitCost) ?? 0;

      // Perform transfer in transaction
      await this.prisma.$transaction(async (tx) => {
        // Find the source stock record — prefer "MAIN" bin, fall back to any bin
        // with sufficient available stock. This handles cases where items were
        // imported into non-MAIN bins.
        let sourceStock = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.fromStoreId,
              bin: "MAIN",
            },
          },
        });

        if (!sourceStock) {
          // No MAIN bin — find the bin with the most available stock
          const allSourceBins = await tx.inventoryStock.findMany({
            where: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.fromStoreId,
            },
            orderBy: { quantityOnHand: "desc" },
          });

          sourceStock =
            allSourceBins.find(
              (s) =>
                (toNumber(s.quantityOnHand) ?? 0) -
                  (toNumber(s.quantityReserved) ?? 0) >=
                options.quantity,
            ) ?? null;
        }

        if (!sourceStock) {
          throw new BadRequestError(
            `No stock record found for this item in source store ${options.fromStoreId}. Cannot transfer.`,
          );
        }

        // Decrement source store (by record id to avoid bin ambiguity)
        await tx.inventoryStock.update({
          where: { id: sourceStock.id },
          data: {
            quantityOnHand: { decrement: options.quantity },
          },
        });

        // Increment or create destination store (always use MAIN bin)
        const destStock = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.toStoreId,
              bin: "MAIN",
            },
          },
        });

        if (destStock) {
          await tx.inventoryStock.update({
            where: {
              inventoryItemId_storeId_bin: {
                inventoryItemId: options.inventoryItemId,
                storeId: options.toStoreId,
                bin: "MAIN",
              },
            },
            data: {
              quantityOnHand: { increment: options.quantity },
            },
          });
        } else {
          await tx.inventoryStock.create({
            data: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.toStoreId,
              bin: "MAIN",
              quantityOnHand: options.quantity,
              quantityReserved: 0,
            },
          });
        }
      });

      // Record TRANSFER_OUT transaction
      await inventoryTransactionService.recordWorkOrderTransaction(
        options.context,
        {
          inventoryItemId: options.inventoryItemId,
          storeId: options.fromStoreId,
          transactionType: InventoryTransactionType.TRANSFER_OUT,
          quantity: options.quantity,
          unitCost,
          workOrderId: "",
          workOrderNumber: `Transfer to ${options.toStoreId}`,
          userId: options.userId,
          userName: options.userName,
          notes: options.notes,
        },
      );

      // Record TRANSFER_IN transaction
      await inventoryTransactionService.recordWorkOrderTransaction(
        options.context,
        {
          inventoryItemId: options.inventoryItemId,
          storeId: options.toStoreId,
          transactionType: InventoryTransactionType.TRANSFER_IN,
          quantity: options.quantity,
          unitCost,
          workOrderId: "",
          workOrderNumber: `Transfer from ${options.fromStoreId}`,
          userId: options.userId,
          userName: options.userName,
          notes: options.notes,
        },
      );

      // Get updated stock summary
      const stockSummary = await this.getStock(options.inventoryItemId);

      return {
        success: true,
        stockSummary,
        metadata: {
          operation: "TRANSFER",
          quantity: options.quantity,
          fromStoreId: options.fromStoreId,
          toStoreId: options.toStoreId,
          unitCost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to transfer stock",
        errorCode:
          error instanceof BadRequestError
            ? "INSUFFICIENT_STOCK"
            : "TRANSFER_FAILED",
      };
    }
  }

  // ============================================================================
  // ADJUST OPERATIONS (3 locations analyzed)
  // ============================================================================

  /**
   * Adjust inventory stock
   *
   * Sets absolute value (not increment/decrement).
   * Used for cycle counts, corrections, damage, loss, found items.
   * MUST create transaction record for audit trail.
   *
   * Pattern from: inventory-edit-dialog.tsx, inventory.service.ts
   *
   * @param inventoryItemId - Inventory item to adjust
   * @param storeId - Store to adjust
   * @param newQuantity - New absolute quantity
   * @param options - Adjust options including REQUIRED reason
   * @returns Operation result with updated stock summary
   */
  async adjust(
    inventoryItemId: string,
    storeId: string,
    newQuantity: number,
    options: AdjustOptions,
  ): Promise<StockOperationResult> {
    try {
      // Validate inputs
      if (newQuantity < 0) {
        throw new BadRequestError("Quantity cannot be negative");
      }

      // Resolve bin: use provided bin or default to "MAIN"
      const bin = options.bin ?? "MAIN";

      // Get current stock
      const stock = await this.prisma.inventoryStock.findUnique({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId,
            storeId,
            bin,
          },
        },
      });

      if (!stock) {
        throw new NotFoundError(
          "Inventory Stock",
          `${inventoryItemId}:${storeId}`,
        );
      }

      const oldQuantity = toNumber(stock.quantityOnHand) ?? 0;
      const adjustmentAmount = newQuantity - oldQuantity;

      // Get inventory item for unit cost
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: { unitCost: true },
      });

      if (!item) {
        throw new NotFoundError("Inventory Item", inventoryItemId);
      }

      const unitCost = toNumber(item.unitCost) ?? 0;

      // Perform adjustment in transaction
      await this.prisma.$transaction(async (tx) => {
        // Set absolute quantity
        await tx.inventoryStock.update({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId,
              storeId,
              bin,
            },
          },
          data: {
            quantityOnHand: newQuantity,
          },
        });

        // Get inventory item for SKU
        const inventoryItem = await tx.inventoryItem.findUnique({
          where: { id: inventoryItemId },
          select: { sku: true },
        });

        // Create GL transaction for adjustment (only if not from cycle count)
        // Cycle counts handle their own GL transactions
        if (options.reason !== "CYCLE_COUNT") {
          try {
            await inventoryGLService.createAdjustmentTransaction(
              options.context,
              {
                inventoryItemId,
                inventoryItemSku: inventoryItem?.sku ?? "UNKNOWN",
                oldQuantity,
                newQuantity,
                unitCost,
                referenceType: "MANUAL_ADJUSTMENT",
                referenceId: inventoryItemId,
                referenceNumber: options.reason,
                description: `Manual adjustment: ${options.reason}`,
                reason: options.notes ?? options.reason,
                accountCodeId: undefined,
                departmentId: undefined,
                areaId: undefined,
              },
            );
          } catch (glError) {
            // GL failure is non-blocking for stock adjustments, but must be visible
            logger.error(
              `[STOCK-ADJUST-GL] GL entry failed for item ${inventoryItemId}: ` +
                `${glError instanceof Error ? glError.message : String(glError)}`,
            );
          }
        }
      });

      // Record transaction for audit trail (only if there was an actual change)
      const reasonNote = `${options.reason}${options.notes ? `: ${options.notes}` : ""}`;
      await inventoryTransactionService.recordWorkOrderTransaction(
        options.context,
        {
          inventoryItemId,
          storeId,
          transactionType: InventoryTransactionType.ADJUST,
          quantity: Math.abs(adjustmentAmount), // Always positive in transaction
          unitCost,
          workOrderId: "",
          workOrderNumber: `Adjustment: ${options.reason}`,
          userId: options.userId,
          userName: options.userName,
          notes: `${reasonNote}\nOld: ${oldQuantity}, New: ${newQuantity}, Change: ${adjustmentAmount > 0 ? "+" : ""}${adjustmentAmount}`,
        },
      );

      // Get updated stock summary
      const stockSummary = await this.getStock(inventoryItemId, storeId);

      return {
        success: true,
        stockSummary,
        metadata: {
          operation: "ADJUST",
          oldQuantity,
          newQuantity,
          adjustmentAmount,
          reason: options.reason,
          storeId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to adjust stock",
        errorCode: "ADJUST_FAILED",
      };
    }
  }

  // ============================================================================
  // BIN TRANSFER OPERATIONS (Multi-bin support)
  // ============================================================================

  /**
   * Transfer inventory between bins within the same store
   *
   * This operation:
   * 1. Validates source bin has sufficient stock
   * 2. Decrements source bin quantityOnHand
   * 3. Increments or creates destination bin quantityOnHand
   * 4. Creates audit trail transactions
   *
   * @param options - Bin transfer options
   * @returns Operation result with updated bin stocks
   */
  async transferBin(options: BinTransferOptions): Promise<BinTransferResult> {
    try {
      // Validate inputs
      if (options.quantity <= 0) {
        throw new BadRequestError("Quantity must be positive");
      }

      if (options.fromBin === options.toBin) {
        throw new BadRequestError(
          "Source and destination bins must be different",
        );
      }

      // Get inventory item for unit cost
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: options.inventoryItemId },
        select: { unitCost: true, sku: true },
      });

      if (!item) {
        throw new NotFoundError("Inventory Item", options.inventoryItemId);
      }

      const unitCost = toNumber(item.unitCost) ?? 0;

      // Validate source bin has sufficient stock
      const sourceBinStock = await this.prisma.inventoryStock.findUnique({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId: options.inventoryItemId,
            storeId: options.storeId,
            bin: options.fromBin,
          },
        },
      });

      if (!sourceBinStock) {
        throw new NotFoundError(
          "Source Bin Stock",
          `${options.inventoryItemId}:${options.storeId}:${options.fromBin}`,
        );
      }

      const sourceOnHand = toNumber(sourceBinStock.quantityOnHand) ?? 0;
      const sourceReserved = toNumber(sourceBinStock.quantityReserved) ?? 0;
      const sourceAvailable = sourceOnHand - sourceReserved;

      if (sourceAvailable < options.quantity) {
        throw new BadRequestError(
          `Insufficient stock in source bin. Available: ${sourceAvailable}, Requested: ${options.quantity}`,
        );
      }

      // Perform bin transfer in transaction
      await this.prisma.$transaction(async (tx) => {
        // Decrement source bin
        await tx.inventoryStock.update({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.storeId,
              bin: options.fromBin,
            },
          },
          data: {
            quantityOnHand: { decrement: options.quantity },
          },
        });

        // Check if destination bin exists
        const destBinStock = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.storeId,
              bin: options.toBin,
            },
          },
        });

        if (destBinStock) {
          // Update existing destination bin
          await tx.inventoryStock.update({
            where: {
              inventoryItemId_storeId_bin: {
                inventoryItemId: options.inventoryItemId,
                storeId: options.storeId,
                bin: options.toBin,
              },
            },
            data: {
              quantityOnHand: { increment: options.quantity },
            },
          });
        } else {
          // Create new destination bin
          await tx.inventoryStock.create({
            data: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.storeId,
              bin: options.toBin,
              quantityOnHand: options.quantity,
              quantityReserved: 0,
            },
          });
        }
      });

      // Record BIN_TRANSFER_OUT transaction
      await inventoryTransactionService.recordWorkOrderTransaction(
        options.context,
        {
          inventoryItemId: options.inventoryItemId,
          storeId: options.storeId,
          transactionType: InventoryTransactionType.TRANSFER_OUT,
          quantity: options.quantity,
          unitCost,
          workOrderId: "",
          workOrderNumber: `Bin Transfer: ${options.fromBin} → ${options.toBin}`,
          userId: options.userId,
          userName: options.userName,
          notes: `${options.notes ?? "Bin transfer"}\nFrom: ${options.fromBin}\nTo: ${options.toBin}`,
        },
      );

      // Record BIN_TRANSFER_IN transaction
      await inventoryTransactionService.recordWorkOrderTransaction(
        options.context,
        {
          inventoryItemId: options.inventoryItemId,
          storeId: options.storeId,
          transactionType: InventoryTransactionType.TRANSFER_IN,
          quantity: options.quantity,
          unitCost,
          workOrderId: "",
          workOrderNumber: `Bin Transfer: ${options.fromBin} → ${options.toBin}`,
          userId: options.userId,
          userName: options.userName,
          notes: `${options.notes ?? "Bin transfer"}\nFrom: ${options.fromBin}\nTo: ${options.toBin}`,
        },
      );

      // Get updated bin stocks
      const [updatedSourceBin, updatedDestBin] = await Promise.all([
        this.prisma.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.storeId,
              bin: options.fromBin,
            },
          },
        }),
        this.prisma.inventoryStock.findUnique({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: options.inventoryItemId,
              storeId: options.storeId,
              bin: options.toBin,
            },
          },
        }),
      ]);

      return {
        success: true,
        sourceBinStock: updatedSourceBin
          ? {
              bin: updatedSourceBin.bin,
              quantityOnHand: toNumber(updatedSourceBin.quantityOnHand) ?? 0,
              quantityReserved:
                toNumber(updatedSourceBin.quantityReserved) ?? 0,
              available:
                (toNumber(updatedSourceBin.quantityOnHand) ?? 0) -
                (toNumber(updatedSourceBin.quantityReserved) ?? 0),
            }
          : undefined,
        destinationBinStock: updatedDestBin
          ? {
              bin: updatedDestBin.bin,
              quantityOnHand: toNumber(updatedDestBin.quantityOnHand) ?? 0,
              quantityReserved: toNumber(updatedDestBin.quantityReserved) ?? 0,
              available:
                (toNumber(updatedDestBin.quantityOnHand) ?? 0) -
                (toNumber(updatedDestBin.quantityReserved) ?? 0),
            }
          : undefined,
        metadata: {
          operation: "BIN_TRANSFER",
          quantity: options.quantity,
          fromBin: options.fromBin,
          toBin: options.toBin,
          storeId: options.storeId,
          unitCost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to transfer between bins",
        errorCode:
          error instanceof BadRequestError
            ? "INSUFFICIENT_STOCK"
            : "BIN_TRANSFER_FAILED",
      };
    }
  }

  /**
   * Get multi-bin stock summary for an inventory item at a specific store
   *
   * Returns breakdown of stock by bin location within the store.
   *
   * @param inventoryItemId - Inventory item to query
   * @param storeId - Store to query
   * @returns Multi-bin stock summary
   */
  async getMultiBinStock(
    inventoryItemId: string,
    storeId: string,
  ): Promise<MultiBinStockSummary> {
    const stocks = await this.prisma.inventoryStock.findMany({
      where: {
        inventoryItemId,
        storeId,
      },
      include: {
        store: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        bin: "asc",
      },
    });

    const totalOnHand = stocks.reduce(
      (sum, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
      0,
    );
    const totalReserved = stocks.reduce(
      (sum, s) => sum + (toNumber(s.quantityReserved) ?? 0),
      0,
    );
    const totalAvailable = totalOnHand - totalReserved;

    const bins = stocks.map((s) => ({
      stockId: s.id,
      bin: s.bin,
      quantityOnHand: toNumber(s.quantityOnHand) ?? 0,
      quantityReserved: toNumber(s.quantityReserved) ?? 0,
      available:
        (toNumber(s.quantityOnHand) ?? 0) - (toNumber(s.quantityReserved) ?? 0),
      storeId: s.storeId,
      storeName: s.store.name,
    }));

    return {
      inventoryItemId,
      storeId,
      storeName: stocks[0]?.store.name ?? "",
      totalOnHand,
      totalReserved,
      totalAvailable,
      bins,
    };
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate if sufficient stock is available
   *
   * Checks available quantity (onHand - reserved) against requested quantity.
   * If storeId provided: Checks only that store
   * If storeId NOT provided: Checks total across all stores
   *
   * @param inventoryItemId - Inventory item to check
   * @param requestedQuantity - Quantity needed
   * @param storeId - Optional store to check (if not provided, checks all stores)
   * @returns Validation result with availability details
   */
  async validateAvailability(
    inventoryItemId: string,
    requestedQuantity: number,
    storeId?: string,
  ): Promise<StockValidationResult> {
    // Use transaction to ensure fresh data
    return await this.prisma.$transaction(async (tx) => {
      const whereClause: Prisma.InventoryStockWhereInput = storeId
        ? { inventoryItemId, storeId }
        : { inventoryItemId };

      const stocks = await tx.inventoryStock.findMany({
        where: whereClause,
        include: {
          store: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const totalOnHand = stocks.reduce(
        (sum, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
        0,
      );
      const totalReserved = stocks.reduce(
        (sum, s) => sum + (toNumber(s.quantityReserved) ?? 0),
        0,
      );
      const totalCommitted = stocks.reduce(
        (sum, s) => sum + (toNumber(s.quantityCommitted) ?? 0),
        0,
      );
      const totalAvailable = totalOnHand - totalReserved - totalCommitted;

      const valid = totalAvailable >= requestedQuantity;
      const shortfall = valid ? 0 : requestedQuantity - totalAvailable;

      const storeBreakdown = stocks.map((s) => ({
        storeId: s.storeId,
        storeName: s.store.name,
        onHand: toNumber(s.quantityOnHand) ?? 0,
        reserved: toNumber(s.quantityReserved) ?? 0,
        available:
          (toNumber(s.quantityOnHand) ?? 0) -
          (toNumber(s.quantityReserved) ?? 0),
      }));

      return {
        valid,
        available: totalAvailable,
        onHand: totalOnHand,
        reserved: totalReserved,
        shortfall: valid ? undefined : shortfall,
        message: valid
          ? `${totalAvailable} units available`
          : `Insufficient stock. Available: ${totalAvailable}, Requested: ${requestedQuantity}, Shortfall: ${shortfall}`,
        stores: storeBreakdown,
      };
    });
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get stock summary for an inventory item
   *
   * Returns current stock levels across all stores or a specific store.
   *
   * @param inventoryItemId - Inventory item to query
   * @param storeId - Optional store filter
   * @returns Stock summary with store breakdown
   */
  async getStock(
    inventoryItemId: string,
    storeId?: string,
  ): Promise<StockSummary> {
    const whereClause: Prisma.InventoryStockWhereInput = storeId
      ? { inventoryItemId, storeId }
      : { inventoryItemId };

    const stocks = await this.prisma.inventoryStock.findMany({
      where: whereClause,
      include: {
        store: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const totalOnHand = stocks.reduce(
      (sum, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
      0,
    );
    const totalReserved = stocks.reduce(
      (sum, s) => sum + (toNumber(s.quantityReserved) ?? 0),
      0,
    );
    const totalCommitted = stocks.reduce(
      (sum, s) => sum + (toNumber(s.quantityCommitted) ?? 0),
      0,
    );
    const totalAvailable = totalOnHand - totalReserved - totalCommitted;

    const storeBreakdown = stocks.map((s) => ({
      storeId: s.storeId,
      storeName: s.store.name,
      onHand: toNumber(s.quantityOnHand) ?? 0,
      reserved: toNumber(s.quantityReserved) ?? 0,
      committed: toNumber(s.quantityCommitted) ?? 0,
      available:
        (toNumber(s.quantityOnHand) ?? 0) -
        (toNumber(s.quantityReserved) ?? 0) -
        (toNumber(s.quantityCommitted) ?? 0),
      bin: s.bin,
    }));

    return {
      inventoryItemId,
      totalOnHand,
      totalReserved,
      totalCommitted,
      totalAvailable,
      stores: storeBreakdown,
    };
  }

  /**
   * Get total on-hand quantity across all stores
   *
   * @param inventoryItemId - Inventory item to query
   * @returns Total on-hand quantity
   */
  async getTotalOnHand(inventoryItemId: string): Promise<number> {
    const stocks = await this.prisma.inventoryStock.findMany({
      where: { inventoryItemId },
      select: { quantityOnHand: true },
    });

    return stocks.reduce(
      (sum, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
      0,
    );
  }

  /**
   * Get total reserved quantity across all stores
   *
   * @param inventoryItemId - Inventory item to query
   * @returns Total reserved quantity
   */
  async getTotalReserved(inventoryItemId: string): Promise<number> {
    const stocks = await this.prisma.inventoryStock.findMany({
      where: { inventoryItemId },
      select: { quantityReserved: true },
    });

    return stocks.reduce(
      (sum, s) => sum + (toNumber(s.quantityReserved) ?? 0),
      0,
    );
  }

  /**
   * Get total available quantity across all stores
   *
   * @param inventoryItemId - Inventory item to query
   * @returns Total available quantity (onHand - reserved)
   */
  async getTotalAvailable(inventoryItemId: string): Promise<number> {
    const stocks = await this.prisma.inventoryStock.findMany({
      where: { inventoryItemId },
      select: {
        quantityOnHand: true,
        quantityReserved: true,
        quantityCommitted: true,
      },
    });

    return stocks.reduce(
      (sum, s) =>
        sum +
        ((toNumber(s.quantityOnHand) ?? 0) -
          (toNumber(s.quantityReserved) ?? 0) -
          (toNumber(s.quantityCommitted) ?? 0)),
      0,
    );
  }

  // ============================================================================
  // COMMITTED QUANTITY OPERATIONS (for REQ/PO on-order tracking)
  // ============================================================================

  /**
   * Increment quantityCommitted for an inventory item
   *
   * Called when an auto-REQ is created for a WO shortfall.
   * Marks units as "on order / committed" to a WO via active REQ/PO.
   *
   * @param inventoryItemId - Inventory item to update
   * @param quantity - Quantity to commit
   * @param tx - Optional Prisma transaction client
   */
  async incrementCommitted(
    inventoryItemId: string,
    quantity: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    logger.info("[InventoryStock] incrementCommitted", {
      inventoryItemId,
      quantity,
    });

    await client.inventoryStock.updateMany({
      where: { inventoryItemId },
      data: {
        quantityCommitted: { increment: quantity },
      },
    });
  }

  /**
   * Decrement quantityCommitted for an inventory item
   *
   * Called when a PO line with a WO-linked REQ is received (goods arrive),
   * or when a REQ is cancelled.
   * Decrements committed quantity, guarded so it never goes below 0.
   *
   * @param inventoryItemId - Inventory item to update
   * @param quantity - Quantity to un-commit
   * @param tx - Optional Prisma transaction client
   */
  async decrementCommitted(
    inventoryItemId: string,
    quantity: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    logger.info("[InventoryStock] decrementCommitted", {
      inventoryItemId,
      quantity,
    });

    // Decrement, then clamp to 0 to prevent negative values
    await client.inventoryStock.updateMany({
      where: { inventoryItemId },
      data: {
        quantityCommitted: { decrement: quantity },
      },
    });

    // Clamp: ensure quantityCommitted never goes below 0
    await client.inventoryStock.updateMany({
      where: {
        inventoryItemId,
        quantityCommitted: { lt: 0 },
      },
      data: {
        quantityCommitted: 0,
      },
    });
  }

  /**
   * Check stock levels and send notifications if below thresholds
   *
   * @param inventoryItemId - Inventory item to check
   * @param storeId - Store to check
   * @param context - Service context for notifications
   */
  private async checkStockLevelsAndNotify(
    inventoryItemId: string,
    storeId: string,
    context: ServiceContext,
  ): Promise<void> {
    try {
      // Get inventory item with min/max quantities
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: {
          id: true,
          sku: true,
          description: true,
          minQuantity: true,
          maxQuantity: true,
          unit: true,
        },
      });

      if (!item?.minQuantity) {
        return; // No min quantity set, skip notification
      }

      const minQty = toNumber(item.minQuantity) ?? 0;
      if (minQty === 0) {
        return; // Min quantity is 0, skip notification
      }

      // Get current stock level
      const stock = await this.prisma.inventoryStock.findUnique({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId,
            storeId,
            bin: "MAIN",
          },
        },
        include: {
          store: {
            select: { name: true },
          },
        },
      });

      if (!stock) {
        return;
      }

      const onHand = toNumber(stock.quantityOnHand) ?? 0;
      const reserved = toNumber(stock.quantityReserved) ?? 0;
      const available = onHand - reserved;

      // Calculate percentage of minimum
      const percentOfMin = (available / minQty) * 100;

      // Determine notification type and priority
      let shouldNotify = false;
      let notificationType: "stock_low" | "stock_critical" | null = null;
      let priority = NotificationPriority.NORMAL;

      if (percentOfMin <= 25) {
        // Critical: 25% or less of minimum
        shouldNotify = true;
        notificationType = "stock_critical";
        priority = NotificationPriority.URGENT;
      } else if (available <= minQty) {
        // Low: At or below minimum
        shouldNotify = true;
        notificationType = "stock_low";
        priority = NotificationPriority.HIGH;
      }

      if (!shouldNotify || !notificationType) {
        return;
      }

      // Find inventory managers to notify
      const managers = await this.prisma.user.findMany({
        where: {
          isActive: true,
          role: {
            permissions: {
              some: {
                permission: {
                  resource: "INVENTORY",
                  action: "update",
                },
              },
            },
          },
        },
        select: { id: true },
      });

      // Send notification to each manager
      for (const manager of managers) {
        await notificationService.sendNotification(context, {
          userId: manager.id,
          type: INVENTORY_NOTIFICATIONS.STOCK_LOW.type,
          category: NotificationCategory.INVENTORY,
          title:
            notificationType === "stock_critical"
              ? `Critical Stock Level: ${item.sku}`
              : `Low Stock Level: ${item.sku}`,
          message:
            notificationType === "stock_critical"
              ? `Stock for ${item.sku} is critically low (${percentOfMin.toFixed(1)}% of minimum)`
              : `Stock for ${item.sku} has fallen below minimum quantity`,
          priority,
          actionUrl: `/inventory/${inventoryItemId}`,
          actionLabel: "View Item",
          data: {
            inventoryItemId,
            sku: item.sku,
            description: item.description,
            storeId,
            storeName: stock.store.name,
            currentQuantity: available,
            minQuantity: minQty,
            maxQuantity: toNumber(item.maxQuantity) ?? 0,
            percentOfMinimum: percentOfMin,
            unit: item.unit,
          },
        });
      }
    } catch (_error) {
      // Notification failure is non-critical, continue execution
    }
  }
}

// Export singleton instance
// In development, always create a fresh instance so HMR picks up code changes.
// In production, cache via globalThis to avoid creating multiple instances.
const globalForInventoryStock = globalThis as unknown as {
  inventoryStockService: InventoryStockService | undefined;
};
if (process.env.NODE_ENV !== "production") {
  globalForInventoryStock.inventoryStockService = new InventoryStockService(
    prisma,
  );
} else {
  globalForInventoryStock.inventoryStockService =
    globalForInventoryStock.inventoryStockService ??
    new InventoryStockService(prisma);
}
export const inventoryStockService =
  globalForInventoryStock.inventoryStockService;
