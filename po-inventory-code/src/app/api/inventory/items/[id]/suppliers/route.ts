/**
 * Inventory Item Suppliers API Routes
 *
 * Main CRUD endpoints for managing supplier relationships for inventory items.
 * Uses the inventoryItemSupplierService for business logic.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 300; // Cache for 300 seconds

import { NextRequest } from "next/server";
import { created, paginated } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryItemSupplierService } from "@/services/inventory";
import {
  inventoryItemSupplierCreateSchema,
  InventoryItemSupplierCreateDTO,
} from "@/services/inventory/inventory-item-supplier.types";
import { checkPermission } from "@/services/shared/permissions";
import {
  buildPermissionString,
  PermissionAction,
  PermissionResource,
} from "@/types/permissions";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema for listing suppliers
 */
const listQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .default("1")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  limit: z
    .string()
    .optional()
    .default("20")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(100)),
  activeOnly: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

/**
 * GET /api/inventory/items/[id]/suppliers
 * List all suppliers for an inventory item with pagination
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (req: NextRequest, context: ApiContextWithParams) => {
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
    const validatedQuery = listQuerySchema.parse(queryParams);

    const { page, limit, activeOnly } = validatedQuery;

    // Get inventory item ID from params
    const inventoryItemId = context.params.id;

    // Call service
    const result = await inventoryItemSupplierService.listForItem(
      context.serviceContext,
      inventoryItemId,
      {
        page,
        limit,
        activeOnly,
      }
    );

    return paginated(
      result.data,
      result.pagination,
      "Suppliers retrieved successfully"
    );
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/inventory/items/[id]/suppliers
 * Create a new supplier relationship for an inventory item
 */
export const POST = createApiHandler(
  { bodySchema: inventoryItemSupplierCreateSchema, hasParams: true },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<
      { id: string },
      InventoryItemSupplierCreateDTO
    >,
  ) => {
    try {
    // Ensure inventoryItemId in body matches URL param
    const inventoryItemId = context.params.id;
    const data = {
      ...context.data,
      inventoryItemId,
    };

    // Call service
    const supplier = await inventoryItemSupplierService.create(
      context.serviceContext,
      data
    );

    return created(supplier, "Supplier relationship created successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
