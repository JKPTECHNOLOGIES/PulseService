/**
 * Master Cycle Count Service
 *
 * Comprehensive service for managing physical inventory cycle counts.
 * Implements complete workflow from count initiation through posting adjustments.
 *
 * Key Features:
 * - Transaction-based operations for data integrity
 * - Complete audit trail via MasterCycleCountAudit
 * - Status-based workflow management
 * - Variance detection and recount handling
 * - Integration with InventoryStockService and InventoryTransactionService
 *
 * Workflow:
 * 1. IN_PROGRESS: Count items, detect variances
 * 2. COUNT_COMPLETE: All items counted
 * 3. UNDER_REVIEW: Manager reviews variances
 * 4. APPROVED: Ready to post
 * 5. POSTED: Adjustments applied to inventory
 */

import { PrismaClient, Prisma, type ABCClassification } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { BadRequestError, NotFoundError } from "@/lib/api-errors";
import { inventoryStockService } from "@/services/inventory/stock/inventory-stock.service";
import { inventoryGLService } from "@/services/inventory/inventory-gl.service";
import { abcClassificationService } from "@/services/inventory/abc-classification/abc-classification.service";
import { toNumber } from "@/lib/decimal-helpers";
import { notificationService } from "@/services/notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { INVENTORY_NOTIFICATIONS } from "@/services/notifications/notification-types-registry";
import type { ServiceContext } from "@/services/base/types";

import {
  CycleCountStatus,
  CountItemStatus,
  CreateCycleCountDTO,
  UpdateCycleCountDTO,
  CountItemInputDTO,
  RecountItemDTO,
  ReviewCycleCountDTO,
  ApproveCycleCountDTO,
  CycleCountFiltersDTO,
  MasterCycleCountWithRelations,
  MasterCycleCountItemWithRelations,
  VarianceThresholds,
  CycleCountStatistics,
  VarianceReport,
  validateCreateCycleCount,
  validateUpdateCycleCount,
  validateCountItemInput,
  validateRecountItem,
  validateReviewCycleCount,
  validateApproveCycleCount,
  validateCycleCountFilters,
  isEditable,
  canComplete,
  canApprove,
  canPost,
} from "./master-cycle-count.types";

/**
 * Master Cycle Count Service Class
 *
 * Provides centralized cycle count management with:
 * - Transactional integrity
 * - Audit trail recording
 * - Workflow validation
 * - Variance handling
 */
