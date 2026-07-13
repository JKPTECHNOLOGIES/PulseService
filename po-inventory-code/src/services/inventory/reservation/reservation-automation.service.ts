/**
 * Reservation Automation Service
 *
 * Service for automated reservation operations.
 * Handles stock monitoring, notifications, and auto-requisition creation.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  PermissionAction,
  buildPermissionString,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import { toNumber } from "@/lib/decimal-helpers";
import { logInventoryEvent } from "@/lib/event-logger";
import { requisitionService } from "@/services/purchasing/requisition/requisition.service";
import { requisitionWorkflowService } from "@/services/purchasing/requisition/requisition-workflow.service";
import { RequisitionPriority } from "@/services/purchasing/requisition/requisition.types";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { INVENTORY_NOTIFICATIONS } from "@/services/notifications/notification-types-registry";
import { logger } from "@/lib/logger";
import { inventoryStockService } from "@/services/inventory/stock/inventory-stock.service";

/**
 * Reservation Automation Service Class
 *
 * Provides automated operations for reservations.
 * Handles notifications, stock monitoring, and auto-requisition creation.
 */
class ReservationAutomationService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Check stock levels after reservation and notify planner if below minimum
   * Also creates auto-requisition if enabled (unless skipRequisition is true)
   *
   * IMPORTANT: This is called AFTER the stock has already been reserved,
   * so totalReserved already includes the reservation we just made.
   * We should NOT add reservedQuantity again.
   *
   * @param skipRequisition - If true, skips auto-requisition creation (user chose "Proceed Without Requisition")
   */
  async checkStockLevelsAndNotify(
    context: ServiceContext,
    inventoryItem: {
      id: string;
      sku: string;
      description: string;
      minQuantity: number | null;
      maxQuantity: number | null;
      unitCost?: number | null;
      stock: Array<{ quantityOnHand: number; quantityReserved: number }>;
    },
    _reservedQuantity: number,
    workOrderId?: string,
    skipRequisition?: boolean,
  ): Promise<void> {
    logger.info(
      `[AUTO-REQ-STOCK-CHECK] === checkStockLevelsAndNotify called ===`,
    );
    logger.info(
      `[AUTO-REQ-STOCK-CHECK] inventoryItemId: ${inventoryItem.id}, sku: ${inventoryItem.sku}`,
    );
    logger.info(
      `[AUTO-REQ-STOCK-CHECK] workOrderId: ${workOrderId ?? "none"}, skipRequisition: ${skipRequisition ?? false}`,
    );
    logger.info(
      `[AUTO-REQ-STOCK-CHECK] stock records: ${JSON.stringify(inventoryItem.stock)}`,
    );

    // Calculate total available - stock data already includes the reservation we just made
    const totalOnHand = inventoryItem.stock.reduce(
      (sum, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
      0,
    );
    const totalReserved = inventoryItem.stock.reduce(
      (sum, s) => sum + (toNumber(s.quantityReserved) ?? 0),
      0,
    );
    // FIXED: Don't subtract reservedQuantity again - it's already in totalReserved
    const totalAvailable = totalOnHand - totalReserved;
    const minQty = toNumber(inventoryItem.minQuantity) ?? 0;

    logger.info(
      `[AUTO-REQ-STOCK-CHECK] totalOnHand: ${totalOnHand}, totalReserved: ${totalReserved}, totalAvailable: ${totalAvailable}, minQty: ${minQty}`,
    );
    logger.info(
      `[AUTO-REQ-STOCK-CHECK] atOrBelowMin: ${totalAvailable <= minQty}, skipRequisition: ${!!skipRequisition}`,
    );

    // Check if AT OR BELOW minimum quantity - create requisition ONLY if not skipped.
    // IMPORTANT: Use <= (not <) so that reaching exactly the min threshold also triggers a
    // reorder. Previously used <, which silently skipped auto-req when available == min,
    // causing missed reorders in the exact-min edge case.
    if (totalAvailable <= minQty && !skipRequisition) {
      logger.info(
        `[AUTO-REQ-STOCK-CHECK] >>> CALLING createAutoRequisition (totalAvailable ${totalAvailable} <= minQty ${minQty} and skipRequisition is falsy)`,
      );
      await this.createAutoRequisition(
        context,
        inventoryItem,
        totalAvailable,
        workOrderId,
      );
    } else {
      logger.info(
        `[AUTO-REQ-STOCK-CHECK] >>> NOT calling createAutoRequisition. Reason: ${totalAvailable > minQty ? `totalAvailable (${totalAvailable}) > minQty (${minQty})` : `skipRequisition is true`}`,
      );
    }
    // If totalAvailable <= minQty && skipRequisition: skip auto-requisition (user chose to proceed without)
  }

  /**
   * Notify planner that reservation will cause stock to go below minimum level
   */
  async notifyPlannerBelowMinLevel(
    context: ServiceContext,
    inventoryItem: {
      id: string;
      sku: string;
      description: string;
    },
    availableQty: number,
    minQty: number,
    workOrderId?: string,
  ): Promise<void> {
    try {
      // Get planner role users
      const plannerRole = await this.prisma.role.findFirst({
        where: { name: "Planner" },
        include: { users: true },
      });

      if (!plannerRole || plannerRole.users.length === 0) {
        return; // No planners to notify
      }

      // Create notification for each planner
      const { notificationService } = await import("@/services/notifications");

      for (const planner of plannerRole.users) {
        await notificationService.sendNotification(context, {
          userId: planner.id,
          type: INVENTORY_NOTIFICATIONS.STOCK_LOW.type,
          category: NotificationCategory.INVENTORY,
          title: "Inventory Below Minimum Level",
          message: `Item ${inventoryItem.sku} - ${inventoryItem.description} will be below minimum level after reservation. Available: ${availableQty}, Minimum: ${minQty}`,
          priority: NotificationPriority.HIGH,
          actionUrl: workOrderId
            ? `/work-orders/${workOrderId}`
            : `/inventory/${inventoryItem.id}`,
          actionLabel: workOrderId ? "View Work Order" : "View Inventory",
          data: {
            inventoryItemId: inventoryItem.id,
            sku: inventoryItem.sku,
            availableQty,
            minQty,
            workOrderId,
          },
        });
      }
    } catch (_error) {
      // Don't throw - notification failure shouldn't block reservation
    }
  }

  /**
   * Create auto-requisition when stock goes below reorder point
   *
   * DEPRECATED: Use createConsolidatedAutoRequisition for work orders
   * This method creates individual requisitions per item
   *
   * @param context - Service context
   * @param inventoryItem - Inventory item details
   * @param availableQty - Current available quantity (after reservation)
   * @param workOrderId - Optional work order ID for budget tracking
   * @param additionalContext - Optional additional context for detailed justification
   */
  async createAutoRequisition(
    context: ServiceContext,
    inventoryItem: {
      id: string;
      sku: string;
      description: string;
      maxQuantity?: number | null;
      minQuantity?: number | null;
      unitCost?: number | null;
      unit?: string;
    },
    availableQty: number,
    workOrderId?: string,
    additionalContext?: {
      quantityReserved?: number;
      currentOnHand?: number;
      workOrderNumber?: string;
      workOrderTitle?: string;
      equipmentId?: string;
    },
  ): Promise<void> {
    logger.info(`[AUTO-REQ-CREATE] === createAutoRequisition called ===`);
    logger.info(
      `[AUTO-REQ-CREATE] inventoryItemId: ${inventoryItem.id}, sku: ${inventoryItem.sku}, description: ${inventoryItem.description}`,
    );
    logger.info(
      `[AUTO-REQ-CREATE] availableQty: ${availableQty}, workOrderId: ${workOrderId ?? "none"}`,
    );
    logger.info(
      `[AUTO-REQ-CREATE] additionalContext: ${JSON.stringify(additionalContext ?? null)}`,
    );
    logger.info(
      `[AUTO-REQ-CREATE] inventoryItem maxQuantity: ${inventoryItem.maxQuantity}, minQuantity: ${inventoryItem.minQuantity}, unitCost: ${inventoryItem.unitCost}`,
    );

    try {
      // CRITICAL: Check for existing OPEN requisitions FIRST to prevent duplicates
      // Check Draft, Submitted, Approved, AND Ordered - all are still in the pipeline.
      // "Ordered" means the req was already converted to a PO — a PO is in flight, no new req needed.
      //
      // SCOPE depends on the charge type:
      //   • WORK-ORDER charged (workOrderId present): scope the dedup to THIS work
      //     order. Each work order has independent demand and its own cost charge,
      //     so a req for the same part on a DIFFERENT work order (or a general
      //     ADD_TO_REORDER req) must NOT block this WO from getting its own req.
      //   • ADD_TO_REORDER (no workOrderId): stay item-scoped — one open
      //     replenishment req per physical item is enough.
      logger.info(
        `[AUTO-REQ-CREATE] Performing idempotency check (${workOrderId ? "WO-scoped" : "item-scoped"}): inventoryItemId=${inventoryItem.id}, workOrderId=${workOrderId ?? "none"}`,
      );
      const existingOpenReq = await this.prisma.requisition.findFirst({
        where: {
          status: { in: ["Draft", "Submitted", "Approved", "Ordered"] },
          lines: {
            some: {
              inventoryItemId: inventoryItem.id,
            },
          },
          // WO-charged auto-reqs only dedupe against the SAME work order.
          ...(workOrderId ? { budgetHeader: { workOrderId } } : {}),
        },
        select: {
          id: true,
          reqNumber: true,
          status: true,
          createdAt: true,
        },
      });

      if (existingOpenReq) {
        logger.info(
          `[AUTO-REQ-CREATE] *** IDEMPOTENCY CHECK: EXISTING REQUISITION FOUND ***`,
        );
        logger.info(
          `[AUTO-REQ-CREATE] Existing req: reqNumber=${existingOpenReq.reqNumber}, status=${existingOpenReq.status}, id=${existingOpenReq.id}, createdAt=${existingOpenReq.createdAt}`,
        );
        logger.info(
          `[AUTO-REQ-CREATE] >>> RETURNING EARLY - will NOT create a new requisition (status="${existingOpenReq.status}" is in pipeline)`,
        );
        return; // Exit early — req already exists in pipeline (Draft/Submitted/Approved) or already converted to PO (Ordered)
      }
      logger.info(
        `[AUTO-REQ-CREATE] Idempotency check passed: NO existing open or ordered requisitions found for this item`,
      );

      const maxQty = toNumber(inventoryItem.maxQuantity) ?? 10;
      const minQty = toNumber(inventoryItem.minQuantity) ?? 0;
      const unitCost = toNumber(inventoryItem.unitCost) ?? 0;

      // Calculate quantity to order based on context
      let quantityToOrder: number;

      if (
        additionalContext?.quantityReserved &&
        additionalContext.currentOnHand !== undefined
      ) {
        // We have detailed context - calculate based on actual shortfall
        const requestedQty = additionalContext.quantityReserved;
        const currentOnHand = additionalContext.currentOnHand;

        // Shortfall: How much we're short to fulfill the request
        const shortfall = Math.max(requestedQty - currentOnHand, 0);

        // Restore to max: How much to order to get back to max level
        // availableQty is AFTER reservation, so we need to restore from there
        const restoreToMax = Math.max(maxQty - availableQty, 0);

        // Order the GREATER of: shortfall OR restore-to-max (minimum 1)
        quantityToOrder = Math.max(shortfall, restoreToMax, 1);
        logger.info(
          `[AUTO-REQ-CREATE] Quantity calc (detailed): requestedQty=${requestedQty}, currentOnHand=${currentOnHand}, shortfall=${shortfall}, restoreToMax=${restoreToMax}, quantityToOrder=${quantityToOrder}`,
        );
      } else {
        // Fallback: Simple restore to max calculation
        // availableQty is the stock level AFTER the reservation that triggered this
        // So we need: MAX - availableQty to get back to MAX
        quantityToOrder = Math.max(maxQty - availableQty, 1);
        logger.info(
          `[AUTO-REQ-CREATE] Quantity calc (simple): maxQty=${maxQty}, availableQty=${availableQty}, quantityToOrder=${quantityToOrder}`,
        );
      }

      // Get full inventory item to get unit and supplier if not provided
      const fullItem = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItem.id },
        select: {
          unit: true,
          defaultSupplierId: true,
          minQuantity: true,
          maxQuantity: true,
          suppliers: {
            where: { isPrimary: true, isActive: true },
            select: { supplierId: true },
            take: 1,
          },
        },
      });

      // Resolve preferred supplier: primary from join table → defaultSupplierId
      const preferredSupplierId =
        fullItem?.suppliers[0]?.supplierId ??
        fullItem?.defaultSupplierId ??
        undefined;

      const unit = inventoryItem.unit ?? fullItem?.unit ?? "EA";
      const finalMinQty = minQty || (toNumber(fullItem?.minQuantity) ?? 0);
      const finalMaxQty = maxQty || (toNumber(fullItem?.maxQuantity) ?? 10);

      // Build detailed justification
      let justification: string;
      let lineNotes: string;

      if (
        additionalContext?.quantityReserved &&
        additionalContext.workOrderNumber
      ) {
        // Detailed justification with work order context
        const currentOnHand = additionalContext.currentOnHand ?? 0;
        const shortfall = Math.max(
          0,
          additionalContext.quantityReserved - currentOnHand,
        );

        const woReference = additionalContext.workOrderTitle
          ? `${additionalContext.workOrderNumber} - ${additionalContext.workOrderTitle}`
          : additionalContext.workOrderNumber;

        justification = `Stock level will be ${availableQty.toFixed(2)} ${unit} (${Math.abs(availableQty - finalMinQty).toFixed(2)} ${unit} ${availableQty < finalMinQty ? "below" : "above"} minimum quantity of ${finalMinQty} ${unit}) after adding ${additionalContext.quantityReserved} ${unit} to work order ${woReference}. Current available: ${currentOnHand.toFixed(2)} ${unit}. Ordering ${quantityToOrder.toFixed(2)} ${unit} to ${shortfall > 0 ? `cover shortfall of ${shortfall.toFixed(2)} ${unit} and ` : ""}restore stock to maximum level of ${finalMaxQty} ${unit}.`;

        lineNotes = `Auto-generated: Requested ${additionalContext.quantityReserved.toFixed(2)}, Available ${currentOnHand.toFixed(2)}, Shortfall ${shortfall.toFixed(2)}, Ordering ${quantityToOrder.toFixed(2)} to restore to max ${finalMaxQty}`;
      } else {
        // Simple justification for reservation-only context
        justification = `Auto-generated: Stock below minimum quantity. Available: ${availableQty}`;
        lineNotes = "Auto-generated requisition due to low stock";
      }

      // Create an elevated context with purchasing permissions for system-generated requisition
      // The original context (from part issue flow) only has inventory permissions,
      // but requisitionService.create() requires purchasing:create and submit requires purchasing:update
      logger.info(
        `[AUTO-REQ-CREATE] Elevating context with purchasing permissions for system-generated requisition`,
      );
      const elevatedContext: ServiceContext = {
        ...context,
        permissions: [
          ...context.permissions,
          { resource: "purchasing", action: "create", isActive: true },
          { resource: "purchasing", action: "update", isActive: true },
          { resource: "purchasing", action: "read", isActive: true },
        ],
      };

      // Create requisition using the new requisition service
      logger.info(
        `[AUTO-REQ-CREATE] Creating requisition with payload: ${JSON.stringify(
          {
            requestedById: context.userId,
            description: `Auto-reorder: ${inventoryItem.description} (SKU: ${inventoryItem.sku}) - Stock below minimum quantity`,
            priority: RequisitionPriority.NORMAL,
            neededByDate: null,
            workOrderId: workOrderId,
            equipmentId: additionalContext?.equipmentId,
            budgetType: workOrderId ? "CHARGE_TO_WORK_ORDER" : "ADD_TO_REORDER",
            justification,
            quantityToOrder,
            unit,
            inventoryItemId: inventoryItem.id,
            supplierId: fullItem?.defaultSupplierId,
            estimatedPrice: unitCost,
          },
          null,
          2,
        )}`,
      );

      // Resolve a GL account code for WO-charged requisitions. The requisition
      // schema (superRefine) REQUIRES inventory lines linked to a work order to
      // carry an account code (Store Room 1535 vs CIP 1580 routing). Without it,
      // requisitionService.create() throws "Validation failed". Resolution chain
      // mirrors the GL engine: WO project/equipment → finance default WO account.
      let resolvedAccountCodeId: string | null = null;
      if (workOrderId) {
        const { budgetResolutionService } =
          await import("@/services/budget/budget-resolution.service");
        resolvedAccountCodeId =
          await budgetResolutionService.resolveWorkOrderAccountCodeId(
            workOrderId,
          );
        if (!resolvedAccountCodeId) {
          logger.error(
            `[AUTO-REQ-CREATE] No GL account code resolvable for work order ${workOrderId} (no project, no equipment account, no finance default). Skipping auto-requisition for item ${inventoryItem.sku} — a default work-order account must be configured in Finance settings.`,
          );
          return;
        }
      }

      const requisition = await requisitionService.create(elevatedContext, {
        requestedById: context.userId,
        description: `Auto-reorder: ${inventoryItem.description} (SKU: ${inventoryItem.sku}) - Stock below minimum quantity`,
        priority: RequisitionPriority.NORMAL,
        neededByDate: null,
        workOrderId: workOrderId,
        equipmentId: additionalContext?.equipmentId,
        // budgetType: when workOrderId is present, use CHARGE_TO_WORK_ORDER with the
        // resolved account code; otherwise ADD_TO_REORDER (no WO account needed).
        budgetType: workOrderId
          ? ("CHARGE_TO_WORK_ORDER" as const)
          : ("ADD_TO_REORDER" as const),
        // Header-level account code so the WO-linked INVENTORY line validates and
        // GL/receiving can route Store Room vs CIP correctly.
        accountCodeId: resolvedAccountCodeId ?? undefined,
        justification,
        // Set header-level supplier from item's preferred supplier
        supplierId: preferredSupplierId,
        items: [
          {
            lineType: "INVENTORY" as const,
            inventoryItemId: inventoryItem.id,
            description: inventoryItem.description,
            quantity: quantityToOrder,
            unit,
            supplierId: preferredSupplierId,
            estimatedPrice: unitCost, // FIXED: Unit price, not total (total = quantity × unitCost)
            notes: lineNotes,
          },
        ],
      });
      logger.info(
        `[AUTO-REQ-CREATE] Requisition CREATED: id=${requisition.id}, reqNumber=${requisition.reqNumber}`,
      );

      // Auto-submit the requisition (using elevated context for purchasing:update permission)
      logger.info(
        `[AUTO-REQ-CREATE] Auto-submitting requisition ${requisition.id}...`,
      );
      const submitResult = await requisitionWorkflowService.submit(
        elevatedContext,
        requisition.id,
      );
      logger.info(
        `[AUTO-REQ-CREATE] Submit result: ${JSON.stringify(submitResult)}`,
      );

      // Increment quantityCommitted: mark these on-order units as committed to the WO
      // This ensures full visibility of both reserved + on-order quantities
      try {
        await inventoryStockService.incrementCommitted(
          inventoryItem.id,
          quantityToOrder,
        );
        logger.info(
          `[AUTO-REQ-CREATE] quantityCommitted incremented by ${quantityToOrder} for item ${inventoryItem.id}`,
        );
      } catch (commitErr) {
        // Non-fatal: log but don't fail the REQ creation
        logger.error(
          `[AUTO-REQ-CREATE] Failed to increment quantityCommitted for item ${inventoryItem.id}: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
        );
      }

      // Log event
      await logInventoryEvent(
        context,
        "AUTO_REQUISITION_CREATED",
        inventoryItem.id,
        `Auto-requisition ${requisition.reqNumber} created for ${quantityToOrder} units`,
        {
          reqNumber: requisition.reqNumber,
          requisitionId: requisition.id,
          availableQty,
          quantityToOrder,
          workOrderId,
        },
      );

      logger.info(
        `[AUTO-REQ-CREATE] === createAutoRequisition COMPLETED SUCCESSFULLY === reqNumber=${requisition.reqNumber}`,
      );
    } catch (error) {
      logger.error(
        `[AUTO-REQ-CREATE] !!! FAILED to create auto-requisition for item: ${inventoryItem.sku}`,
      );
      logger.error(
        `[AUTO-REQ-CREATE] Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.error(
        `[AUTO-REQ-CREATE] Stack: ${error instanceof Error ? (error.stack ?? "no stack trace") : "no stack trace"}`,
      );
    }
  }

  /**
   * Create consolidated auto-requisition for multiple items
   * Creates a SINGLE requisition with ALL items that need reordering
   *
   * @param context - Service context
   * @param workOrderId - Work order ID for budget tracking
   * @param itemsNeedingReorder - Array of items that need reordering
   * @returns The created requisition or null if one already exists
   */
  async createConsolidatedAutoRequisition(
    context: ServiceContext,
    workOrderId: string,
    itemsNeedingReorder: Array<{
      inventoryItem: {
        id: string;
        sku: string;
        description: string;
        maxQuantity?: number | null;
        minQuantity?: number | null;
        unitCost?: number | null;
        unit?: string;
        defaultSupplierId?: string | null;
      };
      availableQty: number;
      quantityToOrder: number;
      shortfall: number;
      belowMin: number;
    }>,
    workOrderContext?: {
      woNumber: string;
      title?: string;
      equipmentId?: string;
      plannedStartDate?: Date | null;
    },
  ): Promise<{ requisitionId: string; reqNumber: string } | null> {
    try {
      // Check for existing pending requisition for this work order
      // Use WorkOrderResource relation to find requisitions linked to this work order
      const existingRequisition = await this.prisma.requisition.findFirst({
        where: {
          workOrderResources: {
            some: {
              workOrderId,
            },
          },
          status: { in: ["Draft", "Submitted", "Approved"] },
        },
        select: {
          id: true,
          reqNumber: true,
          status: true,
        },
      });

      if (existingRequisition) {
        return null; // Exit early - requisition already exists for this work order
      }

      if (itemsNeedingReorder.length === 0) {
        return null; // Nothing to order
      }

      // Build consolidated justification
      const woReference = workOrderContext?.title
        ? `${workOrderContext.woNumber} - ${workOrderContext.title}`
        : (workOrderContext?.woNumber ?? workOrderId);

      const totalItems = itemsNeedingReorder.length;
      const totalShortfall = itemsNeedingReorder.reduce(
        (sum, item) => sum + item.shortfall,
        0,
      );
      const totalBelowMin = itemsNeedingReorder.reduce(
        (sum, item) => sum + item.belowMin,
        0,
      );

      const justification = `Auto-generated for Work Order ${woReference}. ${totalItems} item(s) will be below minimum stock levels after reservation. Total shortfall: ${totalShortfall.toFixed(2)} units. Total below minimum: ${totalBelowMin.toFixed(2)} units. Ordering to restore stock to maximum levels.`;

      // Create requisition line items
      // Fetch preferred suppliers for all items in one batch
      const itemIds = itemsNeedingReorder.map((i) => i.inventoryItem.id);
      const primarySupplierRows =
        await this.prisma.inventoryItemSupplier.findMany({
          where: {
            inventoryItemId: { in: itemIds },
            isPrimary: true,
            isActive: true,
          },
          select: { inventoryItemId: true, supplierId: true },
        });
      const primarySupplierMap = new Map(
        primarySupplierRows.map((r) => [r.inventoryItemId, r.supplierId]),
      );

      const requisitionItems = itemsNeedingReorder.map((item) => {
        const unit = item.inventoryItem.unit ?? "EA";
        const unitCost = toNumber(item.inventoryItem.unitCost) ?? 0;
        const minQty = toNumber(item.inventoryItem.minQuantity) ?? 0;
        const maxQty = toNumber(item.inventoryItem.maxQuantity) ?? 10;
        // Preferred supplier: isPrimary from join table → defaultSupplierId
        const lineSupplierId =
          primarySupplierMap.get(item.inventoryItem.id) ??
          item.inventoryItem.defaultSupplierId ??
          undefined;

        return {
          lineType: "INVENTORY" as const,
          inventoryItemId: item.inventoryItem.id,
          description: item.inventoryItem.description,
          quantity: item.quantityToOrder,
          unit,
          supplierId: lineSupplierId,
          estimatedPrice: unitCost, // FIXED: Unit price, not total (total = quantity × unitCost)
          notes: `Auto-generated: Available ${item.availableQty.toFixed(2)}, Min ${minQty}, Max ${maxQty}, Shortfall ${item.shortfall.toFixed(2)}, Ordering ${item.quantityToOrder.toFixed(2)} to restore to max`,
        };
      });

      // Create an elevated context with purchasing permissions for system-generated requisition
      // The original context may only have inventory permissions,
      // but requisitionService.create() requires purchasing:create and submit requires purchasing:update
      logger.info(
        `[AUTO-REQ-CREATE] Elevating context with purchasing permissions for consolidated system-generated requisition`,
      );
      const elevatedContext: ServiceContext = {
        ...context,
        permissions: [
          ...context.permissions,
          { resource: "purchasing", action: "create", isActive: true },
          { resource: "purchasing", action: "update", isActive: true },
          { resource: "purchasing", action: "read", isActive: true },
        ],
      };

      // Determine header-level supplier: use the first item's preferred supplier if all items share one
      // (commonly the case for single-item or same-supplier reqs)
      const firstItemSupplierId = requisitionItems[0]?.supplierId ?? undefined;

      // Resolve the WO charge account. WO-linked INVENTORY lines REQUIRE an
      // account code at validation time (Store Room 1535 vs CIP 1580 routing) —
      // create() resolving it internally is too late, it runs after validation.
      const { budgetResolutionService } =
        await import("@/services/budget/budget-resolution.service");
      const consolidatedAccountCodeId =
        await budgetResolutionService.resolveWorkOrderAccountCodeId(
          workOrderId,
        );
      if (!consolidatedAccountCodeId) {
        logger.error(
          `[AUTO-REQ-CREATE] No GL account code resolvable for work order ${workOrderId} (no project, equipment account, or finance default). Skipping consolidated auto-requisition (${totalItems} items) — configure a default work-order account in Finance settings.`,
        );
        return null;
      }

      // Create consolidated requisition
      const requisition = await requisitionService.create(elevatedContext, {
        requestedById: context.userId,
        description: `Auto-reorder for WO ${workOrderContext?.woNumber ?? workOrderId} - ${totalItems} items below minimum`,
        priority: RequisitionPriority.NORMAL,
        neededByDate: workOrderContext?.plannedStartDate?.toISOString() ?? null,
        workOrderId,
        equipmentId: workOrderContext?.equipmentId,
        // Always CHARGE_TO_WORK_ORDER since workOrderId is always provided here.
        budgetType: "CHARGE_TO_WORK_ORDER" as const,
        // Header-level account so the WO-linked lines validate and GL/receiving
        // can route Store Room vs CIP correctly.
        accountCodeId: consolidatedAccountCodeId,
        justification,
        // Set header-level supplier from the first item's preferred supplier
        supplierId: firstItemSupplierId,
        items: requisitionItems,
      });

      // Auto-submit the requisition (using elevated context for purchasing:update permission)
      await requisitionWorkflowService.submit(elevatedContext, requisition.id);

      // Log event
      await logInventoryEvent(
        context,
        "AUTO_REQUISITION_CREATED",
        workOrderId,
        `Consolidated auto-requisition ${requisition.reqNumber} created with ${totalItems} items`,
        {
          reqNumber: requisition.reqNumber,
          requisitionId: requisition.id,
          workOrderId,
          itemCount: totalItems,
          totalShortfall,
          totalBelowMin,
        },
      );

      return {
        requisitionId: requisition.id,
        reqNumber: requisition.reqNumber,
      };
    } catch (_error) {
      // Don't throw - requisition failure shouldn't block reservation
      return null;
    }
  }

  /**
   * Send notifications for reservations expiring soon
   * Useful for scheduled jobs
   */
  async notifyExpiringSoon(
    context: ServiceContext,
    daysAhead: number = 7,
  ): Promise<number> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    // Find reservations expiring soon
    const reservations = await this.prisma.inventoryReservation.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: {
          gte: now,
          lte: futureDate,
        },
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
          },
        },
        reservedByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (reservations.length === 0) {
      return 0;
    }

    try {
      const { notificationService } = await import("@/services/notifications");

      for (const reservation of reservations) {
        const daysUntilExpiration = Math.ceil(
          ((reservation.expiresAt?.getTime() ?? 0) - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        await notificationService.sendNotification(context, {
          userId: reservation.reservedBy,
          type: INVENTORY_NOTIFICATIONS.RESERVATION_EXPIRING_SOON.type,
          category: NotificationCategory.INVENTORY,
          title: "Reservation Expiring Soon",
          message: `Your reservation for ${reservation.inventoryItem.sku} - ${reservation.inventoryItem.description} expires in ${daysUntilExpiration} day(s)`,
          priority:
            daysUntilExpiration <= 2
              ? NotificationPriority.HIGH
              : NotificationPriority.NORMAL,
          actionUrl: `/inventory/reservations/${reservation.id}`,
          actionLabel: "View Reservation",
          data: {
            reservationId: reservation.id,
            inventoryItemId: reservation.inventoryItemId,
            expiresAt: reservation.expiresAt?.toISOString(),
            daysUntilExpiration,
          },
        });
      }
    } catch (_error) {
      // Silently handle notification errors
    }

    return reservations.length;
  }

  /**
   * Monitor stock levels and create notifications/requisitions as needed
   * Useful for scheduled jobs
   */
  async monitorStockLevels(context: ServiceContext): Promise<{
    itemsChecked: number;
    notificationsSent: number;
    requisitionsCreated: number;
  }> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      PermissionAction.READ,
    );
    await checkPermission(context, permission);

    // Get active inventory items with minimum quantity set, using select + take for memory safety
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        minQuantity: { gt: 0 },
      },
      take: 50000,
      select: {
        id: true,
        sku: true,
        description: true,
        minQuantity: true,
        maxQuantity: true,
        unitCost: true,
        stock: {
          select: {
            quantityOnHand: true,
            quantityReserved: true,
          },
        },
      },
    });

    const notificationsSent = 0;
    let requisitionsCreated = 0;

    for (const item of items) {
      const totalOnHand = item.stock.reduce(
        (sum: number, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
        0,
      );
      const totalReserved = item.stock.reduce(
        (sum: number, s) => sum + (toNumber(s.quantityReserved) ?? 0),
        0,
      );
      const totalAvailable = Number(totalOnHand) - Number(totalReserved);
      const minQty = toNumber(item.minQuantity) ?? 0;

      // Create auto-req when AT OR BELOW minimum quantity (use <= not <).
      // Mirrors the fix applied to checkStockLevelsAndNotify() — stock landing
      // exactly at min must trigger a reorder the same as stock landing below it.
      if (totalAvailable <= minQty) {
        // Create auto-requisition
        await this.createAutoRequisition(
          context,
          {
            id: item.id,
            sku: item.sku,
            description: item.description,
            maxQuantity: toNumber(item.maxQuantity),
            unitCost: toNumber(item.unitCost),
          },
          totalAvailable,
        );
        requisitionsCreated++;
      }
    }

    return {
      itemsChecked: items.length,
      notificationsSent,
      requisitionsCreated,
    };
  }
}

// Export singleton instance
const globalForReservationAutomation = globalThis as unknown as {
  reservationAutomationService: ReservationAutomationService | undefined;
};
export const reservationAutomationService =
  globalForReservationAutomation.reservationAutomationService ??
  (globalForReservationAutomation.reservationAutomationService =
    new ReservationAutomationService(prisma));
