/**
 * RMA Service
 *
 * Core CRUD operations and business logic for RMA (Return Merchandise Authorization).
 * Handles listing, creating, updating, deleting, and managing RMA records.
 *
 * Created: 2025-12-10
 */

import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { checkPermission } from "@/services/shared/permissions";
import { PaginatedResponse } from "@/types/api";
import { RMAStatus, ReturnDisposition } from "@prisma/client";
import {
  CreateRMADTO,
  UpdateRMADTO,
  RMAFilterDTO,
  InspectLineItemDTO,
  RestockLineItemDTO,
  ScrapLineItemDTO,
  RMAWithRelations,
  RMAStats,
} from "./rma.types";
import { validateRMACreate, validateRMAUpdate } from "./rma-validation";
import {
  generateRMANumber,
  buildRMAInclude,
  buildRMAWhereClause,
  transformRMA,
} from "./rma-utils";
import {
  submitRMA,
  approveRMA,
  rejectRMA,
  processRMA,
  shipRMA,
  receiveRMA,
  issueCreditRMA,
  completeRMA,
  cancelRMA,
} from "./rma-workflow.service";

/**
 * List RMAs with pagination, filtering, and sorting
 */
export async function listRMAs(
  context: ServiceContext,
  filters?: RMAFilterDTO,
): Promise<PaginatedResponse<RMAWithRelations>> {
  // Check permission
  await checkPermission(context, "rma:read");

  // Build where clause
  const where = buildRMAWhereClause(filters ?? {});

  // Get total count
  const total = await prisma.purchaseOrderReturn.count({ where });

  // Get paginated results
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const rmas = await prisma.purchaseOrderReturn.findMany({
    where,
    include: buildRMAInclude(),
    orderBy: filters?.sortBy
      ? { [filters.sortBy]: filters.sortOrder ?? "desc" }
      : { createdAt: "desc" },
    skip,
    take: limit,
  });

  return {
    success: true,
    data: rmas.map(transformRMA),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get RMA by ID
 */
export async function getRMAById(
  context: ServiceContext,
  id: string,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:read");

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id },
    include: buildRMAInclude(),
  });

  if (!rma) {
    throw new Error("RMA not found");
  }

  return transformRMA(rma);
}

/**
 * Create new RMA
 */
export async function createRMA(
  context: ServiceContext,
  data: CreateRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:create");

  // Validate
  const validation = await validateRMACreate(prisma, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Generate RMA number
  const rmaNumber = await generateRMANumber(prisma);

  // Get PO to extract supplierId
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: data.purchaseOrderId },
    select: { supplierId: true },
  });

  if (!po) {
    throw new Error("Purchase order not found");
  }

  // Calculate total amount from items
  const totalAmount = data.items.reduce((sum, item) => {
    return sum + item.quantityToReturn * (item.unitPrice ?? 0);
  }, 0);

  // Create RMA
  const rma = await prisma.purchaseOrderReturn.create({
    data: {
      rmaNumber,
      purchaseOrderId: data.purchaseOrderId,
      supplierId: po.supplierId,
      returnType: data.returnType,
      status: RMAStatus.DRAFT,
      totalAmount,
      netRefundAmount: totalAmount,
      reason: data.reason,
      notes: data.notes,
      requestedById: context.userId,
      requestedByName: context.userName || "",
      lines: {
        create: data.items.map((item) => ({
          poLineId: item.poLineId,
          poLineReceiptId: item.poLineReceiptId,
          inventoryItemId: item.inventoryItemId,
          description: item.description ?? "",
          quantityToReturn: item.quantityToReturn,
          unitPrice: item.unitPrice ?? 0,
          totalPrice: item.quantityToReturn * (item.unitPrice ?? 0),
          condition: item.condition,
          conditionNotes: item.conditionNotes,
          defectDescription: item.defectDescription,
          lotNumber: item.lotNumber,
          serialNumbers: item.serialNumbers,
          photoUrls: item.photoUrls,
        })),
      },
    },
    include: buildRMAInclude(),
  });

  return transformRMA(rma);
}

/**
 * Update RMA (only in DRAFT status)
 */
