/**
 * Partial PO Conversion Service
 *
 * Handles converting selected requisition lines to purchase orders
 */

import { prisma } from "@/lib/prisma";
import { budgetResolutionService } from "@/services/budget";
import {
  ConvertLinesToPOInput,
  ConvertLinesToPOResult,
  RequisitionLineStatus,
  RequisitionLineWithPOTracking,
  RequisitionWithRelations,
  LineSelectionValidation,
} from "./requisition.types";
import { generatePONumber } from "../purchase-order/purchase-order-utils";
import {
  getTaxConfig,
  calculateTaxAmount,
  calculateGrandTotal,
} from "@/services/tax/tax-config.service";

/**
 * Validate line selection for PO conversion
 */
export async function validateLineSelection(
  lineIds: string[],
): Promise<LineSelectionValidation> {
  const errors: string[] = [];

  // Get all lines with requisition info
  const lines = await prisma.requisitionLine.findMany({
    where: { id: { in: lineIds } },
    include: {
      supplier: true,
      requisition: true,
    },
  });

  if (lines.length === 0) {
    return {
      canCreatePO: false,
      allSameSupplier: false,
      allApproved: false,
      supplierId: null,
      supplierName: null,
      errors: ["No lines found"],
    };
  }

  if (lines.length !== lineIds.length) {
    errors.push("Some line IDs are invalid");
  }

  // Check all lines are APPROVED (either line-level or requisition workflow approved)
  const allApproved = lines.every((line) => {
    const isLineApproved = line.lineStatus === RequisitionLineStatus.APPROVED;
    const isReqApproved =
      line.requisition.approvalStatus === "APPROVED" ||
      line.requisition.status === "Approved";
    return isLineApproved || isReqApproved;
  });
  if (!allApproved) {
    errors.push("All lines must be from approved requisitions");
  }

  // Check all lines have same supplier
  const supplierIds = new Set(
    lines.map((line) => line.supplierId).filter(Boolean),
  );
  const allSameSupplier = supplierIds.size === 1;

  if (!allSameSupplier) {
    errors.push("All lines must have the same supplier");
  }

  // Check no lines are already on a PO
  const alreadyOrdered = lines.filter((line) => line.purchaseOrderId);
  if (alreadyOrdered.length > 0) {
    errors.push(
      `${alreadyOrdered.length} line(s) are already on a purchase order`,
    );
  }

  const supplierId =
    supplierIds.size === 1 ? (Array.from(supplierIds)[0] ?? null) : null;
  const supplierName =
    supplierId && lines[0]?.supplier?.name ? lines[0].supplier.name : null;

  return {
    canCreatePO: errors.length === 0,
    allSameSupplier,
    allApproved,
    supplierId: supplierId ?? null,
    supplierName,
    errors,
  };
}

/**
 * Convert selected lines to purchase order
 */
