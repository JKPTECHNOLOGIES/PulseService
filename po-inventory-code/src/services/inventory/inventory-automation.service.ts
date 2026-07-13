/**
 * Inventory Automation Service
 *
 * Service layer for inventory automation operations including
 * auto-reorder, supplier selection, PO generation, and optimization.
 */

import { PrismaClient } from "@prisma/client";
import { CrudService } from "@/services/base/crud.service";
import {
  ServiceContext,
  ValidationResult,
  ServiceConfig,
} from "@/services/base/types";
import { notificationService } from "@/services/notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { INVENTORY_NOTIFICATIONS } from "@/services/notifications/notification-types-registry";
import {
  InventoryAutomationRuleCreateDTO,
  InventoryAutomationRuleUpdateDTO,
  InventoryAutomationRuleWithRelations,
  AutomationRecommendation,
  AutomationTrigger,
  AutomationAction,
  inventoryAutomationRuleCreateSchema,
  inventoryAutomationRuleUpdateSchema,
  validateRuleConditions,
  validateRuleActions,
} from "./inventory-automation.types";
import { prisma } from "@/lib/prisma";
import { PermissionResource } from "@/types/permissions";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";

/**
 * Inventory Automation Service Class
 *
 * Manages automation rules and recommendations for inventory management.
 */
class InventoryAutomationService extends CrudService<
  InventoryAutomationRuleWithRelations,
  InventoryAutomationRuleCreateDTO,
  InventoryAutomationRuleUpdateDTO
