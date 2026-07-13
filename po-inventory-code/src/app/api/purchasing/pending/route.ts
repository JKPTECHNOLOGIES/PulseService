/**
 * Pending Purchase Orders API
 *
 * GET /api/purchasing/pending
 * Returns pending purchase orders awaiting approval or processing
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema
 */
const querySchema = z.object({
  limit: z.coerce.number().int().positive().default(50),
});

/**
 * GET /api/purchasing/pending
 *
 * Get pending purchase orders
 *
 * Query Parameters:
 * - limit: Maximum number of records to return (default: 50)
 *
 * Returns:
 * - 200: Pending purchase orders data
 * - 401: Unauthorized
 * - 403: Forbidden (insufficient permissions)
 * - 500: Internal server error
 */
export const GET = createApiHandler(
  {
    permission: "dashboard:read",
  },
  async (req: NextRequest, _context: BaseApiContext) => {
    try {
    // Parse and validate query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const validatedQuery = querySchema.parse(queryParams);

    // Get pending purchase orders
    const pendingPOs = await prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: ["Draft", "Pending Approval", "Approved"],
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
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { orderDate: "desc" }],
      take: validatedQuery.limit,
    });

    // Transform to response format
    const orders = pendingPOs.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      totalAmount: Number(po.totalAmount),
      supplier: {
        id: po.supplier.id,
        name: po.supplier.name,
        code: po.supplier.code ?? "",
      },
      itemCount: po.lines.length,
    }));

    // Calculate summary metrics
    const byStatus = {
      draft: orders.filter((o) => o.status === "Draft").length,
      pendingApproval: orders.filter((o) => o.status === "Pending Approval")
        .length,
      approved: orders.filter((o) => o.status === "Approved").length,
    };

    const totalValue = orders.reduce((sum, o) => sum + o.totalAmount, 0);

    // Calculate average age (days since order date)
    const now = new Date();
    const avgAgeDays =
      orders.length > 0
        ? orders.reduce((sum, o) => {
            const days =
              (now.getTime() - o.orderDate.getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / orders.length
        : 0;

    const result = {
      count: orders.length,
      byStatus,
      totalValue: Math.round(totalValue * 100) / 100,
      avgAgeDays: Math.round(avgAgeDays * 10) / 10,
      orders,
    };

    // Return response with cache headers (5 minutes)
    const response = success(
      result,
      "Pending purchase orders retrieved successfully"
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
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
