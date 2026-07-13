/**
 * Inventory Categories API Routes
 *
 * GET  /api/inventory/categories - List / search categories
 * POST /api/inventory/categories - Create a new category
 *
 * On the very first GET this endpoint seeds the 10 historical category names
 * that were previously hardcoded in the UI, so existing inventory items
 * categorised under those names are immediately searchable.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createGetHandler,
  createApiHandler,
  BaseApiContext,
  parseQueryParams,
} from "@/lib/api-middleware-v2";
import { paginated, success } from "@/lib/api-response";
import { paginationSchema } from "@/lib/validation";
import { ValidationError } from "@/lib/api-errors";
import type { Prisma } from "@prisma/client";

/** The original hardcoded values — seeded once so they appear immediately. */
const LEGACY_CATEGORIES = [
  "Spare Parts",
  "Consumables",
  "Tools",
  "Safety Equipment",
  "Chemicals",
  "Lubricants",
  "Electrical",
  "Mechanical",
  "Instrumentation",
  "Other",
];

async function ensureSeeded() {
  const count = await prisma.inventoryCategory.count();
  if (count === 0) {
    await prisma.inventoryCategory.createMany({
      data: LEGACY_CATEGORIES.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }
}

const listQuerySchema = paginationSchema.merge(
  z.object({
    search: z.string().optional(),
    isActive: z
      .string()
      .transform((val) => val === "true")
      .optional(),
  })
);

const createCategorySchema = z.object({
  name: z.string().min(1, "Category name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

/**
 * GET /api/inventory/categories
 */
export const GET = createGetHandler(
  async (_req: NextRequest, _context: BaseApiContext) => {
    await ensureSeeded();

    const queryParams = parseQueryParams(_req, listQuerySchema);
    const { page, limit, search, isActive } = queryParams;

    const where: Prisma.InventoryCategoryWhereInput = {};

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [categories, total] = await Promise.all([
      prisma.inventoryCategory.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true, isActive: true },
      }),
      prisma.inventoryCategory.count({ where }),
    ]);

    return paginated(categories, { page, limit, total }, "Categories retrieved successfully");
  }
);

/**
 * POST /api/inventory/categories
 */
export const POST = createApiHandler(
  {},
  async (req: NextRequest, _context: BaseApiContext) => {
    const body = await req.json() as Record<string, unknown>;
    const data = createCategorySchema.parse(body);

    const existing = await prisma.inventoryCategory.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" } },
    });

    if (existing) {
      throw new ValidationError("A category with this name already exists");
    }

    const category = await prisma.inventoryCategory.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        isActive: data.isActive,
      },
      select: { id: true, name: true, description: true, isActive: true },
    });

    return success(category, "Category created successfully");
  }
);
