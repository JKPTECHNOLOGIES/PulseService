/**
 * PO Line Charge Allocation API Routes
 *
 * GET  /api/purchasing/purchase-orders/[id]/lines/[lineId]/allocations
 *   — Fetch current budget charge allocations for a PO line
 *
 * PUT  /api/purchasing/purchase-orders/[id]/lines/[lineId]/allocations
 *   — Replace ALL allocations for a PO line (delete existing + create new)
 *   — For GL-active POs (Approved, Ordered, PartiallyReceived), also reverses
 *     existing GL entries and re-posts new ones based on updated allocations.
 *
 * Validates that the PO line has no active (non-reversed) goods receipts
 * before allowing allocation changes.
 */

import { success } from "@/lib/api-response";
import {
  createApiHandler,
  type ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import {
  BadRequestError,
  NotFoundError,
} from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
import { buildServiceContext } from "@/lib/route-helpers";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { BudgetTrackingService } from "@/services/budgets";
import { GLEventType, GLEntry } from "@/types/gl-rules";
import { ServiceContext } from "@/services/base/types";

/** Route params for this nested endpoint */
type RouteParams = { id: string; lineId: string };

/** Editable PO statuses (DB string values) */
const EDITABLE_PO_STATUSES = [
  "Draft",
  "Submitted",
  "Approved",
  "Ordered",
  "PartiallyReceived",
];

/** PO statuses where GL entries exist and must be reversed + re-posted on allocation change */
const GL_ACTIVE_STATUSES = [
  "Approved",
  "Ordered",
  "PartiallyReceived",
];

/** Shape of a single allocation in the request body */
interface AllocationInput {
  accountCodeId: string;
  departmentId?: string;
  projectId?: string;
  areaId?: string;
  percentage: number;
  amount: number;
}

/** Shape of an allocation record from the database */
interface AllocationFromDB {
  id: string;
  accountCodeId: string | null;
  departmentId: string | null;
  projectId: string | null;
  areaId: string | null;
  percentage: number;
  amount: number;
}

/** Include fragment for returning expanded allocations */
const allocationInclude = {
  accountCode: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  area: { select: { id: true, name: true } },
} as const;

// ---------------------------------------------------------------------------
// GET /api/purchasing/purchase-orders/[id]/lines/[lineId]/allocations
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  { hasParams: true },
  async (_req, context: ApiContextWithParams<RouteParams>) => {
    const { id, lineId } = context.params;

    // Load PO line with allocations
    const poLine = await prisma.pOLine.findUnique({
      where: { id: lineId },
      include: {
        purchaseOrder: { select: { id: true } },
        chargeAllocations: {
          include: allocationInclude,
        },
      },
    });

    if (!poLine) {
      throw new NotFoundError("POLine", lineId);
    }

    // Ensure the line belongs to the PO specified in the URL
    if (poLine.purchaseOrder.id !== id) {
      throw new NotFoundError("POLine", `${lineId} on PO ${id}`);
    }

    // Check if there is net received quantity/amount remaining
    // (returns/reversals decrement these fields, so 0 means all receipts have been reversed)
    const hasActiveReceipts =
      Number(poLine.receivedQuantity) > 0 || Number(poLine.receivedAmount) > 0;

    return success({
      allocations: poLine.chargeAllocations,
      hasActiveReceipts,
    });
  },
);

// ---------------------------------------------------------------------------
// PUT /api/purchasing/purchase-orders/[id]/lines/[lineId]/allocations
// ---------------------------------------------------------------------------

