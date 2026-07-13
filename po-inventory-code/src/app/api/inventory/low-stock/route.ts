/**
 * GET /api/inventory/low-stock
 *
 * Returns inventory items that are at or below their minimum quantity,
 * or have zero available stock (quantityOnHand - quantityReserved <= 0).
 *
 * Exclusions:
 *  - Repairable/serialized items (isRepairable = true)
 *  - Inactive or archived items
 *  - Non-stock items (isStockItem = false)
 *  - Items with both minQuantity = 0 AND maxQuantity = 0 (no tracking thresholds set)
 *
 * Includes procurement intelligence per item:
 *  - openReqLines / openReqQty: active requisition lines NOT yet converted to a PO
 *    (excludes CANCELLED, FULFILLED, and ORDERED statuses — ORDERED means a PO already exists)
 *  - openPoLines / openPoQty: open PO lines (PO not Cancelled/Closed/Completed)
 *  - reservedQty: quantity held in ACTIVE or PENDING reservations
 *  - openReqs: detail list [{requisitionId, reqNumber, quantity}] for hover popover
 *  - openPos: detail list [{poId, poNumber, quantity, expectedDate}] for hover popover
 *
 * Used by the Attention Required banner on the inventory dashboard.
 * Accessible to authenticated sessions only.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { RequisitionLineStatus, ReservationStatus } from "@prisma/client";

export interface OpenReqDetail {
  requisitionId: string;
  reqNumber: string;
  quantity: number;
  /** True when the REQ was preserved after its parent WO was cancelled.
   *  Purchasing must decide whether to continue or cancel this REQ. */
  parentWoCancelled?: boolean;
  parentWoNumber?: string;
}

export interface OpenPoDetail {
  poId: string;
  poNumber: string;
  quantity: number;
  /** ISO date string or null */
  expectedDate: string | null;
}

export interface LowStockItem {
  id: string;
  sku: string;
  description: string;
  category: string | null;
  /** Total quantityOnHand across all stores */
  totalOnHand: number;
  /** Total quantityReserved across all stores */
  totalReserved: number;
  /** availableQty = totalOnHand - totalReserved */
  availableQuantity: number;
  minQuantity: number;
  reorderPoint: number | null;
  /** "OUT_OF_STOCK" | "LOW_STOCK" */
  stockStatus: "OUT_OF_STOCK" | "LOW_STOCK";
  /** Count of active/pending requisition lines (not yet converted to PO) */
  openReqLines: number;
  /** Total quantity across open req lines */
  openReqQty: number;
  /** Count of open PO lines for this item */
  openPoLines: number;
  /** Total quantity across open PO lines */
  openPoQty: number;
  /** Total quantity held in ACTIVE or PENDING reservations */
  reservedQty: number;
  /** Detail per open requisition line for hover popover */
  openReqs: OpenReqDetail[];
  /** Detail per open PO for hover popover */
  openPos: OpenPoDetail[];
}

export interface LowStockResponse {
  items: LowStockItem[];
  /** Total number of low-stock items in the database (may exceed items.length when paginated) */
  total: number;
  counts: {
    outOfStock: number;
    lowStock: number;
    total: number;
  };
}

/** PO statuses that are considered closed / terminal */
const CLOSED_PO_STATUSES: string[] = [
  "Cancelled",
  "Closed",
  "Completed",
  "cancelled",
  "closed",
  "completed",
  "CANCELLED",
  "CLOSED",
  "COMPLETED",
];

/**
 * RequisitionLine statuses that are terminal or already covered by a PO.
 * ORDERED means the line has been converted to a PO — it should count under
 * Open POs, not Open Reqs.
 */
const EXCLUDED_REQ_LINE_STATUSES: RequisitionLineStatus[] = [
  RequisitionLineStatus.CANCELLED,
  RequisitionLineStatus.FULFILLED,
  RequisitionLineStatus.ORDERED,
];

/** Reservation statuses that count as actively reserving stock */
const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = [
  ReservationStatus.ACTIVE,
  ReservationStatus.PENDING,
];

