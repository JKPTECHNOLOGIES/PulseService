/**
 * RMA Workflow Service
 *
 * Handles RMA state transitions and workflow operations.
 * Each method enforces business rules and updates audit trail.
 */

import { PrismaClient, RMAStatus } from "@prisma/client";
import { ServiceContext } from "@/types/service-types";
import {
  SubmitRMADTO,
  ApproveRMADTO,
  RejectRMADTO,
  ProcessRMADTO,
  ShipRMADTO,
  ReceiveRMADTO,
  IssueCreditDTO,
  CompleteRMADTO,
  CancelRMADTO,
  RMAWithRelations,
} from "./rma.types";
import {
  validateRMASubmit,
  validateRMAApprove,
  validateRMAReject,
  validateRMAProcess,
  validateRMAShip,
  validateRMAReceive,
  validateRMAIssueCredit,
  validateRMAComplete,
  validateRMACancel,
  validateStatusTransition,
} from "./rma-validation";
import { buildRMAInclude, transformRMA } from "./rma-utils";
import { checkPermission } from "@/services/shared/permissions";
import { getCurrentBudgetPeriod } from "@/services/gl";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { glTransactionService } from "@/services/gl/gl-transaction.service";
import { GLEventType, type RuleEvaluationContext } from "@/types/gl-rules";
import { notificationService } from "@/services/notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";

/**
 * Submit RMA for approval
 * Transitions: DRAFT → SUBMITTED
 */
export async function submitRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: SubmitRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:submit");

  // Validate
  const validation = await validateRMASubmit(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.SUBMITTED,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.SUBMITTED,
      submittedAt: new Date(),
      submittedBy: context.userId,
      submittedByName: context.userName || "Unknown",
      notes: data.notes ?? currentRMA.notes,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "SUBMITTED",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.SUBMITTED,
      comments: data.notes,
    },
  });

  // Notify all users with rma:approve permission so they can review
  try {
    const approvers = await prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          permissions: {
            some: { permission: { resource: "rma", action: "approve" } },
          },
        },
      },
      select: { id: true },
    });
    for (const approver of approvers) {
      await notificationService.sendNotification(context, {
        userId: approver.id,
        type: "rma.submitted",
        category: NotificationCategory.PURCHASING,
        title: `RMA Submitted: ${updatedRMA.rmaNumber}`,
        message: `RMA ${updatedRMA.rmaNumber} has been submitted for approval.`,
        priority: NotificationPriority.NORMAL,
        actionUrl: `/purchasing/rma/${rmaId}`,
        actionLabel: "Review RMA",
        data: {
          rmaId,
          rmaNumber: updatedRMA.rmaNumber,
          submittedBy: context.userName ?? "",
        },
      });
    }
  } catch {
    // Notification failure is non-critical
  }

  return transformRMA(updatedRMA);
}

/**
 * Approve RMA
 * Transitions: SUBMITTED/PENDING_APPROVAL → APPROVED
 */
export async function approveRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: ApproveRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:approve");

  // Validate
  const validation = await validateRMAApprove(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.APPROVED,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Calculate net refund
  const restockingFee = data.restockingFee || 0;
  const shippingCost = data.shippingCost || 0;
  const netRefundAmount = Math.max(
    0,
    Number(currentRMA.totalAmount) - restockingFee - shippingCost,
  );

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.APPROVED,
      approvedAt: new Date(),
      approvedBy: context.userId,
      approvedByName: context.userName || "Unknown",
      restockingFee,
      shippingCost,
      netRefundAmount,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "APPROVED",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.APPROVED,
      comments: data.comments,
    },
  });

  // Notify the original requester
  try {
    await notificationService.sendNotification(context, {
      userId: currentRMA.requestedById,
      type: "rma.approved",
      category: NotificationCategory.PURCHASING,
      title: `RMA Approved: ${updatedRMA.rmaNumber}`,
      message: `Your RMA ${updatedRMA.rmaNumber} has been approved. Net refund: $${netRefundAmount.toFixed(2)}.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/purchasing/rma/${rmaId}`,
      actionLabel: "View RMA",
      data: {
        rmaId,
        rmaNumber: updatedRMA.rmaNumber,
        approvedBy: context.userName ?? "",
        netRefundAmount,
      },
    });
  } catch {
    // Notification failure is non-critical
  }

  return transformRMA(updatedRMA);
}

