/**
 * RMA Utilities
 *
 * Shared utility functions for RMA operations.
 * These functions are pure and have no side effects.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { RMAWithRelations } from "./rma.types";

/**
 * Generate unique RMA number
 * Format: RMA-NNNNNN (6 digits, zero-padded)
 *
 * Uses an atomic documentCounter increment — no scans, no race conditions.
 */
export async function generateRMANumber(prisma: PrismaClient): Promise<string> {
  const counter = await prisma.documentCounter.upsert({
    where: { name: "RMA" },
    create: { name: "RMA", nextValue: 1 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return `RMA-${String(counter.nextValue).padStart(6, "0")}`;
}

/**
 * Calculate total return value from line items
 */
export function calculateTotalReturnValue(
  lines: Array<{ quantityToReturn: number; unitPrice: number }>,
): number {
  return lines.reduce((total, line) => {
    return total + line.quantityToReturn * line.unitPrice;
  }, 0);
}

/**
 * Calculate net refund amount
 */
export function calculateNetRefund(
  totalAmount: number,
  restockingFee: number,
  shippingCost: number,
): number {
  return Math.max(0, totalAmount - restockingFee - shippingCost);
}

/**
 * Transform Prisma RMA to API response format
 * Converts Decimal types to numbers for JSON serialization
 */
export function transformRMA(rma: unknown): RMAWithRelations {
  const r = rma as Record<string, unknown>;

  return {
    ...r,
    totalAmount: Number(r.totalAmount),
    restockingFee: Number(r.restockingFee),
    shippingCost: Number(r.shippingCost),
    netRefundAmount: Number(r.netRefundAmount),
    creditAmount: r.creditAmount ? Number(r.creditAmount) : null,
    lines: Array.isArray(r.lines)
      ? (r.lines as Array<Record<string, unknown>>).map((line) => ({
          ...line,
          quantityToReturn: Number(line.quantityToReturn),
          quantityReturned: Number(line.quantityReturned),
          unitPrice: Number(line.unitPrice),
          totalPrice: Number(line.totalPrice),
          poLine: line.poLine
            ? {
                ...(line.poLine as Record<string, unknown>),
                quantity: Number(
                  (line.poLine as Record<string, unknown>).quantity,
                ),
                unitPrice: Number(
                  (line.poLine as Record<string, unknown>).unitPrice,
                ),
                totalPrice: Number(
                  (line.poLine as Record<string, unknown>).totalPrice,
                ),
              }
            : undefined,
        }))
      : [],
    purchaseOrder: r.purchaseOrder
      ? {
          ...(r.purchaseOrder as Record<string, unknown>),
          totalAmount: Number(
            (r.purchaseOrder as Record<string, unknown>).totalAmount,
          ),
        }
      : undefined,
  } as unknown as RMAWithRelations;
}

/**
 * Build Prisma include clause for RMAs
 */
export function buildRMAInclude(): Prisma.PurchaseOrderReturnInclude {
  return {
    purchaseOrder: {
      select: {
        id: true,
        poNumber: true,
        status: true,
        orderDate: true,
        totalAmount: true,
      },
    },
    supplier: {
      select: {
        id: true,
        name: true,
        code: true,
        email: true,
        phone: true,
      },
    },
    lines: {
      include: {
        poLine: {
          select: {
            id: true,
            description: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
          },
        },
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
          },
        },
        poLineReceipt: {
          select: {
            id: true,
            storeId: true,
            receiptNumber: true,
          },
        },
      },
    },
    approvalHistory: {
      orderBy: {
        approvedAt: "desc" as const,
      },
    },
  };
}

/**
 * Build Prisma where clause from filters
 */
export function buildRMAWhereClause(
  filters: Record<string, unknown>,
): Prisma.PurchaseOrderReturnWhereInput {
  const where: Prisma.PurchaseOrderReturnWhereInput = {};

  if (filters.status) {
    where.status = filters.status as Prisma.EnumRMAStatusFilter;
  }

  if (filters.returnType) {
    where.returnType = filters.returnType as Prisma.EnumRMAReturnTypeFilter;
  }

  if (filters.purchaseOrderId) {
    where.purchaseOrderId = filters.purchaseOrderId as string;
  }

  if (filters.supplierId) {
    where.supplierId = filters.supplierId as string;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.requestedAt = {};
    if (filters.dateFrom) {
      const d = new Date(filters.dateFrom as string);
      d.setHours(0, 0, 0, 0);
      where.requestedAt.gte = d;
    }
    if (filters.dateTo) {
      const d = new Date(filters.dateTo as string);
      d.setHours(23, 59, 59, 999);
      where.requestedAt.lte = d;
    }
  }

  if (filters.search) {
    const q = filters.search as string;
    where.OR = [
      { rmaNumber: { contains: q, mode: "insensitive" } },
      { reason: { contains: q, mode: "insensitive" } },
      { supplierRMANumber: { contains: q, mode: "insensitive" } },
      { trackingNumber: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } },
      { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

/**
 * Check if all line items are inspected
 */
export function areAllItemsInspected(
  lineReturns: Array<{ inspectedAt: Date | null }>,
): boolean {
  return lineReturns.every((line) => line.inspectedAt !== null);
}

/**
 * Check if all line items are disposed
 */
export function areAllItemsDisposed(
  lineReturns: Array<{
    disposition: string;
    restockedAt: Date | null;
    scrapedAt: Date | null;
  }>,
): boolean {
  return lineReturns.every((line) => {
    if (line.disposition === "RESTOCK") {
      return line.restockedAt !== null;
    }
    if (line.disposition === "SCRAP") {
      return line.scrapedAt !== null;
    }
    if (line.disposition === "RETURN_TO_SUPPLIER") {
      return true;
    }
    return false;
  });
}

/**
 * Calculate processing time in days
 */
export function calculateProcessingTime(
  requestedAt: Date,
  completedAt: Date | null,
): number | null {
  if (!completedAt) return null;
  const diffMs = completedAt.getTime() - requestedAt.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get status display name
 */
export function getStatusDisplayName(status: string): string {
  const statusMap: Record<string, string> = {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    PENDING_APPROVAL: "Pending Approval",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    PROCESSING: "Processing",
    SHIPPED: "Shipped",
    RECEIVED_BY_SUPPLIER: "Received by Supplier",
    CREDIT_ISSUED: "Credit Issued",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  };
  return statusMap[status] ?? status;
}

/**
 * Get return type display name
 */
export function getReturnTypeDisplayName(returnType: string): string {
  const typeMap: Record<string, string> = {
    DEFECTIVE: "Defective",
    WRONG_ITEM: "Wrong Item",
    DAMAGED_IN_TRANSIT: "Damaged in Transit",
    NOT_AS_DESCRIBED: "Not as Described",
    OVERSTOCKED: "Overstocked",
    EXPIRED: "Expired",
    WARRANTY_CLAIM: "Warranty Claim",
    OTHER: "Other",
  };
  return typeMap[returnType] ?? returnType;
}

/**
 * Get condition display name
 */
export function getConditionDisplayName(condition: string): string {
  const conditionMap: Record<string, string> = {
    GOOD: "Good",
    DAMAGED: "Damaged",
    EXPIRED: "Expired",
    WRONG_ITEM: "Wrong Item",
    DEFECTIVE: "Defective",
    UNOPENED: "Unopened",
    OPENED_UNUSED: "Opened/Unused",
  };
  return conditionMap[condition] ?? condition;
}

/**
 * Get disposition display name
 */
export function getDispositionDisplayName(disposition: string): string {
  const dispositionMap: Record<string, string> = {
    RESTOCK: "Restock",
    SCRAP: "Scrap",
    RETURN_TO_SUPPLIER: "Return to Supplier",
    REPAIR: "Repair",
    PENDING_INSPECTION: "Pending Inspection",
  };
  return dispositionMap[disposition] ?? disposition;
}