export async function GET(): Promise<NextResponse<LowStockResponse | { error: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const baseWhere = {
      isActive: true,
      isArchived: false,
      isStockItem: true,
      isRepairable: false,
      // Exclude items with no tracking thresholds (both min and max are zero)
      NOT: {
        AND: [
          { minQuantity: 0 },
          { maxQuantity: 0 },
        ],
      },
    };

    // Count total eligible items (for pagination metadata)
    const totalEligibleCount = await prisma.inventoryItem.count({ where: baseWhere });

    // Fetch active, non-archived, non-repairable stock items with their stock levels
    // and procurement relations for intelligence columns.
    const items = await prisma.inventoryItem.findMany({
      where: baseWhere,
      take: 100,
      select: {
        id: true,
        sku: true,
        description: true,
        category: true,
        minQuantity: true,
        maxQuantity: true,
        stock: {
          select: {
            quantityOnHand: true,
            quantityReserved: true,
          },
        },
        // Requisition lines: only lines not yet converted to PO, not cancelled/fulfilled
        requisitionLines: {
          where: {
            lineStatus: {
              notIn: EXCLUDED_REQ_LINE_STATUSES,
            },
          },
          select: {
            quantity: true,
            requisitionId: true,
            requisition: {
              select: {
                reqNumber: true,
                budgetHeader: {
                  select: {
                    workOrderId: true,
                    workOrder: {
                      select: {
                        woNumber: true,
                        status: true,
                        completionNotes: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // PO lines: only lines where the PO is not cancelled/closed/completed
        poLines: {
          where: {
            purchaseOrder: {
              status: {
                notIn: CLOSED_PO_STATUSES,
              },
            },
          },
          select: {
            quantity: true,
            purchaseOrderId: true,
            purchaseOrder: {
              select: {
                poNumber: true,
                expectedDate: true,
              },
            },
          },
        },
        // Active/pending reservations
        reservations: {
          where: {
            status: {
              in: ACTIVE_RESERVATION_STATUSES,
            },
          },
          select: {
            quantity: true,
          },
        },
      },
    });

    const lowStockItems: LowStockItem[] = [];

    for (const item of items) {
      const totalOnHand = item.stock.reduce(
        (sum, s) => sum + Number(s.quantityOnHand),
        0
      );
      const totalReserved = item.stock.reduce(
        (sum, s) => sum + Number(s.quantityReserved),
        0
      );
      const availableQuantity = totalOnHand - totalReserved;
      const minQty = Number(item.minQuantity);

      // Include if out of stock OR at/below min quantity
      const isOutOfStock = availableQuantity <= 0;
      const isLowStock = !isOutOfStock && availableQuantity <= minQty;

      if (isOutOfStock || isLowStock) {
        // Procurement intelligence — requisitions
        const openReqLines = item.requisitionLines.length;
        const openReqQty = item.requisitionLines.reduce(
          (sum, rl) => sum + Number(rl.quantity),
          0
        );

        // Build deduplicated requisition detail list (group by requisitionId)
        const reqMap = new Map<string, OpenReqDetail>();
        for (const rl of item.requisitionLines) {
          const existing = reqMap.get(rl.requisitionId);
          if (existing) {
            existing.quantity += Number(rl.quantity);
          } else {
            const wo = rl.requisition.budgetHeader?.workOrder;
          const woCancelled = wo?.status === "Closed" &&
            (wo.completionNotes ?? "").startsWith("Cancelled:");
          reqMap.set(rl.requisitionId, {
            requisitionId: rl.requisitionId,
            reqNumber: rl.requisition.reqNumber,
            quantity: Number(rl.quantity),
            parentWoCancelled: woCancelled,
            parentWoNumber: woCancelled ? wo.woNumber : undefined,
          });
          }
        }
        const openReqs = Array.from(reqMap.values());

        // Procurement intelligence — PO lines
        const openPoLines = item.poLines.length;
        const openPoQty = item.poLines.reduce(
          (sum, pl) => sum + Number(pl.quantity),
          0
        );

        // Build deduplicated PO detail list (group by purchaseOrderId)
        const poMap = new Map<string, OpenPoDetail>();
        for (const pl of item.poLines) {
          const existing = poMap.get(pl.purchaseOrderId);
          if (existing) {
            existing.quantity += Number(pl.quantity);
            // Keep the earliest expected date
            if (pl.purchaseOrder.expectedDate) {
              const newDate = pl.purchaseOrder.expectedDate.toISOString();
              if (!existing.expectedDate || newDate < existing.expectedDate) {
                existing.expectedDate = newDate;
              }
            }
          } else {
            poMap.set(pl.purchaseOrderId, {
              poId: pl.purchaseOrderId,
              poNumber: pl.purchaseOrder.poNumber,
              quantity: Number(pl.quantity),
              expectedDate: pl.purchaseOrder.expectedDate
                ? pl.purchaseOrder.expectedDate.toISOString()
                : null,
            });
          }
        }
        const openPos = Array.from(poMap.values());

        const reservedQty = item.reservations.reduce(
          (sum, r) => sum + Number(r.quantity),
          0
        );

        lowStockItems.push({
          id: item.id,
          sku: item.sku,
          description: item.description,
          category: item.category,
          totalOnHand,
          totalReserved,
          availableQuantity,
          minQuantity: minQty,
          // maxQuantity doubles as reorder point when no dedicated field exists
          reorderPoint: Number(item.maxQuantity),
          stockStatus: isOutOfStock ? "OUT_OF_STOCK" : "LOW_STOCK",
          openReqLines,
          openReqQty,
          openPoLines,
          openPoQty,
          reservedQty,
          openReqs,
          openPos,
        });
      }
    }

    // Default sort: Out of Stock first, then by available qty ascending
    lowStockItems.sort((a, b) => {
      if (a.stockStatus !== b.stockStatus) {
        return a.stockStatus === "OUT_OF_STOCK" ? -1 : 1;
      }
      return a.availableQuantity - b.availableQuantity;
    });

    const outOfStockCount = lowStockItems.filter(
      (i) => i.stockStatus === "OUT_OF_STOCK"
    ).length;

    return NextResponse.json({
      items: lowStockItems,
      total: totalEligibleCount,
      counts: {
        outOfStock: outOfStockCount,
        lowStock: lowStockItems.length - outOfStockCount,
        total: lowStockItems.length,
      },
    });
  } catch (error) {
    logger.error("[low-stock] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch low stock items" },
      { status: 500 }
    );
  }
}
