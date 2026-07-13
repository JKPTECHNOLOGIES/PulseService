/**
 * Inventory Transactions Export API
 *
 * GET /api/inventory/transactions/export - Export transactions to CSV
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest, NextResponse } from "next/server";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/services/shared/permissions";
import {
  buildPermissionString,
  PermissionAction,
  PermissionResource,
} from "@/types/permissions";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema for exporting transactions
 */
const exportQuerySchema = z.object({
  inventoryItemId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  transactionType: z.string().optional(),
  workOrderId: z.string().uuid().optional(),
  equipmentId: z.string().uuid().optional(),
  performedBy: z.string().uuid().optional(),
  startDate: z
    .string()
    .transform((val) => new Date(val))
    .optional(),
  endDate: z
    .string()
    .transform((val) => new Date(val))
    .optional(),
  search: z.string().optional(),
  format: z.enum(["csv", "excel"]).optional().default("csv"),
});

/**
 * GET /api/inventory/transactions/export
 * Export transactions to CSV or Excel format
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
    // Check permission - requires special export permission
    const exportPermission = buildPermissionString(
      PermissionResource.INVENTORY,
      "export" as PermissionAction
    );
    await checkPermission(context.serviceContext, exportPermission);

    // Parse and validate query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const validatedQuery = exportQuerySchema.parse(queryParams);

    const {
      inventoryItemId,
      storeId,
      transactionType,
      workOrderId,
      equipmentId,
      performedBy,
      startDate,
      endDate,
      search,
      format: _format, // Prefix with _ since it's not used yet (reserved for future Excel export)
    } = validatedQuery;

    // Build where clause (same as list endpoint)
    const where: Record<string, unknown> = {};

    if (inventoryItemId) where.inventoryItemId = inventoryItemId;
    if (storeId) where.storeId = storeId;
    if (transactionType) where.transactionType = transactionType;
    if (workOrderId) {
      where.referenceType = "WORK_ORDER";
      where.referenceId = workOrderId;
    }
    if (equipmentId) where.equipmentId = equipmentId;
    if (performedBy) where.performedBy = performedBy;
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate)
        (where.transactionDate as Record<string, unknown>).gte = startDate;
      if (endDate)
        (where.transactionDate as Record<string, unknown>).lte = endDate;
    }

    // Handle search - need to search inventory items separately since no direct relation
    if (search) {
      // First, find inventory items matching the search term (SKU or description)
      const matchingItems = await prisma.inventoryItem.findMany({
        where: {
          OR: [
            { sku: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });

      const matchingItemIds = matchingItems.map((item) => item.id);

      // Build OR conditions including inventory item matches
      where.OR = [
        { referenceNumber: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { performedByName: { contains: search, mode: "insensitive" } },
        { equipmentTag: { contains: search, mode: "insensitive" } },
        // Add inventory item ID matches if any found
        ...(matchingItemIds.length > 0
          ? [{ inventoryItemId: { in: matchingItemIds } }]
          : []),
      ];
    }

    // Query all matching transactions (no pagination for export)
    const transactions = await prisma.inventoryTransaction.findMany({
      where,
      orderBy: { transactionDate: "desc" },
      take: 10000, // Limit to prevent memory issues
    });

    // Fetch related data
    const [inventoryItems, stores, workOrders, equipment, users] =
      await Promise.all([
        prisma.inventoryItem.findMany({
          where: {
            id: {
              in: [...new Set(transactions.map((t) => t.inventoryItemId))],
            },
          },
          select: { id: true, sku: true, description: true, unit: true },
        }),
        prisma.store.findMany({
          where: {
            id: { in: [...new Set(transactions.map((t) => t.storeId))] },
          },
          select: { id: true, name: true, code: true },
        }),
        Promise.resolve(
          transactions.filter(
            (t) => t.referenceType === "WORK_ORDER" && t.referenceId,
          ).length > 0
            ? prisma.workOrder.findMany({
                where: {
                  id: {
                    in: transactions
                      .filter(
                        (t) =>
                          t.referenceType === "WORK_ORDER" && t.referenceId,
                      )
                      .map((t) => t.referenceId as string),
                  },
                },
                select: { id: true, woNumber: true, title: true },
              })
            : [],
        ),
        Promise.resolve(
          transactions.filter((t) => t.equipmentId).length > 0
            ? prisma.equipment.findMany({
                where: {
                  id: {
                    in: transactions
                      .filter((t) => t.equipmentId)
                      .map((t) => t.equipmentId as string),
                  },
                },
                select: { id: true, tag: true, description: true },
              })
            : [],
        ),
        Promise.resolve(
          transactions.filter((t) => t.performedBy).length > 0
            ? prisma.user.findMany({
                where: {
                  id: {
                    in: transactions
                      .filter((t) => t.performedBy)
                      .map((t) => t.performedBy as string),
                  },
                },
                select: { id: true, firstName: true, lastName: true },
              })
            : [],
        ),
      ]);

    // Create lookup maps
    const itemMap = new Map(inventoryItems.map((i) => [i.id, i]));
    const storeMap = new Map(stores.map((s) => [s.id, s]));
    const workOrderMap = new Map(workOrders.map((wo) => [wo.id, wo]));
    const equipmentMap = new Map(equipment.map((e) => [e.id, e]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Generate CSV content
    const headers = [
      "Transaction Date",
      "Transaction Type",
      "Item SKU",
      "Item Description",
      "Store",
      "Quantity",
      "Unit Cost",
      "Total Cost",
      "Quantity Before",
      "Quantity After",
      "Work Order",
      "Equipment",
      "Performed By",
      "Reference Number",
      "Notes",
    ];

    const rows = transactions.map((t) => {
      const item = itemMap.get(t.inventoryItemId);
      const store = storeMap.get(t.storeId);
      const workOrder =
        t.referenceType === "WORK_ORDER" && t.referenceId
          ? workOrderMap.get(t.referenceId)
          : null;
      const equip = t.equipmentId ? equipmentMap.get(t.equipmentId) : null;
      const user = t.performedBy ? userMap.get(t.performedBy) : null;

      const quantity = Number(t.quantity);
      const unitCost = t.unitCost ? Number(t.unitCost) : 0;
      const totalCost = unitCost * quantity;

      return [
        t.transactionDate.toISOString(),
        t.transactionType,
        item?.sku ?? "",
        item?.description ?? "",
        store?.name ?? "",
        quantity.toString(),
        unitCost.toFixed(2),
        totalCost.toFixed(2),
        t.quantityBefore ? Number(t.quantityBefore).toString() : "",
        t.quantityAfter ? Number(t.quantityAfter).toString() : "",
        workOrder?.woNumber ?? "",
        equip?.tag ?? "",
        user ? `${user.firstName} ${user.lastName}` : t.performedByName ?? "",
        t.referenceNumber ?? "",
        t.notes ?? "",
      ];
    });

    // Create CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${cell.toString().replace(/"/g, '""')}"`).join(","),
      ),
    ].join("\n");

    // Return CSV file
    const filename = `inventory-transactions-${new Date().toISOString().split("T")[0]}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
