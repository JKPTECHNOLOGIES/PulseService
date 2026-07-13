/**
 * Reservation Settings Service
 *
 * Service for managing configurable reservation behavior settings
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { checkPermission } from "@/services/shared/permissions";
import {
  PermissionResource,
  PermissionAction,
  buildPermissionString,
} from "@/types/permissions";

import {
  ReservationSettings,
  ReservationSettingsUpdateDTO,
  ReservationMode,
  StockCheckResult,
  ReservationDecision,
  reservationSettingsUpdateSchema,
} from "./reservation-settings.types";

/**
 * Reservation Settings Service Class
 */
class ReservationSettingsService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Get current reservation settings
   * Creates default settings if none exist
   */
  async getSettings(context: ServiceContext): Promise<ReservationSettings> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get or create settings
    let settings = await this.prisma.reservationSettings.findFirst();

    // Create default settings if none exist
    settings ??= await this.prisma.reservationSettings.create({
      data: {
        mode: ReservationMode.TIME_BASED,
        daysThreshold: 30,
        promptOnStockShortage: true,
        promptOnMinQty: true,
        autoCreateReq: true,
      },
    });

    return settings as ReservationSettings;
  }

  /**
   * Update reservation settings
   */
  async updateSettings(
    context: ServiceContext,
    data: ReservationSettingsUpdateDTO,
  ): Promise<ReservationSettings> {
    // Check permission - require settings update permission
    const permission = buildPermissionString(
      PermissionResource.SETTINGS,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    // Validate data
    const validated = reservationSettingsUpdateSchema.parse(data);

    // Get current settings
    let settings = await this.prisma.reservationSettings.findFirst();

    if (!settings) {
      // Create with provided data
      settings = await this.prisma.reservationSettings.create({
        data: {
          mode: validated.mode ?? ReservationMode.TIME_BASED,
          daysThreshold: validated.daysThreshold ?? 30,
          promptOnStockShortage: validated.promptOnStockShortage ?? true,
          promptOnMinQty: validated.promptOnMinQty ?? true,
          autoCreateReq: validated.autoCreateReq ?? true,
          updatedBy: context.userId,
          updatedByName: context.userId, // Will be populated by frontend
        },
      });
    } else {
      // Update existing settings
      settings = await this.prisma.reservationSettings.update({
        where: { id: settings.id },
        data: {
          ...validated,
          updatedBy: context.userId,
          updatedByName: context.userId, // Will be populated by frontend
        },
      });
    }

    return settings as ReservationSettings;
  }

  /**
   * Check if stock reservation should prompt planner
   *
   * @param _inventoryItemId - Inventory item ID
   * @param requestedQty - Quantity being requested
   * @param currentOnHand - Current on-hand quantity
   * @param currentReserved - Current reserved quantity
   * @param minQty - Minimum quantity threshold
   * @returns Stock check result
   */
  checkStockForPrompt(
    _inventoryItemId: string,
    requestedQty: number,
    currentOnHand: number,
    currentReserved: number,
    minQty: number,
  ): StockCheckResult {
    const availableQty = currentOnHand - currentReserved;
    const qtyAfterReservation = availableQty - requestedQty;

    // Check if requesting more than available
    if (requestedQty > availableQty) {
      const shortageQty = requestedQty - availableQty;
      return {
        shouldPrompt: true,
        reason: "STOCK_SHORTAGE",
        currentStock: currentOnHand,
        requestedQty,
        minQty,
        availableQty,
        shortageQty,
        message: `Insufficient stock: Requesting ${requestedQty} but only ${availableQty} available. Shortage: ${shortageQty}`,
      };
    }

    // Prompt when reservation causes stock to reach OR go below minimum (use <= not <).
    // This aligns the planner warning with the actual auto-req trigger in
    // checkStockLevelsAndNotify() which was fixed to <= in the same patch.
    // Previously, landing exactly at min showed no warning but still fired an auto-req.
    if (qtyAfterReservation <= minQty) {
      return {
        shouldPrompt: true,
        reason: "MIN_QTY_HIT",
        currentStock: currentOnHand,
        requestedQty,
        minQty,
        availableQty,
        message: `Stock will reach or fall below minimum: After reservation, stock will be ${qtyAfterReservation} (min: ${minQty})`,
      };
    }

    // No issues
    return {
      shouldPrompt: false,
      reason: "NONE",
      currentStock: currentOnHand,
      requestedQty,
      minQty,
      availableQty,
      message: "Sufficient stock available",
    };
  }

  /**
   * Make reservation decision based on settings
   *
   * @param context - Service context
   * @param plannedStartDate - Work order planned start date
   * @param stockCheckResult - Result of stock check
   * @returns Reservation decision
   */
  async makeReservationDecision(
    context: ServiceContext,
    plannedStartDate: Date | null,
    stockCheckResult?: StockCheckResult,
  ): Promise<ReservationDecision> {
    const settings = await this.getSettings(context);

    // MODE: TIME_BASED (current 30-day logic)
    if (settings.mode === ReservationMode.TIME_BASED) {
      if (!plannedStartDate) {
        return {
          shouldReserveStock: false,
          shouldPromptPlanner: false,
          reason: "No planned start date - using TIME_BASED mode",
        };
      }

      const daysUntilStart = Math.ceil(
        (plannedStartDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilStart > settings.daysThreshold) {
        return {
          shouldReserveStock: false,
          shouldPromptPlanner: false,
          reason: `Long-lead (${daysUntilStart} days > ${settings.daysThreshold} threshold) - using TIME_BASED mode`,
        };
      }

      return {
        shouldReserveStock: true,
        shouldPromptPlanner: false,
        reason: `Short-lead (${daysUntilStart} days ≤ ${settings.daysThreshold} threshold) - using TIME_BASED mode`,
      };
    }

    // MODE: PROMPT_BASED (new behavior) - must be PROMPT_BASED after TIME_BASED check above
    {
      // Check if we should prompt based on stock conditions
      if (stockCheckResult) {
        const shouldPrompt =
          (stockCheckResult.reason === "STOCK_SHORTAGE" &&
            settings.promptOnStockShortage) ||
          (stockCheckResult.reason === "MIN_QTY_HIT" &&
            settings.promptOnMinQty);

        if (shouldPrompt) {
          return {
            shouldReserveStock: false, // Don't reserve until planner confirms
            shouldPromptPlanner: true,
            stockCheckResult,
            reason: `Stock issue detected (${stockCheckResult.reason}) - prompting planner`,
          };
        }
      }

      // No stock issues, proceed with reservation
      return {
        shouldReserveStock: true,
        shouldPromptPlanner: false,
        stockCheckResult,
        reason:
          "No stock issues - proceeding with reservation in PROMPT_BASED mode",
      };
    }
  }

  /**
   * Get settings without permission check (for internal use)
   * @internal
   */
  async getSettingsInternal(): Promise<ReservationSettings> {
    let settings = await this.prisma.reservationSettings.findFirst();

    // Create default settings if none exist
    settings ??= await this.prisma.reservationSettings.create({
      data: {
        mode: ReservationMode.TIME_BASED,
        daysThreshold: 30,
        promptOnStockShortage: true,
        promptOnMinQty: true,
        autoCreateReq: true,
      },
    });

    return settings as ReservationSettings;
  }
}

// Export singleton instance
const globalForReservationSettings = globalThis as unknown as {
  reservationSettingsService: ReservationSettingsService | undefined;
};
export const reservationSettingsService =
  globalForReservationSettings.reservationSettingsService ??
  (globalForReservationSettings.reservationSettingsService =
    new ReservationSettingsService(prisma));