export const PUT = createApiHandler(
  { hasParams: true },
  async (req, context: ApiContextWithParams<RouteParams>) => {
    const { id, lineId } = context.params;

    // ---- Parse request body ----
    const body = (await req.json()) as Record<string, unknown>;
    const allocations = body.allocations as AllocationInput[] | undefined;

    if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
      throw new BadRequestError(
        "Request body must include an 'allocations' array with at least one item.",
      );
    }

    // ---- Load PO line with relations ----
    const poLine = await prisma.pOLine.findUnique({
      where: { id: lineId },
      include: {
        purchaseOrder: true,
        chargeAllocations: true,
      },
    });

    if (!poLine) {
      throw new NotFoundError("POLine", lineId);
    }

    // Ensure the line belongs to the PO specified in the URL
    if (poLine.purchaseOrder.id !== id) {
      throw new NotFoundError("POLine", `${lineId} on PO ${id}`);
    }

    // ---- Validate PO is in an editable status ----
    if (!EDITABLE_PO_STATUSES.includes(poLine.purchaseOrder.status)) {
      throw new BadRequestError(
        `Cannot modify allocations on a purchase order with status "${poLine.purchaseOrder.status}". ` +
          `Editable statuses are: ${EDITABLE_PO_STATUSES.join(", ")}.`,
      );
    }

    // ---- Validate no active (un-reversed) receipts ----
    // Use net receivedQuantity/receivedAmount instead of counting receipt records,
    // because reversed receipts create return records but don't delete originals.
    const hasNetReceivedQty = Number(poLine.receivedQuantity) > 0 || Number(poLine.receivedAmount) > 0;
    if (hasNetReceivedQty) {
      throw new BadRequestError(
        "Cannot modify budget allocations while this line has unreversed goods receipts. " +
          "Please reverse all receipts for this line from the Receiving tab first.",
      );
    }

    // ---- Validate each allocation ----
    allocations.forEach((alloc, i) => {
      if (!alloc.accountCodeId || typeof alloc.accountCodeId !== "string") {
        throw new BadRequestError(
          `allocations[${i}].accountCodeId is required and must be a string.`,
        );
      }

      if (typeof alloc.percentage !== "number" || alloc.percentage < 0) {
        throw new BadRequestError(
          `allocations[${i}].percentage is required and must be a non-negative number.`,
        );
      }

      if (typeof alloc.amount !== "number") {
        throw new BadRequestError(
          `allocations[${i}].amount is required and must be a number.`,
        );
      }
    });

    // ---- Validate percentages sum to 100 ----
    const percentageSum = allocations.reduce((sum, a) => sum + a.percentage, 0);
    if (Math.abs(percentageSum - 100) >= 0.01) {
      throw new BadRequestError(
        `Allocation percentages must total 100%. Current total: ${percentageSum.toFixed(2)}%.`,
      );
    }

    // ---- Validate account codes exist ----
    const accountCodeIds = Array.from(new Set(allocations.map((a) => a.accountCodeId)));
    const existingAccountCodes = await prisma.accountCode.findMany({
      where: { id: { in: accountCodeIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingAccountCodes.map((ac) => ac.id));

    for (const acId of accountCodeIds) {
      if (!existingIds.has(acId)) {
        throw new BadRequestError(
          `Account code with id "${acId}" does not exist.`,
        );
      }
    }

    // ---- Determine if GL reversal + re-posting is needed ----
    const poStatus = poLine.purchaseOrder.status;
    const isGLActive = GL_ACTIVE_STATUSES.includes(poStatus);

    if (isGLActive) {
      // ================================================================
      // GL-ACTIVE PATH: Reverse existing GL → Save allocations → Re-post GL
      // ================================================================
      const serviceContext = await buildServiceContext();

      // STEP 1: Find existing POSTED EXPENDITURE GL transactions for this PO
      const existingGLTransactions = await prisma.gLTransaction.findMany({
        where: {
          referenceType: 'PurchaseOrder',
          referenceId: id,
          transactionType: 'EXPENDITURE',
          status: 'POSTED',
        },
      });

      // STEP 2: Reverse each existing GL transaction
      // This automatically corrects budgets (unconsumeBudgetFromGL for EXPENDITURE)
      // FATAL: If reversal fails, the entire operation aborts — no allocation changes saved
      for (const glTx of existingGLTransactions) {
        await glReversalService.reverseTransaction(
          glTx.id,
          `Allocation change on PO line ${lineId} — reversing for re-posting with updated allocations`,
          serviceContext.userId,
        );
      }

      // STEP 3: Save new allocations (delete old + create new)
      await prisma.$transaction(async (tx) => {
        await tx.pOLineChargeAllocation.deleteMany({
          where: { poLineId: lineId },
        });

        for (const alloc of allocations) {
          await tx.pOLineChargeAllocation.create({
            data: {
              poLineId: lineId,
              accountCodeId: alloc.accountCodeId,
              departmentId: alloc.departmentId ?? null,
              projectId: alloc.projectId ?? null,
              areaId: alloc.areaId ?? null,
              percentage: alloc.percentage,
              amount: alloc.amount,
            },
          });
        }
      });

      // STEP 4: Re-create GL entries based on ALL PO lines with their current allocations
      // This follows the same pattern as createApprovalGLEntries() in purchase-order-workflow.service.ts
      await repostPOExpenditureGL(
        serviceContext,
        id,
        poLine.purchaseOrder.poNumber,
        poLine.purchaseOrder.requisitionIds,
      );
    } else {
      // ================================================================
      // NON-GL PATH: Draft/Submitted — just save allocations, no GL impact
      // ================================================================
      await prisma.$transaction(async (tx) => {
        await tx.pOLineChargeAllocation.deleteMany({
          where: { poLineId: lineId },
        });

        for (const alloc of allocations) {
          await tx.pOLineChargeAllocation.create({
            data: {
              poLineId: lineId,
              accountCodeId: alloc.accountCodeId,
              departmentId: alloc.departmentId ?? null,
              projectId: alloc.projectId ?? null,
              areaId: alloc.areaId ?? null,
              percentage: alloc.percentage,
              amount: alloc.amount,
            },
          });
        }
      });
    }

    // ---- Return the updated allocations ----
    const updated = await prisma.pOLineChargeAllocation.findMany({
      where: { poLineId: lineId },
      include: allocationInclude,
    });

    return success(
      { allocations: updated },
      isGLActive
        ? "PO line allocations updated — GL entries reversed and re-posted with new dimensions"
        : "PO line allocations updated successfully",
    );
  },
);

// ---------------------------------------------------------------------------
// Helper: Re-post EXPENDITURE GL entries for an entire PO
// ---------------------------------------------------------------------------
// Replicates the logic from createApprovalGLEntries() in
// purchase-order-workflow.service.ts (lines 933-1176).
// Reads ALL PO lines with their CURRENT allocations from the database,
// evaluates GL rules, creates a single GL transaction, posts it,
// and consumes budget.
// ---------------------------------------------------------------------------

async function repostPOExpenditureGL(
  context: ServiceContext,
  poId: string,
  poNumber: string,
  requisitionIds: string[],
): Promise<void> {
  // Get current budget period
  const budgetPeriod = await getCurrentBudgetPeriod(prisma);

  // Load PO with ALL lines and their current allocations
  const poWithLines = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      lines: {
        include: {
          chargeAllocations: true,
        },
      },
    },
  });

  if (!poWithLines || poWithLines.lines.length === 0) {
    throw new BadRequestError('Cannot re-post GL entries: no PO lines found');
  }

  // Check if this PO is linked to work order requisitions
  let isWorkOrderPO = false;
  if (requisitionIds.length > 0) {
    const requisition = await prisma.requisition.findFirst({
      where: { id: { in: requisitionIds } },
      include: {
        budgetHeader: {
          select: { budgetType: true },
        },
      },
    });
    const budgetHeader = requisition?.budgetHeader as { budgetType: string } | null;
    isWorkOrderPO = budgetHeader?.budgetType === 'CHARGE_TO_WORK_ORDER';
  }

  // Type guard for lines with allocations
  const hasAllocations = (line: typeof poWithLines.lines[0]): line is typeof line & {
    chargeAllocations: AllocationFromDB[];
  } => {
    const lineWithAlloc = line as typeof line & { chargeAllocations?: unknown };
    return Array.isArray(lineWithAlloc.chargeAllocations) && lineWithAlloc.chargeAllocations.length > 0;
  };

  // Build projectId → projectCode lookup
  // chargeAllocations is always an array (Prisma include), never undefined
  const allAllocProjectIds: string[] = poWithLines.lines
    .flatMap(l => {
      const lineWithAlloc = l as typeof l & { chargeAllocations: Array<{ projectId: string | null }> };
      return lineWithAlloc.chargeAllocations
        .map(a => a.projectId)
        .filter((pid): pid is string => pid !== null);
    });
  const uniqueAllocProjectIds = Array.from(new Set(allAllocProjectIds));
  const projectCodeMap = new Map<string, string>();
  if (uniqueAllocProjectIds.length > 0) {
    const projects = await prisma.project.findMany({
      where: { id: { in: uniqueAllocProjectIds } },
      select: { id: true, code: true },
    });
    for (const p of projects) {
      projectCodeMap.set(p.id, p.code);
    }
  }

  // Collect ALL GL entries from ALL lines and ALL allocations
  const allGLEntries: GLEntry[] = [];
  let matchedApprovalRuleId: string | undefined;

  const budgetTrackingService = new BudgetTrackingService(prisma);

  for (const line of poWithLines.lines) {
    const lineAmount = Number(line.quantity) * Number(line.unitPrice);
    const lineType = line.lineType;

    if (isWorkOrderPO) {
      // Work order POs: Equipment always provides account codes and departments.
      // Use the first allocation's account code if available, otherwise skip GL for this line.
      const lineWithAlloc = line as typeof line & { chargeAllocations: Array<{ accountCodeId: string | null; departmentId: string | null }> };
      const firstAlloc = lineWithAlloc.chargeAllocations[0];
      const woAccountCodeId = firstAlloc?.accountCodeId;

      if (!woAccountCodeId) {
        throw new BadRequestError(
          'No account code configured for work order PO line. Equipment must have a default account code.',
        );
      }

      const ruleResult = await glRuleEngineService.evaluateRules(
        context,
        GLEventType.PO_APPROVE,
        {
          amount: lineAmount,
          accountCodeId: woAccountCodeId,
          departmentId: firstAlloc.departmentId ?? undefined,
          transactionDate: new Date(),
          referenceType: 'PurchaseOrder',
          referenceId: poId,
          referenceNumber: poNumber,
          poNumber,
          lineType,
          sourceType: 'WORK_ORDER',
        },
      );

      if (!ruleResult.success || !ruleResult.matched) {
        throw new BadRequestError(
          'No GL rule matched for PO_APPROVE event. Please configure GL rules for PO approval transactions.',
        );
      }
      if (!ruleResult.isBalanced) {
        throw new BadRequestError(
          `GL entries not balanced for PO re-posting: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
        );
      }

      matchedApprovalRuleId ??= ruleResult.rule?.id;
      allGLEntries.push(...ruleResult.entries);
    } else {
      // For regular POs, iterate each allocation on this line
      if (!hasAllocations(line)) {
        // Skip lines without allocations - they may be INVENTORY (auto-assigned by GL rules)
        // or non-inventory lines that haven't had their allocations configured yet
        continue;
      }

      for (const allocation of line.chargeAllocations) {
        if (!allocation.accountCodeId) {
          throw new BadRequestError(`Allocation ${allocation.id} has no account code`);
        }

        const allocationAmount = lineAmount * (allocation.percentage / 100);

        const ruleResult = await glRuleEngineService.evaluateRules(
          context,
          GLEventType.PO_APPROVE,
          {
            amount: allocationAmount,
            accountCodeId: allocation.accountCodeId,
            departmentId: allocation.departmentId ?? undefined,
            areaId: allocation.areaId ?? undefined,
            projectId: allocation.projectId ?? undefined,
            transactionDate: new Date(),
            referenceType: 'PurchaseOrder',
            referenceId: poId,
            referenceNumber: poNumber,
            poNumber,
            projectCode: allocation.projectId ? projectCodeMap.get(allocation.projectId) : undefined,
            lineType,
            sourceType: 'MANUAL',
          },
        );

        if (!ruleResult.success || !ruleResult.matched) {
          throw new BadRequestError(
            'No GL rule matched for PO_APPROVE event. Please configure GL rules for PO approval transactions.',
          );
        }
        if (!ruleResult.isBalanced) {
          throw new BadRequestError(
            `GL entries not balanced for PO re-posting: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
          );
        }

        matchedApprovalRuleId ??= ruleResult.rule?.id;
        allGLEntries.push(...ruleResult.entries);
      }
    }
  }

  // Validate we have GL entries
  if (allGLEntries.length === 0) {
    throw new BadRequestError('No GL entries generated for PO during re-posting');
  }

  // Compute the debit total — must match what budget tracking extracts
  const totalDebitAmount = allGLEntries
    .filter(e => e.entryType === 'DEBIT')
    .reduce((sum, e) => sum + e.amount, 0);

  // Create ONE GL transaction with ALL entries
  const glTransactionId = await glTransactionService.createTransaction(context, {
    transactionDate: new Date(),
    fiscalPeriodId: budgetPeriod.id,
    transactionType: 'EXPENDITURE',
    referenceType: 'PurchaseOrder',
    referenceId: poId,
    referenceNumber: poNumber,
    description: `Re-posted commitment for PO ${poNumber} after allocation change`,
    glTransactionRuleId: matchedApprovalRuleId,
    lines: allGLEntries.map(entry => ({
      entryType: entry.entryType,
      glAccountId: entry.glAccountId,
      amount: entry.amount,
      description: entry.description,
      accountCodeId: entry.accountCodeId,
      departmentId: entry.departmentId,
      projectId: entry.projectId,
      areaId: entry.areaId,
    })),
  });

  // Post GL transaction
  await glTransactionService.postTransaction(context, glTransactionId);

  // Consume budget using GL transaction as single source of truth
  // Only for regular (charge-to-account) POs, NOT work order POs
  if (!isWorkOrderPO) {
    await budgetTrackingService.consumeBudgetFromGL(context, {
      periodId: budgetPeriod.id,
      glTransactionId,
      referenceType: 'PurchaseOrder',
      referenceId: poId,
      referenceNumber: poNumber,
      totalAmount: totalDebitAmount,
    });
  }
}
