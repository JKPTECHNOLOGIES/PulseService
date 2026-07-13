/**
 * Purchase Order Statistics Service
 *
 * Responsibilities:
 * - Calculate comprehensive PO statistics
 * - Generate financial metrics
 * - Calculate performance metrics
 * - Analyze supplier performance
 * - Track overdue orders
 *
 * PERF: All aggregations are executed at the DB layer using groupBy / aggregate /
 * count instead of pulling every PO row into Node.js memory.  The previous
 * implementation called findMany({ include: { lines: true } }) with no limit,
 * which on a large database could load tens-of-thousands of rows on every
 * single visit to the PO list page.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/types/service-types";
import {
  buildPermissionString,
  PermissionAction,
  PermissionResource,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import { PurchaseOrderStatus } from "./purchase-order.types";

/**
 * Statistics interface for purchase orders
 */
export interface PurchaseOrderStats {
  totalCount: number;
  byStatus: {
    draft: number;
    submitted: number;
    approved: number;
    ordered: number;
    partiallyReceived: number;
    received: number;
    invoiced: number;
    closed: number;
    cancelled: number;
  };
  financial: {
    totalValue: number;
    averageValue: number;
    totalByStatus: {
      [key: string]: number;
    };
  };
  performance: {
    onTimeDeliveryRate: number;
    averageLeadTime: number;
    approvalRate: number;
  };
  topSuppliers: Array<{
    supplierId: string;
    supplierName: string;
    orderCount: number;
    totalValue: number;
  }>;
  overdueOrders: number;
}

/**
 * Purchase Order Statistics Service
 *
 * Provides comprehensive statistics and analytics for purchase orders.
 */
