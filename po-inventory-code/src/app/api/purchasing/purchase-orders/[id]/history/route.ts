/**
 * Purchase Order History API Route
 *
 * GET /api/purchasing/purchase-orders/:id/history - Get comprehensive audit log history for purchase order
 *
 * This route fetches:
 * 1. Direct purchase order audit logs
 * 2. Related requisition audit logs (for POs created from requisitions)
 * 3. Cross-referenced events from requisition resets
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds


import { success } from "@/lib/api-response";
import {
  createApiHandler,
} from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/purchasing/purchase-orders/:id/history
 * Get comprehensive audit log history for a purchase order including related requisition events
 */
export const GET = createApiHandler(
  {
    hasParams: true,
    anyPermissions: ["purchasing:read", "purchasing:update"],
  },
  async (_req, context) => {
    try {
      const purchaseOrderId = context.params.id;

    // Get the purchase order to find related requisitions
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        poNumber: true,
        requisitionIds: true,
        requisitionNumbers: true,
      },
    });

    if (!purchaseOrder) {
      return success([], "Purchase order not found");
    }

    // Get related requisition IDs
    const relatedReqIds = purchaseOrder.requisitionIds;

    // Also find requisitions that have this PO in their previousPOIds (cancelled/reset scenarios)
    const resetRequisitions = await prisma.requisition.findMany({
      where: {
        previousPOIds: {
          has: purchaseOrderId,
        },
      },
      select: {
        id: true,
        reqNumber: true,
      },
    });

    const allRelatedReqIds = [
      ...relatedReqIds,
      ...resetRequisitions.map((r) => r.id),
    ];

    // Fetch audit logs for this purchase order
    const poLogs = await prisma.auditLog.findMany({
      where: {
        entityType: "PurchaseOrder",
        entityId: purchaseOrderId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Fetch audit logs for related requisitions
    const relatedReqLogs = allRelatedReqIds.length > 0
      ? await prisma.auditLog.findMany({
          where: {
            entityType: "Requisition",
            entityId: { in: allRelatedReqIds },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        })
      : [];

    // Fetch audit logs that reference this PO in metadata but are NOT already
    // captured by the relatedReqLogs query (i.e. REQs linked via previousPOIds
    // that aren't in allRelatedReqIds).
    // The cancellation service stores the PO reference as `resetPOId` and
    // `relatedEntityId` — NOT `purchaseOrderId` / `cancelledPOId`.
    const crossReferencedLogs = await prisma.auditLog.findMany({
      where: {
        OR: [
          {
            // REQ logs from cancel-for-edit: resetPOId = this PO's id
            entityType: "Requisition",
            metadata: {
              path: ["resetPOId"],
              equals: purchaseOrderId,
            },
          },
          {
            // REQ logs that store PO reference under relatedEntityId
            entityType: "Requisition",
            metadata: {
              path: ["relatedEntityId"],
              equals: purchaseOrderId,
            },
          },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Combine all logs and remove duplicates
    const allLogs = [
      ...poLogs,
      ...relatedReqLogs,
      ...crossReferencedLogs,
    ];
    
    const uniqueLogs = Array.from(
      new Map(allLogs.map((log) => [log.id, log])).values()
    );

    // Sort by timestamp (oldest first for chronological order)
    uniqueLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Transform audit logs to history entries
    const historyEntries = uniqueLogs.map((log) => {
      const metadata = log.metadata as Record<string, unknown> | null;
      const detailedChanges = metadata?.detailedChanges as Array<{
        field: string;
        from: unknown;
        to: unknown;
        description: string;
      }> | undefined;

      // Determine if this is a cross-referenced event.
      // All Requisition logs shown in PO history are cross-references —
      // a REQ's entityId is always the REQ's own UUID, never the PO's UUID.
      const isCrossReference = log.entityType === "Requisition" && log.entityId !== purchaseOrderId;
      // relatedReqNumber = the REQ's own number (entityName), NOT metadata.relatedEntityNumber
      // which for REQ logs stores the *PO* number (the REQ's related entity is the PO).
      const relatedReqNumber = isCrossReference
        ? (log.entityName ?? undefined)
        : undefined;

      return {
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        entityName: log.entityName,
        user: {
          id: log.userId,
          name: log.user ? `${log.user.firstName} ${log.user.lastName}` : "System",
          email: log.user?.email ?? "system@crn.com",
        },
        changes: log.changes as Record<string, unknown>,
        metadata: log.metadata as Record<string, unknown>,
        detailedChanges: detailedChanges,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        isCrossReference,
        relatedReqNumber,
      };
    });

    return success(historyEntries, "Purchase order history retrieved successfully");
    } catch (error) {
      throw new InternalServerError('Failed to retrieve purchase order history', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);