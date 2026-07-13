/**
 * Inventory API Routes
 *
 * Main CRUD endpoints for inventory management.
 * Uses the inventory service layer for business logic.
 */

// Disable caching for GET requests to show real-time stock/reservation data
export const dynamic = "force-dynamic";
export const revalidate = 0; // No cache - always fetch fresh data

import { NextRequest } from "next/server";
import { created, paginated } from "@/lib/api-response";
import {
  createApiHandler,
  createPostHandler,
  BaseApiContext,
  ApiContextWithData,
} from "@/lib/api-middleware-v2";
import { inventoryService } from "@/services/inventory";
import {
  inventoryItemCreateSchema,
  InventoryItemCreateDTO,
} from "@/services/inventory/inventory.types";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema for listing inventory items
 * Override the limit field to allow up to 1000 items
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
    .default("10")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(200)), // CRITICAL: Reduced from 1000 to 200 to prevent memory exhaustion
  category: z.string().optional(),
  storeId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  equipmentId: z.string().min(1).optional(),
  plannerId: z.string().min(1).optional(),
  lowStock: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  isActive: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  isStockItem: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  isRepairable: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  isAssembly: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  isArchived: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  search: z.string().optional(),
  bin: z.string().optional(),
});

/**
 * GET /api/inventory
 * List all inventory items with pagination, filtering, and search
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
      // Parse and validate query parameters
      const url = new URL(req.url);
      const queryParams = Object.fromEntries(url.searchParams.entries());

      const validatedQuery = listQuerySchema.parse(queryParams);

      const {
        page,
        limit,
        search,
        bin,
        category,
        supplierId,
        equipmentId,
        plannerId,
        isActive,
        isStockItem,
        isRepairable,
        isAssembly,
        isArchived,
      } = validatedQuery;

      // Build filters
      const filters: Record<string, string | boolean> = {};
      if (category) filters.category = category;
      if (supplierId) filters.defaultSupplierId = supplierId;
      if (equipmentId) filters.equipmentId = equipmentId;
      if (plannerId) filters.plannerId = plannerId;
      if (isActive !== undefined) filters.isActive = isActive;
      if (isStockItem !== undefined) filters.isStockItem = isStockItem;
      if (isRepairable !== undefined) filters.isRepairable = isRepairable;
      if (isAssembly !== undefined) filters.isAssembly = isAssembly;
      if (isArchived !== undefined) filters.isArchived = isArchived;

      // Pass bin as a special filter — handled in the service via stock.some.bin
      if (bin) filters.bin = bin;

      // Call service
      const result = await inventoryService.list(context.serviceContext, {
        page,
        limit,
        filters,
        search,
        include: ["stock", "defaultSupplier", "equipment"],
      });

      // Batch-fetch On Req / On PO quantities using the shared service method.
      // See inventoryService.getOnOrderQuantities() for the full definition of
      // On Req (poLineId IS NULL, not CANCELLED/FULFILLED, parent req active)
      // and On PO (active PO, remaining-to-receive qty per line).
      const itemIds = result.data.map((item) => (item as { id: string }).id);
      const { reqMap, poMap } =
        await inventoryService.getOnOrderQuantities(itemIds);

      // Augment each item with onReqQty and onPOQty
      const augmentedData = result.data.map((item) => {
        const id = (item as { id: string }).id;
        return {
          ...item,
          onReqQty: reqMap.get(id)?.qty ?? 0,
          onPOQty: poMap.get(id)?.qty ?? 0,
        };
      });

      // Return standard paginated response format
      return paginated(
        augmentedData,
        result.pagination,
        "Inventory items retrieved successfully",
      );
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError(
        "An error occurred while processing your request",
        {
          suggestion:
            "Please try again. If the problem persists, contact support.",
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
);

/**
 * POST /api/inventory
 * Create a new inventory item
 */
export const POST = createPostHandler(
  inventoryItemCreateSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithData<InventoryItemCreateDTO>,
  ) => {
    // Call service
    const item = await inventoryService.create(
      context.serviceContext,
      context.data,
    );

    return created(item, "Inventory item created successfully");
  },
);
