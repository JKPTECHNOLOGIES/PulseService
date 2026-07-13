/**
 * Inventory Reorder Service
 *
 * Automated inventory reordering based on min/max levels.
 * Monitors stock levels and creates requisitions when items reach reorder points.
 * Integrates with multi-supplier system for intelligent supplier selection.
 */

import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/services/base/types";
import { inventoryService } from "@/services/inventory/inventory.service"; // shared getOnOrderQuantities
import { requisitionService } from "@/services/purchasing/requisition/requisition.service";
import { requisitionWorkflowService } from "@/services/purchasing/requisition/requisition-workflow.service";
import { RequisitionPriority } from "@/services/purchasing/requisition/requisition.types";
import { logSystemEvent } from "@/lib/event-logger";

/**
 * Reorder check result
 */
export interface ReorderCheckResult {
  itemsChecked: number;
  requisitionsCreated: number;
  itemsReordered: number;
  errors: string[];
  duration: number;
}

/**
 * Reorder item details
 */
export interface ReorderItem {
  inventoryItemId: string;
  sku: string;
  description: string;
  currentQuantity: number;
  minQuantity: number;
  maxQuantity: number;
  supplierId: string | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  unitCost: number | null;
}

/**
 * Work order reservation details
 */
export interface WorkOrderReservation {
  id: string;
  number: string;
  title: string;
  quantity: number;
  priority: string;
  status: string;
  scheduledDate: Date | null;
}

/**
 * Stock status categories for the reorder dashboard.
 * UNCOVERED_OUT — out of stock, no open req and no open PO (needs immediate action)
 * REQ_ONLY_OUT  — out of stock, req exists but not yet a PO
 * PO_OUT        — out of stock, PO is in flight (req may or may not exist)
 * UNCOVERED_LOW — below minimum, nothing in pipeline
 * BUY_TO_ORDER  — min/max = 0/0 (non-stocked), but has an open req or PO in flight
 * OK            — stock is sufficient (included only when item has reservations)
 */
export type StockStatus =
  | "UNCOVERED_OUT"
  | "REQ_ONLY_OUT"
  | "PO_OUT"
  | "UNCOVERED_LOW"
  | "BUY_TO_ORDER"
  | "OK";

/** Open requisition detail for display */
export interface ReorderReqDetail {
  reqId: string;
  reqNumber: string;
  qty: number;
  /** Non-null when this req line has been converted to a PO (lineStatus = ORDERED) */
  linkedPoId: string | null;
  linkedPoNumber: string | null;
}

/** Open PO detail for display */
export interface ReorderPoDetail {
  poId: string;
  poNumber: string;
  qty: number;
  expectedDate: string | null;
  supplierId: string | null;
  supplierName: string | null;
  /** Non-null when this PO was created from a requisition */
  linkedReqId: string | null;
  linkedReqNumber: string | null;
}

/**
 * Reorder dashboard item
 */
export interface ReorderDashboardItem {
  id: string;
  sku: string;
  description: string;
  unit: string;
  currentStock: number;
  minQuantity: number;
  maxQuantity: number;
  isLowStock: boolean;
  stockStatus: StockStatus;
  reservedQuantity: number;
  defaultSupplier: {
    id: string;
    name: string;
  } | null;
  leadTimeDays: number | null;
  workOrders: WorkOrderReservation[];
  /** Total qty on open requisition lines not yet converted to a PO */
  onReqQty: number;
  /** Total remaining-to-receive qty on open PO lines */
  onPOQty: number;
  /** Number of open requisition lines */
  onReqLineCount: number;
  /** Number of open PO lines */
  onPOLineCount: number;
  /** Detailed req list for display — includes linked PO info */
  openReqs: ReorderReqDetail[];
  /** Detailed PO list for display — includes linked req info */
  openPos: ReorderPoDetail[];
}

/**
 * Reorder dashboard data
 */
export interface ReorderDashboardData {
  summary: {
    lowStockCount: number;
    outOfStockCount: number;
    totalReserved: number;
    highPriorityWOCount: number;
    /** Items out of stock with nothing in pipeline */
    uncoveredOutCount: number;
    /** Items out of stock, req exists but no PO yet */
    reqOnlyOutCount: number;
    /** Items out of stock, PO is in flight */
    poOutCount: number;
    /** Items below minimum, nothing in pipeline */
    uncoveredLowCount: number;
    /** Non-stocked items (min/max = 0/0) with an open req or PO */
    buyToOrderCount: number;
  };
  items: ReorderDashboardItem[];
}