export async function convertLinesToPO(
  input: ConvertLinesToPOInput,
): Promise<ConvertLinesToPOResult> {
  // Validate input
  const validation = await validateLineSelection(input.lineIds);

  if (!validation.canCreatePO) {
    throw new Error(`Cannot create PO: ${validation.errors.join(", ")}`);
  }

  // Verify supplier matches
  if (validation.supplierId !== input.supplierId) {
    throw new Error("Supplier ID mismatch");
  }

  // Enforce the dedicated PO-creation permission at the service layer.
  // Converting requisition lines creates a purchase order, which is restricted
  // to PO-creator roles (Admin, Finance Manager, Plant Manager, Purchasing
  // Manager). This function has no ServiceContext, so load the actor's role
  // permissions by `convertedBy`. The route also gates `purchase_orders:create`;
  // this is defense-in-depth so the restriction holds regardless of caller.
  const actor = await prisma.user.findUnique({
    where: { id: input.convertedBy },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  const canCreatePO = actor?.role.permissions.some(
    (rp) =>
      rp.permission.resource === "purchase_orders" &&
      rp.permission.action === "create" &&
      rp.permission.isActive,
  );
  if (!canCreatePO) {
    throw new Error(
      "You do not have permission to create Purchase Orders. " +
        "The 'Purchase Orders: Create' permission is required.",
    );
  }

  // Fetch tax config outside the transaction (cached, lightweight)
  const taxConfig = await getTaxConfig();

  // Start transaction
  return await prisma.$transaction(async (tx) => {
    // Get ALL requisitions for the selected lines (they may come from different requisitions)
    const allLines = await tx.requisitionLine.findMany({
      where: { id: { in: input.lineIds } },
      include: {
        supplier: true,
        inventoryItem: true,
        allocations: true,
        requisition: {
          include: {
            requestedBy: true,
            supplier: true,
            budgetHeader: {
              include: {
                accountCode: true,
                workOrder: {
                  select: {
                    id: true,
                    woNumber: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (allLines.length === 0) {
      throw new Error("No valid lines found");
    }

    // Collect ALL unique requisitions and work orders from selected lines
    const uniqueRequisitions = new Map<
      string,
      { id: string; number: string }
    >();
    const uniqueWorkOrders = new Map<string, { id: string; number: string }>();

    for (const line of allLines) {
      // Track requisition
      if (!uniqueRequisitions.has(line.requisitionId)) {
        uniqueRequisitions.set(line.requisitionId, {
          id: line.requisitionId,
          number: line.requisition.reqNumber,
        });
      }

      // Track work order (if exists)
      const workOrder = line.requisition.budgetHeader?.workOrder;
      if (workOrder && !uniqueWorkOrders.has(workOrder.id)) {
        uniqueWorkOrders.set(workOrder.id, {
          id: workOrder.id,
          number: workOrder.woNumber,
        });
      }
    }

    // Calculate subtotal from lines
    const subtotal = allLines.reduce((sum, line) => {
      const quantity =
        typeof line.quantity === "number"
          ? line.quantity
          : line.quantity.toNumber();
      const price =
        typeof line.estimatedPrice === "number"
          ? line.estimatedPrice
          : line.estimatedPrice.toNumber();
      return sum + quantity * price;
    }, 0);

    // Compute tax amount from the configured rate.
    // If tax module is disabled, taxAmount is always 0.
    const taxAmount = calculateTaxAmount(subtotal, taxConfig);
    const grandTotal = calculateGrandTotal(subtotal, taxAmount);

    // Generate PO number
    const poNumber = await generatePONumber(tx);

    // Create purchase order with ALL requisitions and work orders
    // POs created from approved requisitions start at "Approved" status,
    // skipping the Draft→Submitted→Approved workflow. GL entries happen at Send to Supplier.
    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: input.supplierId,
        status: "Approved",
        approvedAt: new Date(),
        orderDate: new Date(),
        totalAmount: grandTotal,
        notes:
          input.notes ??
          `Created from ${uniqueRequisitions.size} requisition(s)${uniqueWorkOrders.size > 0 ? ` and ${uniqueWorkOrders.size} work order(s)` : ""}`,
        createdBy: input.convertedBy,
        requisitionIds: Array.from(uniqueRequisitions.values()).map(
          (r) => r.id,
        ),
        requisitionNumbers: Array.from(uniqueRequisitions.values()).map(
          (r) => r.number,
        ),
        workOrderIds: Array.from(uniqueWorkOrders.values()).map((w) => w.id),
        workOrderNumbers: Array.from(uniqueWorkOrders.values()).map(
          (w) => w.number,
        ),
      },
    });

    // Persist taxAmount using typed Prisma call (post-migration, taxAmount column is generated)
    if (taxAmount > 0) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { taxAmount },
      });
    }

    // totalAmount for display/result purposes is the grand total
    const totalAmount = grandTotal;

    // Create PO lines and update requisition lines
    const convertedLines: RequisitionLineWithPOTracking[] = [];
    let lineIdx = 0;

    for (const line of allLines) {
      const quantity =
        typeof line.quantity === "number"
          ? line.quantity
          : line.quantity.toNumber();
      const estimatedPrice =
        typeof line.estimatedPrice === "number"
          ? line.estimatedPrice
          : line.estimatedPrice.toNumber();

      // Get work order info for this line
      const workOrder = line.requisition.budgetHeader?.workOrder;

      // Create PO line with full tracking
      const poLine = await tx.pOLine.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          lineNumber: ++lineIdx,
          inventoryItemId: line.inventoryItemId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.estimatedPrice,
          unitOfMeasure: line.unit,
          totalPrice: quantity * estimatedPrice,
          lineType: line.lineType,
          notes: line.notes,
          // Requisition tracking
          requisitionId: line.requisitionId,
          requisitionLineId: line.id,
          requisitionNumber: line.requisition.reqNumber,
          // Work order tracking
          workOrderId: workOrder?.id ?? null,
          workOrderNumber: workOrder?.woNumber ?? null,
          // Copy service/consumable fields if applicable
          consumableCategory: line.consumableCategory,
          contractNumber: line.contractNumber,
          deliverables: line.deliverables,
          estimatedHours: line.estimatedHours,
          expirationTracking: line.expirationTracking,
          hourlyRate: line.hourlyRate,
          manufacturer: line.manufacturer,
          modelNumber: line.modelNumber,
          monthlyUsageRate: line.monthlyUsageRate,
          packageSize: line.packageSize,
          sdsRequired: line.sdsRequired,
          serviceEndDate: line.serviceEndDate,
          serviceEquipmentId: line.serviceEquipmentId,
          serviceLocation: line.serviceLocation,
          serviceProvider: line.serviceProvider,
          serviceStartDate: line.serviceStartDate,
          serviceType: line.serviceType,
          serviceWorkOrderId: line.serviceWorkOrderId,
          slaDetails: line.slaDetails,
          storageRequirements: line.storageRequirements,
        },
      });

      // CRITICAL: Copy charge allocations from requisition line to PO line.
      // SERVICE and CONSUMABLE lines require charge allocations with account codes
      // for GL entry generation at "Send to Supplier" time.
      const lineAllocations = line.allocations;
      if (lineAllocations.length > 0) {
        // Copy each line-level allocation to the PO line
        for (const alloc of lineAllocations) {
          await tx.pOLineChargeAllocation.create({
            data: {
              poLineId: poLine.id,
              accountCodeId: alloc.accountCodeId,
              departmentId: alloc.departmentId,
              projectId: alloc.projectId,
              areaId: alloc.areaId,
              percentage: alloc.percentage,
              amount: alloc.amount,
              notes: null,
            },
          });
        }
      } else if (
        line.lineType === "SERVICE" ||
        line.lineType === "CONSUMABLE"
      ) {
        // Fallback: no line-level allocations exist.
        // Resolve the best available account code from the budget header:
        //   1. CHARGE_TO_ACCOUNT: use header.accountCodeId directly
        //   2. CHARGE_TO_PROJECT: look up the project's default accountCodeId
        //   3. CHARGE_TO_WORK_ORDER: resolve from WO's project or equipment (G7)
        const budgetHeader = line.requisition.budgetHeader;
        let fallbackAccountCodeId: string | null =
          budgetHeader?.accountCodeId ?? null;
        let fallbackProjectId: string | null = null;

        if (!fallbackAccountCodeId && budgetHeader?.projectId) {
          // CHARGE_TO_PROJECT: resolve the project's default account code
          const project = await tx.project.findUnique({
            where: { id: budgetHeader.projectId },
            select: { accountCodeId: true },
          });
          fallbackAccountCodeId = project?.accountCodeId ?? null;
          fallbackProjectId = budgetHeader.projectId;
        }

        // G7: CHARGE_TO_WORK_ORDER fallback — resolve from WO's project or equipment
        if (
          !fallbackAccountCodeId &&
          budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER" &&
          budgetHeader.workOrderId
        ) {
          const woResolution =
            await budgetResolutionService.resolveFromWorkOrder(
              budgetHeader.workOrderId,
            );
          fallbackAccountCodeId = woResolution.accountCodeId;
        }

        if (fallbackAccountCodeId) {
          // Create a single 100% allocation using the resolved account code so that
          // GL entries can be generated when the PO is sent to the supplier.
          const lineAmount = quantity * estimatedPrice;
          await tx.pOLineChargeAllocation.create({
            data: {
              poLineId: poLine.id,
              accountCodeId: fallbackAccountCodeId,
              departmentId: null,
              projectId: fallbackProjectId,
              areaId: null,
              percentage: 100,
              amount: lineAmount,
              notes: "Copied from requisition budget header",
            },
          });
        }
      }

      // Update requisition line
      const updatedLine = await tx.requisitionLine.update({
        where: { id: line.id },
        data: {
          lineStatus: RequisitionLineStatus.ORDERED,
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber: poNumber,
          poLineId: poLine.id,
          convertedToPOAt: new Date(),
          convertedToPOBy: input.convertedBy,
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

      convertedLines.push(updatedLine as RequisitionLineWithPOTracking);
    }

    // Update ALL affected requisitions' line counts, PO links, and previousPOIds arrays
    for (const [reqId] of uniqueRequisitions.entries()) {
      const existingReq = await tx.requisition.findUnique({
        where: { id: reqId },
        include: { lines: true },
      });

      if (existingReq) {
        // Compute accurate line counts from actual line statuses
        const totalCount = existingReq.lines.length;
        const orderedCount = existingReq.lines.filter(
          (l) => l.lineStatus === RequisitionLineStatus.ORDERED,
        ).length;
        const pendingCount = existingReq.lines.filter(
          (l) => l.lineStatus === "PENDING",
        ).length;
        const approvedCount = existingReq.lines.filter(
          (l) => l.lineStatus === "APPROVED",
        ).length;
        const fulfilledCount = existingReq.lines.filter(
          (l) =>
            l.lineStatus === "FULFILLED" ||
            l.lineStatus === "PARTIALLY_FULFILLED",
        ).length;
        const cancelledCount = existingReq.lines.filter(
          (l) => l.lineStatus === "CANCELLED",
        ).length;
        const allLinesOrdered = orderedCount === totalCount && totalCount > 0;

        // Track all POs in previousPOIds (deduplicated)
        const existingPrevIds = existingReq.previousPOIds;
        const existingPrevNumbers = existingReq.previousPONumbers;
        const updatedPrevIds = existingPrevIds.includes(purchaseOrder.id)
          ? existingPrevIds
          : [...existingPrevIds, purchaseOrder.id];
        const updatedPrevNumbers = existingPrevNumbers.includes(poNumber)
          ? existingPrevNumbers
          : [...existingPrevNumbers, poNumber];

        await tx.requisition.update({
          where: { id: reqId },
          data: {
            // Always update line counts
            totalLines: totalCount,
            orderedLines: orderedCount,
            pendingLines: pendingCount,
            approvedLines: approvedCount,
            fulfilledLines: fulfilledCount,
            cancelledLines: cancelledCount,
            // Track all POs in previousPOIds
            previousPOIds: updatedPrevIds,
            previousPONumbers: updatedPrevNumbers,
            // Set primary PO if this is the first one (first PO wins)
            purchaseOrderId: existingReq.purchaseOrderId ?? purchaseOrder.id,
            purchaseOrderNumber: existingReq.purchaseOrderNumber ?? poNumber,
            convertedToPOAt: existingReq.convertedToPOAt ?? new Date(),
            convertedToPOBy: existingReq.convertedToPOBy ?? input.convertedBy,
            // Update status to Ordered only when ALL lines are ordered
            ...(allLinesOrdered ? { status: "Ordered" } : {}),
          },
        });
      }
    }

    // Get remaining lines
    const remainingLines = await tx.requisitionLine.findMany({
      where: {
        requisitionId: input.requisitionId,
        id: { notIn: input.lineIds },
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

    // Get updated requisition with all relations
    const updatedRequisition = await tx.requisition.findUnique({
      where: { id: input.requisitionId },
      include: {
        lines: {
          include: {
            supplier: true,
            inventoryItem: true,
            purchaseOrder: true,
            poLine: true,
            convertedByUser: true,
          },
        },
        requestedBy: true,
        supplier: true,
        budgetHeader: {
          include: {
            accountCode: true,
            workOrder: true,
          },
        },
        lineAllocations: {
          include: {
            accountCode: true,
            department: true,
            area: true,
            project: true,
          },
        },
      },
    });

    if (!updatedRequisition) {
      throw new Error("Failed to retrieve updated requisition");
    }

    // Create audit log with full tracking
    await tx.auditLog.create({
      data: {
        userId: input.convertedBy,
        userName: input.convertedByName,
        action: "CONVERT_LINES_TO_PO",
        entityType: "PurchaseOrder",
        entityId: purchaseOrder.id,
        changes: {
          poNumber,
          poId: purchaseOrder.id,
          lineIds: input.lineIds,
          lineCount: convertedLines.length,
          totalAmount,
          requisitionCount: uniqueRequisitions.size,
          requisitionIds: Array.from(uniqueRequisitions.values()).map(
            (r) => r.id,
          ),
          requisitionNumbers: Array.from(uniqueRequisitions.values()).map(
            (r) => r.number,
          ),
          workOrderCount: uniqueWorkOrders.size,
          workOrderIds: Array.from(uniqueWorkOrders.values()).map((w) => w.id),
          workOrderNumbers: Array.from(uniqueWorkOrders.values()).map(
            (w) => w.number,
          ),
        },
        timestamp: new Date(),
      },
    });

    return {
      purchaseOrder: {
        id: purchaseOrder.id,
        poNumber: purchaseOrder.poNumber,
        status: purchaseOrder.status,
        totalAmount:
          typeof purchaseOrder.totalAmount === "number"
            ? purchaseOrder.totalAmount
            : purchaseOrder.totalAmount.toNumber(),
      },
      convertedLines,
      remainingLines: remainingLines as RequisitionLineWithPOTracking[],
      requisition: updatedRequisition as unknown as RequisitionWithRelations,
      success: true,
      message: `Successfully created PO ${poNumber} with ${convertedLines.length} line(s)`,
    };
  });
}

/**
 * Get lines grouped by supplier
 */
export async function getLinesBySupplier(
  requisitionId: string,
): Promise<Map<string, RequisitionLineWithPOTracking[]>> {
  const lines = await prisma.requisitionLine.findMany({
    where: {
      requisitionId,
      lineStatus: RequisitionLineStatus.APPROVED,
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

  const grouped = new Map<string, RequisitionLineWithPOTracking[]>();

  for (const line of lines as RequisitionLineWithPOTracking[]) {
    const supplierId = line.supplierId ?? "no-supplier";
    if (!grouped.has(supplierId)) {
      grouped.set(supplierId, []);
    }
    const group = grouped.get(supplierId);
    if (group) {
      group.push(line);
    }
  }

  return grouped;
}

/**
 * Check if requisition can have partial PO conversion
 */
export async function canConvertPartially(
  requisitionId: string,
): Promise<boolean> {
  const lines = await prisma.requisitionLine.findMany({
    where: {
      requisitionId,
      lineStatus: RequisitionLineStatus.APPROVED,
      purchaseOrderId: null,
    },
  });

  return lines.length > 0;
}

/**
 * Get conversion summary for a requisition
 */
export async function getConversionSummary(requisitionId: string): Promise<{
  totalLines: number;
  convertibleLines: number;
  alreadyOrdered: number;
  supplierGroups: Array<{
    supplierId: string | null;
    supplierName: string | null;
    lineCount: number;
    canConvert: boolean;
  }>;
}> {
  const lines = await prisma.requisitionLine.findMany({
    where: { requisitionId },
    include: { supplier: true },
  });

  const convertibleLines = lines.filter(
    (line) =>
      line.lineStatus === RequisitionLineStatus.APPROVED &&
      !line.purchaseOrderId,
  );

  const alreadyOrdered = lines.filter(
    (line) => line.lineStatus === RequisitionLineStatus.ORDERED,
  );

  // Group by supplier
  const supplierMap = new Map<string, typeof lines>();
  convertibleLines.forEach((line) => {
    const key = line.supplierId ?? "no-supplier";
    if (!supplierMap.has(key)) {
      supplierMap.set(key, []);
    }
    const group = supplierMap.get(key);
    if (group) {
      group.push(line);
    }
  });

  const supplierGroups = Array.from(supplierMap.entries()).map(
    ([supplierId, groupLines]) => ({
      supplierId: supplierId === "no-supplier" ? null : supplierId,
      supplierName: groupLines[0]?.supplier?.name ?? null,
      lineCount: groupLines.length,
      canConvert: groupLines.every(
        (line) => line.lineStatus === RequisitionLineStatus.APPROVED,
      ),
    }),
  );

  return {
    totalLines: lines.length,
    convertibleLines: convertibleLines.length,
    alreadyOrdered: alreadyOrdered.length,
    supplierGroups,
  };
}