class MasterCycleCountService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new cycle count
   *
   * Initializes a cycle count session and populates items based on filters.
   * Items are selected from InventoryStock where isStockItem = true.
   *
   * @param data - Cycle count creation data
   * @param userId - User creating the count
   * @returns Created cycle count with items
   */
  async createCycleCount(
    data: CreateCycleCountDTO,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    // Validate input
    const validatedData = validateCreateCycleCount(data);

    // Generate unique count number
    const countNumber = await this.generateCountNumber();

    // Get items to count based on filters
    const itemsToCount = await this.getItemsForCount(
      validatedData.storeId,
      validatedData.binFilter,
      validatedData.categoryFilter,
    );

    if (itemsToCount.length === 0) {
      throw new BadRequestError(
        "No items found matching the specified filters",
      );
    }

    // Create cycle count with items in transaction
    const cycleCount = await this.prisma.$transaction(async (tx) => {
      // Create cycle count header
      const count = await tx.masterCycleCount.create({
        data: {
          countNumber,
          title: validatedData.title,
          description: validatedData.description,
          status: CycleCountStatus.IN_PROGRESS,
          storeId: validatedData.storeId,
          binFilter: validatedData.binFilter,
          categoryFilter: validatedData.categoryFilter,
          startedBy: userId,
          startedAt: new Date(),
          totalItems: itemsToCount.length,
          itemsCounted: 0,
          itemsWithVariance: 0,
          totalVarianceValue: 0,
          notes: validatedData.notes,
        },
      });

      // Create count items
      await tx.masterCycleCountItem.createMany({
        data: itemsToCount.map((item) => ({
          cycleCountId: count.id,
          inventoryItemId: item.inventoryItemId,
          storeId: item.storeId,
          bin: item.bin,
          systemQuantity: item.quantityOnHand,
          systemUnitCost: item.unitCost,
          status: CountItemStatus.PENDING,
        })),
      });

      // Create audit entry
      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId: count.id,
          action: "CREATED",
          performedBy: userId,
          performedAt: new Date(),
          newValue: {
            countNumber,
            title: validatedData.title,
            totalItems: itemsToCount.length,
          },
          notes: "Cycle count created",
        },
      });

      return count;
    });

    // Fetch with relations
    return await this.getCycleCount(cycleCount.id);
  }

  /**
   * Create cycle count from ABC classification due items
   * Automatically selects items due for count based on their classification
   *
   * @param data - Creation parameters
   * @param userId - User creating the count
   * @returns Created cycle count with items
   */
  async createFromABCClassification(
    data: {
      storeId: string;
      classification?: ABCClassification;
      overdueDays?: number;
      maxItems?: number;
    },
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    // 1. Get items due for count from ABC classification service
    const itemsDue = await abcClassificationService.getItemsDueForCount({
      storeId: data.storeId,
      classification: data.classification,
      overdueDays: data.overdueDays,
    });

    if (itemsDue.length === 0) {
      throw new BadRequestError(
        "No items due for count matching the specified criteria",
      );
    }

    // Apply max items limit if specified
    const itemsToCount = data.maxItems
      ? itemsDue.slice(0, data.maxItems)
      : itemsDue;

    // Get store info
    const store = await this.prisma.store.findUnique({
      where: { id: data.storeId },
      select: { name: true, code: true },
    });

    if (!store) {
      throw new NotFoundError("Store", data.storeId);
    }

    // 2. Generate unique count number
    const countNumber = await this.generateCountNumber();

    // 3. Transform items to count items format
    const countItems = await Promise.all(
      itemsToCount.map(async (item) => {
        // Get stock info for this item
        const stock = await this.prisma.inventoryStock.findFirst({
          where: {
            inventoryItemId: item.id,
            storeId: data.storeId,
          },
          select: {
            quantityOnHand: true,
            bin: true,
          },
        });

        return {
          inventoryItemId: item.id,
          storeId: data.storeId,
          bin: stock?.bin ?? "MAIN",
          systemQuantity: stock?.quantityOnHand ?? new Decimal(0),
          systemUnitCost: item.unitCost,
          status: "PENDING" as const,
        };
      }),
    );

    // 4. Create cycle count with items in transaction
    const cycleCount = await this.prisma.$transaction(async (tx) => {
      const classificationText = data.classification
        ? `${data.classification} Classification`
        : "ABC Classification";

      // Create cycle count header
      const count = await tx.masterCycleCount.create({
        data: {
          countNumber,
          title: `${classificationText} Cycle Count - ${store.name}`,
          description: `Automatic cycle count for items due based on ABC classification`,
          status: "IN_PROGRESS" as const,
          storeId: data.storeId,
          startedBy: userId,
          startedAt: new Date(),
          totalItems: countItems.length,
          itemsCounted: 0,
          itemsWithVariance: 0,
          totalVarianceValue: 0,
          notes: `Created from ABC classification. ${countItems.length} items included.${
            data.classification ? ` Classification: ${data.classification}` : ""
          }${data.overdueDays ? ` Overdue by ${data.overdueDays} days` : ""}`,
        },
      });

      // Create count items
      await tx.masterCycleCountItem.createMany({
        data: countItems.map((item) => ({
          ...item,
          cycleCountId: count.id,
        })),
      });

      // 5. Add audit log entry noting ABC-driven creation
      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId: count.id,
          action: "CREATED",
          performedBy: userId,
          performedAt: new Date(),
          newValue: {
            countNumber,
            source: "ABC Classification",
            classification: data.classification,
            itemCount: countItems.length,
            overdueDays: data.overdueDays,
          },
          notes: "Cycle count created from ABC classification system",
        },
      });

      return count;
    });

    // Fetch with relations
    return await this.getCycleCount(cycleCount.id);
  }

  /**
   * Get a single cycle count header (without items).
   *
   * Items are always fetched separately via getCountItems() to avoid loading
   * potentially thousands of rows as part of every header request.
   *
   * @param id - Cycle count ID
   * @returns Cycle count with all header relations; items is always []
   */
  async getCycleCount(id: string): Promise<MasterCycleCountWithRelations> {
    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id },
      include: {
        starter: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        reviewer: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        store: {
          select: { id: true, name: true, code: true },
        },
        // Items intentionally excluded — fetched separately by getCountItems()
        // to prevent loading thousands of rows on every header request.
      },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", id);
    }

    // Transform Decimals to numbers; items array is empty for header-only fetch
    return this.transformCycleCount({ ...cycleCount, items: [] });
  }

  /**
   * List cycle counts with filtering and pagination
   *
   * @param filters - Filter criteria
   * @returns Array of cycle counts
   */
  async listCycleCounts(
    filters: CycleCountFiltersDTO,
  ): Promise<MasterCycleCountWithRelations[]> {
    const validatedFilters = validateCycleCountFilters(filters);

    const where: Prisma.MasterCycleCountWhereInput = {};

    if (validatedFilters.status) {
      // Explicit status filter — show exactly what was requested, including CANCELLED
      where.status = validatedFilters.status;
    } else {
      // Default: hide CANCELLED counts so the list page stays clean
      where.status = { not: CycleCountStatus.CANCELLED };
    }

    if (validatedFilters.storeId) {
      where.storeId = validatedFilters.storeId;
    }

    if (validatedFilters.startedBy) {
      where.startedBy = validatedFilters.startedBy;
    }

    if (validatedFilters.startDate || validatedFilters.endDate) {
      where.startedAt = {};
      if (validatedFilters.startDate) {
        where.startedAt.gte = new Date(validatedFilters.startDate);
      }
      if (validatedFilters.endDate) {
        where.startedAt.lte = new Date(validatedFilters.endDate);
      }
    }

    if (validatedFilters.search) {
      where.OR = [
        {
          countNumber: {
            contains: validatedFilters.search,
            mode: "insensitive",
          },
        },
        { title: { contains: validatedFilters.search, mode: "insensitive" } },
      ];
    }

    const cycleCounts = await this.prisma.masterCycleCount.findMany({
      where,
      include: {
        starter: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        reviewer: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        store: {
          select: { id: true, name: true, code: true },
        },
        // Items intentionally excluded from list query — the list view only
        // needs header fields.  Individual items are fetched lazily on the
        // detail page via getCountItems().
      },
      orderBy: { startedAt: "desc" },
    });

    return cycleCounts.map((cc) => this.transformCycleCount({ ...cc, items: [] }));
  }

  /**
   * Update cycle count header information
   *
   * Only allowed when status is IN_PROGRESS.
   *
   * @param id - Cycle count ID
   * @param data - Update data
   * @param userId - User performing update
   * @returns Updated cycle count
   */
  async updateCycleCount(
    id: string,
    data: UpdateCycleCountDTO,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    const validatedData = validateUpdateCycleCount(data);

    // Get current cycle count
    const current = await this.prisma.masterCycleCount.findUnique({
      where: { id },
    });

    if (!current) {
      throw new NotFoundError("Cycle Count", id);
    }

    // Validate status
    if (!isEditable(current.status as CycleCountStatus)) {
      throw new BadRequestError(
        `Cannot update cycle count in ${current.status} status`,
      );
    }

    // Update in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.masterCycleCount.update({
        where: { id },
        data: {
          title: validatedData.title,
          description: validatedData.description,
          notes: validatedData.notes,
        },
      });

      // Create audit entry
      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId: id,
          action: "UPDATED",
          performedBy: userId,
          performedAt: new Date(),
          previousValue: {
            title: current.title,
            description: current.description,
          },
          newValue: validatedData,
          notes: "Cycle count updated",
        },
      });
    });

    return await this.getCycleCount(id);
  }

  /**
   * Delete (cancel) a cycle count
   *
   * Sets status to CANCELLED. Cannot delete posted cycle counts.
   *
   * @param id - Cycle count ID
   * @param userId - User performing deletion
   * @returns Operation result
   */
  async deleteCycleCount(
    id: string,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    const current = await this.prisma.masterCycleCount.findUnique({
      where: { id },
    });

    if (!current) {
      throw new NotFoundError("Cycle Count", id);
    }

    if (current.status === CycleCountStatus.POSTED) {
      throw new BadRequestError(
        "Cannot delete a posted cycle count. Posted counts have already been applied to inventory.",
      );
    }

    if (current.status === CycleCountStatus.APPROVED) {
      throw new BadRequestError(
        "Cannot delete an approved cycle count. Approved counts are ready to post to inventory.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.masterCycleCount.update({
        where: { id },
        data: { status: CycleCountStatus.CANCELLED },
      });

      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId: id,
          action: "CANCELLED",
          performedBy: userId,
          performedAt: new Date(),
          notes: "Cycle count cancelled",
        },
      });
    });

    return await this.getCycleCount(id);
  }

  // ============================================================================
  // COUNT ITEM OPERATIONS
  // ============================================================================

  /**
   * Get count items for a cycle count
   *
   * @param cycleCountId - Cycle count ID
   * @param filters - Optional filters
   * @returns Array of count items
   */
  async getCountItems(
    cycleCountId: string,
    filters?: { bin?: string; status?: CountItemStatus },
  ): Promise<MasterCycleCountItemWithRelations[]> {
    const where: Prisma.MasterCycleCountItemWhereInput = {
      cycleCountId,
      inventoryItem: {
        isStockItem: true,
      },
    };

    if (filters?.bin) {
      where.bin = { startsWith: filters.bin };
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    const items = await this.prisma.masterCycleCountItem.findMany({
      where,
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
            category: true,
          },
        },
        store: {
          select: { id: true, name: true, code: true },
        },
        firstCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
        secondCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
        finalCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ bin: "asc" }, { inventoryItem: { sku: "asc" } }],
    });

    return items.map((item) => this.transformCountItem(item));
  }

  /**
   * Enter or update count for an item
   *
   * Records the first count, calculates variance, and determines if recount is needed.
   *
   * @param cycleCountId - Cycle count ID
   * @param itemId - Count item ID
   * @param data - Count data
   * @param userId - User performing count
   * @returns Updated count item
   */
  async enterCount(
    cycleCountId: string,
    itemId: string,
    data: CountItemInputDTO,
    userId: string,
  ): Promise<MasterCycleCountItemWithRelations> {
    const validatedData = validateCountItemInput(data);

    // Get cycle count and item
    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    if (!isEditable(cycleCount.status as CycleCountStatus)) {
      throw new BadRequestError(
        `Cannot enter counts for cycle count in ${cycleCount.status} status`,
      );
    }

    const item = await this.prisma.masterCycleCountItem.findUnique({
      where: { id: itemId },
    });

    if (item?.cycleCountId !== cycleCountId) {
      throw new NotFoundError("Count Item", itemId);
    }

    // Refresh systemQuantity from live InventoryStock at the moment the count is entered.
    // Cycle counts can run for weeks or months; using the creation-time snapshot would produce
    // misleading variance numbers because legitimate issues/receipts during that period would
    // inflate the reported variance. The "system quantity" should reflect what the system shows
    // at the exact moment each item is physically counted.
    const liveStock = await this.prisma.inventoryStock.findUnique({
      where: {
        inventoryItemId_storeId_bin: {
          inventoryItemId: item.inventoryItemId,
          storeId: item.storeId,
          bin: item.bin,
        },
      },
      select: { quantityOnHand: true },
    });
    const liveSystemQty = toNumber(liveStock?.quantityOnHand) ?? 0;

    // Calculate variance
    const systemQty = liveSystemQty;
    const countedQty = validatedData.countedQuantity;
    const unitCost = toNumber(item.systemUnitCost) ?? 0;
    const variance = this.calculateVariance(systemQty, countedQty, unitCost);

    // Determine status based on variance
    // - No variance: VERIFIED (count matches, item complete)
    // - Variance exceeds threshold: VARIANCE_DETECTED (requires recount)
    // - Minor variance: COUNTED (acceptable, no recount needed)
    const thresholds: VarianceThresholds = {
      minorPercentage: 2,
      minorValue: 50,
      moderatePercentage: 5,
      moderateValue: 100,
    };

    let newStatus: CountItemStatus;
    if (variance.quantity === 0) {
      // Perfect match - mark as verified and complete
      newStatus = CountItemStatus.VERIFIED;
    } else if (this.checkVarianceThreshold(variance.percentage, thresholds)) {
      // Significant variance - requires recount
      newStatus = CountItemStatus.VARIANCE_DETECTED;
    } else {
      // Minor variance - acceptable
      newStatus = CountItemStatus.COUNTED;
    }

    // Update item in transaction
    await this.prisma.$transaction(async (tx) => {
      const wasAlreadyCounted = item.status !== CountItemStatus.PENDING;

      await tx.masterCycleCountItem.update({
        where: { id: itemId },
        data: {
          // Persist the refreshed system quantity so the report always shows
          // what the system held at the time the counter physically counted this item.
          systemQuantity: liveSystemQty,
          firstCountQuantity: countedQty,
          firstCountedBy: userId,
          firstCountedAt: new Date(),
          hasVariance: variance.quantity !== 0,
          varianceQuantity: variance.quantity,
          varianceValue: variance.value,
          variancePercentage: variance.percentage,
          status: newStatus,
          notes: validatedData.notes,
        },
      });

      // Update cycle count statistics
      const stats = await this.calculateStatistics(tx, cycleCountId);
      await tx.masterCycleCount.update({
        where: { id: cycleCountId },
        data: {
          itemsCounted: stats.itemsCounted,
          itemsWithVariance: stats.itemsWithVariance,
          totalVarianceValue: stats.totalVarianceValue,
        },
      });

      // Create audit entry
      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId,
          itemId,
          action: wasAlreadyCounted ? "COUNT_UPDATED" : "COUNT_ENTERED",
          performedBy: userId,
          performedAt: new Date(),
          newValue: {
            countedQuantity: countedQty,
            variance: variance.quantity,
            varianceValue: variance.value,
            status: newStatus,
          },
          notes: validatedData.notes ?? "Count entered",
        },
      });
    });

    // Send notification if significant variance detected
    if (newStatus === CountItemStatus.VARIANCE_DETECTED) {
      await this.sendVarianceNotification(
        cycleCountId,
        itemId,
        userId,
        variance,
      );
    }

    const updated = await this.prisma.masterCycleCountItem.findUnique({
      where: { id: itemId },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
            category: true,
          },
        },
        store: {
          select: { id: true, name: true, code: true },
        },
        firstCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
        secondCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
        finalCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!updated) {
      throw new NotFoundError("Count Item", itemId);
    }

    return this.transformCountItem(updated);
  }

  /**
   * Re-count an item with variance
   *
   * Records second count and determines final quantity.
   *
   * @param cycleCountId - Cycle count ID
   * @param itemId - Count item ID
   * @param data - Recount data
   * @param userId - User performing recount
   * @returns Updated count item
   */
  async recountItem(
    cycleCountId: string,
    itemId: string,
    data: RecountItemDTO,
    userId: string,
  ): Promise<MasterCycleCountItemWithRelations> {
    const validatedData = validateRecountItem(data);

    const item = await this.prisma.masterCycleCountItem.findUnique({
      where: { id: itemId },
    });

    if (item?.cycleCountId !== cycleCountId) {
      throw new NotFoundError("Count Item", itemId);
    }

    if (item.status !== CountItemStatus.VARIANCE_DETECTED) {
      throw new BadRequestError("Item does not require recount");
    }

    const firstCount = toNumber(item.firstCountQuantity) ?? 0;
    const secondCount = validatedData.countedQuantity;
    const countsMatch = firstCount === secondCount;

    await this.prisma.$transaction(async (tx) => {
      await tx.masterCycleCountItem.update({
        where: { id: itemId },
        data: {
          secondCountQuantity: secondCount,
          secondCountedBy: userId,
          secondCountedAt: new Date(),
          secondCountMatches: countsMatch,
          finalQuantity: secondCount,
          finalCountedBy: userId,
          finalCountedAt: new Date(),
          status: CountItemStatus.RECOUNTED,
          notes: validatedData.notes,
        },
      });

      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId,
          itemId,
          action: "RECOUNTED",
          performedBy: userId,
          performedAt: new Date(),
          newValue: {
            secondCount,
            countsMatch,
            finalQuantity: secondCount,
          },
          notes: validatedData.notes ?? "Item recounted",
        },
      });
    });

    const updated = await this.prisma.masterCycleCountItem.findUnique({
      where: { id: itemId },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
            category: true,
          },
        },
        store: {
          select: { id: true, name: true, code: true },
        },
        firstCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
        secondCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
        finalCounter: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!updated) {
      throw new NotFoundError("Count Item", itemId);
    }

    return this.transformCountItem(updated);
  }

  /**
   * Bulk enter counts for multiple items
   *
   * @param cycleCountId - Cycle count ID
   * @param items - Array of count items
   * @param userId - User performing counts
   * @returns Operation result
   */
  async bulkEnterCounts(
    cycleCountId: string,
    items: Array<CountItemInputDTO & { countItemId: string }>,
    userId: string,
  ): Promise<MasterCycleCountItemWithRelations[]> {
    const results = await Promise.all(
      items.map((item) =>
        this.enterCount(cycleCountId, item.countItemId, item, userId),
      ),
    );

    return results;
  }

  // ============================================================================
  // WORKFLOW OPERATIONS
  // ============================================================================

  /**
   * Complete count phase
   *
   * Validates all items are counted and transitions to COUNT_COMPLETE.
   *
   * @param cycleCountId - Cycle count ID
   * @param userId - User completing count
   * @returns Updated cycle count
   */
  async completeCount(
    cycleCountId: string,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
      include: { items: true },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    if (!canComplete(cycleCount.status as CycleCountStatus)) {
      throw new BadRequestError(
        `Cannot complete cycle count in ${cycleCount.status} status`,
      );
    }

    // Validate all items are counted
    const pendingItems = cycleCount.items.filter(
      (item) => item.status === CountItemStatus.PENDING,
    );

    if (pendingItems.length > 0) {
      throw new BadRequestError(
        `Cannot complete count: ${pendingItems.length} items still pending`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.masterCycleCount.update({
        where: { id: cycleCountId },
        data: {
          status: CycleCountStatus.COUNT_COMPLETE,
          countCompletedAt: new Date(),
        },
      });

      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId,
          action: "COUNT_COMPLETED",
          performedBy: userId,
          performedAt: new Date(),
          notes: "All items counted",
        },
      });
    });

    return await this.getCycleCount(cycleCountId);
  }

  /**
   * Submit cycle count for review
   *
   * Transitions to UNDER_REVIEW status.
   *
   * @param cycleCountId - Cycle count ID
   * @param userId - User submitting for review
   * @returns Updated cycle count
   */
  async submitForReview(
    cycleCountId: string,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    if (cycleCount.status !== CycleCountStatus.COUNT_COMPLETE) {
      throw new BadRequestError(
        "Count must be completed before submitting for review",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.masterCycleCount.update({
        where: { id: cycleCountId },
        data: { status: CycleCountStatus.UNDER_REVIEW },
      });

      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId,
          action: "SUBMITTED_FOR_REVIEW",
          performedBy: userId,
          performedAt: new Date(),
          notes: "Submitted for manager review",
        },
      });
    });

    return await this.getCycleCount(cycleCountId);
  }

  /**
   * Review cycle count
   *
   * Manager reviews and either approves or rejects.
   *
   * @param cycleCountId - Cycle count ID
   * @param data - Review data
   * @param userId - User performing review
   * @returns Updated cycle count
   */
  async reviewCycleCount(
    cycleCountId: string,
    data: ReviewCycleCountDTO,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    const validatedData = validateReviewCycleCount(data);

    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    if (cycleCount.status !== CycleCountStatus.UNDER_REVIEW) {
      throw new BadRequestError("Cycle count must be under review");
    }

    const newStatus = validatedData.approved
      ? CycleCountStatus.APPROVED
      : CycleCountStatus.IN_PROGRESS;

    await this.prisma.$transaction(async (tx) => {
      await tx.masterCycleCount.update({
        where: { id: cycleCountId },
        data: {
          status: newStatus,
          reviewedBy: userId,
          reviewedAt: new Date(),
          notes: validatedData.notes,
        },
      });

      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId,
          action: validatedData.approved ? "APPROVED" : "REJECTED",
          performedBy: userId,
          performedAt: new Date(),
          notes:
            validatedData.notes ??
            (validatedData.approved ? "Approved" : "Rejected"),
        },
      });
    });

    return await this.getCycleCount(cycleCountId);
  }

  /**
   * Approve cycle count
   *
   * Final approval before posting.
   *
   * @param cycleCountId - Cycle count ID
   * @param data - Approval data
   * @param userId - User approving
   * @returns Updated cycle count
   */
  async approveCycleCount(
    cycleCountId: string,
    data: ApproveCycleCountDTO,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    const validatedData = validateApproveCycleCount(data);

    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    if (!canApprove(cycleCount.status as CycleCountStatus)) {
      throw new BadRequestError(
        `Cannot approve cycle count in ${cycleCount.status} status`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.masterCycleCount.update({
        where: { id: cycleCountId },
        data: {
          status: CycleCountStatus.APPROVED,
          approvedBy: userId,
          approvedAt: new Date(),
          notes: validatedData.notes,
        },
      });

      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId,
          action: "APPROVED",
          performedBy: userId,
          performedAt: new Date(),
          notes: validatedData.notes ?? "Cycle count approved",
        },
      });
    });

    return await this.getCycleCount(cycleCountId);
  }

  /**
   * Post cycle count adjustments to inventory
   *
   * Creates inventory adjustments and transactions for all variances.
   * This is the final step that updates actual inventory quantities.
   *
   * @param cycleCountId - Cycle count ID
   * @param userId - User posting adjustments
   * @returns Updated cycle count
   */
  async postCycleCount(
    cycleCountId: string,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
      include: { items: true },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    if (!canPost(cycleCount.status as CycleCountStatus)) {
      throw new BadRequestError(
        `Cannot post cycle count in ${cycleCount.status} status`,
      );
    }

    // Get items with variances
    const itemsWithVariance = cycleCount.items.filter(
      (item) => item.hasVariance,
    );

    // Track GL failures for audit trail
    const glFailures: Array<{
      inventoryItemId: string;
      sku: string;
      error: string;
    }> = [];

    // Post adjustments in transaction
    await this.prisma.$transaction(async (tx) => {
      for (const item of itemsWithVariance) {
        const finalQty =
          toNumber(item.finalQuantity ?? item.firstCountQuantity) ?? 0;
        const systemQty = toNumber(item.systemQuantity) ?? 0;
        const variance = finalQty - systemQty;

        if (finalQty !== systemQty) {
          // Get inventory item for SKU and unit cost
          const inventoryItem = await tx.inventoryItem.findUnique({
            where: { id: item.inventoryItemId },
            select: { sku: true, unitCost: true },
          });

          // Update inventory stock using InventoryStockService
          await inventoryStockService.adjust(
            item.inventoryItemId,
            item.storeId,
            finalQty,
            {
              reason: "CYCLE_COUNT",
              notes: `Cycle Count ${cycleCount.countNumber}: System ${systemQty}, Counted ${finalQty}`,
              userId,
              userName: "System",
              bin: item.bin,
              context: {
                userId,
                userName: "System",
                userRole: "System",
                roleId: "system",
                userEmail: "system@system.local",
                permissions: [],
              },
            },
          );

          // Create GL transaction for adjustment using shared count variance helper
          const glResult = await inventoryGLService.createCountVarianceGL(
            {
              userId,
              userName: "System",
              userRole: "System",
              roleId: "system",
              userEmail: "system@system.local",
              permissions: [],
            },
            {
              inventoryItemId: item.inventoryItemId,
              inventoryItemSku: inventoryItem?.sku ?? 'UNKNOWN',
              storeId: item.storeId,
              bin: item.bin,
              oldQuantity: systemQty,
              newQuantity: finalQty,
              unitCost: toNumber(inventoryItem?.unitCost) ?? 0,
              referenceType: 'CYCLE_COUNT',
              referenceId: cycleCount.id,
              referenceNumber: cycleCount.countNumber,
              description: `Cycle count adjustment: ${inventoryItem?.sku ?? 'UNKNOWN'}`,
              reason: `System: ${systemQty}, Counted: ${finalQty}, Variance: ${variance}`,
            },
          );

          if (!glResult.success) {
            logger.error(
              `[CYCLE-COUNT-GL] GL entry failed for item ${item.inventoryItemId} ` +
              `in count ${cycleCount.countNumber}: ${glResult.error}`
            );
            glFailures.push({
              inventoryItemId: item.inventoryItemId,
              sku: inventoryItem?.sku ?? 'UNKNOWN',
              error: glResult.error ?? 'Unknown GL error',
            });
          }
        }
      }

      // Record GL failures in audit trail if any occurred
      if (glFailures.length > 0) {
        await tx.masterCycleCountAudit.create({
          data: {
            cycleCountId,
            action: 'GL_WARNINGS',
            performedBy: userId,
            performedAt: new Date(),
            newValue: { glFailures },
            notes: `${glFailures.length} GL entries failed during posting`,
          },
        });
      }

      // Update cycle count status
      await tx.masterCycleCount.update({
        where: { id: cycleCountId },
        data: { status: CycleCountStatus.POSTED },
      });

      // Create audit entry
      await tx.masterCycleCountAudit.create({
        data: {
          cycleCountId,
          action: "POSTED",
          performedBy: userId,
          performedAt: new Date(),
          notes: `Posted ${itemsWithVariance.length} adjustments to inventory`,
        },
      });
    });

    // Update ABC next count dates for all items in this count
    const { abcCycleCountIntegrationService } =
      await import("./abc-integration.service");
    await abcCycleCountIntegrationService.updateNextCountDatesForCount(
      cycleCountId,
    );

    return await this.getCycleCount(cycleCountId);
  }

  // ============================================================================
  // REPORTING OPERATIONS
  // ============================================================================

  /**
   * Get cycle count summary statistics
   *
   * @param cycleCountId - Cycle count ID
   * @returns Summary statistics
   */
  async getCycleCountSummary(
    cycleCountId: string,
  ): Promise<CycleCountStatistics> {
    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
      include: { items: true },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    const totalItems = cycleCount.items.length;
    const itemsCounted = cycleCount.items.filter(
      (item) => item.status !== CountItemStatus.PENDING,
    ).length;
    const itemsPending = totalItems - itemsCounted;
    const itemsWithVariance = cycleCount.items.filter(
      (item) => item.hasVariance,
    ).length;

    const totalVarianceValue = cycleCount.items.reduce(
      (sum, item) => sum + (toNumber(item.varianceValue) ?? 0),
      0,
    );

    const varianceItems = cycleCount.items.filter((item) => item.hasVariance);
    const averageVariancePercentage =
      varianceItems.length > 0
        ? varianceItems.reduce(
            (sum, item) =>
              sum + Math.abs(toNumber(item.variancePercentage) ?? 0),
            0,
          ) / varianceItems.length
        : 0;

    const countProgress =
      totalItems > 0 ? (itemsCounted / totalItems) * 100 : 0;

    // Group by bin
    const binGroups = new Map<string, { total: number; counted: number }>();
    cycleCount.items.forEach((item) => {
      const bin = item.bin;
      if (!binGroups.has(bin)) {
        binGroups.set(bin, { total: 0, counted: 0 });
      }
      const group = binGroups.get(bin);
      if (group) {
        group.total++;
        if (item.status !== CountItemStatus.PENDING) {
          group.counted++;
        }
      }
    });

    const binProgress = Array.from(binGroups.entries()).map(([bin, stats]) => ({
      bin,
      total: stats.total,
      counted: stats.counted,
      progress: stats.total > 0 ? (stats.counted / stats.total) * 100 : 0,
    }));

    return {
      totalItems,
      itemsCounted,
      itemsPending,
      itemsWithVariance,
      totalVarianceValue,
      averageVariancePercentage,
      countProgress,
      binProgress,
    };
  }

  /**
   * Get variance report
   *
   * @param cycleCountId - Cycle count ID
   * @returns Variance report
   */
  async getVarianceReport(cycleCountId: string): Promise<VarianceReport> {
    const cycleCount = await this.prisma.masterCycleCount.findUnique({
      where: { id: cycleCountId },
      include: {
        items: {
          include: {
            inventoryItem: true,
          },
        },
      },
    });

    if (!cycleCount) {
      throw new NotFoundError("Cycle Count", cycleCountId);
    }

    const itemsWithVariance = cycleCount.items.filter(
      (item) => item.hasVariance,
    );

    const variances = itemsWithVariance.map((item) => ({
      item: {
        sku: item.inventoryItem.sku,
        description: item.inventoryItem.description,
        bin: item.bin,
      },
      systemQuantity: toNumber(item.systemQuantity) ?? 0,
      countedQuantity:
        toNumber(item.finalQuantity ?? item.firstCountQuantity) ?? 0,
      varianceQuantity: toNumber(item.varianceQuantity) ?? 0,
      varianceValue: toNumber(item.varianceValue) ?? 0,
      variancePercentage: toNumber(item.variancePercentage) ?? 0,
      reason: item.varianceReason,
      requiresInvestigation: item.requiresInvestigation,
    }));

    // Group by bin
    const byBin = new Map<
      string,
      { itemsWithVariance: number; totalVarianceValue: number }
    >();
    itemsWithVariance.forEach((item) => {
      const bin = item.bin;
      if (!byBin.has(bin)) {
        byBin.set(bin, { itemsWithVariance: 0, totalVarianceValue: 0 });
      }
      const group = byBin.get(bin);
      if (group) {
        group.itemsWithVariance++;
        group.totalVarianceValue += toNumber(item.varianceValue) ?? 0;
      }
    });

    // Group by category
    const byCategory = new Map<
      string,
      { itemsWithVariance: number; totalVarianceValue: number }
    >();
    itemsWithVariance.forEach((item) => {
      const category = item.inventoryItem.category ?? "Uncategorized";
      if (!byCategory.has(category)) {
        byCategory.set(category, {
          itemsWithVariance: 0,
          totalVarianceValue: 0,
        });
      }
      const group = byCategory.get(category);
      if (group) {
        group.itemsWithVariance++;
        group.totalVarianceValue += toNumber(item.varianceValue) ?? 0;
      }
    });

    return {
      cycleCount: {
        id: cycleCount.id,
        countNumber: cycleCount.countNumber,
        title: cycleCount.title,
        status: cycleCount.status as CycleCountStatus,
      },
      summary: {
        totalItems: cycleCount.items.length,
        itemsWithVariance: itemsWithVariance.length,
        totalVarianceValue: toNumber(cycleCount.totalVarianceValue) ?? 0,
        variancePercentage:
          cycleCount.items.length > 0
            ? (itemsWithVariance.length / cycleCount.items.length) * 100
            : 0,
      },
      variances,
      byBin: Array.from(byBin.entries()).map(([bin, stats]) => ({
        bin,
        ...stats,
      })),
      byCategory: Array.from(byCategory.entries()).map(([category, stats]) => ({
        category,
        ...stats,
      })),
    };
  }

  /**
   * Get audit trail for cycle count
   *
   * @param cycleCountId - Cycle count ID
   * @returns Array of audit entries
   */
  async getAuditTrail(cycleCountId: string): Promise<unknown[]> {
    const audits = await this.prisma.masterCycleCountAudit.findMany({
      where: { cycleCountId },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        item: {
          include: {
            inventoryItem: {
              select: { sku: true, description: true },
            },
          },
        },
      },
      orderBy: { performedAt: "desc" },
    });

    // Transform audit entries to include performedByName and format details
    return audits.map((audit) => ({
      id: audit.id,
      cycleCountId: audit.cycleCountId,
      itemId: audit.itemId,
      action: audit.action,
      performedBy: audit.performedBy,
      performedByName: `${audit.user.firstName} ${audit.user.lastName}`,
      performedAt: audit.performedAt,
      previousValue: audit.previousValue,
      newValue: audit.newValue,
      details: audit.newValue ?? audit.previousValue ?? null,
      notes: audit.notes,
      ipAddress: audit.ipAddress,
      item: audit.item
        ? {
            id: audit.item.id,
            bin: audit.item.bin,
            sku: audit.item.inventoryItem.sku,
            description: audit.item.inventoryItem.description,
          }
        : null,
    }));
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate variance metrics
   *
   * @param systemQty - System quantity
   * @param countedQty - Counted quantity
   * @param unitCost - Unit cost
   * @returns Variance metrics
   */
  calculateVariance(
    systemQty: number,
    countedQty: number,
    unitCost: number,
  ): { quantity: number; value: number; percentage: number } {
    const quantity = countedQty - systemQty;
    const value = quantity * unitCost;
    const percentage = systemQty !== 0 ? (quantity / systemQty) * 100 : 0;

    return { quantity, value, percentage };
  }

  /**
   * Check if variance exceeds thresholds
   *
   * @param variancePercentage - Variance percentage
   * @param thresholds - Variance thresholds
   * @returns True if variance exceeds moderate threshold
   */
  checkVarianceThreshold(
    variancePercentage: number,
    thresholds: VarianceThresholds,
  ): boolean {
    return Math.abs(variancePercentage) > thresholds.moderatePercentage;
  }

  /**
   * Validate status transition
   *
   * @param currentStatus - Current status
   * @param newStatus - New status
   * @returns True if transition is valid
   */
  canTransitionStatus(
    currentStatus: CycleCountStatus,
    newStatus: CycleCountStatus,
  ): boolean {
    const validTransitions: Record<CycleCountStatus, CycleCountStatus[]> = {
      [CycleCountStatus.IN_PROGRESS]: [
        CycleCountStatus.COUNT_COMPLETE,
        CycleCountStatus.CANCELLED,
      ],
      [CycleCountStatus.COUNT_COMPLETE]: [
        CycleCountStatus.UNDER_REVIEW,
        CycleCountStatus.IN_PROGRESS,
      ],
      [CycleCountStatus.UNDER_REVIEW]: [
        CycleCountStatus.APPROVED,
        CycleCountStatus.IN_PROGRESS,
      ],
      [CycleCountStatus.APPROVED]: [CycleCountStatus.POSTED],
      [CycleCountStatus.POSTED]: [],
      [CycleCountStatus.CANCELLED]: [],
    };

    return validTransitions[currentStatus].includes(newStatus);
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Generate unique count number
   */
  private async generateCountNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    const prefix = `CC-${year}${month}`;

    const lastCount = await this.prisma.masterCycleCount.findFirst({
      where: {
        countNumber: { startsWith: prefix },
      },
      orderBy: { countNumber: "desc" },
    });

    let sequence = 1;
    if (lastCount) {
      const lastSequence = parseInt(lastCount.countNumber.split("-")[2] ?? "0");
      sequence = lastSequence + 1;
    }

    return `${prefix}-${String(sequence).padStart(4, "0")}`;
  }

  /**
   * Get items for count based on filters
   */
  private async getItemsForCount(
    storeId?: string | null,
    binFilter?: string | null,
    categoryFilter?: string | null,
  ): Promise<
    Array<{
      inventoryItemId: string;
      storeId: string;
      bin: string;
      quantityOnHand: number;
      unitCost: number;
    }>
  > {
    const where: Prisma.InventoryStockWhereInput = {
      inventoryItem: {
        isStockItem: true,
        isActive: true,
        isArchived: false,
      },
    };

    if (storeId) {
      where.storeId = storeId;
    }

    if (binFilter) {
      where.bin = { contains: binFilter, mode: "insensitive" };
    }

    if (categoryFilter) {
      where.inventoryItem = {
        isStockItem: true,
        isActive: true,
        isArchived: false,
        category: { contains: categoryFilter, mode: "insensitive" },
      };
    }

    const stocks = await this.prisma.inventoryStock.findMany({
      where,
      include: {
        inventoryItem: {
          select: { unitCost: true },
        },
      },
    });

    return stocks.map((stock) => ({
      inventoryItemId: stock.inventoryItemId,
      storeId: stock.storeId,
      bin: stock.bin || "MAIN",
      quantityOnHand: toNumber(stock.quantityOnHand) ?? 0,
      unitCost: toNumber(stock.inventoryItem.unitCost) ?? 0,
    }));
  }

  /**
   * Calculate statistics for cycle count
   */
  private async calculateStatistics(
    tx: Prisma.TransactionClient,
    cycleCountId: string,
  ): Promise<{
    itemsCounted: number;
    itemsWithVariance: number;
    totalVarianceValue: number;
  }> {
    const items = await tx.masterCycleCountItem.findMany({
      where: { cycleCountId },
    });

    const itemsCounted = items.filter(
      (item) => item.status !== CountItemStatus.PENDING,
    ).length;
    const itemsWithVariance = items.filter((item) => item.hasVariance).length;
    const totalVarianceValue = items.reduce(
      (sum, item) => sum + (toNumber(item.varianceValue) ?? 0),
      0,
    );

    return { itemsCounted, itemsWithVariance, totalVarianceValue };
  }

  /**
   * Transform cycle count with Decimal conversion
   */
  private transformCycleCount(cycleCount: {
    id: string;
    countNumber: string;
    title: string;
    description: string | null;
    status: string;
    storeId: string | null;
    binFilter: string | null;
    categoryFilter: string | null;
    startedBy: string;
    startedAt: Date;
    countCompletedAt: Date | null;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    approvedBy: string | null;
    approvedAt: Date | null;
    totalItems: number;
    itemsCounted: number;
    itemsWithVariance: number;
    totalVarianceValue: Decimal;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    starter: { id: string; firstName: string; lastName: string; email: string };
    reviewer: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
    approver: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
    store: { id: string; name: string; code: string } | null;
    items: unknown[];
  }): MasterCycleCountWithRelations {
    return {
      id: cycleCount.id,
      countNumber: cycleCount.countNumber,
      title: cycleCount.title,
      description: cycleCount.description,
      status: cycleCount.status as CycleCountStatus,
      storeId: cycleCount.storeId,
      binFilter: cycleCount.binFilter,
      categoryFilter: cycleCount.categoryFilter,
      startedBy: cycleCount.startedBy,
      startedAt: cycleCount.startedAt,
      countCompletedAt: cycleCount.countCompletedAt,
      reviewedBy: cycleCount.reviewedBy,
      reviewedAt: cycleCount.reviewedAt,
      approvedBy: cycleCount.approvedBy,
      approvedAt: cycleCount.approvedAt,
      totalItems: cycleCount.totalItems,
      itemsCounted: cycleCount.itemsCounted,
      itemsWithVariance: cycleCount.itemsWithVariance,
      totalVarianceValue: cycleCount.totalVarianceValue,
      notes: cycleCount.notes,
      createdAt: cycleCount.createdAt,
      updatedAt: cycleCount.updatedAt,
      starter: {
        id: cycleCount.starter.id,
        name: cycleCount.starter.firstName + " " + cycleCount.starter.lastName,
        email: cycleCount.starter.email,
      },
      reviewer: cycleCount.reviewer
        ? {
            id: cycleCount.reviewer.id,
            name:
              cycleCount.reviewer.firstName +
              " " +
              cycleCount.reviewer.lastName,
            email: cycleCount.reviewer.email,
          }
        : null,
      approver: cycleCount.approver
        ? {
            id: cycleCount.approver.id,
            name:
              cycleCount.approver.firstName +
              " " +
              cycleCount.approver.lastName,
            email: cycleCount.approver.email,
          }
        : null,
      store: cycleCount.store,
      items: cycleCount.items.map((item) =>
        this.transformCountItem(
          item as Parameters<typeof this.transformCountItem>[0],
        ),
      ),
    };
  }

  /**
   * Transform count item with Decimal conversion
   */
  private transformCountItem(item: {
    id: string;
    cycleCountId: string;
    inventoryItemId: string;
    storeId: string;
    bin: string;
    systemQuantity: Decimal;
    systemUnitCost: Decimal;
    status: string;
    firstCountQuantity: Decimal | null;
    firstCountedBy: string | null;
    firstCountedAt: Date | null;
    hasVariance: boolean;
    varianceQuantity: Decimal | null;
    varianceValue: Decimal | null;
    variancePercentage: Decimal | null;
    secondCountQuantity: Decimal | null;
    secondCountedBy: string | null;
    secondCountedAt: Date | null;
    secondCountMatches: boolean | null;
    finalQuantity: Decimal | null;
    finalCountedBy: string | null;
    finalCountedAt: Date | null;
    notes: string | null;
    varianceReason: string | null;
    requiresInvestigation: boolean;
    investigationNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
    inventoryItem: {
      id: string;
      sku: string;
      description: string;
      unit: string;
      category: string | null;
    };
    store: { id: string; name: string; code: string };
    firstCounter: { id: string; firstName: string; lastName: string } | null;
    secondCounter: { id: string; firstName: string; lastName: string } | null;
    finalCounter: { id: string; firstName: string; lastName: string } | null;
  }): MasterCycleCountItemWithRelations {
    return {
      id: item.id,
      cycleCountId: item.cycleCountId,
      inventoryItemId: item.inventoryItemId,
      storeId: item.storeId,
      bin: item.bin,
      systemQuantity: item.systemQuantity,
      systemUnitCost: item.systemUnitCost,
      status: item.status as CountItemStatus,
      firstCountQuantity: item.firstCountQuantity,
      firstCountedBy: item.firstCountedBy,
      firstCountedAt: item.firstCountedAt,
      hasVariance: item.hasVariance,
      varianceQuantity: item.varianceQuantity,
      varianceValue: item.varianceValue,
      variancePercentage: item.variancePercentage,
      secondCountQuantity: item.secondCountQuantity,
      secondCountedBy: item.secondCountedBy,
      secondCountedAt: item.secondCountedAt,
      secondCountMatches: item.secondCountMatches,
      finalQuantity: item.finalQuantity,
      finalCountedBy: item.finalCountedBy,
      finalCountedAt: item.finalCountedAt,
      notes: item.notes,
      varianceReason: item.varianceReason,
      requiresInvestigation: item.requiresInvestigation,
      investigationNotes: item.investigationNotes,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      inventoryItem: item.inventoryItem,
      store: item.store,
      firstCounter: item.firstCounter
        ? {
            id: item.firstCounter.id,
            name:
              item.firstCounter.firstName + " " + item.firstCounter.lastName,
          }
        : null,
      secondCounter: item.secondCounter
        ? {
            id: item.secondCounter.id,
            name:
              item.secondCounter.firstName + " " + item.secondCounter.lastName,
          }
        : null,
      finalCounter: item.finalCounter
        ? {
            id: item.finalCounter.id,
            name:
              item.finalCounter.firstName + " " + item.finalCounter.lastName,
          }
        : null,
    };
  }

  /**
   * Send notification for cycle count variance
   */
  private async sendVarianceNotification(
    cycleCountId: string,
    itemId: string,
    userId: string,
    variance: { quantity: number; value: number; percentage: number },
  ): Promise<void> {
    try {
      // Get cycle count and item details
      const cycleCount = await this.prisma.masterCycleCount.findUnique({
        where: { id: cycleCountId },
        select: {
          countNumber: true,
          title: true,
          storeId: true,
          store: {
            select: { name: true },
          },
        },
      });

      const item = await this.prisma.masterCycleCountItem.findUnique({
        where: { id: itemId },
        include: {
          inventoryItem: {
            select: {
              sku: true,
              description: true,
              unit: true,
            },
          },
        },
      });

      if (!cycleCount || !item) {
        return;
      }

      // Create service context for notification
      const context: ServiceContext = {
        userId,
        userName: "System",
        userEmail: "system@system.local",
        userRole: "System",
        roleId: "system",
        permissions: [],
      };

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

      // Determine priority based on variance percentage
      const priority =
        Math.abs(variance.percentage) > 10
          ? NotificationPriority.HIGH
          : NotificationPriority.NORMAL;

      // Send notification to each manager
      for (const manager of managers) {
        await notificationService.sendNotification(context, {
          userId: manager.id,
          type: INVENTORY_NOTIFICATIONS.CYCLE_COUNT_DISCREPANCY.type,
          category: NotificationCategory.INVENTORY,
          title: `Cycle Count Variance Detected: ${item.inventoryItem.sku}`,
          message: `Significant variance found during cycle count ${cycleCount.countNumber}`,
          priority,
          actionUrl: `/inventory/cycle-counts/${cycleCountId}`,
          actionLabel: "Review Count",
          data: {
            cycleCountId,
            cycleCountNumber: cycleCount.countNumber,
            cycleCountTitle: cycleCount.title,
            itemId,
            sku: item.inventoryItem.sku,
            description: item.inventoryItem.description,
            storeId: cycleCount.storeId,
            storeName: cycleCount.store?.name,
            bin: item.bin,
            systemQuantity: toNumber(item.systemQuantity) ?? 0,
            countedQuantity: toNumber(item.firstCountQuantity) ?? 0,
            varianceQuantity: variance.quantity,
            varianceValue: variance.value,
            variancePercentage: variance.percentage,
            unit: item.inventoryItem.unit,
          },
        });
      }
    } catch (_error) {
      // Notification failure is non-critical
    }
  }
}

// Export singleton instance
const globalForMasterCycleCount = globalThis as unknown as { masterCycleCountService: MasterCycleCountService | undefined };
export const masterCycleCountService = globalForMasterCycleCount.masterCycleCountService ?? (globalForMasterCycleCount.masterCycleCountService = new MasterCycleCountService(prisma));