class PurchaseOrderStatisticsService {
  /**
   * Get comprehensive purchase order statistics
   *
   * @param ctx - Service context with user and permissions
   * @param filters - Optional filters for date range and supplier
   * @returns Comprehensive statistics object
   */
  async getStats(
    ctx: ServiceContext,
    filters?: {
      startDate?: Date;
      endDate?: Date;
      supplierId?: string;
    },
  ): Promise<PurchaseOrderStats> {
    try {
      const permission = buildPermissionString(
        PermissionResource.PURCHASING,
        PermissionAction.READ,
      );
      await checkPermission(ctx, permission);

      // Build where clause based on filters
      const where: Prisma.PurchaseOrderWhereInput = {};
      if (filters?.startDate || filters?.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
      }
      if (filters?.supplierId) {
        where.supplierId = filters.supplierId;
      }

      // ── Run all aggregation queries in parallel ─────────────────────────
      // Each query is a single efficient DB-level operation rather than
      // loading all rows into memory.
      const [
        statusAgg,       // count + sum by status
        totalAgg,        // overall count / sum / avg
        supplierAgg,     // top-10 suppliers by spend
        overdueCount,    // count of overdue ORDERED POs
        receivedPOs,     // lightweight rows for performance metrics
      ] = await Promise.all([
        // 1. Per-status counts and financial totals
        prisma.purchaseOrder.groupBy({
          by: ["status"],
          where,
          _count: { id: true },
          _sum: { totalAmount: true },
        }),

        // 2. Overall totals
        prisma.purchaseOrder.aggregate({
          where,
          _count: { id: true },
          _sum: { totalAmount: true },
          _avg: { totalAmount: true },
        }),

        // 3. Top 10 suppliers by total spend
        prisma.purchaseOrder.groupBy({
          by: ["supplierId"],
          where,
          _count: { id: true },
          _sum: { totalAmount: true },
          orderBy: { _sum: { totalAmount: "desc" } },
          take: 10,
        }),

        // 4. Overdue orders (Ordered status, past expected delivery date)
        prisma.purchaseOrder.count({
          where: {
            ...where,
            status: PurchaseOrderStatus.ORDERED,
            expectedDate: { lt: new Date() },
          },
        }),

        // 5. Received/Closed POs — only the fields needed for performance
        //    metrics.  This is a much smaller set than all POs.
        prisma.purchaseOrder.findMany({
          where: {
            ...where,
            status: {
              in: [
                PurchaseOrderStatus.RECEIVED,
                PurchaseOrderStatus.CLOSED,
              ],
            },
          },
          select: {
            status: true,
            orderDate: true,
            expectedDate: true,
            receivedDate: true,
          },
        }),
      ]);

      // ── Resolve supplier names for the top-10 suppliers ────────────────
      const topSupplierIds = supplierAgg.map((s) => s.supplierId);
      const suppliers =
        topSupplierIds.length > 0
          ? await prisma.supplier.findMany({
              where: { id: { in: topSupplierIds } },
              select: { id: true, name: true },
            })
          : [];
      const supplierNameMap = new Map(suppliers.map((s) => [s.id, s.name]));

      // ── Build byStatus counts and financial.totalByStatus ──────────────
      const byStatus: PurchaseOrderStats["byStatus"] = {
        draft: 0,
        submitted: 0,
        approved: 0,
        ordered: 0,
        partiallyReceived: 0,
        received: 0,
        invoiced: 0,
        closed: 0,
        cancelled: 0,
      };
      const totalByStatus: { [key: string]: number } = {};

      for (const row of statusAgg) {
        const key = this.normalizeStatusKey(row.status);
        if (key in byStatus) {
          byStatus[key as keyof typeof byStatus] = row._count.id;
        }
        totalByStatus[row.status] = Number(row._sum.totalAmount ?? 0);
      }

      // ── Performance metrics (computed from the small received subset) ──
      const performance = this.calculatePerformanceMetrics(
        receivedPOs,
        byStatus,
        totalAgg._count.id,
      );

      return {
        totalCount: totalAgg._count.id,
        byStatus,
        financial: {
          totalValue: Number(totalAgg._sum.totalAmount ?? 0),
          averageValue: Number(totalAgg._avg.totalAmount ?? 0),
          totalByStatus,
        },
        performance,
        topSuppliers: supplierAgg.map((s) => ({
          supplierId: s.supplierId,
          supplierName: supplierNameMap.get(s.supplierId) ?? "Unknown",
          orderCount: s._count.id,
          totalValue: Number(s._sum.totalAmount ?? 0),
        })),
        overdueOrders: overdueCount,
      };
    } catch (error) {
      throw new Error(
        `Failed to get purchase order statistics: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Calculate performance metrics from the already-fetched received/closed rows.
   * Also derives approvalRate from the byStatus counts already in memory —
   * no extra DB round-trip needed.
   */
  private calculatePerformanceMetrics(
    receivedPOs: Array<{
      status: string;
      orderDate: Date;
      expectedDate: Date | null;
      receivedDate: Date | null;
    }>,
    byStatus: PurchaseOrderStats["byStatus"],
    totalCount: number,
  ): PurchaseOrderStats["performance"] {
    let onTimeDeliveryRate = 0;
    let averageLeadTime = 0;

    if (receivedPOs.length > 0) {
      // On-time delivery rate
      const onTimeCount = receivedPOs.filter((po) => {
        if (!po.expectedDate || !po.receivedDate) return false;
        return po.receivedDate <= po.expectedDate;
      }).length;
      onTimeDeliveryRate = (onTimeCount / receivedPOs.length) * 100;

      // Average lead time in days
      const totalLeadTime = receivedPOs.reduce((sum, po) => {
        if (!po.receivedDate) return sum;
        return (
          sum +
          Math.floor(
            (po.receivedDate.getTime() - po.orderDate.getTime()) /
              (1000 * 60 * 60 * 24),
          )
        );
      }, 0);
      averageLeadTime = totalLeadTime / receivedPOs.length;
    }

    // Approval rate derived from byStatus counts (no extra query)
    const nonDraftNonCancelledCount =
      totalCount - byStatus.draft - byStatus.cancelled;
    const approvedOrBeyondCount =
      byStatus.approved +
      byStatus.ordered +
      byStatus.partiallyReceived +
      byStatus.received +
      byStatus.closed;

    const approvalRate =
      nonDraftNonCancelledCount > 0
        ? (approvedOrBeyondCount / nonDraftNonCancelledCount) * 100
        : 0;

    return { onTimeDeliveryRate, averageLeadTime, approvalRate };
  }

  /**
   * Normalize status key to match interface
   * Converts PrismaClient status enum to camelCase keys
   *
   * @param status - Prisma status value
   * @returns Normalized status key
   */
  private normalizeStatusKey(status: string): string {
    const statusMap: Record<string, string> = {
      Draft: "draft",
      Submitted: "submitted",
      Approved: "approved",
      Ordered: "ordered",
      PartiallyReceived: "partiallyReceived",
      Received: "received",
      Invoiced: "invoiced",
      Closed: "closed",
      Cancelled: "cancelled",
    };
    return statusMap[status] ?? status.toLowerCase();
  }
}

export const purchaseOrderStatisticsService =
  new PurchaseOrderStatisticsService();