export async function updateRMA(
  context: ServiceContext,
  id: string,
  data: UpdateRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:update");

  // Validate
  const validation = await validateRMAUpdate(prisma, id, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id },
    include: { lines: true },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Only allow updates in DRAFT status
  if (currentRMA.status !== RMAStatus.DRAFT) {
    throw new Error("Can only update RMA in DRAFT status");
  }

  // Calculate new total if items are updated
  let totalAmount: number = Number(currentRMA.totalAmount);
  if (data.items) {
    totalAmount = data.items.reduce((sum, item) => {
      return sum + item.quantityToReturn * (item.unitPrice ?? 0);
    }, 0);
  }

  // Update RMA
  const rma = await prisma.purchaseOrderReturn.update({
    where: { id },
    data: {
      returnType: data.returnType,
      reason: data.reason,
      notes: data.notes,
      totalAmount,
      netRefundAmount: totalAmount,
      ...(data.items && {
        lines: {
          deleteMany: {},
          create: data.items.map((item) => ({
            poLineId: item.poLineId,
            poLineReceiptId: item.poLineReceiptId,
            inventoryItemId: item.inventoryItemId,
            description: item.description ?? "",
            quantityToReturn: item.quantityToReturn,
            unitPrice: item.unitPrice ?? 0,
            totalPrice: item.quantityToReturn * (item.unitPrice ?? 0),
            condition: item.condition,
            conditionNotes: item.conditionNotes,
            defectDescription: item.defectDescription,
            lotNumber: item.lotNumber,
            serialNumbers: item.serialNumbers,
            photoUrls: item.photoUrls,
          })),
        },
      }),
    },
    include: buildRMAInclude(),
  });

  return transformRMA(rma);
}

/**
 * Delete RMA (only in DRAFT status)
 */
export async function deleteRMA(
  context: ServiceContext,
  id: string,
): Promise<void> {
  // Check permission
  await checkPermission(context, "rma:delete");

  // Get current RMA
  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id },
  });

  if (!rma) {
    throw new Error("RMA not found");
  }

  // Only allow deletion in DRAFT status
  if (rma.status !== RMAStatus.DRAFT) {
    throw new Error("Can only delete RMA in DRAFT status");
  }

  // Delete RMA and related records (cascade)
  await prisma.purchaseOrderReturn.delete({
    where: { id },
  });
}

/**
 * Inspect returned line items
 */
export async function inspectLine(
  context: ServiceContext,
  rmaId: string,
  data: InspectLineItemDTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:update");

  // Get the line to verify it exists and belongs to this RMA
  const line = await prisma.pOLineReturn.findFirst({
    where: {
      id: data.lineReturnId,
      returnId: rmaId,
    },
  });

  if (!line) {
    throw new Error("Return line not found or does not belong to this RMA");
  }

  // Update line with inspection results
  await prisma.pOLineReturn.update({
    where: { id: data.lineReturnId },
    data: {
      inspectedAt: new Date(),
      inspectedBy: context.userId,
      inspectedByName: context.userName || "",
      inspectionNotes: data.inspectionNotes,
      condition: data.condition,
      disposition: data.disposition,
      dispositionNotes: data.dispositionNotes,
    },
  });

  // Get updated RMA
  return getRMAById(context, rmaId);
}

/**
 * Restock returned items to inventory
 */
export async function restockLine(
  context: ServiceContext,
  rmaId: string,
  data: RestockLineItemDTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:update");

  // Get line details
  const line = await prisma.pOLineReturn.findFirst({
    where: {
      id: data.lineReturnId,
      returnId: rmaId,
    },
    include: { inventoryItem: true },
  });

  if (!line) {
    throw new Error("Return line not found or does not belong to this RMA");
  }

  if (!line.inventoryItemId) {
    throw new Error("Cannot restock line without inventory item");
  }

  // Update inventory stock
  await prisma.inventoryStock.upsert({
    where: {
      inventoryItemId_storeId_bin: {
        inventoryItemId: line.inventoryItemId,
        storeId: data.storeId,
        bin: "MAIN",
      },
    },
    create: {
      inventoryItemId: line.inventoryItemId,
      storeId: data.storeId,
      bin: "MAIN",
      quantityOnHand: data.quantityToRestock,
    },
    update: {
      quantityOnHand: {
        increment: data.quantityToRestock,
      },
    },
  });

  // Create inventory transaction
  await prisma.inventoryTransaction.create({
    data: {
      inventoryItemId: line.inventoryItemId,
      storeId: data.storeId,
      transactionType: "RMA_RESTOCK",
      quantity: data.quantityToRestock,
      unitCost: line.unitPrice,
      referenceType: "RMA",
      referenceId: rmaId,
      notes: data.notes ?? `Restocked from RMA`,
      performedBy: context.userId,
      performedByName: context.userName || "",
    },
  });

  // Update line
  await prisma.pOLineReturn.update({
    where: { id: data.lineReturnId },
    data: {
      restockedAt: new Date(),
      restockedBy: context.userId,
      restockedByName: context.userName || "",
      restockLocation: data.storeId,
      disposition: ReturnDisposition.RESTOCK,
    },
  });

  // Get updated RMA
  return getRMAById(context, rmaId);
}

/**
 * Mark returned items as scrapped
 */
export async function scrapLine(
  context: ServiceContext,
  rmaId: string,
  data: ScrapLineItemDTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:update");

  // Get the line to verify it exists and belongs to this RMA
  const line = await prisma.pOLineReturn.findFirst({
    where: {
      id: data.lineReturnId,
      returnId: rmaId,
    },
  });

  if (!line) {
    throw new Error("Return line not found or does not belong to this RMA");
  }

  // Update line
  await prisma.pOLineReturn.update({
    where: { id: data.lineReturnId },
    data: {
      scrapedAt: new Date(),
      scrapedBy: context.userId,
      scrapedByName: context.userName || "",
      scrapReason: data.reason,
      disposition: ReturnDisposition.SCRAP,
    },
  });

  // Get updated RMA
  return getRMAById(context, rmaId);
}

