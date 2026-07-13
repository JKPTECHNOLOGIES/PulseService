/**
 * Requisition Statistics Service
 *
 * Responsibilities:
 * - Calculate comprehensive requisition statistics
 * - Generate financial metrics
 * - Calculate performance metrics
 * - Analyze requestor performance
 * - Track department statistics
 *
 * PERF: All aggregations are executed at the DB layer using groupBy / aggregate /
 * count instead of pulling every requisition row into Node.js memory.  The previous
 * implementation called findMany({ include: { lines: true } }) with no limit,
 * which on a large database loaded every requisition + all their line items on
 * every visit to the requisitions page.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import {
  RequisitionStatus,
  RequisitionPriority,
  type RequisitionStatistics,
  type RequisitionStatisticsFilters,
} from "./requisition.types";

/**
 * Requisition Statistics Service
 *
 * Provides comprehensive statistics and analytics for requisitions.
 */
class RequisitionStatisticsService {
  /**
   * Get comprehensive requisition statistics
   *
   * @param ctx - Service context with user and permissions
   * @param filters - Optional filters for date range, requestor, status
   * @returns Comprehensive statistics object
   */
  async getStatistics(
    ctx: ServiceContext,
    filters?: RequisitionStatisticsFilters,
  ): Promise<RequisitionStatistics> {
    try {
      const permission = buildPermissionString(
        PermissionResource.PURCHASING,
        PermissionAction.READ,
      );
      await checkPermission(ctx, permission);

      // Build where clause based on filters
      const where: Prisma.RequisitionWhereInput = {};
      if (filters?.startDate || filters?.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
      }
      if (filters?.requestorId) {
        where.requestedById = filters.requestorId;
      }
      if (filters?.status) {
        where.status = filters.status;
      }

      // ── Run all aggregation queries in parallel ─────────────────────────
      const [
        statusAgg,        // count by status
        priorityAgg,      // count by priority
        totalAgg,         // overall count
        requestorAgg,     // top-10 requestors by count
        valueAgg,         // total + avg from stored budget header amounts
        approvedReqs,     // lightweight rows for approval-time metric
      ] = await Promise.all([
        // 1. Per-status counts
        prisma.requisition.groupBy({
          by: ["status"],
          where,
          _count: { id: true },
        }),

        // 2. Per-priority counts
        prisma.requisition.groupBy({
          by: ["priority"],
          where,
          _count: { id: true },
        }),

        // 3. Overall count
        prisma.requisition.aggregate({
          where,
          _count: { id: true },
        }),

        // 4. Top 10 requestors by requisition count
        prisma.requisition.groupBy({
          by: ["requestedById"],
          where,
          _count: { id: true },
          orderBy: { _count: { requestedById: "desc" } },
          take: 10,
        }),

        // 5. Total + avg value from stored budget header totals.
        //    RequisitionBudgetHeader.totalAmount is persisted on create/update
        //    so we avoid recomputing line-level maths here.
        prisma.requisitionBudgetHeader.aggregate({
          where: { requisition: where },
          _sum: { totalAmount: true },
          _avg: { totalAmount: true },
          _count: { id: true },
        }),

        // 6. Approved requisitions (minimal select) for performance metrics.
        //    Only Approved rows have approvedAt set, so this is a small subset.
        prisma.requisition.findMany({
          where: {
            ...where,
            approvedAt: { not: null },
          },
          select: {
            status: true,
            createdAt: true,
            approvedAt: true,
          },
        }),
      ]);

      // ── Resolve requestor names for the top-10 ────────────────────────
      const requestorIds = requestorAgg.map((r) => r.requestedById);
      const requestors =
        requestorIds.length > 0
          ? await prisma.user.findMany({
              where: { id: { in: requestorIds } },
              select: { id: true, firstName: true, lastName: true },
            })
          : [];
      const requestorNameMap = new Map(
        requestors.map((u) => [u.id, `${u.firstName} ${u.lastName}`]),
      );

      // ── Build byStatus ────────────────────────────────────────────────
      const byStatus: RequisitionStatistics["byStatus"] = {
        [RequisitionStatus.DRAFT]: 0,
        [RequisitionStatus.SUBMITTED]: 0,
        [RequisitionStatus.APPROVED]: 0,
        [RequisitionStatus.REJECTED]: 0,
        [RequisitionStatus.CANCELLED]: 0,
        [RequisitionStatus.ORDERED]: 0,
        [RequisitionStatus.FULFILLED]: 0,
        [RequisitionStatus.PARTIALLY_FULFILLED]: 0,
      };

      for (const row of statusAgg) {
        // Treat legacy "Pending" status as Draft
        const key =
          row.status === "Pending" ? RequisitionStatus.DRAFT : row.status;
        if (key in byStatus) {
          byStatus[key as RequisitionStatus] += row._count.id;
        }
      }

      // ── Build byPriority ──────────────────────────────────────────────
      const byPriority: RequisitionStatistics["byPriority"] = {
        [RequisitionPriority.LOW]: 0,
        [RequisitionPriority.NORMAL]: 0,
        [RequisitionPriority.HIGH]: 0,
        [RequisitionPriority.URGENT]: 0,
      };
      for (const row of priorityAgg) {
        if (row.priority in byPriority) {
          byPriority[row.priority as RequisitionPriority] = row._count.id;
        }
      }

      const totalCount = totalAgg._count.id;
      const totalValue = Number(valueAgg._sum.totalAmount ?? 0);
      const averageValue = Number(valueAgg._avg.totalAmount ?? 0);

      // ── Performance metrics (derived from the small approved subset) ──
      const performance = this.calculatePerformanceMetrics(
        approvedReqs,
        byStatus,
        totalCount,
      );

      return {
        totalCount,
        byStatus,
        byPriority,
        totalValue,
        averageValue,
        averageApprovalTime: performance.averageApprovalTime,
        approvalRate: performance.approvalRate,
        conversionRate: performance.conversionRate,
        topRequestors: requestorAgg.map((r) => ({
          userId: r.requestedById,
          userName: requestorNameMap.get(r.requestedById) ?? "Unknown",
          count: r._count.id,
          totalValue: 0, // Per-requestor value requires a heavier query; omit for now
        })),
        byDepartment: [],
      };
    } catch (error) {
      throw new Error(
        `Failed to get requisition statistics: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Calculate performance metrics from already-fetched approved rows.
   * Derives approval/conversion rates from byStatus counts already in memory.
   */
  private calculatePerformanceMetrics(
    approvedReqs: Array<{
      status: string;
      createdAt: Date;
      approvedAt: Date | null;
    }>,
    byStatus: RequisitionStatistics["byStatus"],
    totalCount: number,
  ): {
    averageApprovalTime: number;
    approvalRate: number;
    conversionRate: number;
  } {
    // Average time from creation to approval (hours)
    let averageApprovalTime = 0;
    if (approvedReqs.length > 0) {
      const totalApprovalTime = approvedReqs.reduce((sum, req) => {
        if (!req.approvedAt) return sum;
        return (
          sum +
          (req.approvedAt.getTime() - req.createdAt.getTime()) /
            (1000 * 60 * 60)
        );
      }, 0);
      averageApprovalTime = totalApprovalTime / approvedReqs.length;
    }

    // Approval rate = (approved or beyond) / (non-draft, non-cancelled)
    const nonDraftNonCancelled =
      totalCount -
      byStatus[RequisitionStatus.DRAFT] -
      byStatus[RequisitionStatus.CANCELLED];
    const approvedOrBeyond =
      byStatus[RequisitionStatus.APPROVED] +
      byStatus[RequisitionStatus.ORDERED] +
      byStatus[RequisitionStatus.PARTIALLY_FULFILLED] +
      byStatus[RequisitionStatus.FULFILLED];
    const approvalRate =
      nonDraftNonCancelled > 0
        ? (approvedOrBeyond / nonDraftNonCancelled) * 100
        : 0;

    // Conversion rate = ordered or fulfilled / (approved or beyond)
    const convertedCount =
      byStatus[RequisitionStatus.ORDERED] +
      byStatus[RequisitionStatus.PARTIALLY_FULFILLED] +
      byStatus[RequisitionStatus.FULFILLED];
    const conversionRate =
      approvedOrBeyond > 0 ? (convertedCount / approvedOrBeyond) * 100 : 0;

    return { averageApprovalTime, approvalRate, conversionRate };
  }
}

const globalForReqStatistics = globalThis as unknown as {
  requisitionStatisticsService: RequisitionStatisticsService | undefined;
};
export const requisitionStatisticsService =
  globalForReqStatistics.requisitionStatisticsService ??
  (globalForReqStatistics.requisitionStatisticsService =
    new RequisitionStatisticsService());