/**
 * Reorder dashboard options
 */
export interface ReorderDashboardOptions {
  startDate: Date;
  endDate: Date;
  category?: string;
  showReservedOnly?: boolean;
  lowStockOnly?: boolean;
  search?: string;
}

/**
 * Inventory Reorder Service
 */
export class InventoryReorderService {
  /**
   * Create a requisition for reorder items
   *
   * @param context - Service context
   * @param items - Items to reorder
   * @param supplierId - Supplier ID (or 'no-supplier')
   * @returns Created requisition ID or null
   */
  private async createRequisition(
    context: ServiceContext,
    items: ReorderItem[],
    supplierId: string,
  ): Promise<string | null> {
    try {
      // Get inventory items to get unit information
      const inventoryItems = await prisma.inventoryItem.findMany({
        where: {
          id: { in: items.map((i) => i.inventoryItemId) },
        },
        select: {
          id: true,
          unit: true,
        },
      });

      const unitMap = new Map(inventoryItems.map((i) => [i.id, i.unit]));

      // Calculate order quantity as maxQuantity - effectiveAvailable.
      // NOTE: for the triggerReorderForItem() path, item.currentQuantity is
      // already set to effectiveAvailable (onHand - activeReserved + openPOQty).
      // We use Math.max(1, ...) to always order at least 1 unit.
      const requisitionItems = items.map((item) => {
        const orderQuantity = Math.max(
          1,
          item.maxQuantity - item.currentQuantity,
        );
        return {
          lineType: "INVENTORY" as const,
          inventoryItemId: item.inventoryItemId,
          description: `Auto-reorder: ${item.description} (SKU: ${item.sku})`,
          quantity: orderQuantity,
          unit: unitMap.get(item.inventoryItemId) ?? "EA",
          // FIX: estimatedPrice is the UNIT price, not total.
          // The requisition service multiplies quantity × estimatedPrice for line total.
          // Previously passed unitCost × orderQuantity which caused double-counting.
          estimatedPrice: item.unitCost ?? 0,
          workOrderId: null,
          notes: `Current stock: ${item.currentQuantity}, Min: ${item.minQuantity}, Max: ${item.maxQuantity}, Ordering: ${orderQuantity}${
            item.leadTimeDays ? `, Lead time: ${item.leadTimeDays} days` : ""
          }`,
        };
      });

      // Build description
      const firstItem = items[0];
      const description =
        supplierId === "no-supplier"
          ? `Auto-reorder: ${items.length} low stock item(s) - No supplier`
          : `Auto-reorder: ${items.length} low stock item(s) from ${firstItem ? firstItem.supplierName : "Unknown"}`;

      // Create requisition
      const requisition = await requisitionService.create(context, {
        requestedById: context.userId,
        description,
        priority: "Normal" as never, // Normal priority for auto-reorders
        budgetType: "ADD_TO_REORDER",
        neededByDate: null,
        justification:
          supplierId === "no-supplier"
            ? `Automatic reorder for ${items.length} low stock item(s) - No default supplier assigned`
            : `Automatic reorder for ${items.length} low stock item(s) from ${firstItem ? firstItem.supplierName : "Unknown"}`,
        items: requisitionItems,
      });

      // Auto-submit the requisition
      await requisitionWorkflowService.submit(context, requisition.id);

      // Log requisition creation
      await logSystemEvent(
        context,
        "INVENTORY_AUTO_REQUISITION_CREATED",
        `Auto-created requisition for ${items.length} low stock items`,
        {
          requisitionId: requisition.id,
          reqNumber: requisition.reqNumber,
          itemCount: items.length,
          supplierId: supplierId !== "no-supplier" ? supplierId : null,
          supplierName: firstItem ? firstItem.supplierName : null,
          items: items.map((i) => ({
            sku: i.sku,
            description: i.description,
            currentQuantity: i.currentQuantity,
            minQuantity: i.minQuantity,
            maxQuantity: i.maxQuantity,
            orderQuantity: Math.max(0, i.maxQuantity - i.currentQuantity),
          })),
        },
      ).catch(
        (_err) => {}, // Silently handle logging errors
      );

      return requisition.id;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get items that need reordering
   *
   * @param context - Service context
   * @returns Array of items needing reorder
   */
  async getItemsNeedingReorder(
    context: ServiceContext,
  ): Promise<ReorderItem[]> {
    const lowStockItems = await inventoryService.getLowStockItems(context);

    return lowStockItems.map((item) => ({
      inventoryItemId: item.id,
      sku: item.sku,
      description: item.description,
      currentQuantity: item.currentQuantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      supplierId: item.defaultSupplier?.id ?? null,
      supplierName: item.defaultSupplier?.name ?? null,
      leadTimeDays: null,
      unitCost: null,
    }));
  }

  /**
   * Check if an item needs reordering
   *
   * @param context - Service context
   * @param inventoryItemId - Inventory item ID
   * @returns True if item needs reordering
   */
  async checkItemNeedsReorder(
    _context: ServiceContext,
    inventoryItemId: string,
  ): Promise<boolean> {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: { stock: true },
    });

    if (!item) {
      return false;
    }

    // BUG FIX: Use effective available (onHand - activeReserved + openPOQty)
    // instead of raw quantityOnHand to prevent false reorder triggers.
    const totalOnHand = item.stock.reduce(
      (sum, s) => sum + Number(s.quantityOnHand),
      0,
    );

    // Sum active reservations for this item
    const reservationAgg = await prisma.inventoryReservation.aggregate({
      where: { inventoryItemId, status: "ACTIVE" },
      _sum: { quantity: true },
    });
    const activeReserved = Number(reservationAgg._sum.quantity ?? 0);

    // Sum open PO unreceived quantities
    const openPOLines = await prisma.pOLine.findMany({
      where: {
        inventoryItemId,
        purchaseOrder: { status: { notIn: ["Draft", "Cancelled", "Closed"] } },
      },
      select: { quantity: true, receivedQuantity: true },
    });
    const openPOQty = openPOLines.reduce(
      (sum, l) =>
        sum + Math.max(0, Number(l.quantity) - Number(l.receivedQuantity)),
      0,
    );

    const effectiveAvailable = totalOnHand - activeReserved + openPOQty;

    // Check if effective available is below minimum quantity
    return effectiveAvailable < Number(item.minQuantity);
  }