> {
  constructor(prismaClient: PrismaClient) {
    const config: ServiceConfig = {
      resourceName: "Inventory Automation Rule",
      permissions: {
        read: `${PermissionResource.INVENTORY}:read`,
        create: `${PermissionResource.INVENTORY}:create`,
        update: `${PermissionResource.INVENTORY}:update`,
        delete: `${PermissionResource.INVENTORY}:delete`,
      },
      softDelete: false,
      trackAudit: true,
      defaultLimit: 20,
      maxLimit: 100,
    };

    super(prismaClient, prismaClient.inventoryAutomationRule, config);
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  protected override validateCreate(
    data: InventoryAutomationRuleCreateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation =
      inventoryAutomationRuleCreateSchema.safeParse(data);
    if (!schemaValidation.success) {
      schemaValidation.error.issues.forEach((err) => {
        errors.push({
          field: err.path.join("."),
          message: err.message,
          code: err.code,
        });
      });
      return Promise.resolve({ valid: false, errors });
    }

    // Validate rule conditions
    if (!validateRuleConditions(data.trigger, data.conditions)) {
      errors.push({
        field: "conditions",
        message: "Invalid conditions for the specified trigger",
        code: "INVALID_CONDITIONS",
      });
    }

    // Validate rule actions
    if (!validateRuleActions(data.actions)) {
      errors.push({
        field: "actions",
        message: "Invalid actions configuration",
        code: "INVALID_ACTIONS",
      });
    }

    return Promise.resolve({
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  protected override async validateUpdate(
    id: string,
    data: InventoryAutomationRuleUpdateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation =
      inventoryAutomationRuleUpdateSchema.safeParse(data);
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

    // Get existing rule
    const rule = await this.prisma.inventoryAutomationRule.findUnique({
      where: { id },
    });

    if (!rule) {
      errors.push({
        field: "id",
        message: "Automation rule not found",
        code: "RULE_NOT_FOUND",
      });
      return { valid: false, errors };
    }

    // Validate conditions if provided
    if (data.trigger && data.conditions) {
      if (!validateRuleConditions(data.trigger, data.conditions)) {
        errors.push({
          field: "conditions",
          message: "Invalid conditions for the specified trigger",
          code: "INVALID_CONDITIONS",
        });
      }
    }

    // Validate actions if provided
    if (data.actions) {
      if (!validateRuleActions(data.actions)) {
        errors.push({
          field: "actions",
          message: "Invalid actions configuration",
          code: "INVALID_ACTIONS",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ============================================================================
  // DATA TRANSFORMATION
  // ============================================================================

  protected override transformCreateDTO(
    data: InventoryAutomationRuleCreateDTO,
    context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    return Promise.resolve({
      name: data.name,
      description: data.description ?? null,
      ruleType: data.ruleType,
      trigger: data.trigger,
      conditions: data.conditions,
      actions: data.actions,
      priority: data.priority,
      isActive: data.isActive,
      createdBy: context.userId,
      executionCount: 0,
    });
  }

  protected override transformUpdateDTO(
    data: InventoryAutomationRuleUpdateDTO,
    _context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    const transformed: Record<string, unknown> = {};

    if (data.name !== undefined) transformed.name = data.name;
    if (data.description !== undefined)
      transformed.description = data.description;
    if (data.trigger !== undefined) transformed.trigger = data.trigger;
    if (data.conditions !== undefined) transformed.conditions = data.conditions;
    if (data.actions !== undefined) transformed.actions = data.actions;
    if (data.priority !== undefined) transformed.priority = data.priority;
    if (data.isActive !== undefined) transformed.isActive = data.isActive;

    return Promise.resolve(transformed);
  }

  protected override transformModel(
    model: Record<string, unknown>,
  ): Promise<InventoryAutomationRuleWithRelations> {
    return Promise.resolve(
      model as unknown as InventoryAutomationRuleWithRelations,
    );
  }

  // ============================================================================
  // CUSTOM METHODS
  // ============================================================================

  /**
   * Activate automation rule
   */
  async activate(
    context: ServiceContext,
    id: string,
  ): Promise<InventoryAutomationRuleWithRelations> {
    await this.checkPermission(context, this.config.permissions.update);

    const rule = await this.prisma.inventoryAutomationRule.findUnique({
      where: { id },
    });

    if (!rule) {
      throw new NotFoundError("Automation Rule", id);
    }

    const updated = await this.prisma.inventoryAutomationRule.update({
      where: { id },
      data: { isActive: true },
    });

    return this.transformModel(updated);
  }

  /**
   * Deactivate automation rule
   */
  async deactivate(
    context: ServiceContext,
    id: string,
  ): Promise<InventoryAutomationRuleWithRelations> {
    await this.checkPermission(context, this.config.permissions.update);

    const rule = await this.prisma.inventoryAutomationRule.findUnique({
      where: { id },
    });

    if (!rule) {
      throw new NotFoundError("Automation Rule", id);
    }

    const updated = await this.prisma.inventoryAutomationRule.update({
      where: { id },
      data: { isActive: false },
    });

    return this.transformModel(updated);
  }

  /**
   * Find matching rules for a trigger
   */
  async findMatchingRules(
    context: ServiceContext,
    trigger: AutomationTrigger,
    itemData: Record<string, unknown>,
  ): Promise<InventoryAutomationRuleWithRelations[]> {
    await this.checkPermission(context, this.config.permissions.read);

    const rules = await this.prisma.inventoryAutomationRule.findMany({
      where: {
        trigger,
        isActive: true,
      },
      orderBy: { priority: "desc" },
    });

    // Filter rules based on conditions
    const matchingRules = rules.filter((rule) => {
      const conditions = rule.conditions as Record<string, unknown>;
      return this.evaluateConditions(conditions, itemData);
    });

    return Promise.all(
      matchingRules.map((rule) =>
        this.transformModel(rule as unknown as Record<string, unknown>),
      ),
    );
  }

  /**
   * Execute automation rule
   */
  async executeRule(
    context: ServiceContext,
    ruleId: string,
    itemId: string,
  ): Promise<{ success: boolean; results: unknown[] }> {
    await this.checkPermission(context, this.config.permissions.update);

    const rule = await this.prisma.inventoryAutomationRule.findUnique({
      where: { id: ruleId },
    });

    if (!rule) {
      throw new NotFoundError("Automation Rule", ruleId);
    }

    if (!rule.isActive) {
      throw new BadRequestError("Cannot execute inactive rule");
    }

    const actions = rule.actions as Array<{
      type: AutomationAction;
      parameters: Record<string, unknown>;
    }>;

    const results: unknown[] = [];

    for (const action of actions) {
      try {
        const result = await this.executeAction(context, action, itemId);
        results.push(result);
      } catch (error) {
        results.push({ error: (error as Error).message });
      }
    }

    // Update execution count
    await this.prisma.inventoryAutomationRule.update({
      where: { id: ruleId },
      data: {
        lastExecutedAt: new Date(),
        executionCount: { increment: 1 },
      },
    });

    return {
      success: results.every((r) => !(r as Record<string, unknown>).error),
      results,
    };
  }

  /**
   * Get automation recommendations
   */
  async getRecommendations(
    context: ServiceContext,
    itemId?: string,
  ): Promise<AutomationRecommendation[]> {
    await this.checkPermission(context, this.config.permissions.read);

    const where: Record<string, unknown> = {
      status: "pending",
    };

    if (itemId) {
      where.inventoryItemId = itemId;
    }

    const recommendations =
      await this.prisma.inventoryAutomationRecommendation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
      });

    return recommendations as AutomationRecommendation[];
  }

  /**
   * Apply automation recommendation
   */
  async applyRecommendation(
    context: ServiceContext,
    recommendationId: string,
  ): Promise<{ success: boolean; result: unknown }> {
    await this.checkPermission(context, this.config.permissions.update);

    const recommendation =
      await this.prisma.inventoryAutomationRecommendation.findUnique({
        where: { id: recommendationId },
      });

    if (!recommendation) {
      throw new NotFoundError("Recommendation", recommendationId);
    }

    if (recommendation.status !== "Pending") {
      throw new BadRequestError("Recommendation has already been processed");
    }

    const suggestedAction = recommendation.data as {
      type: string;
      parameters: Record<string, unknown>;
    };

    let result: unknown;

    try {
      // Execute the suggested action
      result = await this.executeRecommendationAction(
        context,
        suggestedAction,
        recommendation.inventoryItemId ?? "",
      );

      // Mark as applied
      await this.prisma.inventoryAutomationRecommendation.update({
        where: { id: recommendationId },
        data: {
          status: "applied",
          appliedAt: new Date(),
          appliedBy: context.userId,
        },
      });

      return { success: true, result };
    } catch (error) {
      return { success: false, result: { error: (error as Error).message } };
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Evaluate rule conditions against item data
   */
  private evaluateConditions(
    conditions: Record<string, unknown>,
    itemData: Record<string, unknown>,
  ): boolean {
    for (const [key, value] of Object.entries(conditions)) {
      const itemValue = itemData[key];

      if (typeof value === "object" && value !== null) {
        const operator = value as Record<string, unknown>;

        if (
          "$gt" in operator &&
          !((itemValue as number) > (operator.$gt as number))
        )
          return false;
        if (
          "$gte" in operator &&
          !((itemValue as number) >= (operator.$gte as number))
        )
          return false;
        if (
          "$lt" in operator &&
          !((itemValue as number) < (operator.$lt as number))
        )
          return false;
        if (
          "$lte" in operator &&
          !((itemValue as number) <= (operator.$lte as number))
        )
          return false;
        if ("$eq" in operator && itemValue !== operator.$eq) return false;
        if ("$ne" in operator && itemValue === operator.$ne) return false;
        if (
          "$in" in operator &&
          !(operator.$in as unknown[]).includes(itemValue)
        )
          return false;
      } else {
        if (itemValue !== value) return false;
      }
    }

    return true;
  }

  /**
   * Execute automation action
   */
  private executeAction(
    context: ServiceContext,
    action: { type: AutomationAction; parameters: Record<string, unknown> },
    itemId: string,
  ): Promise<unknown> {
    switch (action.type) {
      case AutomationAction.CREATE_REQUISITION:
        return this.createRequisitionAction(context, itemId, action.parameters);

      case AutomationAction.ADJUST_REORDER_POINT:
        return this.adjustReorderPointAction(
          context,
          itemId,
          action.parameters,
        );

      case AutomationAction.SEND_ALERT:
        return this.sendAlertAction(context, itemId, action.parameters);

      default:
        throw new BadRequestError(`Unsupported action type: ${action.type}`);
    }
  }

  /**
   * Execute recommendation action
   */
  private executeRecommendationAction(
    context: ServiceContext,
    action: { type: string; parameters: Record<string, unknown> },
    itemId: string,
  ): Promise<unknown> {
    // Similar to executeAction but for recommendations
    return this.executeAction(
      context,
      action as { type: AutomationAction; parameters: Record<string, unknown> },
      itemId,
    );
  }

  /**
   * Create requisition action
   */
  private async createRequisitionAction(
    context: ServiceContext,
    itemId: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    // Delegate to the CANONICAL reorder entry point so the pipeline-aware
    // quantity formula, dedup, supplier resolution, budget classification and
    // auto-submit all live in ONE place. (Previously this ordered the full
    // maxQuantity regardless of current stock or inbound pipeline.) Dynamic
    // import avoids the reorder.service ↔ inventory.service import cycle.
    const { inventoryReorderService } =
      await import("@/services/inventory/reorder.service");
    const result = (await inventoryReorderService.createReorderForItem(
      context,
      {
        inventoryItemId: itemId,
        source: "AUTOMATION",
        autoSubmit: !!parameters.autoSubmit,
        sourceNote: "Created by inventory automation rule.",
      },
    )) as { requisitionId: string; reqNumber: string } | null;

    // Pipeline already covered the shortfall (or item ineligible) — nothing
    // was created, so there is nothing to notify about.
    if (!result) {
      return { requisitionId: null };
    }

    // Send notification about auto-requisition creation
    try {
      // Find purchasing managers to notify
      const purchasingManagers = await this.prisma.user.findMany({
        where: {
          isActive: true,
          role: {
            permissions: {
              some: {
                permission: {
                  resource: "PURCHASING",
                  action: "update",
                },
              },
            },
          },
        },
        select: { id: true },
      });

      // Notify each purchasing manager
      for (const manager of purchasingManagers) {
        await notificationService.sendNotification(context, {
          userId: manager.id,
          type: INVENTORY_NOTIFICATIONS.AUTO_REQUISITION_CREATED.type,
          category: NotificationCategory.INVENTORY,
          title: `Auto-Requisition Created: ${item.sku}`,
          message: `An automatic requisition (${result.reqNumber}) has been created for ${item.description} due to low stock levels`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/requisitions/${result.requisitionId}`,
          actionLabel: "View Requisition",
          data: {
            requisitionId: result.requisitionId,
            reqNumber: result.reqNumber,
            inventoryItemId: itemId,
            sku: item.sku,
            description: item.description,
            estimatedUnitPrice: Number(item.unitCost),
            autoSubmitted: !!parameters.autoSubmit,
          },
        });
      }
    } catch (_error) {
      // Notification failure is non-critical
    }

    return { requisitionId: result.requisitionId, reqNumber: result.reqNumber };
  }

  /**
   * Adjust reorder point action
   */
  private async adjustReorderPointAction(
    _context: ServiceContext,
    itemId: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundError("Inventory Item", itemId);
    }

    const adjustmentFactor = parameters.adjustmentFactor as number;
    const newMinQuantity = Math.ceil(
      Number(item.minQuantity) * adjustmentFactor,
    );

    await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { minQuantity: newMinQuantity },
    });

    return {
      oldMinQuantity: Number(item.minQuantity),
      newMinQuantity,
      adjustmentFactor,
    };
  }

  /**
   * Send alert action
   */
  private sendAlertAction(
    _context: ServiceContext,
    _itemId: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    // This would integrate with notification service
    return Promise.resolve({
      alertSent: true,
      recipients: parameters.recipients,
    });
  }
}

// Export singleton instance
const globalForInventoryAutomation = globalThis as unknown as {
  inventoryAutomationService: InventoryAutomationService | undefined;
};
export const inventoryAutomationService =
  globalForInventoryAutomation.inventoryAutomationService ??
  (globalForInventoryAutomation.inventoryAutomationService =
    new InventoryAutomationService(prisma));