/**
 * Get RMA statistics
 */
export async function getRMAStats(
  context: ServiceContext,
  filters?: {
    startDate?: Date;
    endDate?: Date;
    supplierId?: string;
  },
): Promise<RMAStats> {
  // Check permission
  await checkPermission(context, "rma:read");

  const where: Record<string, unknown> = {};

  if (filters?.startDate || filters?.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) createdAt.gte = filters.startDate;
    if (filters.endDate) createdAt.lte = filters.endDate;
    where.createdAt = createdAt;
  }

  if (filters?.supplierId) {
    where.supplierId = filters.supplierId;
  }

  // Get counts by status
  const statusCounts = await prisma.purchaseOrderReturn.groupBy({
    by: ["status"],
    where,
    _count: true,
  });

  // Get counts by return type
  const typeCounts = await prisma.purchaseOrderReturn.groupBy({
    by: ["returnType"],
    where,
    _count: true,
  });

  // Get total amounts
  const totals = await prisma.purchaseOrderReturn.aggregate({
    where,
    _sum: {
      totalAmount: true,
      netRefundAmount: true,
      creditAmount: true,
    },
    _avg: {
      totalAmount: true,
    },
  });

  // Calculate average processing time for completed RMAs
  const completedRMAs = await prisma.purchaseOrderReturn.findMany({
    where: {
      ...where,
      status: RMAStatus.COMPLETED,
      completedAt: { not: null },
    },
    select: {
      createdAt: true,
      completedAt: true,
    },
  });

  const avgProcessingTime =
    completedRMAs.length > 0
      ? completedRMAs.reduce((sum, rma) => {
          const completedTime = rma.completedAt?.getTime() ?? 0;
          const days = Math.floor(
            (completedTime - rma.createdAt.getTime()) / (1000 * 60 * 60 * 24),
          );
          return sum + days;
        }, 0) / completedRMAs.length
      : 0;

  // Build status counts with all statuses
  const byStatus = {
    draft: 0,
    submitted: 0,
    pendingApproval: 0,
    approved: 0,
    rejected: 0,
    processing: 0,
    shipped: 0,
    receivedBySupplier: 0,
    creditIssued: 0,
    completed: 0,
    cancelled: 0,
  };

  statusCounts.forEach((s) => {
    const key = s.status.toLowerCase().replace(/_/g, "");
    if (key === "pendingapproval") {
      byStatus.pendingApproval = s._count;
    } else if (key === "receivedbysupplier") {
      byStatus.receivedBySupplier = s._count;
    } else if (key === "creditissued") {
      byStatus.creditIssued = s._count;
    } else if (key in byStatus) {
      byStatus[key as keyof typeof byStatus] = s._count;
    }
  });

  // Build type counts
  const byReturnType = {
    defective: 0,
    wrongItem: 0,
    damagedInTransit: 0,
    notAsDescribed: 0,
    overstocked: 0,
    expired: 0,
    warrantyClaim: 0,
    other: 0,
  };

  typeCounts.forEach((t) => {
    const key = t.returnType.toLowerCase().replace(/_/g, "");
    if (key === "wrongitem") {
      byReturnType.wrongItem = t._count;
    } else if (key === "damagedintransit") {
      byReturnType.damagedInTransit = t._count;
    } else if (key === "notasdescribed") {
      byReturnType.notAsDescribed = t._count;
    } else if (key === "warrantyclaim") {
      byReturnType.warrantyClaim = t._count;
    } else if (key in byReturnType) {
      byReturnType[key as keyof typeof byReturnType] = t._count;
    }
  });

  return {
    totalCount: statusCounts.reduce((sum, s) => sum + s._count, 0),
    byStatus,
    byReturnType,
    financial: {
      totalReturnValue: Number(totals._sum.totalAmount ?? 0),
      totalRestockingFees: 0, // Would need to aggregate from lines
      totalShippingCosts: 0, // Would need to aggregate from lines
      totalCreditsIssued: Number(totals._sum.creditAmount ?? 0),
      netRefundAmount: Number(totals._sum.netRefundAmount ?? 0),
    },
    performance: {
      averageProcessingTime: Math.round(avgProcessingTime),
      approvalRate: 0, // Would need to calculate approved / (approved + rejected)
      restockRate: 0, // Would need to query line dispositions
      scrapRate: 0, // Would need to query line dispositions
    },
  };
}

// Re-export workflow functions for convenience
export {
  submitRMA,
  approveRMA,
  rejectRMA,
  processRMA,
  shipRMA,
  receiveRMA,
  issueCreditRMA,
  completeRMA,
  cancelRMA,
};

export { receiveItemsBack } from "./rma-receive-items.service";
