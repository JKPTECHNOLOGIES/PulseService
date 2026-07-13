/**
 * Purchase Order Utilities
 *
 * Shared utility functions for purchase order operations.
 * These functions are pure and have no side effects.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PurchaseOrderWithRelations } from "./purchase-order.types";

/**
 * Generate unique purchase order number
 * Format: PO-NNNNNN (6 digits, zero-padded)
 *
 * Atomically increments the 'PO' row in document_counters and returns
 * the new value as the issued number. One DB write, no scans, no race
 * conditions, no dependency on the format or content of existing PO rows.
 *
 * The counter row (name = 'PO') is seeded by seed-document-counters.js.
 * nextValue = 1199 → first call issues PO-001200.
 */
export async function generatePONumber(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<string> {
  const counter = await (prisma as PrismaClient).documentCounter.update({
    where: { name: "PO" },
    data: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return `PO-${String(counter.nextValue).padStart(6, "0")}`;
}

/**
 * Calculate line item total
 * @param quantity - Item quantity
 * @param unitPrice - Price per unit
 * @returns Total price for the line item
 */
export function calculateItemTotal(
  quantity: number,
  unitPrice: number,
): number {
  return quantity * unitPrice;
}

/**
 * Calculate purchase order total
 * Includes line items, shipping, and tax
 * @param lines - Array of line items with totalPrice
 * @param shippingCost - Optional shipping cost
 * @param tax - Optional tax amount
 * @returns Total PO value
 */
export function calculatePOTotal(
  lines: Array<{ totalPrice: number }>,
  shippingCost: number = 0,
  tax: number = 0,
): number {
  const itemsTotal = lines.reduce((sum, line) => sum + line.totalPrice, 0);
  return itemsTotal + shippingCost + tax;
}

/**
 * Transform Prisma purchase order to API response format
 * Converts Decimal types to numbers for JSON serialization
 * @param po - Raw Prisma purchase order object
 * @returns Transformed purchase order with proper types
 */
export function transformPurchaseOrder(
  po: unknown,
): PurchaseOrderWithRelations {
  const p = po as Record<string, unknown>;

  return {
    ...p,
    totalAmount: Number(p.totalAmount),
    lines: Array.isArray(p.lines)
      ? (p.lines as Array<Record<string, unknown>>).map((line) => {
          const inventoryItem = line.inventoryItem as
            | Record<string, unknown>
            | null
            | undefined;
          return {
            ...line,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            totalPrice: Number(line.totalPrice),
            receivedQuantity: Number(line.receivedQuantity ?? 0),
            // Pass through inventoryItem with stock quantities converted from Decimal to number
            inventoryItem: inventoryItem
              ? {
                  ...inventoryItem,
                  stock: Array.isArray(inventoryItem.stock)
                    ? (
                        inventoryItem.stock as Array<Record<string, unknown>>
                      ).map((s) => ({
                        quantityOnHand: Number(s.quantityOnHand),
                        quantityReserved: Number(s.quantityReserved ?? 0),
                      }))
                    : [],
                }
              : null,
          };
        })
      : [],
  } as PurchaseOrderWithRelations;
}

/**
 * Transform individual PO line item
 * Converts Decimal types to numbers
 * @param line - Raw Prisma PO line object
 * @returns Transformed line item
 */
export function transformPurchaseOrderItem(
  line: unknown,
): Record<string, unknown> {
  const l = line as Record<string, unknown>;

  return {
    ...l,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    totalPrice: Number(l.totalPrice),
    receivedQuantity: Number(l.receivedQuantity ?? 0),
  };
}

/**
 * Lightweight Prisma include clause for the PO list endpoint.
 *
 * Omits the deep nesting that is only required on the detail view:
 *   - chargeAllocations (4 extra JOINs per line — accountCode/department/project/area)
 *   - inventoryItem.stock (per-line stock levels)
 *   - supplier.addresses (address history array)
 *
 * For a page of 20 POs with 10 lines each this saves ~1 100 JOIN operations
 * compared to buildPOInclude(), significantly reducing query time and payload.
 */
export function buildPOListInclude(): Prisma.PurchaseOrderInclude {
  return {
    lines: {
      orderBy: [{ lineNumber: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        lineNumber: true,
        lineType: true,
        description: true,
        quantity: true,
        unitPrice: true,
        totalPrice: true,
        approvedUnitPrice: true,
        approvedTotalPrice: true,
        receivedQuantity: true,
        inventoryItemId: true,
        requisitionId: true,
        requisitionLineId: true,
        requisitionNumber: true,
        workOrderId: true,
        workOrderNumber: true,
        requiresInvoiceMatch: true,
        invoiceMatched: true,
        canReceive: true,
        approvedInvoiceAmount: true,
        receivedAmount: true,
        notes: true,
        longTextOverride: true,
        deliveryDate: true,
        serviceType: true,
        consumableCategory: true,
        createdAt: true,
        updatedAt: true,
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
            longText: true,
            minQuantity: true,
            maxQuantity: true,
            unitCost: true,
          },
        },
      },
    },
    supplier: {
      select: {
        id: true,
        name: true,
        code: true,
        email: true,
        phone: true,
        paymentTerms: true,
        isActive: true,
      },
    },
    creator: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    },
    buyer: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
    invoiceApprover: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
  };
}

/**
 * Build Prisma include clause for purchase orders
 * @param _options - Optional array of additional includes
 * @returns Prisma include object — use buildPOListInclude() for list endpoints
 */
export function buildPOInclude(
  _options?: string[],
): Prisma.PurchaseOrderInclude {
  return {
    lines: {
      orderBy: [{ lineNumber: "asc" }, { createdAt: "asc" }],
      include: {
        inventoryItem: {
          include: {
            stock: {
              select: {
                quantityOnHand: true,
                quantityReserved: true,
              },
            },
          },
        },
        // Include receipts so the receive page can compute the authoritative
        // receivedAmount from actual receipt records rather than the denormalized
        // POLine.receivedAmount cache which can drift (M-021).
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            quantityReceived: true,
            totalCost: true,
            unitCost: true,
            status: true,
            isReturn: true,
            receivedAt: true,
            storeId: true,
            bin: true,
          },
        },
        chargeAllocations: {
          include: {
            accountCode: {
              select: {
                id: true,
                code: true,
                name: true,
                glAccountId: true,
              },
            },
            department: {
              select: {
                id: true,
                name: true,
              },
            },
            project: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            area: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    },
    supplier: {
      include: {
        addresses: true,
      },
    },
    creator: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    },
    buyer: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
    invoiceApprover: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
  };
}

/**
 * Fetch work order information for a purchase order's requisitions
 * @param prisma - Prisma client instance
 * @param requisitionIds - Array of requisition IDs
 * @returns Array of work order information
 */
export async function fetchWorkOrdersForRequisitions(
  prisma: PrismaClient,
  requisitionIds: string[],
): Promise<Array<{ id: string; woNumber: string; title: string }>> {
  if (requisitionIds.length === 0) {
    return [];
  }

  // Find requisitions with their budget headers that link to work orders
  const requisitions = await prisma.requisition.findMany({
    where: {
      id: { in: requisitionIds },
    },
    include: {
      budgetHeader: {
        include: {
          workOrder: {
            select: {
              id: true,
              woNumber: true,
              title: true,
            },
          },
        },
      },
    },
  });

  // Extract unique work orders
  const workOrders = requisitions
    .map((req) => req.budgetHeader?.workOrder)
    .filter(
      (wo): wo is { id: string; woNumber: string; title: string } =>
        wo !== null && wo !== undefined,
    );

  // Remove duplicates based on work order ID
  const uniqueWorkOrders = Array.from(
    new Map(workOrders.map((wo) => [wo.id, wo])).values(),
  );

  return uniqueWorkOrders;
}

/**
 * Fetch requisition information with budget data for a purchase order
 * @param prisma - Prisma client instance
 * @param requisitionIds - Array of requisition IDs
 * @returns Array of requisitions with budget information
 */
export async function fetchRequisitionsWithBudget(
  prisma: PrismaClient,
  requisitionIds: string[],
): Promise<
  Array<{
    id: string;
    reqNumber: string;
    status: string;
    requestedBy?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
    budgetHeader?: {
      budgetType: string;
      accountCodeId: string | null;
      workOrderId: string | null;
      totalAmount: number;
      accountCode?: {
        code: string;
        name: string;
      } | null;
      workOrder?: {
        woNumber: string;
      } | null;
    } | null;
    lineAllocations?: Array<{
      id: string;
      requisitionLineId: string | null;
      accountCodeId: string | null;
      departmentId: string | null;
      areaId: string | null;
      projectId: string | null;
      amount: number;
      percentage: number;
      accountCode?: {
        code: string;
        name: string;
      } | null;
      department?: {
        name: string;
      } | null;
      area?: {
        name: string;
      } | null;
      project?: {
        code: string | null;
        name: string;
      } | null;
      requisitionLine?: {
        description: string;
        quantity: number;
        estimatedPrice: number;
      } | null;
    }>;
  }>
> {
  if (requisitionIds.length === 0) {
    return [];
  }

  const requisitions = await prisma.requisition.findMany({
    where: {
      id: { in: requisitionIds },
    },
    select: {
      id: true,
      reqNumber: true,
      status: true,
      requestedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      budgetHeader: {
        select: {
          budgetType: true,
          accountCodeId: true,
          workOrderId: true,
          totalAmount: true,
          accountCode: {
            select: {
              code: true,
              name: true,
            },
          },
          workOrder: {
            select: {
              woNumber: true,
            },
          },
        },
      },
      lineAllocations: {
        select: {
          id: true,
          requisitionLineId: true,
          accountCodeId: true,
          departmentId: true,
          areaId: true,
          projectId: true,
          amount: true,
          percentage: true,
          accountCode: {
            select: {
              code: true,
              name: true,
            },
          },
          department: {
            select: {
              name: true,
            },
          },
          area: {
            select: {
              name: true,
            },
          },
          project: {
            select: {
              code: true,
              name: true,
            },
          },
          requisitionLine: {
            select: {
              description: true,
              quantity: true,
              estimatedPrice: true,
            },
          },
        },
      },
    },
  });

  return requisitions.map((req) => {
    return {
      ...req,
      budgetHeader: req.budgetHeader
        ? {
            ...req.budgetHeader,
            totalAmount: Number(req.budgetHeader.totalAmount),
          }
        : null,
      lineAllocations: req.lineAllocations.map((alloc) => ({
        ...alloc,
        amount: Number(alloc.amount),
        percentage: Number(alloc.percentage),
        requisitionLine: alloc.requisitionLine
          ? {
              description: alloc.requisitionLine.description,
              quantity: Number(alloc.requisitionLine.quantity),
              estimatedPrice: Number(alloc.requisitionLine.estimatedPrice),
            }
          : null,
      })),
    };
  });
}

/**
 * Build Prisma where clause from filters
 * @param filters - Filter object with various criteria
 * @returns Prisma where input object
 */
export function buildPOWhereClause(
  filters: Record<string, unknown>,
): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {};

  if (filters.supplierId) {
    where.supplierId = filters.supplierId as string;
  }

  if (filters.status) {
    const statusStr = filters.status as string;
    if (statusStr.includes(",")) {
      where.status = { in: statusStr.split(",").map((s) => s.trim()) };
    } else {
      where.status = statusStr;
    }
  }

  if (filters.requisitionId) {
    where.notes = {
      contains: filters.requisitionId as string,
    };
  }

  if (filters.dateFrom || filters.dateTo) {
    where.orderDate = {};
    if (filters.dateFrom) {
      where.orderDate.gte = new Date(filters.dateFrom as string);
    }
    if (filters.dateTo) {
      where.orderDate.lte = new Date(filters.dateTo as string);
    }
  }

  return where;
}

/**
 * Check if all items are fully received
 * @param lines - Array of PO lines with quantity and receivedQuantity
 * @returns True if all items are fully received
 */
export function isFullyReceived(
  lines: Array<{ quantity: number; receivedQuantity: number }>,
): boolean {
  return lines.every((line) => line.receivedQuantity >= line.quantity);
}

/**
 * Check if any items are partially received
 * @param lines - Array of PO lines with quantity and receivedQuantity
 * @returns True if some items are received but not all
 */
export function isPartiallyReceived(
  lines: Array<{ quantity: number; receivedQuantity: number }>,
): boolean {
  return (
    lines.some((line) => line.receivedQuantity > 0) && !isFullyReceived(lines)
  );
}
