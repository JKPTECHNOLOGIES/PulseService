/**
 * Inventory Reorder Dashboard API
 *
 * GET /api/inventory/reorder/dashboard
 * - Get reorder dashboard data with reservations in date range
 */

// Always fetch fresh data - no caching for order-status-sensitive data
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { inventoryReorderService } from "@/services/inventory/reorder.service";
import { checkPermission } from "@/services/shared/permissions";
import {
  buildPermissionString,
  PermissionAction,
  PermissionResource,
} from "@/types/permissions";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema for reorder dashboard
 */
const dashboardQuerySchema = z.object({
  startDate: z
    .string()
    .min(1)
    .transform((val) => new Date(val)),
  endDate: z
    .string()
    .min(1)
    .transform((val) => new Date(val)),
  category: z.string().optional(),
  showReservedOnly: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  lowStockOnly: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  search: z.string().optional(),
});

/**
 * GET /api/inventory/reorder/dashboard
 * Get reorder dashboard data with reservations in date range
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
    // Check permission
    const permission = buildPermissionString(
      PermissionResource.INVENTORY,
      PermissionAction.READ
    );
    await checkPermission(context.serviceContext, permission);

    // Parse and validate query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const validatedQuery = dashboardQuerySchema.parse(queryParams);

    const {
      startDate,
      endDate,
      category,
      showReservedOnly,
      lowStockOnly,
      search,
    } = validatedQuery;

    // Get dashboard data
    const data = await inventoryReorderService.getReorderDashboard(
      context.serviceContext,
      {
        startDate,
        endDate,
        category,
        showReservedOnly,
        lowStockOnly,
        search,
      }
    );

    return success(data, "Reorder dashboard data retrieved successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
