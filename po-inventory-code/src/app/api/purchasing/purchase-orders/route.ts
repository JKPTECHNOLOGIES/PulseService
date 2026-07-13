/**
 * Purchase Orders API Routes
 *
 * CRUD endpoints for purchase order management.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { z } from "zod";
import { created, paginated } from "@/lib/api-response";
import { createGetHandler, createApiHandler } from "@/lib/api-middleware-v2";
import {
  purchaseOrderService,
  purchaseOrderCreateSchema,
} from "@/services/purchasing/purchase-order";
import { paginationSchema } from "@/lib/validation";
import { supplierCostUpdateService } from "@/services/purchasing/supplier-cost-update.service";
/**
 * Query parameters schema for listing purchase orders
 */
const listQuerySchema = paginationSchema.merge(
  z.object({
    search: z.string().optional(),
    supplierId: z.string().min(1).optional(),
    status: z.string().optional(),
    requisitionId: z.string().min(1).optional(),
    /** Purchasing Manager filter — maps to PurchaseOrder.buyerId */
    buyerId: z.string().min(1).optional(),
    /** Outstanding filter — "true" = open POs with expectedDate in the past */
    outstanding: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    minAmount: z.string().optional(),
    maxAmount: z.string().optional(),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),
);

/**
 * GET /api/purchasing/purchase-orders
 * List all purchase orders with pagination and filtering
 */
export const GET = createGetHandler(async (req, context) => {
  // Parse and validate query parameters
  const url = new URL(req.url);
  const rawParams = {
    page: url.searchParams.get("page") ?? "1",
    limit: url.searchParams.get("limit") ?? "10",
    search: url.searchParams.get("search") ?? undefined,
    supplierId: url.searchParams.get("supplierId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    requisitionId: url.searchParams.get("requisitionId") ?? undefined,
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
    minAmount: url.searchParams.get("minAmount") ?? undefined,
    maxAmount: url.searchParams.get("maxAmount") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    order: url.searchParams.get("order") ?? undefined,
  };

  // Pass strings directly - the schema will transform them
  const validationResult = listQuerySchema.safeParse(rawParams);

  if (!validationResult.success) {
    const { ValidationError } = await import("@/lib/api-errors");
    throw ValidationError.fromZodError(validationResult.error);
  }

  const {
    page,
    limit,
    search,
    supplierId,
    status,
    requisitionId,
    buyerId,
    outstanding,
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
    sort,
    order,
  } = validationResult.data;

  // Build filters
  const filters: Record<string, string> = {};
  if (supplierId) filters.supplierId = supplierId;
  if (status) filters.status = status;
  if (requisitionId) filters.requisitionId = requisitionId;
  if (buyerId) filters.buyerId = buyerId;
  if (outstanding) filters.outstanding = outstanding;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  if (minAmount) filters.minAmount = minAmount;
  if (maxAmount) filters.maxAmount = maxAmount;

  // Call service
  const serviceResult = await purchaseOrderService.list(
    context.serviceContext,
    {
      page,
      limit,
      filters,
      search,
      sort: sort ?? "orderDate",
      order: order ?? "desc",
    },
  );

  return paginated(
    serviceResult.data,
    serviceResult.pagination,
    "Purchase orders retrieved successfully",
  );
});

/**
 * POST /api/purchasing/purchase-orders
 * Create a new purchase order
 *
 * Permission: purchase_orders:create (dedicated PO-creation permission)
 * Roles with this permission: Finance Manager, Purchasing Manager, Admin
 */
export const POST = createApiHandler(
  {
    bodySchema: purchaseOrderCreateSchema,
    permission: "purchase_orders:create",
  },
  async (_req, context) => {
    const purchaseOrder = await purchaseOrderService.create(
      context.serviceContext,
      context.data,
    );

    // Update supplier unit costs based on this PO (async, don't wait)
    void supplierCostUpdateService
      .updateCostsForPurchaseOrder(purchaseOrder.id)
      .catch(() => {
        // Don't fail the PO creation if cost update fails
      });

    return created(purchaseOrder, "Purchase order created successfully");
  },
);