  /**
   * Create a top-up requisition for a specific quantity gap.
   *
   * Called by the inventory integrity monitor when an item has negative
   * available stock AND the existing open reqs are insufficient to restore
   * the item to its maximum stock level.
   *
   * Unlike triggerReorderForItem(), this method bypasses the minQuantity
   * gate and directly creates a req for the explicit gap quantity, so it
   * can correct under-ordered situations even when effectiveSupply > minQty.
   *
   * @param context - Service context
   * @param inventoryItemId - Item to top up
   * @param gapQty - Exact additional units needed (caller is responsible for calculation)
   * @returns Created requisition ID or null if item not found / no supplier
   */
  async createTopUpRequisition(
    context: ServiceContext,
    inventoryItemId: string,
    gapQty: number,
  ): Promise<string | null> {
    if (gapQty <= 0) return null;

    const item = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: { defaultSupplier: true },
    });
    if (!item) throw new Error(`Inventory item not found: ${inventoryItemId}`);

    const maxQuantity = Number(item.maxQuantity);

    const reorderItem: ReorderItem = {
      inventoryItemId: item.id,
      sku: item.sku,
      description: item.description,
      currentQuantity: maxQuantity - gapQty, // drives createRequisition: orderQty = max(1, maxQty - currentQty) = gapQty
      minQuantity: Number(item.minQuantity),
      maxQuantity,
      supplierId: item.defaultSupplier?.id ?? null,
      supplierName: item.defaultSupplier?.name ?? null,
      leadTimeDays: item.leadTimeDays,
      unitCost: Number(item.unitCost),
    };

    const supplierId = item.defaultSupplier?.id ?? "no-supplier";
    return this.createRequisition(context, [reorderItem], supplierId);
  }

  /**
   * Manually trigger reorder for specific item
   *
   * @param context - Service context
   * @param inventoryItemId - Inventory item ID
   * @returns Created requisition ID or null
   */
  async triggerReorderForItem(
    context: ServiceContext,
    inventoryItemId: string,
  ): Promise<string | null> {
    // Thin wrapper over the canonical createReorderForItem so there is exactly
    // one pipeline-aware reorder implementation. Source MANUAL = ADD_TO_REORDER
    // (no work order). Returns the created requisition id (or null when the
    // pipeline already covers the item / it is ineligible).
    const result = await this.createReorderForItem(context, {
      inventoryItemId,
      source: "MANUAL",
    });
    return result?.requisitionId ?? null;
  }

  /**
   * CANONICAL single-item reorder entry point — the single source of truth for
   * "an event dropped stock below its reorder point; create the covering
   * replenishment requisition."
   *
   * This consolidates the reorder logic that was previously duplicated (with
   * four divergent quantity formulas) across:
   *   - direct-issue.service.ts        checkAndCreateRequisition
   *   - reservation-automation.service createAutoRequisition
   *   - inventory-monitor.service       createRequisitionForItems
   *   - inventory-automation.service    createRequisitionAction
   *   - lib/inventory-auto-reorder      generateRequisition
   *
   * Quantity uses the ONLY correct, pipeline-aware formula (same as
   * triggerReorderForItem):
   *   effectiveSupply = onHand − activeReserved + openPOQty + openReqQty
   *   reorderQty      = max(0, maxQuantity − effectiveSupply)
   *   newReqQty       = max(0, reorderQty − openReqQty)   (uncovered gap only)
   * Returning the uncovered gap is also the dedup: if open reqs already cover
   * the shortfall, newReqQty <= 0 and no requisition is created.
   *
   * Budget classification follows the work-order rule:
   *   - workOrderId present → CHARGE_TO_WORK_ORDER (account + DEPARTMENT derived
   *     from the equipment by requisitionService.create → resolveFromWorkOrder;
   *     project applied ONLY when the WO is a project work order).
   *   - otherwise          → ADD_TO_REORDER. A system-generated reorder is
   *     never CHARGE_TO_ACCOUNT and NEVER CHARGE_TO_PROJECT.
   *
   * @returns the created requisition's id + number, or null when nothing needs
   *          ordering (ineligible item, or pipeline already covers max).
   */
  async createReorderForItem(
    context: ServiceContext,
    opts: {
      inventoryItemId: string;
      workOrderId?: string | null;
      equipmentId?: string | null;
      source:
        | "DIRECT_ISSUE"
        | "RESERVATION"
        | "MONITOR"
        | "AUTOMATION"
        | "CRON"
        | "MANUAL";
      sourceNote?: string;
      /** Auto-submit into the approval workflow (default true). */
      autoSubmit?: boolean;
    },
  ): Promise<{ requisitionId: string; reqNumber: string } | null> {
    const { inventoryItemId, workOrderId, equipmentId, source } = opts;

    const item = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: {
        stock: true,
        defaultSupplier: true,
        suppliers: {
          where: { isPrimary: true, isActive: true },
          select: { supplierId: true },
          take: 1,
        },
      },
    });
    if (!item) return null;

    // Eligibility: only stocked, non-repairable items with a configured min/max.
    // Repairable items follow the repair/return workflow; non-stock items are
    // never auto-reordered; 0/0 min-max means no reorder point is set.
    if (!item.isStockItem || item.isRepairable) return null;
    const minQuantity = Number(item.minQuantity);
    const maxQuantity = Number(item.maxQuantity);
    if (minQuantity <= 0 || maxQuantity <= 0) return null;

    // Pipeline-aware quantity using the shared open-PO/open-req helper.
    const totalOnHand = item.stock.reduce(
      (s, st) => s + Number(st.quantityOnHand),
      0,
    );
    const totalReserved = item.stock.reduce(
      (s, st) => s + Number(st.quantityReserved),
      0,
    );
    const { reqMap, poMap } = await inventoryService.getOnOrderQuantities([
      item.id,
    ]);
    const openReqQty = reqMap.get(item.id)?.qty ?? 0;
    const openPOQty = poMap.get(item.id)?.qty ?? 0;

    const available = totalOnHand - totalReserved;
    const effectiveSupply = available + openPOQty + openReqQty;
    // Only reorder once effective supply (incl. inbound pipeline) has fallen to
    // or below the minimum threshold (matches triggerReorderForItem). Prevents
    // topping up to max on every minor draw while pipeline already covers min.
    if (effectiveSupply > minQuantity) return null;
    const reorderQty = Math.max(0, maxQuantity - effectiveSupply);
    if (reorderQty <= 0) return null;
    const newReqQty = Math.max(0, reorderQty - openReqQty);
    if (newReqQty <= 0) return null;

    // Supplier: primary join-table supplier → default supplier.
    const preferredSupplierId =
      item.suppliers[0]?.supplierId ?? item.defaultSupplier?.id ?? undefined;

    // Elevate context so technician/system callers carry purchasing:create and
    // purchasing:update (required by requisitionService.create + submit).
    const elevatedContext: ServiceContext = {
      ...context,
      permissions: [
        ...context.permissions,
        { resource: "purchasing", action: "create", isActive: true },
        { resource: "purchasing", action: "update", isActive: true },
        { resource: "purchasing", action: "read", isActive: true },
      ],
    };

    const unit = item.unit || "EA";
    const justification =
      `Stock at ${available.toFixed(2)} ${unit} (min ${minQuantity}). ` +
      `On Req ${openReqQty.toFixed(2)}, On PO ${openPOQty.toFixed(2)}. ` +
      `Ordering ${newReqQty.toFixed(2)} ${unit} (uncovered gap) to reach max ${maxQuantity}.` +
      (opts.sourceNote ? ` ${opts.sourceNote}` : "");

    // Resolve the WO charge account up-front. WO-linked INVENTORY lines REQUIRE
    // an account code at validation time (Store Room 1535 vs CIP 1580 routing).
    // If the work order has no resolvable account (no project, equipment account,
    // or finance default), fall back to a plain ADD_TO_REORDER replenishment so
    // stock is still reordered rather than failing validation.
    let woAccountCodeId: string | null = null;
    if (workOrderId) {
      const { budgetResolutionService } =
        await import("@/services/budget/budget-resolution.service");
      woAccountCodeId =
        await budgetResolutionService.resolveWorkOrderAccountCodeId(
          workOrderId,
        );
      if (!woAccountCodeId) {
        const { logger } = await import("@/lib/logger");
        logger.error(
          `[REORDER] Work order ${workOrderId} has no resolvable GL account code (no project, equipment account, or finance default). Falling back to ADD_TO_REORDER replenishment for item ${item.sku}.`,
        );
      }
    }
    const chargeToWorkOrder = !!workOrderId && !!woAccountCodeId;

    const requisition = await requisitionService.create(elevatedContext, {
      requestedById: context.userId,
      description: `Auto-reorder: ${item.description} (SKU: ${item.sku}) - Stock below minimum`,
      priority: RequisitionPriority.NORMAL,
      neededByDate: null,
      justification,
      // WO source WITH a resolvable account → charge to the work order.
      // Otherwise (no WO, or WO without any resolvable account) → ADD_TO_REORDER.
      ...(chargeToWorkOrder
        ? {
            workOrderId,
            equipmentId: equipmentId ?? undefined,
            budgetType: "CHARGE_TO_WORK_ORDER" as const,
            accountCodeId: woAccountCodeId ?? undefined,
          }
        : { budgetType: "ADD_TO_REORDER" as const }),
      supplierId: preferredSupplierId,
      items: [
        {
          lineType: "INVENTORY" as const,
          inventoryItemId: item.id,
          description: item.description,
          quantity: newReqQty,
          unit,
          supplierId: preferredSupplierId,
          // estimatedPrice is the UNIT price; the requisition service multiplies
          // by quantity for the line total.
          estimatedPrice: Number(item.unitCost),
          notes:
            `Auto-reorder [${source}]: onHand=${totalOnHand}, reserved=${totalReserved}, ` +
            `onReq=${openReqQty}, onPO=${openPOQty}, ordering=${newReqQty} to max=${maxQuantity}`,
        },
      ],
    });

    if (opts.autoSubmit !== false) {
      await requisitionWorkflowService.submit(elevatedContext, requisition.id);
    }
    return { requisitionId: requisition.id, reqNumber: requisition.reqNumber };
  }

  /**
   * Get reorder dashboard data with reservations in date range
   *
   * @param context - Service context
   * @param options - Dashboard options (date range, filters)
   * @returns Dashboard data with items and summary
   */
  async getReorderDashboard(
    _context: ServiceContext,
    options: ReorderDashboardOptions,
  ): Promise<ReorderDashboardData> {
    const { category, showReservedOnly, lowStockOnly, search } = options;

    // Build where clause for inventory items.
    // Includes 0/0 min-max items so that Buy to Order items (non-stocked but with
    // an open req or PO) appear in their own category. They are filtered in the loop
    // below — 0/0 items with no open coverage are silently skipped.
    const where: Record<string, unknown> = {
      isActive: true,
      isStockItem: true,
    };

    if (category) {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // Get inventory items with their stock, reservations, and default supplier
    // Safety limit to prevent loading millions of records
    const items = await prisma.inventoryItem.findMany({
      where,
      take: 50000,
      select: {
        id: true,
        sku: true,
        description: true,
        unit: true,
        minQuantity: true,
        maxQuantity: true,
        leadTimeDays: true,
        stock: {
          select: {
            quantityOnHand: true,
            quantityReserved: true,
          },
        },
        defaultSupplier: {
          select: {
            id: true,
            name: true,
          },
        },
        reservations: {
          where: {
            status: "ACTIVE",
            reservedFor: "WorkOrder",
          },
          select: {
            id: true,
            quantity: true,
            reservedFor: true,
            reservedForId: true,
          },
        },
      },
      orderBy: [{ sku: "asc" }],
    });

    // Collect item IDs for batch order queries
    const itemIds = items.map((i) => i.id);

    // Use the shared service method to get On Req / On PO quantities.
    // See inventoryService.getOnOrderQuantities() for the canonical definitions.
    const { reqMap: reqQtyMap, poMap: poQtyMap } =
      await inventoryService.getOnOrderQuantities(itemIds);

    // Fetch detailed req/PO data for display (numbers, IDs, link status, expected dates).
    // Runs in parallel with zero extra round trips.
    const CLOSED_PO_STATUSES_DETAIL = [
      "Cancelled",
      "Closed",
      "Completed",
      "cancelled",
      "closed",
      "completed",
    ];
    const [detailReqLines, detailPoLines] = await Promise.all([
      // All non-cancelled/non-fulfilled req lines — ORDERED ones show the linked PO
      prisma.requisitionLine.findMany({
        where: {
          inventoryItemId: { in: itemIds },
          lineStatus: { notIn: ["CANCELLED", "FULFILLED"] as never[] },
          requisition: { status: { notIn: ["Cancelled", "Rejected"] } },
        },
        select: {
          inventoryItemId: true,
          quantity: true,
          lineStatus: true,
          requisitionId: true,
          purchaseOrderId: true,
          purchaseOrderNumber: true,
          requisition: { select: { reqNumber: true } },
        },
      }),
      // All open PO lines
      prisma.pOLine.findMany({
        where: {
          inventoryItemId: { in: itemIds },
          purchaseOrder: { status: { notIn: CLOSED_PO_STATUSES_DETAIL } },
        },
        select: {
          inventoryItemId: true,
          purchaseOrderId: true,
          quantity: true,
          receivedQuantity: true,
          requisitionId: true,
          requisitionNumber: true,
          purchaseOrder: {
            select: {
              poNumber: true,
              expectedDate: true,
              supplier: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    // Build per-item req detail map (deduplicated by requisitionId)
    const reqDetailMap = new Map<string, ReorderReqDetail[]>();
    for (const rl of detailReqLines) {
      if (!rl.inventoryItemId) continue;
      const list = reqDetailMap.get(rl.inventoryItemId) ?? [];
      const existing = list.find((r) => r.reqId === rl.requisitionId);
      const isLinked = rl.lineStatus === "ORDERED" && !!rl.purchaseOrderId;
      if (existing) {
        existing.qty += Number(rl.quantity);
        if (isLinked && !existing.linkedPoId) {
          existing.linkedPoId = rl.purchaseOrderId ?? null;
          existing.linkedPoNumber = rl.purchaseOrderNumber ?? null;
        }
      } else {
        list.push({
          reqId: rl.requisitionId,
          reqNumber: rl.requisition.reqNumber,
          qty: Number(rl.quantity),
          linkedPoId: isLinked ? (rl.purchaseOrderId ?? null) : null,
          linkedPoNumber: isLinked ? (rl.purchaseOrderNumber ?? null) : null,
        });
      }
      reqDetailMap.set(rl.inventoryItemId, list);
    }

    // Build per-item PO detail map (deduplicated by purchaseOrderId)
    const poDetailMap = new Map<string, ReorderPoDetail[]>();
    for (const pl of detailPoLines) {
      if (!pl.inventoryItemId) continue;
      const remaining = Math.max(
        0,
        Number(pl.quantity) - Number(pl.receivedQuantity),
      );
      const list = poDetailMap.get(pl.inventoryItemId) ?? [];
      const existing = list.find((p) => p.poId === pl.purchaseOrderId);
      if (existing) {
        existing.qty += remaining;
      } else {
        list.push({
          poId: pl.purchaseOrderId,
          poNumber: pl.purchaseOrder.poNumber,
          qty: remaining,
          expectedDate: pl.purchaseOrder.expectedDate?.toISOString() ?? null,
          supplierId: pl.purchaseOrder.supplier?.id ?? null, // eslint-disable-line @typescript-eslint/no-unnecessary-condition
          supplierName: pl.purchaseOrder.supplier?.name ?? null, // eslint-disable-line @typescript-eslint/no-unnecessary-condition
          linkedReqId: pl.requisitionId ?? null,
          linkedReqNumber: pl.requisitionNumber ?? null,
        });
      }
      poDetailMap.set(pl.inventoryItemId, list);
    }

    // Collect all unique work order IDs from reservations
    const workOrderIds = new Set<string>();
    for (const item of items) {
      for (const reservation of item.reservations) {
        if (reservation.reservedForId) {
          workOrderIds.add(reservation.reservedForId);
        }
      }
    }

    // Get all work orders that have reservations
    // We show ALL work orders with active reservations, regardless of planned date
    // The date range filter is just for the dashboard view context, not for filtering WOs
    const workOrders = await prisma.workOrder.findMany({
      where: {
        id: { in: Array.from(workOrderIds) },
      },
      select: {
        id: true,
        woNumber: true,
        title: true,
        priority: true,
        status: true,
        plannedStartDate: true,
      },
    });

    // Create a map of work orders by ID for quick lookup
    const workOrderMap = new Map(workOrders.map((wo) => [wo.id, wo]));

    // Transform items into dashboard format
    const dashboardItems: ReorderDashboardItem[] = [];
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let totalReserved = 0;
    let highPriorityWOCount = 0;
    const highPriorityWOs = new Set<string>();
    let uncoveredOutCount = 0;
    let reqOnlyOutCount = 0;
    let poOutCount = 0;
    let uncoveredLowCount = 0;
    let buyToOrderCount = 0;

    for (const item of items) {
      // Calculate current stock
      const currentStock = item.stock.reduce(
        (sum, s) => sum + Number(s.quantityOnHand),
        0,
      );

      // Calculate reserved quantity
      const reservedQuantity = item.reservations.reduce(
        (sum, r) => sum + Number(r.quantity),
        0,
      );

      const minQty = Number(item.minQuantity);
      const maxQty = Number(item.maxQuantity);
      const isUntracked = minQty === 0 && maxQty === 0;

      // minQty must be > 0 — items with min=0 have no reorder threshold and are never "low stock"
      const isLowStock = minQty > 0 && currentStock <= minQty;
      // Only flag as "out of stock" if the item has a min quantity set (i.e., it's a stocked item)
      const isOutOfStock = currentStock === 0 && minQty > 0;

      // For 0/0 untracked items: only include if they have an open req or PO (Buy to Order).
      // Untracked items with nothing in flight are silently skipped — they have no reorder policy.
      if (isUntracked) {
        const openReqsEarly = reqDetailMap.get(item.id) ?? [];
        const openPosEarly = poDetailMap.get(item.id) ?? [];
        if (openReqsEarly.length === 0 && openPosEarly.length === 0) continue;
      }

      // For tracked items: apply legacy filters
      if (
        showReservedOnly &&
        reservedQuantity === 0 &&
        !isOutOfStock &&
        !isUntracked
      ) {
        continue;
      }
      if (lowStockOnly && (!isLowStock || isUntracked)) {
        continue;
      }

      // Group reservations by work order
      const woReservationMap = new Map<string, WorkOrderReservation>();

      for (const reservation of item.reservations) {
        // Check if this reservation is for a work order in our date range
        const woId = reservation.reservedForId;
        if (!woId || reservation.reservedFor !== "WorkOrder") continue;

        const workOrder = workOrderMap.get(woId);
        if (!workOrder) continue; // Work order not in date range

        if (woReservationMap.has(woId)) {
          // Add to existing work order quantity
          const existing = woReservationMap.get(woId);
          if (existing) {
            existing.quantity += Number(reservation.quantity);
          }
        } else {
          // Create new work order entry
          woReservationMap.set(woId, {
            id: workOrder.id,
            number: workOrder.woNumber,
            title: workOrder.title,
            quantity: Number(reservation.quantity),
            priority: workOrder.priority,
            status: workOrder.status,
            scheduledDate: workOrder.plannedStartDate,
          });

          // Track high priority work orders
          if (
            workOrder.priority === "High" ||
            workOrder.priority === "Critical"
          ) {
            highPriorityWOs.add(woId);
          }
        }
      }

      // Convert work order map to array
      const workOrdersForItem = Array.from(woReservationMap.values()).sort(
        (a, b) => {
          // Sort by priority (Critical > High > Normal > Low)
          const priorityOrder: Record<string, number> = {
            Critical: 0,
            High: 1,
            Normal: 2,
            Low: 3,
          };
          const aPriority = priorityOrder[a.priority] ?? 2;
          const bPriority = priorityOrder[b.priority] ?? 2;

          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }

          // Then by scheduled date (earliest first)
          if (a.scheduledDate && b.scheduledDate) {
            return a.scheduledDate.getTime() - b.scheduledDate.getTime();
          }
          if (a.scheduledDate) return -1;
          if (b.scheduledDate) return 1;

          return 0;
        },
      );

      // Look up order quantities and detail lists
      const reqData = reqQtyMap.get(item.id);
      const poData = poQtyMap.get(item.id);
      const openReqs = reqDetailMap.get(item.id) ?? [];
      const openPos = poDetailMap.get(item.id) ?? [];

      // Compute coverage-aware stock status
      const hasOpenPO = openPos.length > 0;
      const hasOpenReqNotYetPO = openReqs.some((r) => !r.linkedPoId);
      let stockStatus: StockStatus;
      if (isUntracked) {
        // min/max = 0/0 but has an open req or PO — Buy to Order
        stockStatus = "BUY_TO_ORDER";
      } else if (isOutOfStock) {
        if (hasOpenPO) stockStatus = "PO_OUT";
        else if (hasOpenReqNotYetPO) stockStatus = "REQ_ONLY_OUT";
        else stockStatus = "UNCOVERED_OUT";
      } else if (isLowStock) {
        stockStatus = "UNCOVERED_LOW";
      } else {
        stockStatus = "OK";
      }

      // Add to dashboard items
      dashboardItems.push({
        id: item.id,
        sku: item.sku,
        description: item.description,
        unit: item.unit,
        currentStock,
        minQuantity: Number(item.minQuantity),
        maxQuantity: Number(item.maxQuantity),
        isLowStock,
        stockStatus,
        reservedQuantity,
        defaultSupplier: item.defaultSupplier
          ? { id: item.defaultSupplier.id, name: item.defaultSupplier.name }
          : null,
        leadTimeDays: item.leadTimeDays,
        workOrders: workOrdersForItem,
        onReqQty: reqData?.qty ?? 0,
        onReqLineCount: reqData?.count ?? 0,
        onPOQty: poData?.qty ?? 0,
        onPOLineCount: poData?.count ?? 0,
        openReqs,
        openPos,
      });

      // Update summary stats
      if (isLowStock) lowStockCount++;
      if (isOutOfStock) outOfStockCount++;
      totalReserved += reservedQuantity;

      // Status-specific counts
      if (stockStatus === "UNCOVERED_OUT") uncoveredOutCount++;
      else if (stockStatus === "REQ_ONLY_OUT") reqOnlyOutCount++;
      else if (stockStatus === "PO_OUT") poOutCount++;
      else if (stockStatus === "UNCOVERED_LOW") uncoveredLowCount++;
      else if (stockStatus === "BUY_TO_ORDER") buyToOrderCount++;
    }

    highPriorityWOCount = highPriorityWOs.size;

    // Sort dashboard items: low stock first, then by reserved quantity (descending)
    dashboardItems.sort((a, b) => {
      if (a.isLowStock !== b.isLowStock) {
        return a.isLowStock ? -1 : 1;
      }
      if (a.reservedQuantity !== b.reservedQuantity) {
        return b.reservedQuantity - a.reservedQuantity;
      }
      return a.sku.localeCompare(b.sku);
    });

    return {
      summary: {
        lowStockCount,
        outOfStockCount,
        totalReserved,
        highPriorityWOCount,
        uncoveredOutCount,
        reqOnlyOutCount,
        poOutCount,
        uncoveredLowCount,
        buyToOrderCount,
      },
      items: dashboardItems,
    };
  }
}

// Export singleton instance
const globalForInventoryReorder = globalThis as unknown as {
  inventoryReorderService: InventoryReorderService | undefined;
};
export const inventoryReorderService =
  globalForInventoryReorder.inventoryReorderService ??
  (globalForInventoryReorder.inventoryReorderService =
    new InventoryReorderService());
