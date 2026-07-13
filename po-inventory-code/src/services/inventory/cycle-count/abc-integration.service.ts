/**
 * ABC Cycle Count Integration Service
 *
 * Dedicated service for integrating ABC classification with cycle count system.
 * Handles automatic cycle count generation based on ABC classifications and
 * manages the lifecycle of ABC-driven counts.
 *
 * Key Features:
 * - Scheduled cycle count generation from ABC classifications
 * - Classification-based count creation
 * - Next count date management
 * - Recommended schedule calculation
 *
 * @module abc-integration.service
 */

import { PrismaClient, ABCClassification } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BadRequestError, NotFoundError } from "@/lib/api-errors";
import { masterCycleCountService } from "./master-cycle-count.service";
import { abcClassificationService } from "../abc-classification/abc-classification.service";
import type { MasterCycleCountWithRelations } from "./master-cycle-count.types";

/**
 * Result of scheduled cycle count generation
 */
interface ScheduledGenerationResult {
  countsCreated: number;
  itemsIncluded: number;
  stores: string[];
  errors?: string[];
}

/**
 * Recommended schedule for a classification
 */
interface RecommendedSchedule {
  classification: ABCClassification;
  itemCount: number;
  nextDueDate: Date | null;
  frequency: number;
}

/**
 * ABC Cycle Count Integration Service Class
 *
 * Provides integration between ABC classification and cycle count systems.
 */