/**
 * Reject RMA
 * Transitions: SUBMITTED/PENDING_APPROVAL → REJECTED
 */
export async function rejectRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: RejectRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:approve");

  // Validate
  const validation = await validateRMAReject(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.REJECTED,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.REJECTED,
      rejectedAt: new Date(),
      rejectedBy: context.userId,
      rejectedByName: context.userName || "Unknown",
      rejectionReason: data.reason,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "REJECTED",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.REJECTED,
      comments: data.reason,
    },
  });

  // Notify the original requester
  try {
    await notificationService.sendNotification(context, {
      userId: currentRMA.requestedById,
      type: "rma.rejected",
      category: NotificationCategory.PURCHASING,
      title: `RMA Rejected: ${updatedRMA.rmaNumber}`,
      message: `Your RMA ${updatedRMA.rmaNumber} has been rejected. Reason: ${data.reason}`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/purchasing/rma/${rmaId}`,
      actionLabel: "View RMA",
      data: {
        rmaId,
        rmaNumber: updatedRMA.rmaNumber,
        rejectedBy: context.userName ?? "",
        reason: data.reason,
      },
    });
  } catch {
    // Notification failure is non-critical
  }

  return transformRMA(updatedRMA);
}

/**
 * Process RMA
 * Transitions: APPROVED → PROCESSING
 */
export async function processRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: ProcessRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:process");

  // Validate
  const validation = await validateRMAProcess(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.PROCESSING,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.PROCESSING,
      processedAt: new Date(),
      processedBy: context.userId,
      processedByName: context.userName || "Unknown",
      supplierRMANumber: data.supplierRMANumber ?? currentRMA.supplierRMANumber,
      notes: data.notes ?? currentRMA.notes,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "PROCESSING",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.PROCESSING,
      comments: data.notes,
    },
  });

  return transformRMA(updatedRMA);
}

/**
 * Ship RMA
 * Transitions: PROCESSING → SHIPPED
 *
 * Side-effects:
 *  1. Reduces InventoryStock for each line item with an inventoryItemId
 *  2. Creates InventoryTransaction records (type: RMA_DEDUCTION)
 *  3. Sets quantityReturned = quantityToReturn on each POLineReturn
 *  4. Creates a REVERSAL GL transaction via the PO_RETURN rule (non-blocking —
 *     GL failure is logged but does not prevent the status transition)
 */
export async function shipRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: ShipRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:process");

  // Validate
  const validation = await validateRMAShip(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA with header info needed for GL
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
    include: {
      purchaseOrder: { select: { poNumber: true } },
      supplier: { select: { name: true } },
    },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.SHIPPED,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // ─── 1. Update RMA header status ─────────────────────────────────────────
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.SHIPPED,
      shippedAt: new Date(),
      shippedBy: context.userId,
      shippedByName: context.userName || "Unknown",
      trackingNumber: data.trackingNumber,
      carrier: data.carrier,
      notes: data.notes ?? currentRMA.notes,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "SHIPPED",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.SHIPPED,
      comments: `Shipped via ${data.carrier}, Tracking: ${data.trackingNumber}`,
    },
  });

  // ─── 2. Load lines with all data needed for inventory + GL ───────────────
  const lines = await prisma.pOLineReturn.findMany({
    where: { returnId: rmaId },
    include: {
      poLineReceipt: {
        select: { storeId: true, receiptNumber: true },
      },
      poLine: {
        select: {
          id: true,
          chargeAllocations: {
            select: {
              accountCodeId: true,
              departmentId: true,
              projectId: true,
              areaId: true,
            },
            orderBy: { percentage: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  const shippedAt = new Date();

  // ─── 3. Inventory deductions — one per line with an inventory item ────────
  for (const line of lines) {
    if (!line.inventoryItemId) continue;

    // storeId: prefer the linked receipt's store, skip if unknown
    const storeId = line.poLineReceipt?.storeId;
    if (!storeId) continue;

    const qty = Number(line.quantityToReturn);
    if (qty <= 0) continue;

    // Capture current stock for before/after audit
    const currentStock = await prisma.inventoryStock.findUnique({
      where: {
        inventoryItemId_storeId_bin: {
          inventoryItemId: line.inventoryItemId,
          storeId,
          bin: "MAIN",
        },
      },
      select: { quantityOnHand: true },
    });

    const quantityBefore = currentStock
      ? Number(currentStock.quantityOnHand)
      : 0;

    // Deduct stock (only if a record exists to deduct from)
    if (currentStock) {
      await prisma.inventoryStock.update({
        where: {
          inventoryItemId_storeId_bin: {
            inventoryItemId: line.inventoryItemId,
            storeId,
            bin: "MAIN",
          },
        },
        data: { quantityOnHand: { decrement: qty } },
      });
    }

    // Record the outbound inventory transaction
    await prisma.inventoryTransaction.create({
      data: {
        inventoryItemId: line.inventoryItemId,
        storeId,
        transactionType: "RMA_DEDUCTION",
        quantity: -qty, // negative = outbound
        unitCost: Number(line.unitPrice),
        referenceType: "RMA",
        referenceId: rmaId,
        referenceNumber: currentRMA.rmaNumber,
        notes: `Returned to supplier via RMA ${currentRMA.rmaNumber}`,
        performedBy: context.userId,
        performedByName: context.userName || "",
        quantityBefore,
        quantityAfter: quantityBefore - qty,
        transactionDate: shippedAt,
      },
    });

    // Stamp quantityReturned on the line (confirms items physically left)
    await prisma.pOLineReturn.update({
      where: { id: line.id },
      data: { quantityReturned: qty },
    });
  }

  // ─── 4. GL entries (REVERSAL via PO_RETURN rule — non-blocking) ──────────
  // If the GL rule engine has no rule for PO_RETURN, or the PO is in a
  // non-eligible status, we log a warning but do NOT fail the ship operation.
  // Finance can post a manual journal if needed.
  try {
    const budgetPeriod = await getCurrentBudgetPeriod(
      prisma as Parameters<typeof getCurrentBudgetPeriod>[0],
    );

    for (const line of lines) {
      if (!line.inventoryItemId) continue;

      const allocation = line.poLine.chargeAllocations[0];
      if (!allocation?.accountCodeId) continue; // Can't create GL without account code

      const totalCost = Number(line.totalPrice);
      if (totalCost <= 0) continue;

      const ruleContext: RuleEvaluationContext = {
        amount: totalCost,
        accountCodeId: allocation.accountCodeId,
        departmentId: allocation.departmentId ?? undefined,
        projectId: allocation.projectId ?? undefined,
        areaId: allocation.areaId ?? undefined,
        poId: currentRMA.purchaseOrderId,
        poNumber: currentRMA.purchaseOrder?.poNumber ?? "",
        supplierId: currentRMA.supplierId,
        supplierName: currentRMA.supplier?.name ?? "",
        transactionDate: shippedAt,
        referenceType: "POLineReceipt",
        referenceId: rmaId,
        referenceNumber: currentRMA.rmaNumber,
        itemType: "INVENTORY",
      };

      const ruleResult = await glRuleEngineService.evaluateRules(
        context,
        GLEventType.PO_RETURN,
        ruleContext,
      );

      if (
        !ruleResult.success ||
        !ruleResult.matched ||
        !ruleResult.isBalanced
      ) {
        console.warn(
          `[RMA ${currentRMA.rmaNumber}] No matching GL rule for PO_RETURN on line ${line.id} — skipping GL entry`,
        );
        continue;
      }

      // Resolve the 1535 account to apply the balance-sheet guard
      const account1535 = await prisma.gLAccount.findFirst({
        where: { accountNumber: "1535" },
        select: { id: true },
      });

      const glTransactionId = await glTransactionService.createTransaction(
        context,
        {
          transactionDate: shippedAt,
          fiscalPeriodId: budgetPeriod.id,
          transactionType: "REVERSAL",
          // POLineReturn = RMA return to supplier. Each line gets its own GL
          // transaction so the idempotency guard in createTransaction scopes
          // correctly to one line (not the whole RMA header).
          referenceType: "POLineReturn",
          referenceId: line.id, // unique per POLineReturn row
          referenceNumber: currentRMA.rmaNumber,
          description: `RMA ${currentRMA.rmaNumber} - ${currentRMA.supplier?.name ?? ""} - ${line.description}`,
          glTransactionRuleId: ruleResult.rule?.id,
          lines: ruleResult.entries.map((acc) => ({
            ...acc,
            // 1535 guard: balance-sheet inventory lines must not carry an accountCodeId
            accountCodeId:
              account1535 && acc.glAccountId === account1535.id
                ? undefined
                : allocation.accountCodeId,
            departmentId: allocation.departmentId ?? undefined,
            projectId: allocation.projectId ?? undefined,
            areaId: allocation.areaId ?? undefined,
          })),
        },
      );

      await glTransactionService.postTransaction(context, glTransactionId);
    }
  } catch (glError) {
    // GL is non-blocking — log and continue
    console.warn(
      `[RMA ${currentRMA.rmaNumber}] GL entry creation failed during ship step:`,
      glError instanceof Error ? glError.message : String(glError),
    );
  }

  return transformRMA(updatedRMA);
}

/**
 * Mark RMA as received by supplier
 * Transitions: SHIPPED → RECEIVED_BY_SUPPLIER
 */
export async function receiveRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: ReceiveRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:process");

  // Validate
  const validation = await validateRMAReceive(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.RECEIVED_BY_SUPPLIER,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.RECEIVED_BY_SUPPLIER,
      receivedBySupplierAt: new Date(),
      notes: data.notes ?? currentRMA.notes,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "RECEIVED_BY_SUPPLIER",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.RECEIVED_BY_SUPPLIER,
      comments: data.notes,
    },
  });

  // Notify users with rma:approve (AP team) — credit memo expected or items may return
  try {
    const rmaFull = await prisma.purchaseOrderReturn.findUnique({
      where: { id: rmaId },
      include: {
        purchaseOrder: { select: { poNumber: true } },
        supplier: { select: { name: true } },
      },
    });

    const actionUsers = await prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          permissions: {
            some: { permission: { resource: "rma", action: "approve" } },
          },
        },
      },
      select: { id: true },
    });

    for (const user of actionUsers) {
      await notificationService.sendNotification(context, {
        userId: user.id,
        type: "rma.received_by_supplier",
        category: NotificationCategory.PURCHASING,
        title: `Action Required — RMA ${currentRMA.rmaNumber}`,
        message: `Supplier has confirmed receipt of RMA ${currentRMA.rmaNumber} from ${rmaFull?.supplier?.name ?? "supplier"}. Record the credit memo (AP) or receive items back into stock (Warehouse).`,
        priority: NotificationPriority.HIGH,
        actionUrl: `/purchasing/rma/${rmaId}`,
        actionLabel: "Open RMA",
        data: {
          rmaId,
          rmaNumber: currentRMA.rmaNumber,
          supplierName: rmaFull?.supplier?.name ?? "",
          poNumber: rmaFull?.purchaseOrder?.poNumber ?? "",
          totalAmount: Number(currentRMA.totalAmount),
          netRefundAmount: Number(currentRMA.netRefundAmount),
        },
      });
    }
  } catch {
    // Notification failure is non-critical
  }

  return transformRMA(updatedRMA);
}

/**
 * Issue credit for RMA
 * Transitions: RECEIVED_BY_SUPPLIER → CREDIT_ISSUED
 */
export async function issueCreditRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: IssueCreditDTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:approve");

  // Validate
  const validation = await validateRMAIssueCredit(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.CREDIT_ISSUED,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.CREDIT_ISSUED,
      creditIssuedAt: new Date(),
      creditIssuedBy: context.userId,
      creditIssuedByName: context.userName || "Unknown",
      creditAmount: data.creditAmount,
      creditMethod: data.creditMethod,
      creditReferenceNumber: data.creditReferenceNumber ?? null,
      notes: data.notes ?? currentRMA.notes,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "CREDIT_ISSUED",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.CREDIT_ISSUED,
      comments: `Credit issued: $${data.creditAmount}`,
    },
  });

  // ─── GL entry for credit memo receipt (non-blocking) ─────────────────────
  // Records the AP liability reduction when the supplier issues a credit.
  // Uses INV_ADJ_DEC reversal event to debit AP and credit the returns account.
  // Non-blocking: GL failure is logged but does not prevent status transition.
  try {
    const budgetPeriod = await getCurrentBudgetPeriod(
      prisma as Parameters<typeof getCurrentBudgetPeriod>[0],
    );

    // Load RMA lines to get charge allocation dimensions
    const rmaLines = await prisma.pOLineReturn.findMany({
      where: { returnId: rmaId },
      include: {
        poLine: {
          select: {
            chargeAllocations: {
              select: {
                accountCodeId: true,
                departmentId: true,
                projectId: true,
                areaId: true,
              },
              orderBy: { percentage: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    const rmaHeader = await prisma.purchaseOrderReturn.findUnique({
      where: { id: rmaId },
      include: {
        purchaseOrder: { select: { poNumber: true } },
        supplier: { select: { name: true } },
      },
    });

    if (rmaHeader) {
      // Use the first line's allocation for dimensions (represents the return)
      const firstAllocation = rmaLines[0]?.poLine.chargeAllocations[0];

      const ruleContext: RuleEvaluationContext = {
        amount: data.creditAmount,
        accountCodeId: firstAllocation?.accountCodeId ?? undefined,
        departmentId: firstAllocation?.departmentId ?? undefined,
        projectId: firstAllocation?.projectId ?? undefined,
        areaId: firstAllocation?.areaId ?? undefined,
        poId: rmaHeader.purchaseOrderId,
        poNumber: rmaHeader.purchaseOrder?.poNumber ?? "",
        supplierId: rmaHeader.supplierId,
        supplierName: rmaHeader.supplier?.name ?? "",
        transactionDate: new Date(),
        referenceType: "POLineReceipt",
        referenceId: rmaId,
        referenceNumber: rmaHeader.rmaNumber,
        itemType: "INVENTORY",
      };

      const ruleResult = await glRuleEngineService.evaluateRules(
        context,
        GLEventType.PO_RETURN,
        ruleContext,
      );

      if (ruleResult.success && ruleResult.matched && ruleResult.isBalanced) {
        // Resolve account 1535 to apply the balance-sheet guard (same guard as
        // po-gl.service.ts and shipRMA — 1535 lines must never carry accountCodeId
        // or NAV misroutes them to expense accounts instead of 1680).
        const creditAccount1535 = await prisma.gLAccount.findFirst({
          where: { accountNumber: "1535" },
          select: { id: true },
        });

        const creditGLId = await glTransactionService.createTransaction(
          context,
          {
            transactionDate: new Date(),
            fiscalPeriodId: budgetPeriod.id,
            transactionType: "ADJUSTMENT",
            referenceType: "POLineReturn",
            referenceId: `${rmaId}-credit`, // distinct from the shipRMA REVERSAL
            referenceNumber: rmaHeader.rmaNumber,
            description: `RMA ${rmaHeader.rmaNumber} - Credit memo from ${rmaHeader.supplier?.name ?? ""} - Ref: ${data.creditReferenceNumber ?? "N/A"}`,
            glTransactionRuleId: ruleResult.rule?.id,
            // EXCLUDED: credit memo settlement is handled in NAV as a Purchase
            // Credit Memo through the AP module — auto-syncing as a Gen. Journal
            // Line would double-count the AP liability reduction in NAV.
            // Finance reviews the RMA credit in NAV and posts a Purchase Credit
            // Memo which creates the proper Vendor Ledger Entry.
            erpSyncStatus: "EXCLUDED",
            lines: ruleResult.entries.map((acc) => ({
              ...acc,
              // 1535 guard: balance-sheet inventory lines must not carry accountCodeId
              accountCodeId:
                creditAccount1535 && acc.glAccountId === creditAccount1535.id
                  ? undefined
                  : (firstAllocation?.accountCodeId ?? undefined),
              departmentId: firstAllocation?.departmentId ?? undefined,
              projectId: firstAllocation?.projectId ?? undefined,
              areaId: firstAllocation?.areaId ?? undefined,
            })),
          },
        );

        await glTransactionService.postTransaction(context, creditGLId);
      }
    }
  } catch (glError) {
    console.warn(
      `[RMA ${rmaId}] GL entry creation failed during credit issuance:`,
      glError instanceof Error ? glError.message : String(glError),
    );
  }

  // Notify the original requester
  try {
    await notificationService.sendNotification(context, {
      userId: currentRMA.requestedById,
      type: "rma.credit_issued",
      category: NotificationCategory.PURCHASING,
      title: `Credit Memo Recorded — RMA ${currentRMA.rmaNumber}`,
      message: `A credit of $${data.creditAmount.toFixed(2)} has been recorded for RMA ${currentRMA.rmaNumber}.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/purchasing/rma/${rmaId}`,
      actionLabel: "View RMA",
      data: {
        rmaId,
        rmaNumber: currentRMA.rmaNumber,
        creditAmount: data.creditAmount,
        creditMethod: data.creditMethod,
        creditReferenceNumber: data.creditReferenceNumber ?? "",
      },
    });
  } catch {
    // Notification failure is non-critical
  }

  return transformRMA(updatedRMA);
}

/**
 * Complete RMA
 * Transitions: CREDIT_ISSUED → COMPLETED
 */
export async function completeRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: CompleteRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:process");

  // Validate
  const validation = await validateRMAComplete(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.COMPLETED,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.COMPLETED,
      completedAt: new Date(),
      completedBy: context.userId,
      completedByName: context.userName || "Unknown",
      actualResolutionDate: new Date(),
      internalNotes: data.resolution,
      notes: data.notes ?? currentRMA.notes,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "COMPLETED",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.COMPLETED,
      comments: data.resolution,
    },
  });

  return transformRMA(updatedRMA);
}

/**
 * Cancel RMA
 * Transitions: Multiple states → CANCELLED
 */
export async function cancelRMA(
  prisma: PrismaClient,
  context: ServiceContext,
  rmaId: string,
  data: CancelRMADTO,
): Promise<RMAWithRelations> {
  // Check permission
  await checkPermission(context, "rma:cancel");

  // Validate
  const validation = await validateRMACancel(prisma, rmaId, data);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Get current RMA
  const currentRMA = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
  });

  if (!currentRMA) {
    throw new Error("RMA not found");
  }

  // Validate status transition
  const transitionCheck = validateStatusTransition(
    currentRMA.status,
    RMAStatus.CANCELLED,
  );
  if (!transitionCheck.valid) {
    throw new Error(transitionCheck.error);
  }

  // Update RMA
  const updatedRMA = await prisma.purchaseOrderReturn.update({
    where: { id: rmaId },
    data: {
      status: RMAStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy: context.userId,
      cancelledByName: context.userName || "Unknown",
      cancellationReason: data.reason,
    },
    include: buildRMAInclude(),
  });

  // Create approval history entry
  await prisma.rMAApprovalHistory.create({
    data: {
      returnId: rmaId,
      approverUserId: context.userId,
      approverName: context.userName || "Unknown",
      action: "CANCELLED",
      previousStatus: currentRMA.status,
      newStatus: RMAStatus.CANCELLED,
      comments: data.reason,
    },
  });

  return transformRMA(updatedRMA);
}
