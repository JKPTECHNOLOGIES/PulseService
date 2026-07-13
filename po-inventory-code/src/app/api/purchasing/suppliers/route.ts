/**
 * Suppliers API Routes
 *
 * GET /api/purchasing/suppliers - List suppliers
 * POST /api/purchasing/suppliers - Create supplier
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 300; // Cache for 300 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { created, paginated } from "@/lib/api-response";
import {
  createApiHandler,
  createPostHandler,
  BaseApiContext,
  ApiContextWithData,
} from "@/lib/api-middleware-v2";
import { supplierService } from "@/services/purchasing";
import {
  supplierCreateSchema,
  SupplierCreateDTO,
} from "@/services/purchasing/supplier.types";
import { paginationSchema } from "@/lib/validation";

/**
 * Query parameters schema for listing suppliers
 */
const listQuerySchema = paginationSchema.merge(
  z.object({
    search: z.string().optional(),
    isActive: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    minRating: z
      .string()
      .transform((val) => parseInt(val, 10))
      .optional(),
    type: z.enum(["supplier", "contractor", "Supplier", "Contractor"])
      .optional()
      .transform(val => val ? val.charAt(0).toUpperCase() + val.slice(1).toLowerCase() : undefined),
  })
);

/**
 * GET /api/purchasing/suppliers
 * List all suppliers with pagination and filtering
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
      // Parse and validate query parameters
      const url = new URL(req.url);
      const queryParams = Object.fromEntries(url.searchParams.entries());
      
      const validatedQuery = listQuerySchema.parse(queryParams);

      const { page, limit, search, isActive, minRating, type } = validatedQuery;

      // Build filters
      const filters: Record<string, unknown> = {};
      if (isActive !== undefined) filters.isActive = isActive;
      if (minRating !== undefined) filters.rating = { gte: minRating };
      
      // Convert old type parameter to new boolean fields for backward compatibility
      if (type !== undefined) {
        const normalizedType = type.toLowerCase();
        if (normalizedType === "supplier") {
          filters.isSupplier = true;
        } else if (normalizedType === "contractor") {
          filters.isContractor = true;
        }
      }

      // Call service
      // NOTE: Do NOT include "purchaseOrders" or "inventoryItems" here.
      // This list endpoint is used by autocomplete/filter dropdowns that need only
      // id, name, code, and internalVendorCode. Fetching all PO and inventory
      // relations for 500 suppliers causes timeout failures and breaks the autocomplete.
      const result = await supplierService.list(context.serviceContext, {
        page,
        limit,
        filters,
        search,
        include: [],
      });

      return paginated(
        result.data,
        result.pagination,
        "Suppliers retrieved successfully"
      );
    } catch (error) {
      throw error;
    }
  }
);

/**
 * POST /api/purchasing/suppliers
 * Create a new supplier
 */
export const POST = createPostHandler(
  supplierCreateSchema,
  async (_req: NextRequest, context: ApiContextWithData<SupplierCreateDTO>) => {
    const supplier = await supplierService.create(
      context.serviceContext,
      context.data
    );
    return created(supplier, "Supplier created successfully");
  }
);