class ABCCycleCountIntegrationService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // ============================================================================
  // SCHEDULED GENERATION
  // ============================================================================

  /**
   * Generate cycle counts for all stores based on ABC classification
   * This is the main method called by the scheduled job
   *
   * @returns Generation result with statistics
   */
  async generateScheduledCycleCounts(): Promise<ScheduledGenerationResult> {
    const errors: string[] = [];
    let totalCountsCreated = 0;
    let totalItemsIncluded = 0;
    const storesProcessed: string[] = [];

    try {
      // 1. Get all active stores
      const stores = await this.prisma.store.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });

      if (stores.length === 0) {
        return {
          countsCreated: 0,
          itemsIncluded: 0,
          stores: [],
          errors: ["No active stores found"],
        };
      }

      // 2. For each store, get items due for count
      for (const store of stores) {
        try {
          const itemsDue = await abcClassificationService.getItemsDueForCount({
            storeId: store.id,
          });

          if (itemsDue.length === 0) {
            continue; // No items due for this store
          }

          // 3. Group items by classification
          const itemsByClassification =
            this.groupItemsByClassification(itemsDue);

          // 4. Create separate cycle counts for each classification
          for (const [classification, items] of Object.entries(
            itemsByClassification,
          )) {
            if (items.length === 0) continue;

            try {
              await this.createCountForClassification(
                store.id,
                classification as ABCClassification,
                "system", // System-generated counts
              );

              totalCountsCreated++;
              totalItemsIncluded += items.length;

              if (!storesProcessed.includes(store.id)) {
                storesProcessed.push(store.id);
              }
            } catch (error) {
              errors.push(
                `Failed to create count for ${store.name} - ${classification}: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              );
            }
          }
        } catch (error) {
          errors.push(
            `Failed to process store ${store.name}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
        }
      }

      return {
        countsCreated: totalCountsCreated,
        itemsIncluded: totalItemsIncluded,
        stores: storesProcessed,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      errors.push(
        `Fatal error in scheduled generation: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Create cycle count for specific classification
   *
   * @param storeId - Store ID
   * @param classification - ABC classification
   * @param userId - User creating the count
   * @returns Created cycle count
   */
  async createCountForClassification(
    storeId: string,
    classification: ABCClassification,
    userId: string,
  ): Promise<MasterCycleCountWithRelations> {
    // Get items due for this classification
    const itemsDue = await abcClassificationService.getItemsDueForCount({
      storeId,
      classification,
    });

    if (itemsDue.length === 0) {
      throw new BadRequestError(
        `No items due for count in classification ${classification}`,
      );
    }

    // Get store info
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true, code: true },
    });

    if (!store) {
      throw new NotFoundError("Store", storeId);
    }

    // Create cycle count using master service
    const cycleCount = await masterCycleCountService.createCycleCount(
      {
        title: `ABC ${classification} Classification Count - ${store.name}`,
        description: `Automatic cycle count for ${classification} classification items due for count`,
        storeId,
        notes: `Auto-generated from ABC classification. ${itemsDue.length} items included.`,
      },
      userId,
    );

    // Add audit entry noting ABC-driven creation
    await this.prisma.masterCycleCountAudit.create({
      data: {
        cycleCountId: cycleCount.id,
        action: "ABC_GENERATED",
        performedBy: userId,
        performedAt: new Date(),
        newValue: {
          classification,
          itemCount: itemsDue.length,
          source: "ABC Classification System",
        },
        notes: `Cycle count automatically generated from ABC classification ${classification}`,
      },
    });

    return cycleCount;
  }

  // ============================================================================
  // SCHEDULE MANAGEMENT
  // ============================================================================

  /**
   * Get recommended cycle count schedule for a store
   *
   * @param storeId - Store ID
   * @returns Recommended schedule by classification
   */
  async getRecommendedSchedule(
    storeId: string,
  ): Promise<RecommendedSchedule[]> {
    const classifications = [
      ABCClassification.A,
      ABCClassification.B,
      ABCClassification.C,
      ABCClassification.D,
      ABCClassification.UNCLASSIFIED,
    ];

    const schedules: RecommendedSchedule[] = [];

    for (const classification of classifications) {
      // Get items for this classification in this store
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          isActive: true,
          isStockItem: true,
          isArchived: false,
          abcClassification: classification,
          stock: {
            some: { storeId },
          },
        },
        select: {
          id: true,
          nextCycleCountDate: true,
          cycleCountFrequencyDays: true,
        },
      });

      if (items.length === 0) {
        continue;
      }

      // Find earliest next due date
      const nextDueDate = items.reduce(
        (earliest, item) => {
          if (!item.nextCycleCountDate) return earliest;
          if (!earliest) return item.nextCycleCountDate;
          return item.nextCycleCountDate < earliest
            ? item.nextCycleCountDate
            : earliest;
        },
        null as Date | null,
      );

      // Get frequency from first item (all items in same classification should have same frequency)
      const frequency = items[0]?.cycleCountFrequencyDays ?? 0;

      schedules.push({
        classification,
        itemCount: items.length,
        nextDueDate,
        frequency,
      });
    }

    return schedules.sort((a, b) => {
      // Sort by next due date (earliest first), then by classification
      if (!a.nextDueDate && !b.nextDueDate) return 0;
      if (!a.nextDueDate) return 1;
      if (!b.nextDueDate) return -1;
      return a.nextDueDate.getTime() - b.nextDueDate.getTime();
    });
  }

  // ============================================================================
  // NEXT COUNT DATE MANAGEMENT
  // ============================================================================

  /**
   * Update item's next count date after cycle count completion
   *
   * @param itemId - Item ID
   */
  async updateNextCountDate(itemId: string): Promise<void> {
    // 1. Get item's classification and frequency
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        abcClassification: true,
        cycleCountFrequencyDays: true,
      },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    if (!item.cycleCountFrequencyDays) {
      // No frequency set, skip update
      return;
    }

    // 2. Calculate next count date based on frequency
    const now = new Date();
    const nextDate = new Date(now);
    nextDate.setDate(nextDate.getDate() + item.cycleCountFrequencyDays);

    // 3. Update item's next count date and last count date
    await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: {
        lastCycleCountDate: now,
        nextCycleCountDate: nextDate,
      },
    });
  }

  /**
   * Update next count dates for all items in a cycle count
   * Called after posting a cycle count
   *
   * @param cycleCountId - Cycle count ID
   */
  async updateNextCountDatesForCount(cycleCountId: string): Promise<void> {
    // Get all items in the cycle count
    const countItems = await this.prisma.masterCycleCountItem.findMany({
      where: { cycleCountId },
      select: { inventoryItemId: true },
    });

    // Update next count date for each item
    await Promise.all(
      countItems.map((item) => this.updateNextCountDate(item.inventoryItemId)),
    );
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Group items by classification
   *
   * @param items - Items to group
   * @returns Items grouped by classification
   */
  private groupItemsByClassification(
    items: Array<{ id: string; abcClassification: ABCClassification | null }>,
  ): Record<
    string,
    Array<{ id: string; abcClassification: ABCClassification | null }>
  > {
    return items.reduce(
      (groups, item) => {
        const classification =
          item.abcClassification ?? ABCClassification.UNCLASSIFIED;
        groups[classification] ??= [];
        groups[classification].push(item);
        return groups;
      },
      {} as Record<
        string,
        Array<{ id: string; abcClassification: ABCClassification | null }>
      >,
    );
  }
}

// Export singleton instance
export const abcCycleCountIntegrationService =
  new ABCCycleCountIntegrationService(prisma);
