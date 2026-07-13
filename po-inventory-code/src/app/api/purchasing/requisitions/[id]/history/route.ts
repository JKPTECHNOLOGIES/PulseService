/**
 * Requisition History API Route
 *
 * GET /api/purchasing/requisitions/:id/history - Get comprehensive audit log history for requisition
 *
 * This route fetches:
 * 1. Direct requisition audit logs
 * 2. Related purchase order audit logs (for converted requisitions)
 * 3. Cross-referenced events from PO cancellations
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
/**
 * GET /api/purchasing/requisitions/:id/history
 * Get comprehensive audit log history for a requisition including related PO events
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const requisitionId = context.params.id;

    // Get the requisition to find related PO
    const requisition = await prisma.requisition.findUnique({
      where: { id: requisitionId },
      select: {
        id: true,
        reqNumber: true,
        purchaseOrderId: true,
        purchaseOrderNumber: true,
        previousPOIds: true,
        previousPONumbers: true,
      },
    });

    if (!requisition) {
      return success([], "Requisition not found");
    }

    // Build list of all related PO IDs (current + previous)
    const relatedPOIds = [
      ...(requisition.purchaseOrderId ? [requisition.purchaseOrderId] : []),
      ...requisition.previousPOIds,
    ];

    // Fetch audit logs for this requisition
    const requisitionLogs = await prisma.auditLog.findMany({
      where: {
        entityType: "Requisition",
        entityId: requisitionId,
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

    // Fetch audit logs for related purchase orders
    const relatedPOLogs = relatedPOIds.length > 0
      ? await prisma.auditLog.findMany({
          where: {
            entityType: "PurchaseOrder",
            entityId: { in: relatedPOIds },
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

    // Fetch audit logs that reference this requisition in metadata
    const crossReferencedLogs = await prisma.auditLog.findMany({
      where: {
        OR: [
          {
            // PO logs that mention this requisition
            entityType: "PurchaseOrder",
            metadata: {
              path: ["requisitionId"],
              equals: requisitionId,
            },
          },
          {
            // PO logs that mention this requisition in an array
            entityType: "PurchaseOrder",
            metadata: {
              path: ["requisitionIds"],
              array_contains: requisitionId,
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
      ...requisitionLogs,
      ...relatedPOLogs,
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

      // Determine if this is a cross-referenced event
      const isCrossReference = log.entityType === "PurchaseOrder" && log.entityId !== requisitionId;
      const relatedPONumber = isCrossReference
        ? (metadata?.relatedEntityNumber as string | undefined) ?? log.entityName
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
        relatedPONumber,
      };
    });

    return success(historyEntries, "Requisition history retrieved successfully");
  }
);