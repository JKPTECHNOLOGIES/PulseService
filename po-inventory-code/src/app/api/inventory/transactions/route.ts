/**
 * Inventory Transactions API
 *
 * GET /api/inventory/transactions - List transactions with filtering
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { paginated } from "@/lib/api-response";
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
 * Query parameters schema for listing transactions
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
    .default("50")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(500)),
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
  sortBy: z
    .enum(["transactionDate", "quantity", "createdAt"])
    .optional()
    .default("transactionDate"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

/**
 * GET /api/inventory/transactions
 * List all transactions with pagination, filtering, and search
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
      // Check permission
      const permission = buildPermissionString(
        PermissionResource.INVENTORY,
        PermissionAction.READ,
      );
      await checkPermission(context.serviceContext, permission);

      // Parse and validate query parameters
      const url = new URL(req.url);
      const queryParams = Object.fromEntries(url.searchParams.entries());
      const validatedQuery = listQuerySchema.parse(queryParams);

      const {
        page,
        limit,
        inventoryItemId,
        storeId,
        transactionType,
        workOrderId,
        equipmentId,
        performedBy,
        startDate,
        endDate,
        search,
        sortBy,
        sortOrder,
      } = validatedQuery;

      // Build where clause
      const where: Record<string, unknown> = {};

      if (inventoryItemId) {
        where.inventoryItemId = inventoryItemId;
      }

      if (storeId) {
        where.storeId = storeId;
      }

      if (transactionType) {
        where.transactionType = transactionType;
      }

      if (workOrderId) {
        where.referenceType = "WORK_ORDER";
        where.referenceId = workOrderId;
      }

      if (equipmentId) {
        where.equipmentId = equipmentId;
      }

      if (performedBy) {
        where.performedBy = performedBy;
      }

      if (startDate || endDate) {
        where.transactionDate = {};
        if (startDate)
          (where.transactionDate as Record<string, unknown>).gte = startDate;
        if (endDate)
          (where.transactionDate as Record<string, unknown>).lte = endDate;
      }

      // Handle search - use nested relation filter to avoid a separate round-trip
      if (search) {
        // Single query: push item-level filters into a nested JOIN rather than pre-fetching IDs
        where.OR = [
          { referenceNumber: { contains: search, mode: "insensitive" } },
          { notes: { contains: search, mode: "insensitive" } },
          { performedByName: { contains: search, mode: "insensitive" } },
          { equipmentTag: { contains: search, mode: "insensitive" } },
          {
            inventoryItem: {
              OR: [
                { sku: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                { name: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        ];
      }

      // Pagination
      const skip = (page - 1) * limit;

      // Sorting
      const orderBy: Record<string, string> = {};
      orderBy[sortBy] = sortOrder;

      // Query transactions (note: InventoryTransaction model has no relation fields in schema)
      const [transactions, total] = await Promise.all([
        prisma.inventoryTransaction.findMany({
          where,
          skip,
          take: limit,
          orderBy,
        }),
        prisma.inventoryTransaction.count({ where }),
      ]);

      // A receipt against a PO stores referenceType "PurchaseOrder" (new rows),
      // but legacy receive rows were recorded with referenceType "WorkOrder" and
      // the PO id in referenceId. Treat any PurchaseOrder-typed row OR any RECEIVE
      // row that has a referenceId as a PO reference, so the Reference column can
      // resolve and show the PO# in both cases (SUG-000007).
      const isPurchaseOrderRef = (t: {
        referenceType: string | null;
        referenceId: string | null;
        transactionType: string;
      }) =>
        !!t.referenceId &&
        (t.referenceType === "PurchaseOrder" ||
          t.transactionType === "RECEIVE");

      // Fetch related data separately since InventoryTransaction doesn't have relation fields
      const [
        inventoryItems,
        stores,
        workOrders,
        equipment,
        users,
        purchaseOrders,
        directIssues,
      ] = await Promise.all([
        // Get inventory items
        prisma.inventoryItem.findMany({
          where: {
            id: {
              in: [...new Set(transactions.map((t) => t.inventoryItemId))],
            },
          },
          select: { id: true, sku: true, description: true, unit: true },
        }),
        // Get stores
        prisma.store.findMany({
          where: {
            id: { in: [...new Set(transactions.map((t) => t.storeId))] },
          },
          select: { id: true, name: true, code: true },
        }),
        // Get work orders (from referenceId where referenceType is WorkOrder)
        Promise.resolve(
          transactions.filter(
            (t) => t.referenceType === "WorkOrder" && t.referenceId,
          ).length > 0
            ? prisma.workOrder.findMany({
                where: {
                  id: {
                    in: transactions
                      .filter(
                        (t) => t.referenceType === "WorkOrder" && t.referenceId,
                      )
                      .map((t) => t.referenceId as string),
                  },
                },
                select: {
                  id: true,
                  woNumber: true,
                  title: true,
                  status: true,
                  equipment: {
                    select: {
                      id: true,
                      tag: true,
                      description: true,
                    },
                  },
                },
              })
            : [],
        ),
        // Get equipment
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
        // Get users
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
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              })
            : [],
        ),
        // Fetch POs for PurchaseOrder-typed rows AND receipt rows (legacy or new)
        Promise.resolve(
          transactions.filter(isPurchaseOrderRef).length > 0
            ? prisma.purchaseOrder.findMany({
                where: {
                  id: {
                    in: transactions
                      .filter(isPurchaseOrderRef)
                      .map((t) => t.referenceId as string),
                  },
                },
                select: {
                  id: true,
                  poNumber: true,
                  status: true,
                  supplier: { select: { id: true, name: true } },
                },
              })
            : [],
        ),
        // Fetch DirectIssue details when directIssueId is set
        Promise.resolve(
          transactions.filter((t) => t.directIssueId).length > 0
            ? prisma.directIssue.findMany({
                where: {
                  id: {
                    in: transactions
                      .filter((t) => t.directIssueId)
                      .map((t) => t.directIssueId as string),
                  },
                },
                select: {
                  id: true,
                  issueNumber: true,
                  purpose: true,
                  workOrderId: true,
                  department: { select: { id: true, name: true, code: true } },
                  project: { select: { id: true, code: true, name: true } },
                  accountCode: {
                    select: { id: true, code: true, description: true },
                  },
                },
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
      const purchaseOrderMap = new Map(purchaseOrders.map((po) => [po.id, po]));
      const directIssueMap = new Map(directIssues.map((di) => [di.id, di]));

      // Transform transactions to include relations and calculated fields
      const transformedTransactions = transactions.map((t) => {
        const quantity = Number(t.quantity);
        const unitCost = t.unitCost ? Number(t.unitCost) : null;

        return {
          id: t.id,
          inventoryItemId: t.inventoryItemId,
          storeId: t.storeId,
          transactionType: t.transactionType,
          quantity,
          unitCost,
          totalCost: unitCost ? quantity * unitCost : 0,
          referenceType: t.referenceType,
          referenceId: t.referenceId,
          referenceNumber: t.referenceNumber,
          directIssueId: t.directIssueId,
          directIssueNumber: t.directIssueNumber,
          notes: t.notes,
          performedBy: t.performedBy,
          performedByName: t.performedByName,
          quantityBefore: t.quantityBefore ? Number(t.quantityBefore) : null,
          quantityAfter: t.quantityAfter ? Number(t.quantityAfter) : null,
          equipmentId: t.equipmentId,
          equipmentTag: t.equipmentTag,
          transactionDate: t.transactionDate,
          createdAt: t.createdAt,
          // Verification fields
          verified: t.verified,
          verifiedBy: t.verifiedBy,
          verifiedAt: t.verifiedAt,
          verificationNotes: t.verificationNotes,
          // Add relations
          inventoryItem: itemMap.get(t.inventoryItemId) ?? null,
          store: storeMap.get(t.storeId) ?? null,
          performedByUser: t.performedBy
            ? (userMap.get(t.performedBy) ?? null)
            : null,
          equipment: t.equipmentId
            ? (equipmentMap.get(t.equipmentId) ?? null)
            : null,
          workOrder:
            t.referenceType === "WorkOrder" && t.referenceId
              ? (workOrderMap.get(t.referenceId) ?? null)
              : null,
          purchaseOrder: isPurchaseOrderRef(t)
            ? (purchaseOrderMap.get(t.referenceId as string) ?? null)
            : null,
          directIssue: t.directIssueId
            ? (directIssueMap.get(t.directIssueId) ?? null)
            : null,
        };
      });

      return paginated(
        transformedTransactions,
        {
          page,
          limit,
          total,
        },
        "Transactions retrieved successfully",
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
