/**
 * Requisition Utilities
 *
 * Shared utility functions for requisition operations.
 * These functions are pure and have no side effects.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import type { RequisitionWithRelations } from "./requisition.types";
import {
  glRuleEngineService,
  glTransactionService,
  getCurrentBudgetPeriod,
  type PrismaLike,
} from "@/services/gl";
import { GLEventType, type GLEntry } from "@/types/gl-rules";
import type { ServiceContext } from "@/types/service-types";

/**
 * Generate unique requisition number
 * Format: REQ-NNNNNN (6 digits, zero-padded)
 *
 * Atomically increments the 'REQ' row in document_counters and returns
 * the new value as the issued number. One DB write, no scans, no race
 * conditions, no dependency on the format or content of existing REQ rows.
 *
 * The counter row (name = 'REQ') is seeded by seed-document-counters.js.
 *
 * @param prisma - Prisma client instance
 * @returns Promise resolving to formatted requisition number
 */
export async function generateRequisitionNumber(
  prisma: PrismaClient,
): Promise<string> {
  const counter = await prisma.documentCounter.update({
    where: { name: "REQ" },
    data: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return `REQ-${String(counter.nextValue).padStart(6, "0")}`;
}

/**
 * Get next available requisition number
 * Alias for generateRequisitionNumber for consistency
 * @param prisma - Prisma client instance
 * @returns Promise resolving to next requisition number
 */
export function getNextRequisitionNumber(
  prisma: PrismaClient,
): Promise<string> {
  return generateRequisitionNumber(prisma);
}

/**
 * Calculate line item total
 * @param quantity - Item quantity
 * @param estimatedPrice - Estimated price per unit
 * @returns Total estimated price for the line item
 */
export function calculateLineItemTotal(
  quantity: number,
  estimatedPrice: number,
): number {
  return quantity * estimatedPrice;
}

/**
 * Calculate requisition total
 * Sums all line items' estimated values
 * @param lines - Array of line items with quantity and estimatedPrice
 * @returns Total estimated value of requisition
 */
export function calculateRequisitionTotal(
  lines: Array<{ quantity: number; estimatedPrice: number }>,
): number {
  return lines.reduce((sum, line) => {
    return sum + calculateLineItemTotal(line.quantity, line.estimatedPrice);
  }, 0);
}

/**
 * Transform Prisma requisition to API response format
 * Converts Decimal types to numbers for JSON serialization
 * @param requisition - Raw Prisma requisition object
 * @returns Transformed requisition with proper types
 */
export function transformRequisition(
  requisition: unknown,
): RequisitionWithRelations {
  const req = requisition as Record<string, unknown>;

  return {
    ...req,
    lines: Array.isArray(req.lines)
      ? (req.lines as Array<Record<string, unknown>>).map((line) => ({
          ...line,
          quantity: Number(line.quantity),
          estimatedPrice: Number(line.estimatedPrice),
        }))
      : [],
  } as RequisitionWithRelations;
}

/**
 * Transform individual requisition line item
 * Converts Decimal types to numbers
 * @param line - Raw Prisma requisition line object
 * @returns Transformed line item
 */
export function transformRequisitionItem(
  line: unknown,
): Record<string, unknown> {
  const l = line as Record<string, unknown>;

  return {
    ...l,
    quantity: Number(l.quantity),
    estimatedPrice: Number(l.estimatedPrice),
  };
}

/**
 * Build Prisma include clause for requisitions
 * @param options - Optional array of additional includes
 * @returns Prisma include object
 */
export function buildRequisitionInclude(
  _options?: string[],
): Prisma.RequisitionInclude {
  return {
    supplier: true,
    lines: {
      include: {
        inventoryItem: true,
        supplier: true,
        allocations: {
          include: {
            accountCode: true,
            department: true,
            area: true,
            project: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            status: true,
          },
        },
      },
    },
    requestedBy: true,
    budgetHeader: {
      include: {
        accountCode: true,
        // Include the work order's equipment + department so the UI can show the
        // real charge destination (account + department) on INVENTORY lines,
        // which carry no per-line allocation (their GL accounts come from rules).
        workOrder: {
          include: {
            equipment: {
              include: {
                department: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
        project: {
          select: { id: true, name: true, code: true, accountCodeId: true },
        },
      },
    },
    lineAllocations: {
      include: {
        accountCode: true,
        department: true,
        area: true,
        project: true,
        // Include requisitionLine so BudgetAllocationDisplay can show the line description
        // instead of "No line item" for all allocation rows.
        requisitionLine: {
          select: {
            id: true,
            description: true,
            lineType: true,
            quantity: true,
            estimatedPrice: true,
          },
        },
      },
    },
  };
}

/**
 * Build Prisma where clause from filters
 * @param filters - Filter object with various criteria
 * @returns Prisma where input object
 */
export function buildRequisitionWhereClause(
  filters: Record<string, unknown>,
): Prisma.RequisitionWhereInput {
  const where: Prisma.RequisitionWhereInput = {};

  if (filters.status) {
    where.status = filters.status as string;
  }

  if (filters.requestedById) {
    where.requestedById = filters.requestedById as string;
  }

  if (filters.priority) {
    where.justification = {
      contains: filters.priority as string,
    };
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) {
      where.createdAt.gte = new Date(filters.dateFrom as string);
    }
    if (filters.dateTo) {
      where.createdAt.lte = new Date(filters.dateTo as string);
    }
  }

  if (filters.neededByDateFrom || filters.neededByDateTo) {
    where.neededByDate = {};
    if (filters.neededByDateFrom) {
      where.neededByDate.gte = new Date(filters.neededByDateFrom as string);
    }
    if (filters.neededByDateTo) {
      where.neededByDate.lte = new Date(filters.neededByDateTo as string);
    }
  }

  return where;
}

/**
 * Check if status transition is valid
 * @param currentStatus - Current requisition status
 * @param newStatus - Desired new status
 * @returns True if transition is allowed
 */
export function canTransitionStatus(
  currentStatus: string,
  newStatus: string,
): boolean {
  const validTransitions: Record<string, string[]> = {
    Draft: ["Submitted", "Cancelled"],
    Submitted: ["Approved", "Rejected", "Cancelled"],
    Approved: ["Ordered", "Cancelled"],
    Rejected: [], // Terminal state
    Cancelled: [], // Terminal state
    Ordered: ["Fulfilled", "PartiallyFulfilled"],
    PartiallyFulfilled: ["Fulfilled"],
    Fulfilled: [], // Terminal state
  };

  const allowedTransitions = validTransitions[currentStatus] ?? [];
  return allowedTransitions.includes(newStatus);
}

/**
 * Check if requisition has all required items
 * @param lines - Array of requisition lines
 * @returns True if requisition has at least one item
 */
export function hasRequiredItems(lines: Array<unknown>): boolean {
  return Array.isArray(lines) && lines.length > 0;
}

/**
 * Check if all items have valid quantities
 * @param lines - Array of line items with quantity
 * @returns True if all quantities are non-negative (allows zero for Tabware data)
 */
export function hasValidQuantities(
  lines: Array<{ quantity: number }>,
): boolean {
  return lines.every((line) => line.quantity >= 0);
}

/**
 * Check if all items have valid prices
 * @param lines - Array of line items with estimatedPrice
 * @returns True if all prices are non-negative
 */
export function hasValidPrices(
  lines: Array<{ estimatedPrice: number }>,
): boolean {
  return lines.every((line) => line.estimatedPrice >= 0);
}

// ============================================================================
// GL Entry Creation for Approved Requisitions
// ============================================================================

/**
 * Parameters for creating GL entries when a requisition is approved.
 */
export interface CreateRequisitionApprovalGLEntriesParams {
  /** ServiceContext for GL services (user info, permissions) */
  context: ServiceContext;
  /**
   * Prisma client or transaction client for DB queries.
   * Accepts either PrismaClient or Prisma.TransactionClient.
   */
  db: PrismaLike;
  /** Requisition ID */
  requisitionId: string;
  /** Requisition number for reference */
  requisitionNumber: string;
  /** Requisition lines */
  lines: Array<{
    id: string;
    description: string;
    quantity: unknown;
    estimatedPrice: unknown;
    lineType?: string;
  }>;
  /**
   * Work order config — when provided, uses work order GL logic instead of
   * line allocation logic.
   *
   * Rules:
   *   WO with project  → accountCodeId=1580, projectId set, departmentId=undefined
   *   WO without project → accountCodeId=equipment default, departmentId=equipment dept, projectId=undefined
   */
  workOrderConfig?: {
    accountCodeId: string;
    departmentId?: string;
    /** Set when WO has a project — stamped on GLTransactionLine.projectId */
    projectId?: string;
  };
  /**
   * If true, falls back to requisition budget header when no allocations found.
   * If false, throws an error when no allocations exist.
   * Default: false.
   */
  fallbackToBudgetHeader?: boolean;
  /** Log prefix for console messages. Default: 'GL' */
  logPrefix?: string;
}

/**
 * Result of creating GL entries for an approved requisition.
 */
export interface CreateRequisitionApprovalGLEntriesResult {
  /** GL transaction ID, or null if no entries were generated */
  glTransactionId: string | null;
  /** Total amount across all lines */
  totalAmount: number;
  /** Number of GL entry lines created */
  entryCount: number;
  /** Fiscal period ID used for the transaction */
  fiscalPeriodId: string | null;
}

/**
 * Convert an unknown value (number, string, or Prisma Decimal) to a number.
 * Used internally for handling quantity/price/amount values from Prisma.
 */
function toNum(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val);
  if (val && typeof val === "object" && "toNumber" in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val);
}

/**
 * Shape of a requisition line allocation row as returned from the DB query.
 * Used to properly type allocations instead of relying on `any`.
 */
interface RequisitionLineAllocationRow {
  accountCodeId: string | null;
  departmentId: string | null;
  areaId: string | null;
  projectId: string | null;
  amount: unknown;
  project?: { code: string } | null;
}

/**
 * Shared function to create GL entries for an approved requisition.
 *
 * This is the single source of truth for REQ_APPROVE GL entry creation.
 * Both the multi-level approval path (requisition-approval.service.ts) and
 * the direct approval path (requisition-workflow.service.ts) delegate here.
 *
 * The function:
 * 1. Looks up the current fiscal/budget period
 * 2. Iterates lines and their allocations (queried from DB)
 * 3. Evaluates GL rules via glRuleEngineService for each allocation
 * 4. Creates a single GL transaction via glTransactionService
 * 5. Posts the transaction immediately
 *
 * @param params - Parameters for GL entry creation
 * @returns Result with GL transaction ID and totals
 *
 * @see requisition-approval.service.ts — multi-level approval path
 * @see requisition-workflow.service.ts — direct approval path
 */
export async function createRequisitionApprovalGLEntries(
  params: CreateRequisitionApprovalGLEntriesParams,
): Promise<CreateRequisitionApprovalGLEntriesResult> {
  const {
    context,
    db,
    requisitionId,
    requisitionNumber,
    lines,
    workOrderConfig,
    fallbackToBudgetHeader = false,
  } = params;

  // Get fiscal/budget period via shared utility
  let period: { id: string; [key: string]: unknown };
  try {
    period = await getCurrentBudgetPeriod(db);
  } catch {
    return {
      glTransactionId: null,
      totalAmount: 0,
      entryCount: 0,
      fiscalPeriodId: null,
    };
  }

  // Collect ALL GL entries across all lines/allocations
  const allGLEntries: GLEntry[] = [];
  const lineDescriptions: string[] = [];
  let totalAmount = 0;
  let matchedRuleId: string | undefined;

  for (const line of lines) {
    const lineAmount = toNum(line.quantity) * toNum(line.estimatedPrice);
    totalAmount += lineAmount;

    // REPAIRABLE_RETURN uses NON_STOCK GL treatment (vendor repair = operating expense)
    const rawLineType = (line.lineType ?? "INVENTORY") as
      | "INVENTORY"
      | "SERVICE"
      | "CONSUMABLE"
      | "NON_STOCK"
      | "REPAIRABLE_RETURN";
    const lineType: "INVENTORY" | "SERVICE" | "CONSUMABLE" | "NON_STOCK" =
      rawLineType === "REPAIRABLE_RETURN" ? "NON_STOCK" : rawLineType;

    if (workOrderConfig) {
      // Work order requisitions — use the resolved account, dept, and project
      const ruleResult = await glRuleEngineService.evaluateRules(
        context,
        GLEventType.REQ_APPROVE,
        {
          amount: lineAmount,
          accountCodeId: workOrderConfig.accountCodeId,
          departmentId: workOrderConfig.departmentId,
          // projectId is set when WO has a project (1580 + project, no dept)
          // undefined when WO has no project (equipment acct + dept, no project)
          projectId: workOrderConfig.projectId,
          requisitionId,
          requisitionNumber,
          transactionDate: new Date(),
          referenceType: "Requisition",
          referenceId: requisitionId,
          referenceNumber: requisitionNumber,
          lineType,
          sourceType: "WORK_ORDER",
        },
      );

      matchedRuleId ??= ruleResult.rule?.id;
      allGLEntries.push(...ruleResult.entries);
      if (!lineDescriptions.includes(line.description)) {
        lineDescriptions.push(line.description);
      }
    } else {
      // ================================================================
      // INVENTORY vs NON-STOCK (SERVICE/CONSUMABLE/NON_STOCK) GL HANDLING
      // ================================================================
      // INVENTORY lines: GL accounts are determined 100% by GL rules
      //   using FIXED account sources. They do NOT require manual
      //   account code / department allocations. If no allocations
      //   exist, we pass itemType: 'INVENTORY' and let the rule engine
      //   resolve accounts from FIXED sources.
      //
      // SERVICE / CONSUMABLE / NON_STOCK lines: GL rules use
      //   ACCOUNT_CODE_LINK to resolve expense accounts from the
      //   user-supplied account codes. These REQUIRE line allocations
      //   with accountCodeId / departmentId.
      //   NOTE: NON_STOCK items are linked to inventoryItem records
      //   but are treated like SERVICE/CONSUMABLE for GL purposes.
      // ================================================================

      // Regular requisitions — query allocations for this line from DB
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- Prisma model not yet in generated types; runtime-validated
      const lineAllocations = await (
        db as any
      ).requisitionLineAllocation.findMany({
        where: { requisitionLineId: line.id },
        include: { accountCode: true, project: { select: { code: true } } },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- See above: Prisma model not yet in generated types
      if (lineAllocations.length > 0) {
        // Has allocations — iterate them for all line types (including
        // INVENTORY lines that happen to have allocations).
        for (const allocation of lineAllocations as RequisitionLineAllocationRow[]) {
          if (!allocation.accountCodeId) continue;

          const allocAmount = toNum(allocation.amount);

          const ruleResult = await glRuleEngineService.evaluateRules(
            context,
            GLEventType.REQ_APPROVE,
            {
              transactionDate: new Date(),
              amount: allocAmount,
              accountCodeId: allocation.accountCodeId,
              departmentId: allocation.departmentId ?? undefined,
              areaId: allocation.areaId ?? undefined,
              projectId: allocation.projectId ?? undefined,
              projectCode: allocation.project?.code ?? undefined,
              requisitionId,
              requisitionNumber,
              referenceType: "Requisition",
              referenceId: requisitionId,
              referenceNumber: requisitionNumber,
              lineType,
              sourceType: "MANUAL",
            },
          );

          if (ruleResult.success && ruleResult.entries.length > 0) {
            matchedRuleId ??= ruleResult.rule?.id;
            allGLEntries.push(...ruleResult.entries);
            if (!lineDescriptions.includes(line.description)) {
              lineDescriptions.push(line.description);
            }
          }
        }
      } else if (lineType === "INVENTORY") {
        // INVENTORY line without allocations — evaluate GL rules with
        // itemType only (no accountCodeId / departmentId). The rule
        // engine will use FIXED account sources for inventory items.
        const ruleResult = await glRuleEngineService.evaluateRules(
          context,
          GLEventType.REQ_APPROVE,
          {
            transactionDate: new Date(),
            amount: lineAmount,
            itemType: "INVENTORY",
            requisitionId,
            requisitionNumber,
            referenceType: "Requisition",
            referenceId: requisitionId,
            referenceNumber: requisitionNumber,
            lineType: "INVENTORY",
            sourceType: "MANUAL",
          },
        );

        if (ruleResult.success && ruleResult.entries.length > 0) {
          matchedRuleId ??= ruleResult.rule?.id;
          allGLEntries.push(...ruleResult.entries);
          if (!lineDescriptions.includes(line.description)) {
            lineDescriptions.push(line.description);
          }
        }
      } else if (fallbackToBudgetHeader) {
        // Fallback: check for requisition budget header (used by multi-level approval path)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- Prisma model not yet in generated types; runtime-validated
        const budgetHeader = await (
          db as any
        ).requisitionBudgetHeader.findUnique({
          where: { requisitionId },
        });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- See above: Prisma model not yet in generated types
        if (budgetHeader?.accountCodeId) {
          const ruleResult = await glRuleEngineService.evaluateRules(
            context,
            GLEventType.REQ_APPROVE,
            {
              transactionDate: new Date(),
              amount: lineAmount,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- See above: Prisma model not yet in generated types
              accountCodeId: budgetHeader.accountCodeId,
              requisitionId,
              requisitionNumber,
              referenceType: "Requisition",
              referenceId: requisitionId,
              referenceNumber: requisitionNumber,
            },
          );

          if (ruleResult.success && ruleResult.entries.length > 0) {
            matchedRuleId ??= ruleResult.rule?.id;
            allGLEntries.push(...ruleResult.entries);
            if (!lineDescriptions.includes(line.description)) {
              lineDescriptions.push(line.description);
            }
          }
        }
      } else {
        // Non-stock line (SERVICE / CONSUMABLE / NON_STOCK) without allocations — error
        throw new Error(
          `Line ${line.id} has no budget allocations. ` +
            `Non-stock (SERVICE/CONSUMABLE/NON_STOCK) lines require charge allocations with account codes.`,
        );
      }
    }
  }

  // Create a single GL transaction with all collected entries
  if (allGLEntries.length === 0) {
    return {
      glTransactionId: null,
      totalAmount,
      entryCount: 0,
      fiscalPeriodId: period.id,
    };
  }

  const descriptionSummary =
    lineDescriptions.length <= 3
      ? lineDescriptions.join("; ")
      : `${lineDescriptions.slice(0, 3).join("; ")} (+${lineDescriptions.length - 3} more)`;

  const fullDescription =
    `Req Encumbrance - ${requisitionNumber} - ${descriptionSummary}`.substring(
      0,
      255,
    );

  const glTransactionId = await glTransactionService.createTransaction(
    context,
    {
      transactionDate: new Date(),
      fiscalPeriodId: period.id,
      transactionType: "ENCUMBRANCE",
      referenceType: "Requisition",
      referenceId: requisitionId,
      referenceNumber: requisitionNumber,
      description: fullDescription,
      glTransactionRuleId: matchedRuleId,
      lines: allGLEntries.map((entry: GLEntry) => ({
        entryType: entry.entryType,
        glAccountId: entry.glAccountId,
        amount: entry.amount,
        description: entry.description,
        accountCodeId: entry.accountCodeId,
        departmentId: entry.departmentId,
        projectId: entry.projectId,
        areaId: entry.areaId,
      })),
    },
  );

  // Post the GL transaction immediately
  await glTransactionService.postTransaction(context, glTransactionId);

  return {
    glTransactionId,
    totalAmount,
    entryCount: allGLEntries.length,
    fiscalPeriodId: period.id,
  };
}
