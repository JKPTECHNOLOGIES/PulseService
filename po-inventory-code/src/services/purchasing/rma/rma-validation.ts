/**
 * RMA Validation
 *
 * Validation functions for RMA operations.
 * Enforces business rules and data integrity.
 */

import { PrismaClient, RMAStatus } from "@prisma/client";
import {
  CreateRMADTO,
  UpdateRMADTO,
  SubmitRMADTO,
  ApproveRMADTO,
  RejectRMADTO,
  ProcessRMADTO,
  ShipRMADTO,
  ReceiveRMADTO,
  IssueCreditDTO,
  CompleteRMADTO,
  CancelRMADTO,
  InspectLineItemDTO,
  RestockLineItemDTO,
  ScrapLineItemDTO,
  canEdit,
  canSubmit,
  canApprove,
  canReject,
  canProcess,
  canShip,
  canReceive,
  canIssueCredit,
  canComplete,
  canCancel,
} from "./rma.types";

/**
 * Validate RMA creation
 */
export async function validateRMACreate(
  prisma: PrismaClient,
  data: CreateRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Validate purchase order exists
  const purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id: data.purchaseOrderId },
    include: {
      lines: {
        include: {
          receipts: true,
        },
      },
    },
  });

  if (!purchaseOrder) {
    errors.push("Purchase order not found");
    return { valid: false, errors };
  }

  // Validate line items
  if (data.items.length === 0) {
    errors.push("At least one line item is required");
  } else {
    for (const line of data.items) {
      // Validate PO line exists
      const poLine = purchaseOrder.lines.find((l) => l.id === line.poLineId);
      if (!poLine) {
        errors.push(`PO line ${line.poLineId} not found`);
        continue;
      }

      // Validate quantity
      if (line.quantityToReturn <= 0) {
        errors.push(`Invalid quantity for line ${line.poLineId}`);
      }

      // Validate quantity doesn't exceed received quantity
      const totalReceived = poLine.receipts.reduce(
        (sum, receipt) => sum + Number(receipt.quantityReceived),
        0,
      );

      if (line.quantityToReturn > totalReceived) {
        errors.push(
          `Return quantity (${line.quantityToReturn}) exceeds received quantity (${totalReceived}) for line ${line.poLineId}`,
        );
      }

      // If receipt specified, validate it exists and quantity
      if (line.poLineReceiptId) {
        const receipt = poLine.receipts.find(
          (r) => r.id === line.poLineReceiptId,
        );
        if (!receipt) {
          errors.push(`Receipt ${line.poLineReceiptId} not found`);
        } else if (line.quantityToReturn > Number(receipt.quantityReceived)) {
          errors.push(
            `Return quantity exceeds receipt quantity for line ${line.poLineId}`,
          );
        }
      }

      // Guard against double-returns: check quantities already committed to
      // other active (non-cancelled, non-rejected) RMAs for this PO line.
      const existingReturnAgg = await prisma.pOLineReturn.aggregate({
        where: {
          poLineId: line.poLineId,
          return: {
            status: {
              notIn: [RMAStatus.CANCELLED, RMAStatus.REJECTED],
            },
          },
        },
        _sum: { quantityToReturn: true },
      });
      const alreadyCommitted = Number(
        existingReturnAgg._sum.quantityToReturn ?? 0,
      );
      const availableToReturn = totalReceived - alreadyCommitted;
      if (line.quantityToReturn > availableToReturn) {
        errors.push(
          `Return quantity (${line.quantityToReturn}) exceeds available returnable quantity (${availableToReturn}) for line ${line.poLineId}. ` +
            `${alreadyCommitted} unit(s) are already committed to other active RMAs.`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA update
 */
export async function validateRMAUpdate(
  prisma: PrismaClient,
  rmaId: string,
  data: UpdateRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Get existing RMA
  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
    include: {
      lines: true,
    },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  // Check if RMA can be edited
  if (!canEdit(rma.status)) {
    errors.push(`Cannot edit RMA in ${rma.status} status`);
  }

  // If updating items, validate them
  if (data.items) {
    const result = await validateRMACreate(prisma, {
      purchaseOrderId: rma.purchaseOrderId,
      returnType: data.returnType ?? rma.returnType,
      reason: data.reason ?? rma.reason,
      items: data.items,
    });

    if (!result.valid) {
      errors.push(...result.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA submission
 */
export async function validateRMASubmit(
  prisma: PrismaClient,
  rmaId: string,
  _data: SubmitRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
    include: {
      lines: true,
    },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canSubmit(rma.status)) {
    errors.push(`Cannot submit RMA in ${rma.status} status`);
  }

  if (rma.lines.length === 0) {
    errors.push("RMA must have at least one line item");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA approval
 */
export async function validateRMAApprove(
  prisma: PrismaClient,
  rmaId: string,
  _data: ApproveRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canApprove(rma.status)) {
    errors.push(`Cannot approve RMA in ${rma.status} status`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA rejection
 */
export async function validateRMAReject(
  prisma: PrismaClient,
  rmaId: string,
  data: RejectRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canReject(rma.status)) {
    errors.push(`Cannot reject RMA in ${rma.status} status`);
  }

  if (!data.reason || data.reason.trim() === "") {
    errors.push("Rejection reason is required");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA processing
 */
export async function validateRMAProcess(
  prisma: PrismaClient,
  rmaId: string,
  _data: ProcessRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canProcess(rma.status)) {
    errors.push(`Cannot process RMA in ${rma.status} status`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA shipping
 */
export async function validateRMAShip(
  prisma: PrismaClient,
  rmaId: string,
  data: ShipRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canShip(rma.status)) {
    errors.push(`Cannot ship RMA in ${rma.status} status`);
  }

  if (!data.trackingNumber || data.trackingNumber.trim() === "") {
    errors.push("Tracking number is required");
  }

  if (!data.carrier || data.carrier.trim() === "") {
    errors.push("Carrier is required");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA receipt by supplier
 */
export async function validateRMAReceive(
  prisma: PrismaClient,
  rmaId: string,
  _data: ReceiveRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canReceive(rma.status)) {
    errors.push(`Cannot receive RMA in ${rma.status} status`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate credit issuance
 */
export async function validateRMAIssueCredit(
  prisma: PrismaClient,
  rmaId: string,
  data: IssueCreditDTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canIssueCredit(rma.status)) {
    errors.push(`Cannot issue credit for RMA in ${rma.status} status`);
  }

  if (!data.creditAmount || data.creditAmount <= 0) {
    errors.push("Credit amount must be greater than zero");
  }

  if (data.creditAmount > Number(rma.netRefundAmount)) {
    errors.push("Credit amount cannot exceed net refund amount");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA completion
 */
export async function validateRMAComplete(
  prisma: PrismaClient,
  rmaId: string,
  _data: CompleteRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
    include: {
      lines: true,
    },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canComplete(rma.status)) {
    errors.push(`Cannot complete RMA in ${rma.status} status`);
  }

  // Inspection + final disposition are only meaningful on the physical-return
  // (warehouse) closure path, where the supplier ships items back to us and
  // each line is inspected then restocked/scrapped. That path auto-completes
  // through receiveItemsBack() and never reaches this validator.
  //
  // On the AP financial-closure path the items were shipped back to the
  // supplier and a credit memo was issued (status CREDIT_ISSUED) — the lines
  // are never inspected/dispositioned here. Requiring inspection in that case
  // makes the Complete RMA button impossible to satisfy, so skip those checks
  // for credit closures.
  const isCreditClosure =
    rma.status === RMAStatus.CREDIT_ISSUED || rma.creditIssuedAt !== null;

  if (!isCreditClosure) {
    // Check if all line items are inspected
    const uninspectedLines = rma.lines.filter((line) => !line.inspectedAt);
    if (uninspectedLines.length > 0) {
      errors.push("All line items must be inspected before completion");
    }

    // Check if all line items have disposition
    const undisposedLines = rma.lines.filter(
      (line) =>
        !line.disposition ||
        (line.disposition === "RESTOCK" && !line.restockedAt) ||
        (line.disposition === "SCRAP" && !line.scrapedAt),
    );
    if (undisposedLines.length > 0) {
      errors.push(
        "All line items must have final disposition before completion",
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate RMA cancellation
 */
export async function validateRMACancel(
  prisma: PrismaClient,
  rmaId: string,
  data: CancelRMADTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!rma) {
    errors.push("RMA not found");
    return { valid: false, errors };
  }

  if (!canCancel(rma.status)) {
    errors.push(`Cannot cancel RMA in ${rma.status} status`);
  }

  if (!data.reason || data.reason.trim() === "") {
    errors.push("Cancellation reason is required");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate line item inspection
 */
export async function validateLineItemInspect(
  prisma: PrismaClient,
  lineId: string,
  data: InspectLineItemDTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const line = await prisma.pOLineReturn.findUnique({
    where: { id: lineId },
    include: {
      return: true,
    },
  });

  if (!line) {
    errors.push("Line item not found");
    return { valid: false, errors };
  }

  if (line.return.status !== RMAStatus.RECEIVED_BY_SUPPLIER) {
    errors.push("Can only inspect items after they are received by supplier");
  }

  if (line.inspectedAt) {
    errors.push("Line item has already been inspected");
  }

  if (data.condition.trim() === "") {
    errors.push("Condition is required");
  }

  if (data.disposition.trim() === "") {
    errors.push("Disposition is required");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate line item restocking
 */
export async function validateLineItemRestock(
  prisma: PrismaClient,
  lineId: string,
  data: RestockLineItemDTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const line = await prisma.pOLineReturn.findUnique({
    where: { id: lineId },
    include: {
      return: true,
      inventoryItem: true,
    },
  });

  if (!line) {
    errors.push("Line item not found");
    return { valid: false, errors };
  }

  if (!line.inspectedAt) {
    errors.push("Line item must be inspected before restocking");
  }

  if (line.disposition !== "RESTOCK") {
    errors.push("Line item disposition must be RESTOCK");
  }

  if (line.restockedAt) {
    errors.push("Line item has already been restocked");
  }

  if (!line.inventoryItem) {
    errors.push("Line item must have an inventory item to restock");
  }

  if (!data.storeId) {
    errors.push("Store ID is required");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate line item scrapping
 */
export async function validateLineItemScrap(
  prisma: PrismaClient,
  lineId: string,
  data: ScrapLineItemDTO,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const line = await prisma.pOLineReturn.findUnique({
    where: { id: lineId },
    include: {
      return: true,
    },
  });

  if (!line) {
    errors.push("Line item not found");
    return { valid: false, errors };
  }

  if (!line.inspectedAt) {
    errors.push("Line item must be inspected before scrapping");
  }

  if (line.disposition !== "SCRAP") {
    errors.push("Line item disposition must be SCRAP");
  }

  if (line.scrapedAt) {
    errors.push("Line item has already been scrapped");
  }

  if (!data.reason || data.reason.trim() === "") {
    errors.push("Scrap reason is required");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate status transition
 */
export function validateStatusTransition(
  currentStatus: RMAStatus,
  newStatus: RMAStatus,
): { valid: boolean; error?: string } {
  const validTransitions: Record<RMAStatus, RMAStatus[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"],
    PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
    APPROVED: ["PROCESSING", "CANCELLED"],
    REJECTED: [],
    PROCESSING: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["RECEIVED_BY_SUPPLIER", "CANCELLED"],
    RECEIVED_BY_SUPPLIER: ["CREDIT_ISSUED", "COMPLETED"],
    CREDIT_ISSUED: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  const allowedTransitions = validTransitions[currentStatus];

  if (!allowedTransitions.includes(newStatus)) {
    return {
      valid: false,
      error: `Cannot transition from ${currentStatus} to ${newStatus}`,
    };
  }

  return { valid: true };
}
