/**
 * Repair Work Order Service
 *
 * Service for creating repair work orders for inventory items (both serialized and non-serialized).
 * Extends the existing repair workflow to support non-serialized inventory items.
 *
 * Use Cases:
 * - User direct issues a part to a work order
 * - The part that came out needs repair
 * - Create a work order to repair the inventory item
 * - Works for both serialized (repairable items) and non-serialized (regular inventory) items
 */

import { PrismaClient, RepairWorkflowStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";

import {
  ValidationError,
  NotFoundError,
  BadRequestError,
} from "@/lib/api-errors";
import { workOrderService } from "@/services/work-orders/work-order.service";
import { repairableItemNotificationService } from "@/services/repairable-items/repairable-item-notification.service";
import {
  WorkOrderType,
  WorkOrderPriority,
  WorkOrderOutageType,
} from "@/services/work-orders/work-order.types";
import { repairWorkflowService } from "@/services/repairable-items/repair-workflow.service";
import { z } from "zod";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input for creating a repair work order for a serialized item
 */
export const createSerializedRepairWorkOrderSchema = z.object({
  repairableItemId: z.string().min(1, "Repairable item ID is required"),
  problemDescription: z.string().min(1, "Problem description is required"),
  estimatedCost: z.number().optional(),
  scheduledStartDate: z.string().optional(),
  warrantyRepair: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateSerializedRepairWorkOrderInput = z.infer<
  typeof createSerializedRepairWorkOrderSchema
>;

/**
 * Input for creating a repair work order for a non-serialized item
 */
export const createNonSerializedRepairWorkOrderSchema = z.object({
  inventoryItemId: z.string().min(1, "Inventory item ID is required"),
  quantity: z.number().positive("Quantity must be positive"),
  problemDescription: z.string().min(1, "Problem description is required"),
  estimatedCost: z.number().optional(),
  scheduledStartDate: z.string().optional(),
  priority: z.enum(["A", "B", "C", "D", "E", "F"]).optional().default("F"),
  notes: z.string().optional(),
  equipmentId: z.string().optional(),
  // FK to the original equipment WO whose DI triggered this repair WO creation.
  // Stored on the repair WO so the link is queryable without parsing description text.
  sourceWorkOrderId: z.string().optional(),
  // FK to the DirectIssue (good-spare swap) that triggered this repair WO creation.
  // Provides full traceability: DI → repair WO → serial → repair history.
  sourceDirectIssueId: z.string().optional(),
});

export type CreateNonSerializedRepairWorkOrderInput = z.infer<
  typeof createNonSerializedRepairWorkOrderSchema
>;

/**
 * Result of creating a repair work order
 */
export interface RepairWorkOrderResult {
  workOrder: {
    id: string;
    woNumber: string;
    status: string;
    title: string;
    description: string;
    isRepairWorkOrder: boolean;
  };
  inventoryItem: {
    id: string;
    sku: string;
    description: string;
  };
  repairableItem?: {
    id: string;
    serialNumber: string;
    status: string;
    condition: string;
  };
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

class RepairWorkOrderService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Create a repair work order for a serialized item (repairable item)
   *
   * This delegates to the existing RepairWorkflowService.initiateInsideRepair()
   * which handles the full repair workflow for serialized items.
   *
   * @param context - Service context
   * @param data - Repair work order data
   * @returns Created work order and repairable item details
   */
  async createSerializedRepairWorkOrder(
    context: ServiceContext,
    data: CreateSerializedRepairWorkOrderInput,
  ): Promise<RepairWorkOrderResult> {
    // Creating repair work order for serialized item

    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.CREATE,
    );
    await checkPermission(context, permission);

    // Validate data
    const validation = createSerializedRepairWorkOrderSchema.safeParse(data);
    if (!validation.success) {
      const errors = validation.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw new ValidationError("Validation failed", errors);
    }

    // Get repairable item to get inventory item details
    const repairableItem = await this.prisma.repairableItem.findUnique({
      where: { id: data.repairableItemId },
      include: {
        inventoryItem: true,
      },
    });

    if (!repairableItem) {
      throw new NotFoundError("RepairableItem", data.repairableItemId);
    }

    // Use existing repair workflow service for serialized items
    const result = await repairWorkflowService.initiateInsideRepair(context, {
      repairableItemId: data.repairableItemId,
      problemDescription: data.problemDescription,
      estimatedCost: data.estimatedCost,
      scheduledStartDate: data.scheduledStartDate,
      warrantyRepair: data.warrantyRepair,
      metadata: data.metadata,
    });

    // Ensure workOrder exists in result
    if (!result.workOrder) {
      throw new Error("Failed to create work order for repair");
    }

    return {
      workOrder: {
        id: result.workOrder.id,
        woNumber: result.workOrder.woNumber,
        status: result.workOrder.status,
        title: result.workOrder.title,
        description: "", // Default empty description
        isRepairWorkOrder: true,
      },
      inventoryItem: {
        id: repairableItem.inventoryItem.id,
        sku: repairableItem.inventoryItem.sku,
        description: repairableItem.inventoryItem.description,
      },
      repairableItem: result.repairableItem,
    };
  }

  /**
   * Create a repair work order for a non-serialized item
   *
   * This creates a work order flagged as isRepairWorkOrder: true for a regular
   * inventory item that doesn't have a serial number. The work order tracks
   * the repair of the item type in general, not a specific serial number.
   *
   * @param context - Service context
   * @param data - Repair work order data
   * @returns Created work order and inventory item details
   */
  async createNonSerializedRepairWorkOrder(
    context: ServiceContext,
    data: CreateNonSerializedRepairWorkOrderInput,
  ): Promise<RepairWorkOrderResult> {
    // Creating repair work order for non-serialized item

    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.CREATE,
    );
    await checkPermission(context, permission);

    // Validate data
    const validation = createNonSerializedRepairWorkOrderSchema.safeParse(data);
    if (!validation.success) {
      const errors = validation.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw new ValidationError("Validation failed", errors);
    }

    // Get inventory item
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
    });

    if (!inventoryItem) {
      throw new NotFoundError("InventoryItem", data.inventoryItemId);
    }

    if (!inventoryItem.isActive) {
      throw new BadRequestError("Inventory item is not active");
    }

    // Create work order for non-serialized item repair
    const workOrderTitle = `Repair: ${inventoryItem.sku} - ${inventoryItem.description} (${data.quantity} ${inventoryItem.unit})`;
    const workOrderDescription = `Repair for ${inventoryItem.description}\nQuantity: ${data.quantity} ${inventoryItem.unit}\n\nProblem: ${data.problemDescription}${data.notes ? `\n\nNotes: ${data.notes}` : ""}`;

    const workOrder = await workOrderService.create(context, {
      type: WorkOrderType.REPAIRABLE, // Use REPAIRABLE type for auto-created repair work orders
      priority: data.priority as WorkOrderPriority,
      trade: [], // No specific trade for part repair
      title: workOrderTitle,
      description: workOrderDescription,
      equipmentId: data.equipmentId, // Link to equipment if provided
      repairableItemId: null, // No repairable item for non-serialized items
      estimatedCost: data.estimatedCost,
      plannedStartDate: data.scheduledStartDate,
      outageTypes: [WorkOrderOutageType.NO],
      // CRITICAL: Flag this as a repair work order
      // This is handled by the work order service if it supports the field
    });

    // Set isRepairWorkOrder flag, the initial DB-driven workflow status, and source FKs.
    // repairWorkflowStatus drives every UI decision about what buttons/banners to show —
    // code never infers stage from absence of records.
    await this.prisma.workOrder.update({
      where: { id: workOrder.id },
      data: {
        isRepairWorkOrder: true,
        // Start directly at AWAITING_REPAIR_DECISION so anyone can choose the
        // repair path immediately. Serial assignment is an optional parallel step
        // that the IM can do from the action queue or the WO page.
        repairWorkflowStatus: RepairWorkflowStatus.AWAITING_REPAIR_DECISION,
        // Persist the part type so the serial-assignment dialog can scope its
        // search to this SKU without the user having to type it manually.
        repairInventoryItemId: data.inventoryItemId,
        sourceWorkOrderId: data.sourceWorkOrderId ?? null,
        sourceDirectIssueId: data.sourceDirectIssueId ?? null,
      },
    });

    // Notify all IMs that a repair WO was created with no serial assigned.
    // This is the "orphan" case — someone needs to open the WO and assign a serial.
    try {
      // Get equipment tag if available
      let equipmentTag: string | null = null;
      if (data.equipmentId) {
        const eq = await this.prisma.equipment.findUnique({
          where: { id: data.equipmentId },
          select: { tag: true },
        });
        equipmentTag = eq?.tag ?? null;
      }
      await repairableItemNotificationService.notifyRepairWoPendingSerial(
        context,
        {
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.woNumber,
          workOrderTitle: workOrder.title,
          equipmentTag,
        },
      );
    } catch (_notifError) {
      // Non-fatal
    }

    return {
      workOrder: {
        id: workOrder.id,
        woNumber: workOrder.woNumber,
        status: workOrder.status,
        title: workOrder.title,
        description: workOrder.description,
        isRepairWorkOrder: true,
      },
      inventoryItem: {
        id: inventoryItem.id,
        sku: inventoryItem.sku,
        description: inventoryItem.description,
      },
    };
  }

  /**
   * Create a repair work order for any inventory item (auto-detects serialized vs non-serialized)
   *
   * This is a convenience method that automatically determines whether to create
   * a serialized or non-serialized repair work order based on the input.
   *
   * @param context - Service context
   * @param data - Repair work order data (can be either type)
   * @returns Created work order and item details
   */
  createRepairWorkOrder(
    context: ServiceContext,
    data:
      | CreateSerializedRepairWorkOrderInput
      | CreateNonSerializedRepairWorkOrderInput,
  ): Promise<RepairWorkOrderResult> {
    // Check if this is a serialized item request
    if ("repairableItemId" in data) {
      return this.createSerializedRepairWorkOrder(context, data);
    }

    // Otherwise, it's a non-serialized item request
    return this.createNonSerializedRepairWorkOrder(context, data);
  }
}

// Export singleton instance
const globalForRepairWorkOrder = globalThis as unknown as {
  repairWorkOrderService: RepairWorkOrderService | undefined;
};
export const repairWorkOrderService =
  globalForRepairWorkOrder.repairWorkOrderService ??
  (globalForRepairWorkOrder.repairWorkOrderService = new RepairWorkOrderService(
    prisma,
  ));
