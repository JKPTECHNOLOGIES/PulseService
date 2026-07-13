/**
 * Inventory Export API
 *
 * GET /api/inventory/export - Export all inventory items to CSV
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";

const exportQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  lowStock: z
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
  isArchived: z
    .string()
    .transform((val) => val === "true")
    .optional(),
});

/**
 * GET /api/inventory/export
 * Export inventory items to CSV
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, _context: BaseApiContext) => {
    try {
      const url = new URL(req.url);
      const queryParams = Object.fromEntries(url.searchParams.entries());
      const validatedQuery = exportQuerySchema.parse(queryParams);

      const { search, category, isStockItem, isRepairable, isArchived } =
        validatedQuery;

      // Build where clause
      const where: Record<string, unknown> = {};

      if (category) where.category = category;
      if (isStockItem !== undefined) where.isStockItem = isStockItem;
      if (isRepairable !== undefined) where.isRepairable = isRepairable;
      if (isArchived !== undefined) where.isArchived = isArchived;

      if (search) {
        where.OR = [
          { sku: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ];
      }

      // Fetch all matching items with stock and supplier data (no pagination)
      const items = await prisma.inventoryItem.findMany({
        where,
        orderBy: { sku: "asc" },
        take: 10000,
        include: {
          stock: {
            include: {
              store: { select: { id: true, name: true, code: true } },
            },
          },
          defaultSupplier: { select: { id: true, name: true } },
        },
      });

      // Apply lowStock filter in memory (requires computed totalQuantity)
      const filtered =
        validatedQuery.lowStock
          ? items.filter((item) => {
              const totalOnHand = item.stock.reduce(
                (sum, s) => sum + Number(s.quantityOnHand),
                0
              );
              return totalOnHand <= Number(item.minQuantity);
            })
          : items;

      // Build CSV headers
      const headers = [
        "SKU",
        "Description",
        "Category",
        "Unit",
        "Type",
        "Repairable",
        "Status",
        "ABC Classification",
        "On Hand",
        "Available",
        "Reserved",
        "Min Qty",
        "Max Qty",
        "Unit Cost",
        "Lead Time (Days)",
        "Default Supplier",
        "Stores",
        "Bins",
        "Notes",
      ];

      const rows = filtered.map((item) => {
        const totalOnHand = item.stock.reduce(
          (sum, s) => sum + Number(s.quantityOnHand),
          0
        );
        const totalReserved = item.stock.reduce(
          (sum, s) => sum + Number(s.quantityReserved),
          0
        );
        const available = totalOnHand - totalReserved;

        const storeCodes = item.stock
          .map((s) => s.store.code)
          .filter(Boolean)
          .join("; ");
        const bins = item.stock
          .filter((s) => s.bin)
          .map((s) => s.bin)
          .join("; ");

        return [
          item.sku,
          item.description,
          item.category ?? "",
          item.unit,
          item.isStockItem ? "Stock" : "Non-Stock",
          item.isRepairable ? "Yes" : "No",
          item.isArchived ? "Archived" : item.isActive ? "Active" : "Inactive",
          item.abcClassification ?? "",
          totalOnHand.toString(),
          available.toString(),
          totalReserved.toString(),
          Number(item.minQuantity).toString(),
          Number(item.maxQuantity).toString(),
          Number(item.unitCost).toFixed(2),
          item.leadTimeDays?.toString() ?? "",
          item.defaultSupplier?.name ?? "",
          storeCodes,
          bins,
          item.notes ?? "",
        ];
      });

      const escape = (cell: string) =>
        `"${cell.replace(/"/g, '""')}"`;

      const csvContent = [
        headers.map(escape).join(","),
        ...rows.map((row) => row.map(escape).join(",")),
      ].join("\n");

      const filename = `inventory-${new Date().toISOString().split("T")[0]}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (error) {
      throw new InternalServerError(
        "An error occurred while exporting inventory",
        {
          suggestion: "Please try again. If the problem persists, contact support.",
          cause: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
);
