/**
 * Requisition Line Status Service
 * 
 * Handles line-level status transitions and validations
 */

import { prisma } from "@/lib/prisma";
import {
  RequisitionLineStatus,
  RequisitionLineWithPOTracking,
  UpdateLineStatusInput,
  LineStatusValidation,
} from "./requisition.types";

/**
 * Valid status transitions
 */
const VALID_TRANSITIONS: Record<RequisitionLineStatus, RequisitionLineStatus[]> = {
  [RequisitionLineStatus.PENDING]: [
    RequisitionLineStatus.APPROVED,
    RequisitionLineStatus.CANCELLED,
  ],
  [RequisitionLineStatus.APPROVED]: [
    RequisitionLineStatus.ORDERED,
    RequisitionLineStatus.CANCELLED,
  ],
  [RequisitionLineStatus.ORDERED]: [
    RequisitionLineStatus.PARTIALLY_FULFILLED,
    RequisitionLineStatus.FULFILLED,
    RequisitionLineStatus.CANCELLED,
  ],
  [RequisitionLineStatus.PARTIALLY_FULFILLED]: [
    RequisitionLineStatus.FULFILLED,
    RequisitionLineStatus.CANCELLED,
  ],
  [RequisitionLineStatus.FULFILLED]: [],
  [RequisitionLineStatus.CANCELLED]: [],
};

/**
 * Validate status transition
 */
export function validateStatusTransition(
  currentStatus: RequisitionLineStatus,
  newStatus: RequisitionLineStatus
): LineStatusValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check if transition is valid
  const validTransitions = VALID_TRANSITIONS[currentStatus];
  if (!validTransitions.includes(newStatus)) {
    errors.push(
      `Cannot transition from ${currentStatus} to ${newStatus}. ` +
      `Valid transitions: ${validTransitions.join(", ")}`
    );
  }
  
  // Add warnings for certain transitions
  if (currentStatus === RequisitionLineStatus.ORDERED && newStatus === RequisitionLineStatus.CANCELLED) {
    warnings.push("Cancelling an ordered line may require cancelling the PO line");
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Update line status
 */
export async function updateLineStatus(
  input: UpdateLineStatusInput
): Promise<RequisitionLineWithPOTracking> {
  // Get current line
  const line = await prisma.requisitionLine.findUnique({
    where: { id: input.lineId },
    include: {
      requisition: true,
      supplier: true,
      inventoryItem: true,
      purchaseOrder: true,
      poLine: true,
      convertedByUser: true,
    },
  });
  
  if (!line) {
    throw new Error(`Requisition line ${input.lineId} not found`);
  }
  
  // Validate transition
  const validation = validateStatusTransition(
    line.lineStatus as RequisitionLineStatus,
    input.newStatus
  );
  
  if (!validation.isValid) {
    throw new Error(`Invalid status transition: ${validation.errors.join(", ")}`);
  }
  
  // Update line status
  const updatedLine = await prisma.requisitionLine.update({
    where: { id: input.lineId },
    data: {
      lineStatus: input.newStatus,
      updatedAt: new Date(),
    },
    include: {
      requisition: true,
      supplier: true,
      inventoryItem: true,
      purchaseOrder: true,
      poLine: true,
      convertedByUser: true,
    },
  });
  
  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId: input.updatedBy,
      action: "UPDATE_LINE_STATUS",
      entityType: "RequisitionLine",
      entityId: input.lineId,
      changes: {
        oldStatus: line.lineStatus,
        newStatus: input.newStatus,
        reason: input.reason,
      },
      timestamp: new Date(),
    },
  });
  
  return updatedLine as RequisitionLineWithPOTracking;
}

/**
 * Bulk approve lines
 */
export async function bulkApproveLines(
  lineIds: string[],
  approvedBy: string
): Promise<number> {
  // Update all lines to APPROVED status
  const result = await prisma.requisitionLine.updateMany({
    where: {
      id: { in: lineIds },
      lineStatus: RequisitionLineStatus.PENDING,
    },
    data: {
      lineStatus: RequisitionLineStatus.APPROVED,
      updatedAt: new Date(),
    },
  });
  
  // Create audit logs
  await Promise.all(
    lineIds.map((lineId) =>
      prisma.auditLog.create({
        data: {
          userId: approvedBy,
          action: "BULK_APPROVE_LINE",
          entityType: "RequisitionLine",
          entityId: lineId,
          changes: {
            newStatus: RequisitionLineStatus.APPROVED,
          },
          timestamp: new Date(),
        },
      })
    )
  );
  
  return result.count;
}

/**
 * Bulk cancel lines
 */
export async function bulkCancelLines(
  lineIds: string[],
  cancelledBy: string,
  reason: string
): Promise<number> {
  // Update all lines to CANCELLED status
  const result = await prisma.requisitionLine.updateMany({
    where: {
      id: { in: lineIds },
      lineStatus: {
        in: [RequisitionLineStatus.PENDING, RequisitionLineStatus.APPROVED],
      },
    },
    data: {
      lineStatus: RequisitionLineStatus.CANCELLED,
      updatedAt: new Date(),
    },
  });
  
  // Create audit logs
  await Promise.all(
    lineIds.map((lineId) =>
      prisma.auditLog.create({
        data: {
          userId: cancelledBy,
          action: "BULK_CANCEL_LINE",
          entityType: "RequisitionLine",
          entityId: lineId,
          changes: {
            newStatus: RequisitionLineStatus.CANCELLED,
            reason,
          },
          timestamp: new Date(),
        },
      })
    )
  );
  
  return result.count;
}

/**
 * Get lines by status
 */
export async function getLinesByStatus(
  requisitionId: string,
  status: RequisitionLineStatus
): Promise<RequisitionLineWithPOTracking[]> {
  const lines = await prisma.requisitionLine.findMany({
    where: {
      requisitionId,
      lineStatus: status,
    },
    include: {
      requisition: true,
      supplier: true,
      inventoryItem: true,
      purchaseOrder: true,
      poLine: true,
      convertedByUser: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
  
  return lines as RequisitionLineWithPOTracking[];
}

/**
 * Get convertible lines (APPROVED status, no PO)
 */
export function getConvertibleLines(
  requisitionId: string
): Promise<RequisitionLineWithPOTracking[]> {
  return getLinesByStatus(requisitionId, RequisitionLineStatus.APPROVED);
}

/**
 * Get line status summary for a requisition
 */
export async function getLineStatusSummary(requisitionId: string): Promise<{
  total: number;
  pending: number;
  approved: number;
  ordered: number;
  cancelled: number;
  fulfilled: number;
  partiallyFulfilled: number;
}> {
  const lines = await prisma.requisitionLine.findMany({
    where: { requisitionId },
    select: { lineStatus: true },
  });
  
  const summary = {
    total: lines.length,
    pending: 0,
    approved: 0,
    ordered: 0,
    cancelled: 0,
    fulfilled: 0,
    partiallyFulfilled: 0,
  };
  
  lines.forEach((line) => {
    switch (line.lineStatus) {
      case RequisitionLineStatus.PENDING:
        summary.pending++;
        break;
      case RequisitionLineStatus.APPROVED:
        summary.approved++;
        break;
      case RequisitionLineStatus.ORDERED:
        summary.ordered++;
        break;
      case RequisitionLineStatus.CANCELLED:
        summary.cancelled++;
        break;
      case RequisitionLineStatus.FULFILLED:
        summary.fulfilled++;
        break;
      case RequisitionLineStatus.PARTIALLY_FULFILLED:
        summary.partiallyFulfilled++;
        break;
    }
  });
  
  return summary;
}