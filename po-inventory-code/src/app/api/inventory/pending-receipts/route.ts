/**
 * Pending Receipts API
 *
 * Returns purchase orders with pending receipts (partially or not received).
 * Used by Inventory Manager dashboard.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { InternalServerError } from "@/lib/api-errors";
export const GET = createApiHandler(
  { permission: "dashboard:read" },
  async (_req: NextRequest, _context: BaseApiContext) => {
    try {
    // Get purchase orders that are approved/ordered but not fully received
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: ["Approved", "Ordered", "Partial"],
        },
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        lines: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                sku: true,
                name: true,
                description: true,
                category: true,
                unit: true,
              },
            },
          },
        },
      },
      orderBy: {
        expectedDate: "asc",
      },
    });

    // Transform to pending receipts format
    const pendingReceipts = purchaseOrders.map((po) => {
      const lines = po.lines.map((line) => {
        const quantity = Number(line.quantity);
        const receivedQuantity = Number(line.receivedQuantity);
        const pendingQuantity = quantity - receivedQuantity;

        return {
          lineId: line.id,
          inventoryItem: line.inventoryItem
            ? {
                id: line.inventoryItem.id,
                sku: line.inventoryItem.sku,
                name: line.inventoryItem.name ?? line.inventoryItem.description,
                description: line.inventoryItem.description,
                category: line.inventoryItem.category,
                unit: line.inventoryItem.unit,
              }
            : null,
          description: line.description,
          quantity,
          receivedQuantity,
          pendingQuantity,
          unitPrice: Number(line.unitPrice),
          totalPrice: Number(line.totalPrice),
        };
      });

      // Calculate totals
      const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
      const totalReceived = lines.reduce(
        (sum, l) => sum + l.receivedQuantity,
        0
      );
      const totalPending = lines.reduce((sum, l) => sum + l.pendingQuantity, 0);

      // Determine if overdue
      const isOverdue = po.expectedDate
        ? new Date(po.expectedDate) < new Date()
        : false;

      return {
        poId: po.id,
        poNumber: po.poNumber,
        status: po.status,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        receivedDate: po.receivedDate,
        totalAmount: Number(po.totalAmount),
        supplier: po.supplier,
        lines,
        summary: {
          totalQuantity,
          totalReceived,
          totalPending,
          percentageReceived:
            totalQuantity > 0 ? (totalReceived / totalQuantity) * 100 : 0,
        },
        isOverdue,
      };
    });

    // Filter out fully received orders
    const actuallyPending = pendingReceipts.filter(
      (pr) => pr.summary.totalPending > 0
    );

    const response = success(
      {
        receipts: actuallyPending,
        total: actuallyPending.length,
        summary: {
          totalOrders: actuallyPending.length,
          overdueOrders: actuallyPending.filter((pr) => pr.isOverdue).length,
          totalValue: actuallyPending.reduce(
            (sum, pr) => sum + pr.totalAmount,
            0,
          ),
        },
      },
      "Pending receipts retrieved successfully"
    );
    response.headers.set("Cache-Control", "public, s-maxage=120");
    return response;
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
