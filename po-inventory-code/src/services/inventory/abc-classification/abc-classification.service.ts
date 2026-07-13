/**
 * ABC Classification Service
 *
 * Comprehensive service for managing ABC/ABCD inventory classification system.
 * Implements automatic classification based on annual usage value with integration
 * to cycle count scheduling.
 *
 * Key Features:
 * - Monthly automatic classification calculation
 * - Usage-based classification (A/B/C/D/UNCLASSIFIED)
 * - Cycle count frequency management
 * - Classification history tracking
 * - Comprehensive reporting
 *
 * Algorithm:
 * 1. Calculate 12-month rolling usage for all items
 * 2. Sort by annual usage value (descending)
 * 3. Assign classifications based on cumulative percentage thresholds
 * 4. Update cycle count schedules based on classification
 *
 * @module abc-classification.service
 */

import { PrismaClient, Prisma, ABCClassification } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";

import type {
  ABCClassificationSettings,
  InventoryClassificationHistory,
  UpdateSettingsDTO,
  ClassificationReportQueryDTO,
  ItemsDueQueryDTO,
  ClassificationResult,
  ClassificationDistribution,
  ClassificationReport,
  ItemWithClassification,
  ItemUsageData,
  ClassificationAssignment,
} from "./abc-classification.types";

/**
 * ABC Classification Service Class
 *
 * Provides centralized ABC classification management with:
 * - Automatic monthly classification
 * - Usage statistics tracking
 * - Cycle count integration
 * - Comprehensive reporting
 */
