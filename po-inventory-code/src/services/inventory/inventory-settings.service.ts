/**
 * Inventory Settings Service
 *
 * Service for managing global inventory module configuration settings.
 * Controls:
 *   - allowOutsideRepair: enables/disables the outside repair workflow
 *   - assemblyTrackingEnabled: enables assembly BOM learning and sub-serial
 *     parent tracking when Direct Issues are made to assembly repair WOs
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
import { z } from "zod";

// ============================================================================
// TYPES
// ============================================================================

export interface InventorySettings {
  id: string;
  allowOutsideRepair: boolean;
  /** When true, assembly BOM learning and sub-serial parentAssemblyId tracking are active. */
  assemblyTrackingEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
  updatedByName: string | null;
}

export interface InventorySettingsUpdateDTO {
  allowOutsideRepair?: boolean;
  assemblyTrackingEnabled?: boolean;
}

export const inventorySettingsUpdateSchema = z.object({
  allowOutsideRepair: z.boolean().optional(),
  assemblyTrackingEnabled: z.boolean().optional(),
});

// ============================================================================
// SERVICE CLASS
// ============================================================================

class InventorySettingsService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Get current inventory settings.
   * Creates default settings if none exist.
   */
  async getSettings(context: ServiceContext): Promise<InventorySettings> {
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    return this.getOrCreateSettings();
  }

  /**
   * Update inventory settings.
   * Requires settings:update permission.
   */
  async updateSettings(
    context: ServiceContext,
    data: InventorySettingsUpdateDTO,
  ): Promise<InventorySettings> {
    const permission = buildPermissionString(
      PermissionResource.SETTINGS,
      PermissionAction.UPDATE,
    );
    await checkPermission(context, permission);

    const validated = inventorySettingsUpdateSchema.parse(data);

    let settings = await this.prisma.inventorySettings.findFirst();

    if (!settings) {
      settings = await this.prisma.inventorySettings.create({
        data: {
          allowOutsideRepair: validated.allowOutsideRepair ?? true,
          assemblyTrackingEnabled: validated.assemblyTrackingEnabled ?? false,
          updatedBy: context.userId,
          updatedByName: context.userName,
        },
      });
    } else {
      settings = await this.prisma.inventorySettings.update({
        where: { id: settings.id },
        data: {
          ...validated,
          updatedBy: context.userId,
          updatedByName: context.userName,
        },
      });
    }

    return settings as InventorySettings;
  }

  /**
   * Get settings without permission check (for internal use in middleware/dialogs).
   * @internal
   */
  async getSettingsInternal(): Promise<InventorySettings> {
    return this.getOrCreateSettings();
  }

  private async getOrCreateSettings(): Promise<InventorySettings> {
    let settings = await this.prisma.inventorySettings.findFirst();

    settings ??= await this.prisma.inventorySettings.create({
      data: {
        allowOutsideRepair: true,
      },
    });

    return settings as InventorySettings;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

const globalForInventorySettings = globalThis as unknown as {
  inventorySettingsService: InventorySettingsService | undefined;
};
export const inventorySettingsService =
  globalForInventorySettings.inventorySettingsService ??
  (globalForInventorySettings.inventorySettingsService =
    new InventorySettingsService(prisma));
