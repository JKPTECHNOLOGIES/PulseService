/**
 * Inventory Transaction Service
 *
 * Service layer for inventory transaction tracking.
 * Records all inventory movements for complete audit trail.
 */

import { PrismaClient } from "@prisma/client";
import { CrudService } from "@/services/base/crud.service";
import {
  ServiceContext,
  ValidationResult,
  ServiceConfig,
} from "@/services/base/types";
import {
  InventoryTransactionCreateDTO,
  InventoryTransactionWithRelations,
  InventoryTransactionFilterDTO,
  TransactionSummary,
  InventoryMovementReport,
  InventoryTransactionType,
  ReferenceType,
  inventoryTransactionCreateSchema,
  isReceiptTransaction,
  isIssueTransaction,
} from "@/services/inventory/transaction.types";
import { prisma } from "@/lib/prisma";
import { PermissionResource } from "@/types/permissions";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";

/**
 * Inventory Transaction Service Class
 *
 * Provides CRUD operations and business logic for inventory transactions.
 * Transactions are immutable once created for audit trail integrity.
 */
class InventoryTransactionService extends CrudService<
  InventoryTransactionWithRelations,
  InventoryTransactionCreateDTO,
  never
> {
  constructor(prismaClient: PrismaClient) {
    const config: ServiceConfig = {
      resourceName: "InventoryTransaction",
      permissions: {
        read: `${PermissionResource.INVENTORY}:read`,
        create: `${PermissionResource.INVENTORY}:create`,
        update: `${PermissionResource.INVENTORY}:update`,
        delete: `${PermissionResource.INVENTORY}:delete`,
      },
      softDelete: false,
      trackAudit: true, // Full audit trail with createdBy, updatedBy, isActive
      defaultLimit: 50,
      maxLimit: 500,
    };

    super(
      prismaClient,
      prismaClient.inventoryTransaction as unknown as never,
      config,
    );
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate transaction creation data
   */
  protected override async validateCreate(
    data: InventoryTransactionCreateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation = inventoryTransactionCreateSchema.safeParse(data);
    if (!schemaValidation.success) {
      schemaValidation.error.issues.forEach((err) => {
        errors.push({
          field: err.path.join("."),
          message: err.message,
          code: err.code,
        });
      });
      return { valid: false, errors };
    }

    // Validate inventory item exists
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
    });

    if (!item) {
      errors.push({
        field: "inventoryItemId",
        message: "Inventory item not found",
        code: "ITEM_NOT_FOUND",
      });
    }

    // Validate store exists
    const store = await this.prisma.store.findUnique({
      where: { id: data.storeId },
    });

    if (!store) {
      errors.push({
        field: "storeId",
        message: "Store not found",
        code: "STORE_NOT_FOUND",
      });
    }

    // Validate sufficient stock for issue transactions
    // SKIP validation for transactions where stock is already updated by calling service:
    // - DIRECT_ISSUE and DIRECT_ISSUE_RETURN: Stock updated by work order service
    // - ADJUST: Stock updated by InventoryStockService.adjust() before transaction creation
    // - WO_PART_ISSUED from reservation: Stock already allocated during reservation
    // - ISSUE: Generic issue transaction where stock is managed by calling service (e.g., external repairs)
    // - TRANSFER_OUT: Stock already decremented by InventoryStockService.transfer() (may be from non-MAIN bin)
    const transactionType = data.transactionType as InventoryTransactionType;
    const isIssuingFromReservation =
      transactionType === InventoryTransactionType.WO_PART_ISSUED &&
      (data as { reservationId?: string }).reservationId !== undefined;

    const skipStockCheck =
      transactionType === InventoryTransactionType.DIRECT_ISSUE ||
      transactionType === InventoryTransactionType.DIRECT_ISSUE_RETURN ||
      transactionType === InventoryTransactionType.ADJUST ||
      transactionType === InventoryTransactionType.ISSUE ||
      transactionType === InventoryTransactionType.TRANSFER_OUT ||
      isIssuingFromReservation;

    if (isIssueTransaction(transactionType) && !skipStockCheck) {
      const stock = await this.prisma.inventoryStock.findUnique({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId: data.inventoryItemId,
            storeId: data.storeId,
            bin: "MAIN",
          },
        },
      });

      if (!stock || Number(stock.quantityOnHand) < data.quantity) {
        errors.push({
          field: "quantity",
          message: "Insufficient stock for this transaction",
          code: "INSUFFICIENT_STOCK",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Prevent transaction updates - transactions are immutable
   */
  protected override validateUpdate(
    _id: string,
    _data: never,
  ): Promise<ValidationResult> {
    throw new BadRequestError(
      "Inventory transactions cannot be updated for audit trail integrity",
    );
  }

  /**
   * Prevent transaction deletion - transactions are immutable
   */
  protected override beforeDelete(
    _id: string,
    _context: ServiceContext,
  ): Promise<void> {
    throw new BadRequestError(
      "Inventory transactions cannot be deleted for audit trail integrity",
    );
  }

  // ============================================================================
  // DATA TRANSFORMATION
  // ============================================================================

  /**
   * Transform create DTO to Prisma data
   */
  protected override transformCreateDTO(
    data: InventoryTransactionCreateDTO,
    context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    return Promise.resolve({
      inventoryItemId: data.inventoryItemId,
      storeId: data.storeId,
      transactionType: data.transactionType,
      quantity: data.quantity,
      unitCost: data.unitCost ?? null,
      referenceType: data.referenceType ?? null,
      referenceId: data.referenceId ?? null,
      referenceNumber: data.referenceNumber ?? null,
      directIssueId: data.directIssueId ?? null,
      directIssueNumber: data.directIssueNumber ?? null,
      notes: data.notes ?? null,
      performedBy: data.performedBy ?? context.userId,
      performedByName: data.performedByName ?? context.userName,
      quantityBefore: data.quantityBefore ?? null,
      quantityAfter: data.quantityAfter ?? null,
      equipmentId: data.equipmentId ?? null,
      equipmentTag: data.equipmentTag ?? null,
      transactionDate: data.transactionDate ?? new Date(),
    });
  }

  /**
   * Transform update DTO to Prisma data (not allowed)
   */
  protected override transformUpdateDTO(
    _data: never,
    _context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    throw new BadRequestError("Inventory transactions cannot be updated");
  }

  /**
   * Transform model to include relations
   */
  protected override async transformModel(
    model: Record<string, unknown>,
  ): Promise<InventoryTransactionWithRelations> {
    // If relations are already included, convert Decimals and return
    if ("inventoryItem" in model) {
      return {
        ...model,
        quantity: Number(model.quantity),
        unitCost: model.unitCost ? Number(model.unitCost) : null,
      } as unknown as InventoryTransactionWithRelations;
    }

    // Otherwise, fetch with relations
    const transaction = await this.prisma.inventoryTransaction.findUnique({
      where: { id: model.id as string },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundError("InventoryTransaction", model.id as string);
    }

    return {
      ...transaction,
      quantity: Number(transaction.quantity),
      unitCost: transaction.unitCost ? Number(transaction.unitCost) : null,
    } as unknown as InventoryTransactionWithRelations;
  }

  /**
   * Hook called after creating a transaction
   *
   * NOTE: Stock updates are now handled by InventoryStockService BEFORE
   * transaction records are created. This hook is intentionally empty
   * to prevent duplicate stock updates and race conditions.
   *
   * The proper flow is:
   * 1. InventoryStockService updates stock
   * 2. InventoryStockService creates transaction record via this service
   * 3. This hook does nothing (stock already updated)
   */
  protected override async afterCreate(
    _model: InventoryTransactionWithRelations,
    _context: ServiceContext,
  ): Promise<void> {
    // Intentionally empty - stock updates handled by InventoryStockService
    // before transaction creation to prevent race conditions
  }

  // ============================================================================
  // CUSTOM METHODS
  // ============================================================================

  /**
   * Record a transaction and update stock
   *
   * @param context - Service context
   * @param data - Transaction data
   * @returns Created transaction
   */
  recordTransaction(
    context: ServiceContext,
    data: InventoryTransactionCreateDTO,
  ): Promise<InventoryTransactionWithRelations> {
    // Skip permission check: callers have already verified permissions for their operation
    return this.create(context, data, { skipPermissionCheck: true });
  }

  /**
   * Record a work order transaction with full context
   * Captures WHO, WHAT, WHERE, WHEN for complete audit trail
   *
   * @param context - Service context
   * @param data - Transaction data with work order context
   * @returns Created transaction
   */
  async recordWorkOrderTransaction(
    context: ServiceContext,
    data: {
      inventoryItemId: string;
      storeId: string;
      transactionType: InventoryTransactionType;
      quantity: number;
      unitCost?: number;
      workOrderId: string;
      workOrderNumber: string;
      equipmentId?: string;
      equipmentTag?: string;
      userId: string;
      userName: string;
      notes?: string;
      reservationId?: string;
      directIssueId?: string;
      directIssueNumber?: string;
      /**
       * Reference type for the stored transaction. Defaults to WORK_ORDER to
       * preserve existing behaviour for reserve/issue/transfer/adjust callers.
       * PO receives pass PURCHASE_ORDER so the Reference column can resolve and
       * show the PO# (SUG-000007).
       */
      referenceType?: ReferenceType;
    },
  ): Promise<InventoryTransactionWithRelations> {
    // Get current stock level for before/after tracking
    const stock = await this.prisma.inventoryStock.findUnique({
      where: {
        inventoryItemId_storeId_bin: {
          inventoryItemId: data.inventoryItemId,
          storeId: data.storeId,
          bin: "MAIN",
        },
      },
    });

    const quantityBefore = stock ? Number(stock.quantityOnHand) : 0;
    const quantityAfter = isIssueTransaction(data.transactionType)
      ? quantityBefore - data.quantity
      : quantityBefore + data.quantity;

    // Create transaction with full context
    // Include reservationId so validation can skip stock check for reserved parts
    const transactionData: InventoryTransactionCreateDTO & {
      reservationId?: string;
    } = {
      inventoryItemId: data.inventoryItemId,
      storeId: data.storeId,
      transactionType: data.transactionType,
      quantity: data.quantity,
      unitCost: data.unitCost,
      referenceType: data.referenceType ?? ReferenceType.WORK_ORDER,
      referenceId: data.workOrderId,
      referenceNumber: data.workOrderNumber,
      directIssueId: data.directIssueId,
      directIssueNumber: data.directIssueNumber,
      notes: data.notes,
      performedBy: data.userId,
      performedByName: data.userName,
      quantityBefore,
      quantityAfter,
      equipmentId: data.equipmentId,
      equipmentTag: data.equipmentTag,
      transactionDate: new Date(),
    };

    // Add reservationId if provided (for validation skip logic)
    if (data.reservationId) {
      transactionData.reservationId = data.reservationId;
    }

    // Skip permission check: this method is always called internally from other services
    // (e.g., inventoryStockService.reserve/unreserve/issue) that have already verified
    // the caller's permissions (e.g., inventory:reserve). Requiring inventory:create here
    // would incorrectly block planners and technicians from recording audit trail entries
    // when they perform legitimate stock operations they are already authorized to do.
    return this.create(context, transactionData, { skipPermissionCheck: true });
  }

  /**
   * Get transactions by inventory item
   *
   * @param context - Service context
   * @param inventoryItemId - Inventory item ID
   * @param filters - Optional filters
   * @returns Array of transactions
   */
  async getByInventoryItem(
    context: ServiceContext,
    inventoryItemId: string,
    filters?: InventoryTransactionFilterDTO,
  ): Promise<InventoryTransactionWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    const where: Record<string, unknown> = {
      inventoryItemId,
    };

    if (filters?.transactionType) {
      where.transactionType = filters.transactionType;
    }

    if (filters?.storeId) {
      where.storeId = filters.storeId;
    }

    if (filters?.referenceType) {
      where.referenceType = filters.referenceType;
    }

    if (filters?.referenceId) {
      where.referenceId = filters.referenceId;
    }

    if (filters?.dateFrom || filters?.dateTo) {
      const transactionDate: Record<string, unknown> = {};
      if (filters.dateFrom) transactionDate.gte = filters.dateFrom;
      if (filters.dateTo) transactionDate.lte = filters.dateTo;
      where.transactionDate = transactionDate;
    }

    const transactions = await this.prisma.inventoryTransaction.findMany({
      where,
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
          },
        },
      },
      orderBy: { transactionDate: "desc" },
    });

    return transactions as unknown as InventoryTransactionWithRelations[];
  }

  /**
   * Get transactions by reference
   *
   * @param context - Service context
   * @param referenceType - Reference type
   * @param referenceId - Reference ID
   * @returns Array of transactions
   */
  async getByReference(
    context: ServiceContext,
    referenceType: ReferenceType,
    referenceId: string,
  ): Promise<InventoryTransactionWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: {
        referenceType,
        referenceId,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
          },
        },
      },
      orderBy: { transactionDate: "desc" },
    });

    return transactions as unknown as InventoryTransactionWithRelations[];
  }

  /**
   * Get transaction summary by type
   *
   * @param context - Service context
   * @param inventoryItemId - Optional inventory item ID
   * @param storeId - Optional store ID
   * @param dateFrom - Optional start date
   * @param dateTo - Optional end date
   * @returns Transaction summary
   */
  async getTransactionSummary(
    context: ServiceContext,
    inventoryItemId?: string,
    storeId?: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<TransactionSummary[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    const where: Record<string, unknown> = {};
    if (inventoryItemId) where.inventoryItemId = inventoryItemId;
    if (storeId) where.storeId = storeId;

    if (dateFrom || dateTo) {
      const transactionDate: Record<string, unknown> = {};
      if (dateFrom) transactionDate.gte = dateFrom;
      if (dateTo) transactionDate.lte = dateTo;
      where.transactionDate = transactionDate;
    }

    const transactions = await this.prisma.inventoryTransaction.findMany({
      where,
      select: {
        transactionType: true,
        quantity: true,
        unitCost: true,
      },
    });

    // Group by transaction type
    const summary: Record<string, TransactionSummary> = {};

    transactions.forEach((t: Record<string, unknown>) => {
      const transactionType = t.transactionType as string;
      summary[transactionType] ??= {
        transactionType,
        count: 0,
        totalQuantity: 0,
        totalValue: 0,
      };

      summary[transactionType].count++;
      summary[transactionType].totalQuantity += Number(t.quantity);
      summary[transactionType].totalValue +=
        Number(t.quantity) * (Number(t.unitCost) || 0);
    });

    return Object.values(summary);
  }

  /**
   * Get inventory movement report
   *
   * @param context - Service context
   * @param inventoryItemId - Inventory item ID
   * @param storeId - Store ID
   * @param dateFrom - Start date
   * @param dateTo - End date
   * @returns Movement report
   */
  async getMovementReport(
    context: ServiceContext,
    inventoryItemId: string,
    storeId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<InventoryMovementReport> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Get inventory item
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });

    if (!item) {
      throw new NotFoundError("InventoryItem", inventoryItemId);
    }

    // Get opening balance (stock at start date)
    const openingTransactions = await this.prisma.inventoryTransaction.findMany(
      {
        where: {
          inventoryItemId,
          storeId,
          transactionDate: { lt: dateFrom },
        },
      },
    );

    let openingBalance = 0;
    openingTransactions.forEach((t: Record<string, unknown>) => {
      if (isReceiptTransaction(t.transactionType as InventoryTransactionType)) {
        openingBalance += Number(t.quantity);
      } else if (
        isIssueTransaction(t.transactionType as InventoryTransactionType)
      ) {
        openingBalance -= Number(t.quantity);
      }
    });

    // Get transactions in period
    const transactions = await this.getByInventoryItem(
      context,
      inventoryItemId,
      {
        storeId,
        dateFrom,
        dateTo,
      },
    );

    // Calculate movements
    let received = 0;
    let issued = 0;
    let adjusted = 0;
    let transferred = 0;
    let returned = 0;

    transactions.forEach((t) => {
      const qty = Number(t.quantity);
      switch (t.transactionType) {
        case InventoryTransactionType.RECEIVE:
          received += qty;
          break;
        case InventoryTransactionType.ISSUE:
          issued += qty;
          break;
        case InventoryTransactionType.ADJUST:
          adjusted += qty;
          break;
        case InventoryTransactionType.TRANSFER_IN:
          transferred += qty;
          break;
        case InventoryTransactionType.TRANSFER_OUT:
          transferred -= qty;
          break;
        case InventoryTransactionType.RETURN:
          returned += qty;
          break;
      }
    });

    const closingBalance =
      openingBalance + received - issued + adjusted + transferred + returned;

    return {
      inventoryItemId,
      sku: item.sku,
      description: item.description,
      openingBalance,
      received,
      issued,
      adjusted,
      transferred,
      returned,
      closingBalance,
      transactions,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * DEPRECATED: Update inventory stock based on transaction
   *
   * This method is no longer used. Stock updates are now handled by
   * InventoryStockService BEFORE transaction records are created.
   *
   * Keeping this method for reference but it should never be called.
   * If you see this being called, there's a bug in the refactoring.
   *
   * @deprecated Use InventoryStockService methods instead
   */
  // @ts-expect-error TS6133 - Deprecated method kept for reference
  private _updateInventoryStock(
    _inventoryItemId: string,
    _storeId: string,
    _transactionType: InventoryTransactionType,
    _quantity: number,
  ): Promise<void> {
    throw new Error(
      "updateInventoryStock is deprecated. Use InventoryStockService methods instead. " +
        "This indicates a bug in the refactoring - stock should be updated BEFORE transaction creation.",
    );
  }

  /**
   * Get entity name for audit logging
   */
  protected override getEntityName(model: Record<string, unknown>): string {
    if (model.inventoryItem) {
      const inventoryItem = model.inventoryItem as Record<string, unknown>;
      return `${inventoryItem.sku} - ${model.transactionType}`;
    }
    return (model.id as string) || "Unknown";
  }
}

// Export singleton instance
// In development, always create a fresh instance so HMR picks up code changes.
// In production, cache via globalThis to avoid creating multiple instances.
const globalForInventoryTransaction = globalThis as unknown as {
  inventoryTransactionService: InventoryTransactionService | undefined;
};
if (process.env.NODE_ENV !== "production") {
  globalForInventoryTransaction.inventoryTransactionService =
    new InventoryTransactionService(prisma);
} else {
  globalForInventoryTransaction.inventoryTransactionService =
    globalForInventoryTransaction.inventoryTransactionService ??
    new InventoryTransactionService(prisma);
}
export const inventoryTransactionService =
  globalForInventoryTransaction.inventoryTransactionService;