class ABCClassificationService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // CORE CLASSIFICATION METHODS
  // ============================================================================

  /**
   * Calculate ABC classifications for all active stock items
   *
   * This is the main classification algorithm that runs monthly.
   *
   * Algorithm:
   * 1. Get classification settings
   * 2. Get all active stock items
   * 3. Calculate 12-month usage for each item
   * 4. Sort by annual usage value (descending)
   * 5. Assign classifications based on cumulative percentage
   * 6. Save classifications and create history records
   * 7. Update cycle count schedules
   *
   * @returns Classification result with statistics
   */
  async calculateClassifications(): Promise<ClassificationResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // 1. Get settings
      const settings = await this.getOrCreateSettings();

      // 2. Get all active stock items
      const items = await this.getActiveStockItems();

      if (items.length === 0) {
        return {
          success: true,
          itemsClassified: 0,
          classifications: { A: 0, B: 0, C: 0, D: 0, UNCLASSIFIED: 0 },
          totalValue: new Decimal(0),
          executionTime: Date.now() - startTime,
        };
      }

      // 3. Calculate 12-month usage for each item
      const itemsWithUsage = await this.calculateItemUsage(items);

      // 4. Sort by annual usage value (descending)
      itemsWithUsage.sort((a, b) =>
        b.annualUsageValue.minus(a.annualUsageValue).toNumber(),
      );

      // 5. Assign classifications based on cumulative percentage
      const assignments = this.assignClassifications(itemsWithUsage, settings);

      // 6. Save classifications and create history records
      await this.saveClassifications(assignments);

      // 7. Update cycle count schedules
      await this.updateCycleCountSchedules();

      // 8. Calculate result statistics
      const classifications = assignments.reduce(
        (acc, a) => {
          acc[a.classification] = (acc[a.classification] || 0) + 1;
          return acc;
        },
        {} as Record<ABCClassification, number>,
      );

      const totalValue = itemsWithUsage.reduce(
        (sum, item) => sum.plus(item.annualUsageValue),
        new Decimal(0),
      );

      return {
        success: true,
        itemsClassified: assignments.length,
        classifications: {
          A: classifications.A || 0,
          B: classifications.B || 0,
          C: classifications.C || 0,
          D: classifications.D || 0,
          UNCLASSIFIED: classifications.UNCLASSIFIED || 0,
        },
        totalValue,
        executionTime: Date.now() - startTime,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }

  /**
   * Trigger manual classification calculation
   *
   * @param userId - User triggering the calculation
   * @returns Classification result
   */
  async triggerManualCalculation(
    _userId: string,
  ): Promise<ClassificationResult> {
    return await this.calculateClassifications();
  }

  // ============================================================================
  // SETTINGS MANAGEMENT
  // ============================================================================

  /**
   * Get current classification settings
   *
   * @returns Current settings
   */
  async getSettings(): Promise<ABCClassificationSettings> {
    const settings = await this.prisma.aBCClassificationSettings.findFirst();

    if (!settings) {
      throw new NotFoundError("ABC Classification Settings", "default");
    }

    return settings;
  }

  /**
   * Update classification settings
   *
   * @param data - Settings update data
   * @param userId - User performing update
   * @returns Updated settings
   */
  async updateSettings(
    data: UpdateSettingsDTO,
    userId: string,
  ): Promise<ABCClassificationSettings> {
    // Validate input
    const { validateUpdateSettings } =
      await import("./abc-classification.types");
    const validatedData = validateUpdateSettings(data);

    // Get current settings
    const current = await this.prisma.aBCClassificationSettings.findFirst();

    if (!current) {
      // Create new settings if none exist
      return await this.prisma.aBCClassificationSettings.create({
        data: {
          ...validatedData,
          updatedBy: userId,
        },
      });
    }

    // Update existing settings
    return await this.prisma.aBCClassificationSettings.update({
      where: { id: current.id },
      data: {
        ...validatedData,
        updatedBy: userId,
      },
    });
  }

  /**
   * Get or create default settings
   *
   * @returns Settings
   */
  async getOrCreateSettings(): Promise<ABCClassificationSettings> {
    let settings = await this.prisma.aBCClassificationSettings.findFirst();

    // Create default settings if none exist
    settings ??= await this.prisma.aBCClassificationSettings.create({
      data: {
        aThreshold: new Decimal(70),
        bThreshold: new Decimal(90),
        cThreshold: new Decimal(98),
        aFrequency: 60,
        bFrequency: 120,
        cFrequency: 180,
        dFrequency: 365,
        rollingMonths: 12,
        autoCalculate: true,
        calculationDay: 1,
        updatedBy: "system",
      },
    });

    return settings;
  }

  // ============================================================================
  // REPORTING METHODS
  // ============================================================================

  /**
   * Get comprehensive classification report
   *
   * @param query - Report query parameters
   * @returns Classification report
   */
  async getClassificationReport(
    query?: ClassificationReportQueryDTO,
  ): Promise<ClassificationReport> {
    const { validateClassificationReportQuery } =
      await import("./abc-classification.types");
    const validatedQuery = query
      ? validateClassificationReportQuery(query)
      : {};

    // Build where clause
    const where: Prisma.InventoryItemWhereInput = {
      isActive: true,
      isStockItem: true,
      isArchived: false,
    };

    if (validatedQuery.storeId) {
      where.stock = {
        some: { storeId: validatedQuery.storeId },
      };
    }

    if (validatedQuery.classification) {
      where.abcClassification = validatedQuery.classification;
    }

    // Get items
    const items = await this.prisma.inventoryItem.findMany({
      where,
      select: {
        id: true,
        abcClassification: true,
        annualUsageValue: true,
        lastClassifiedAt: true,
        nextCycleCountDate: true,
      },
    });

    // Calculate summary
    const totalItems = items.length;
    const totalValue = items.reduce(
      (sum, item) => sum.plus(item.annualUsageValue ?? 0),
      new Decimal(0),
    );
    const lastCalculated = items.reduce(
      (latest, item) => {
        if (!item.lastClassifiedAt) return latest;
        if (!latest) return item.lastClassifiedAt;
        return item.lastClassifiedAt > latest ? item.lastClassifiedAt : latest;
      },
      null as Date | null,
    );

    // Calculate distribution
    const distribution = await this.getDistribution();

    // Calculate items due
    const now = new Date();
    const itemsDue = [
      ABCClassification.A,
      ABCClassification.B,
      ABCClassification.C,
      ABCClassification.D,
      ABCClassification.UNCLASSIFIED,
    ].map((classification) => {
      const classItems = items.filter(
        (i) => i.abcClassification === classification,
      );
      const dueItems = classItems.filter(
        (i) => i.nextCycleCountDate && new Date(i.nextCycleCountDate) <= now,
      );
      const overdueItems = classItems.filter(
        (i) => i.nextCycleCountDate && new Date(i.nextCycleCountDate) < now,
      );

      return {
        classification,
        count: dueItems.length,
        overdue: overdueItems.length,
      };
    });

    return {
      summary: {
        totalItems,
        totalValue,
        lastCalculated,
      },
      distribution,
      itemsDue,
    };
  }

  /**
   * Get classification distribution
   *
   * @returns Distribution by classification
   */
  async getDistribution(): Promise<ClassificationDistribution[]> {
    const items = await this.prisma.inventoryItem.groupBy({
      by: ["abcClassification"],
      where: {
        isActive: true,
        isStockItem: true,
      },
      _count: true,
      _sum: {
        annualUsageValue: true,
      },
    });

    const totalValue = items.reduce(
      (sum, item) => sum + Number(item._sum.annualUsageValue ?? 0),
      0,
    );

    return items.map((item) => {
      const value = new Decimal(item._sum.annualUsageValue ?? 0);
      const count = item._count;

      return {
        classification:
          item.abcClassification ?? ABCClassification.UNCLASSIFIED,
        itemCount: count,
        totalValue: value,
        percentOfTotal: totalValue > 0 ? (Number(value) / totalValue) * 100 : 0,
        averageValue: count > 0 ? value.dividedBy(count) : new Decimal(0),
      };
    });
  }

  /**
   * Get items by classification
   *
   * @param classification - Classification to filter by
   * @param storeId - Optional store filter
   * @returns Items with classification details
   */
  async getItemsByClassification(
    classification: ABCClassification,
    storeId?: string,
  ): Promise<ItemWithClassification[]> {
    const where: Prisma.InventoryItemWhereInput = {
      isActive: true,
      isStockItem: true,
      abcClassification: classification,
    };

    if (storeId) {
      where.stock = {
        some: { storeId },
      };
    }

    const items = await this.prisma.inventoryItem.findMany({
      where,
      take: 10000,
      include: {
        usageStatistics: {
          orderBy: { periodStart: "desc" },
          take: 12,
        },
        classificationHistory: {
          orderBy: { classificationDate: "desc" },
          take: 5,
        },
      },
    });

    return items as ItemWithClassification[];
  }

  // ============================================================================
  // ITEMS DUE FOR COUNT
  // ============================================================================

  /**
   * Get items due for cycle count
   *
   * @param query - Query parameters
   * @returns Items due for count
   */
  async getItemsDueForCount(
    query?: ItemsDueQueryDTO,
  ): Promise<ItemWithClassification[]> {
    const { validateItemsDueQuery } =
      await import("./abc-classification.types");
    const validatedQuery = query ? validateItemsDueQuery(query) : {};

    const now = new Date();
    const where: Prisma.InventoryItemWhereInput = {
      isActive: true,
      isStockItem: true,
      isArchived: false,
      nextCycleCountDate: {
        lte: validatedQuery.overdueDays
          ? new Date(
              now.getTime() - validatedQuery.overdueDays * 24 * 60 * 60 * 1000,
            )
          : now,
      },
    };

    if (validatedQuery.storeId) {
      where.stock = {
        some: { storeId: validatedQuery.storeId },
      };
    }

    if (validatedQuery.classification) {
      where.abcClassification = validatedQuery.classification;
    }

    const items = await this.prisma.inventoryItem.findMany({
      where,
      take: 10000,
      include: {
        usageStatistics: {
          orderBy: { periodStart: "desc" },
          take: 12,
        },
        classificationHistory: {
          orderBy: { classificationDate: "desc" },
          take: 5,
        },
      },
      orderBy: [{ abcClassification: "asc" }, { nextCycleCountDate: "asc" }],
    });

    return items as ItemWithClassification[];
  }

  /**
   * Get overdue items
   *
   * @param days - Number of days overdue (default: 0)
   * @returns Overdue items
   */
  async getOverdueItems(days: number = 0): Promise<ItemWithClassification[]> {
    return await this.getItemsDueForCount({ overdueDays: days });
  }

  // ============================================================================
  // CLASSIFICATION HISTORY
  // ============================================================================

  /**
   * Get classification history for an item
   *
   * @param itemId - Item ID
   * @param limit - Maximum number of records (default: 10)
   * @returns Classification history
   */
  async getClassificationHistory(
    itemId: string,
    limit: number = 10,
  ): Promise<InventoryClassificationHistory[]> {
    return await this.prisma.inventoryClassificationHistory.findMany({
      where: { inventoryItemId: itemId },
      orderBy: { classificationDate: "desc" },
      take: limit,
    });
  }

  // ============================================================================
  // USAGE STATISTICS
  // ============================================================================

  /**
   * Aggregate monthly usage statistics
   *
   * This should be run at the end of each month to aggregate transaction data.
   *
   * @param periodStart - Start of period
   * @param periodEnd - End of period
   */
  async aggregateMonthlyUsage(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    // Process items in batches to avoid loading all items + N+1 transaction queries
    const BATCH_SIZE = 200;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          isActive: true,
          isStockItem: true,
        },
        select: { id: true, unitCost: true },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });

      if (items.length < BATCH_SIZE) {
        hasMore = false;
      }
      if (items.length === 0) break;

      const lastItem = items[items.length - 1];
      if (!lastItem) break;
      cursor = lastItem.id;

      // Batch-fetch all transactions for this batch of items in one query
      const itemIds = items.map((i) => i.id);
      const allTransactions = await this.prisma.inventoryTransaction.findMany({
        where: {
          inventoryItemId: { in: itemIds },
          transactionDate: {
            gte: periodStart,
            lte: periodEnd,
          },
          isActive: true,
        },
        select: {
          inventoryItemId: true,
          transactionType: true,
          quantity: true,
          unitCost: true,
        },
      });

      // Group transactions by item
      const txByItem = new Map<string, typeof allTransactions>();
      for (const tx of allTransactions) {
        const list = txByItem.get(tx.inventoryItemId) ?? [];
        list.push(tx);
        txByItem.set(tx.inventoryItemId, list);
      }

      for (const item of items) {
        const transactions = txByItem.get(item.id) ?? [];

        // Calculate metrics
        const issues = transactions.filter((t) => t.transactionType === "ISSUE");
        const receipts = transactions.filter(
          (t) => t.transactionType === "RECEIPT",
        );
        const adjustments = transactions.filter(
          (t) => t.transactionType === "ADJUSTMENT",
        );

        const issueQuantity = issues.reduce(
          (sum, t) => sum.plus(t.quantity),
          new Decimal(0),
        );
        const issueValue = issues.reduce(
          (sum, t) => sum.plus(t.quantity.times(t.unitCost ?? item.unitCost)),
          new Decimal(0),
        );
        const receiptQuantity = receipts.reduce(
          (sum, t) => sum.plus(t.quantity),
          new Decimal(0),
        );

        // Create or update statistic
        await this.prisma.inventoryUsageStatistic.upsert({
          where: {
            inventoryItemId_periodStart: {
              inventoryItemId: item.id,
              periodStart,
            },
          },
          create: {
            inventoryItemId: item.id,
            periodStart,
            periodEnd,
            issueCount: issues.length,
            issueQuantity,
            issueValue,
            receiptCount: receipts.length,
            receiptQuantity,
            adjustmentCount: adjustments.length,
            averageUnitCost: item.unitCost,
          },
          update: {
            periodEnd,
            issueCount: issues.length,
            issueQuantity,
            issueValue,
            receiptCount: receipts.length,
            receiptQuantity,
            adjustmentCount: adjustments.length,
            averageUnitCost: item.unitCost,
          },
        });
      }
    }
  }

  /**
   * Calculate 12-month usage for an item
   *
   * @param itemId - Item ID
   * @returns Usage quantity and value
   */
  async calculate12MonthUsage(
    itemId: string,
  ): Promise<{ quantity: Decimal; value: Decimal }> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: {
        inventoryItemId: itemId,
        transactionType: "ISSUE",
        transactionDate: { gte: twelveMonthsAgo },
        isActive: true,
      },
      select: {
        quantity: true,
        unitCost: true,
      },
    });

    const totalQuantity = transactions.reduce(
      (sum, t) => sum.plus(t.quantity),
      new Decimal(0),
    );

    const totalValue = transactions.reduce(
      (sum, t) => sum.plus(t.quantity.times(t.unitCost ?? 0)),
      new Decimal(0),
    );

    return { quantity: totalQuantity, value: totalValue };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Get all active stock items
   */
  private async getActiveStockItems(): Promise<
    Array<{
      id: string;
      sku: string;
      description: string;
      unitCost: Decimal;
      abcClassification: ABCClassification | null;
    }>
  > {
    return await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        isStockItem: true,
        isArchived: false,
      },
      select: {
        id: true,
        sku: true,
        description: true,
        unitCost: true,
        abcClassification: true,
      },
    });
  }

  /**
   * Calculate usage for all items
   */
  private async calculateItemUsage(
    items: Array<{
      id: string;
      sku: string;
      description: string;
      unitCost: Decimal;
      abcClassification: ABCClassification | null;
    }>,
  ): Promise<ItemUsageData[]> {
    const itemsWithUsage: ItemUsageData[] = [];

    for (const item of items) {
      const usage = await this.calculate12MonthUsage(item.id);

      itemsWithUsage.push({
        itemId: item.id,
        sku: item.sku,
        description: item.description,
        unitCost: item.unitCost,
        annualUsageQuantity: usage.quantity,
        annualUsageValue: usage.value,
        currentClassification: item.abcClassification,
      });
    }

    return itemsWithUsage;
  }

  /**
   * Assign classifications based on cumulative percentage
   */
  private assignClassifications(
    itemsWithUsage: ItemUsageData[],
    settings: ABCClassificationSettings,
  ): ClassificationAssignment[] {
    const totalValue = itemsWithUsage.reduce(
      (sum, item) => sum.plus(item.annualUsageValue),
      new Decimal(0),
    );

    if (totalValue.isZero()) {
      // All items get UNCLASSIFIED if no usage
      return itemsWithUsage.map((item) => ({
        itemId: item.itemId,
        classification: ABCClassification.UNCLASSIFIED,
        frequency: settings.dFrequency,
        annualUsageQuantity: item.annualUsageQuantity,
        annualUsageValue: item.annualUsageValue,
        percentileRank: new Decimal(0),
      }));
    }

    let cumulativeValue = new Decimal(0);

    return itemsWithUsage.map((item) => {
      cumulativeValue = cumulativeValue.plus(item.annualUsageValue);
      const percentileRank = cumulativeValue.dividedBy(totalValue).times(100);

      let classification: ABCClassification;
      let frequency: number;

      if (percentileRank.lte(settings.aThreshold)) {
        classification = ABCClassification.A;
        frequency = settings.aFrequency;
      } else if (percentileRank.lte(settings.bThreshold)) {
        classification = ABCClassification.B;
        frequency = settings.bFrequency;
      } else if (percentileRank.lte(settings.cThreshold)) {
        classification = ABCClassification.C;
        frequency = settings.cFrequency;
      } else {
        classification = ABCClassification.D;
        frequency = settings.dFrequency;
      }

      return {
        itemId: item.itemId,
        classification,
        frequency,
        annualUsageQuantity: item.annualUsageQuantity,
        annualUsageValue: item.annualUsageValue,
        percentileRank,
      };
    });
  }

  /**
   * Save classifications and create history records
   */
  private async saveClassifications(
    assignments: ClassificationAssignment[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const assignment of assignments) {
        // Get current classification
        const currentItem = await tx.inventoryItem.findUnique({
          where: { id: assignment.itemId },
          select: { abcClassification: true },
        });

        // Update item
        await tx.inventoryItem.update({
          where: { id: assignment.itemId },
          data: {
            abcClassification: assignment.classification,
            lastClassifiedAt: new Date(),
            annualUsageQuantity: assignment.annualUsageQuantity,
            annualUsageValue: assignment.annualUsageValue,
            cycleCountFrequencyDays: assignment.frequency,
          },
        });

        // Create history record
        await tx.inventoryClassificationHistory.create({
          data: {
            inventoryItemId: assignment.itemId,
            previousClassification: currentItem?.abcClassification ?? null,
            newClassification: assignment.classification,
            annualUsageQuantity: assignment.annualUsageQuantity,
            annualUsageValue: assignment.annualUsageValue,
            percentileRank: assignment.percentileRank,
            classificationRules: {
              frequency: assignment.frequency,
              percentileRank: assignment.percentileRank.toNumber(),
            },
            calculatedBy: "system",
          },
        });
      }
    });
  }

  /**
   * Update cycle count schedules based on classifications
   */
  private async updateCycleCountSchedules(): Promise<void> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        isStockItem: true,
        cycleCountFrequencyDays: { not: null },
      },
      select: {
        id: true,
        cycleCountFrequencyDays: true,
        lastCycleCountDate: true,
      },
    });

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (!item.cycleCountFrequencyDays) continue;

        // Calculate next cycle count date
        const baseDate = item.lastCycleCountDate ?? new Date();
        const nextDate = new Date(baseDate);
        nextDate.setDate(nextDate.getDate() + item.cycleCountFrequencyDays);

        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { nextCycleCountDate: nextDate },
        });
      }
    });
  }
}

// Export singleton instance
const globalForABCClassification = globalThis as unknown as { abcClassificationService: ABCClassificationService | undefined };
export const abcClassificationService = globalForABCClassification.abcClassificationService ?? (globalForABCClassification.abcClassificationService = new ABCClassificationService(prisma));
