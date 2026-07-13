/**
 * Inventory Item Work Orders API Route
 *
 * GET /api/inventory/:id/work-orders - Get all work-order activity for this
 * inventory item. This is a UNIFIED view that combines two sources:
 *   1. WorkOrderPart  — parts planned/reserved/issued on a work order
 *   2. DirectIssue    — items issued directly against a work order
 *                       (includes serialized / repairable items, which carry a
 *                        serialNumber)
 *
 * Both sources represent the ways an inventory item "hits" a work order, so the
 * tab can show every transaction that touched a WO in a single table.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { createGetHandlerWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";

type RouteParams = {
  id: string;
};

/**
 * A single row in the unified work-order activity table.
 * `source` distinguishes a planned/issued part from a direct issue.
 */
interface WorkOrderActivity {
  id: string;
  source: "PART" | "DIRECT_ISSUE";
  // Quantities (Decimals are serialized as numbers by the API layer)
  quantityPlanned: number | null;
  quantityIssued: number | null;
  // Status — one of these is populated depending on source
  partStatus: string | null;
  issueStatus: string | null;
  // Direct-issue specifics
  issueNumber: string | null;
  serialNumber: string | null;
  // Common
  issuedAt: Date | null;
  activityDate: Date;
  workOrder: {
    id: string;
    woNumber: string;
    title: string;
    status: string;
    priority: string;
    equipment: {
      id: string;
      tag: string;
      description: string;
    } | null;
  };
}

/**
 * GET /api/inventory/:id/work-orders
 * Unified list of all work-order activity (planned parts + direct issues) for
 * this inventory item.
 */
export const GET = createGetHandlerWithParams<RouteParams>(
  async (_req, context) => {
    const { id } = await context.params;

    // Verify inventory item exists
    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id },
      select: { id: true, sku: true },
    });

    if (!inventoryItem) {
      throw new NotFoundError("InventoryItem", id);
    }

    // Source 1: Work order parts (planned / reserved / issued)
    const workOrderParts = await prisma.workOrderPart.findMany({
      where: {
        inventoryItemId: id,
      },
      select: {
        id: true,
        quantityPlanned: true,
        quantityUsed: true,
        issuedAt: true,
        status: true,
        createdAt: true,
        assignedSerialNumber: true,
        workOrder: {
          select: {
            id: true,
            woNumber: true,
            title: true,
            status: true,
            priority: true,
            equipment: {
              select: {
                id: true,
                tag: true,
                description: true,
              },
            },
          },
        },
      },
    });

    // Source 2: Direct issues that hit a work order (workOrderId set).
    // Includes serialized / repairable items (serialNumber populated).
    const directIssues = await prisma.directIssue.findMany({
      where: {
        inventoryItemId: id,
        workOrderId: { not: null },
      },
      select: {
        id: true,
        issueNumber: true,
        quantity: true,
        serialNumber: true,
        status: true,
        issuedAt: true,
        workOrder: {
          select: {
            id: true,
            woNumber: true,
            title: true,
            status: true,
            priority: true,
            equipment: {
              select: {
                id: true,
                tag: true,
                description: true,
              },
            },
          },
        },
      },
    });

    const activity: WorkOrderActivity[] = [];

    for (const part of workOrderParts) {
      activity.push({
        id: part.id,
        source: "PART",
        quantityPlanned: Number(part.quantityPlanned),
        quantityIssued:
          part.quantityUsed !== null ? Number(part.quantityUsed) : null,
        partStatus: part.status,
        issueStatus: null,
        issueNumber: null,
        serialNumber: part.assignedSerialNumber,
        issuedAt: part.issuedAt,
        activityDate: part.issuedAt ?? part.createdAt,
        workOrder: part.workOrder,
      });
    }

    for (const issue of directIssues) {
      // workOrderId is filtered to be non-null, so workOrder is present.
      if (!issue.workOrder) continue;
      activity.push({
        id: issue.id,
        source: "DIRECT_ISSUE",
        quantityPlanned: null,
        quantityIssued: Number(issue.quantity),
        partStatus: null,
        issueStatus: issue.status,
        issueNumber: issue.issueNumber,
        serialNumber: issue.serialNumber,
        issuedAt: issue.issuedAt,
        activityDate: issue.issuedAt,
        workOrder: issue.workOrder,
      });
    }

    // Sort newest-first in TypeScript (avoids nested-relation orderBy issues).
    activity.sort(
      (a, b) =>
        new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime(),
    );

    return success(
      activity,
      `Found ${activity.length} work order activity record(s) for ${inventoryItem.sku}`,
    );
  },
);
