/**
 * Inventory GL Service
 *
 * Centralized service for creating GL transactions for inventory operations.
 * Handles account code resolution, budget tracking, and GL posting.
 *
 * This service eliminates code duplication between direct issue and work order part services
 * by providing a single source of truth for inventory GL transaction creation.
 */

import { logger } from "@/lib/logger";
import { PrismaClient } from "@prisma/client";
import { ServiceContext } from "@/services/base/types";
import { BadRequestError } from "@/lib/api-errors";
import { BudgetTrackingService } from "@/services/budgets/budget-tracking.service";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { GLEventType, type RuleEvaluationContext } from "@/types/gl-rules";
import { prisma } from "@/lib/prisma";
import { financeSettingsService } from "@/services/finance/finance-settings.service";

/**
 * Parameters for creating an inventory issue GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface InventoryIssueGLParams {
  // Inventory information
  inventoryItemId: string;
  inventoryItemSku: string;
  quantity: number;
  unitCost: number;
  totalCost: number;

  // Reference information
  referenceType: "WORK_ORDER_PART" | "DIRECT_ISSUE";
  referenceId: string;
  referenceNumber: string;
  description: string;

  // Account resolution (optional - will be resolved using hierarchy)
  workOrderId?: string;
  equipmentId?: string;
  accountCodeId?: string;
  departmentId?: string;
  areaId?: string; // Location ID (budget area)
  projectId?: string; // Project ID for project tracking

  // Repair context (optional - routes to WIP instead of expense)
  isRepairIssue?: boolean;

  // Late-close context (optional) — true when the parent DirectIssue is being
  // created against a Closed WO. Forwarded into the GL rule evaluation context
  // so clients can (optionally) route late-close issues to a different account
  // (e.g. "Prior Period Adjustment") via a condition on their DIRECT_ISSUE
  // rule set. Existing rules that don't reference this flag keep working
  // exactly as before. See direct-issue.service.ts afterCreate.
  isLateCloseIssue?: boolean;
}

/**
 * Result of GL transaction creation
 */
export interface InventoryIssueGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  budgetUpdated: boolean;
}

/**
 * Parameters for creating an inventory return GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface InventoryReturnGLParams {
  // Inventory information
  inventoryItemId: string;
  inventoryItemSku: string;
  quantity: number;
  unitCost: number;
  totalCost: number;

  // Reference information
  referenceType: "DIRECT_ISSUE_RETURN";
  referenceId: string;
  referenceNumber: string;
  description: string;

  // Original issue information (for account code resolution)
  originalIssueId: string;
  accountCodeId?: string;
  departmentId?: string;
  areaId?: string; // Location ID (budget area)
  projectId?: string; // Project ID for project tracking
}

/**
 * Result of return GL transaction creation
 */
export interface InventoryReturnGLResult {
  glTransactionId: string;
  accountCodeId: string;
  departmentId?: string;
  budgetPeriodId: string;
  budgetUpdated: boolean;
}

/**
 * Parameters for creating an inventory adjustment GL transaction
 *
 * NOTE: Budget Dimensions
 * - areaId: Location ID where isBudgetArea=true (NOT the old standalone Area model)
 */
export interface InventoryAdjustmentGLParams {
  // Inventory information
  inventoryItemId: string;
  inventoryItemSku: string;
  oldQuantity: number;
  newQuantity: number;
  unitCost: number;

  // Reference information
  referenceType: "CYCLE_COUNT" | "PHYSICAL_COUNT" | "MANUAL_ADJUSTMENT";
  referenceId: string;
  referenceNumber: string;
  description: string;
  reason: string;

  // Account resolution (optional)
  accountCodeId?: string;
  departmentId?: string;
  areaId?: string; // Location ID (budget area)
  projectId?: string; // Project ID for project tracking
}

/**
 * Result of adjustment GL transaction creation
 */
export interface InventoryAdjustmentGLResult {
  glTransactionId: string;
  accountCodeId?: string;
  departmentId?: string;
  budgetPeriodId: string;
  adjustmentAmount: number;
  isIncrease: boolean;
}

/**
 * Parameters for creating a count variance GL transaction.
 * Used by both full cycle counts and single-item physical counts.
 */
export interface CountVarianceGLParams {
  inventoryItemId: string;
  inventoryItemSku: string;
  storeId: string;
  bin: string;
  oldQuantity: number;
  newQuantity: number;
  unitCost: number;
  referenceType: "CYCLE_COUNT" | "PHYSICAL_COUNT";
  referenceId: string;
  referenceNumber: string;
  description: string;
  reason: string;
}

/**
 * Result of count variance GL transaction creation.
 * Wraps success/failure so callers don't need try/catch.
 */
export interface CountVarianceGLResult {
  success: boolean;
  glTransactionId: string;
  budgetPeriodId: string;
  adjustmentAmount: number;
  isIncrease: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Inventory GL Service Class
 */
class InventoryGLService {
  private budgetTrackingService: BudgetTrackingService;

  constructor(private prisma: PrismaClient) {
    this.budgetTrackingService = new BudgetTrackingService(prisma);
  }

  /** Look up project code from projectId */
  private async resolveProjectCode(
    projectId?: string,
  ): Promise<string | undefined> {
    if (!projectId) return undefined;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { code: true },
    });
    return project?.code ?? undefined;
  }

  /** Look up work order number from workOrderId */
  private async resolveWONumber(
    workOrderId?: string,
  ): Promise<string | undefined> {
    if (!workOrderId) return undefined;
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { woNumber: true },
    });
    return wo?.woNumber ?? undefined;
  }

  /**
   * Create GL transaction for inventory issue
   *
   * This method:
   * 1. Resolves account code using hierarchy (equipment → error)
   * 2. Resolves department (provided or undefined)
   * 3. Gets current budget period
   * 4. Creates GL transaction with double-entry bookkeeping
   * 5. Posts GL transaction
   * 6. Updates budget tracking using GL transaction as dimension source (GL-first pattern)
   *
   * @param context - Service context
   * @param params - Issue parameters
   * @returns GL transaction result
   * @throws BadRequestError if no account code can be resolved or no budget period exists
   * @since 2026-02-16 - Migrated to GL-first budget tracking pattern
   */
  async createIssueTransaction(
    context: ServiceContext,
    params: InventoryIssueGLParams,
  ): Promise<InventoryIssueGLResult> {
    // 1. Resolve account code (equipment → finance settings → error)
    const effectiveAccountCodeId = await this.resolveAccountCode(params);

    // 2. Resolve department (provided → WO default from FinanceSettings → undefined)
    const effectiveDepartmentId = await this.resolveDepartment(params);

    // 3. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);

    // 4. Get GL accounts using rule engine (depends on repair context)
    const eventType = params.isRepairIssue
      ? GLEventType.REPAIR_ISSUE
      : GLEventType.DIRECT_ISSUE;

    const projectCode = await this.resolveProjectCode(params.projectId);
    const woNumber = await this.resolveWONumber(params.workOrderId);
    const ruleContext: RuleEvaluationContext = {
      amount: params.totalCost,
      accountCodeId: effectiveAccountCodeId,
      departmentId: effectiveDepartmentId,
      areaId: params.areaId,
      projectId: params.projectId,
      projectCode,
      inventoryItemId: params.inventoryItemId,
      sku: params.inventoryItemSku,
      workOrderId: params.workOrderId,
      woNumber,
      equipmentId: params.equipmentId,
      transactionDate: new Date(),
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      referenceNumber: params.referenceNumber,
      itemType: "INVENTORY",
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      eventType,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${eventType}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // 5. Create GL transaction.
    // GUARD: account 1535 (Store Room Inventory) is a balance-sheet account.
    // It must NEVER carry an accountCodeId. NAV maps accountCodeId to the linked
    // expense account, silently misrouting 1535 credits to expense accounts
    // instead of NAV 1680 (Capitalized Spares). This is the same guard used in
    // po-gl.service.ts:createReceiptTransaction — keep both in sync.
    const storeroom1535 = await prisma.gLAccount.findFirst({
      where: { accountNumber: "1535" },
      select: { id: true },
    });

    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE",
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        description: params.description,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          // 1535 balance-sheet line: no charge code (NAV routes via account number).
          // All other lines (expense, WIP, etc.): carry dimensions normally.
          accountCodeId:
            storeroom1535 && acc.glAccountId === storeroom1535.id
              ? undefined
              : effectiveAccountCodeId,
          departmentId: effectiveDepartmentId,
          areaId: params.areaId,
          projectId: params.projectId,
        })),
      },
    );

    // 6. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    // 7. Update budget tracking using GL transaction as dimension source (GL-first pattern)
    let budgetUpdated = false;
    try {
      await this.budgetTrackingService.consumeBudgetFromGL(context, {
        periodId: budgetPeriod.id,
        glTransactionId,
        referenceType:
          params.referenceType === "WORK_ORDER_PART"
            ? "WorkOrder"
            : "Requisition",
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        totalAmount: params.totalCost,
      });
      budgetUpdated = true;
    } catch (_error) {
      // Budget tracking is optional - don't fail the transaction if budget doesn't exist
      budgetUpdated = false;
    }

    return {
      glTransactionId,
      accountCodeId: effectiveAccountCodeId,
      departmentId: effectiveDepartmentId,
      budgetPeriodId: budgetPeriod.id,
      budgetUpdated,
    };
  }

  /**
   * Create GL transaction for inventory return
   *
   * This method reverses the original issue transaction:
   * - Debit: 1110 (Inventory Asset) - Increase inventory
   * - Credit: 5140 (Department Expense) - Reverse expense
   *
   * Budget tracking: Uses GL transaction as dimension source (GL-first pattern)
   * to reverse the consumed amount from the original issue.
   *
   * @param context - Service context
   * @param params - Return parameters
   * @returns GL transaction result
   * @throws BadRequestError if no account code can be resolved or no budget period exists
   * @since 2026-02-16 - Migrated to GL-first budget tracking pattern
   */
  async createReturnTransaction(
    context: ServiceContext,
    params: InventoryReturnGLParams,
  ): Promise<InventoryReturnGLResult> {
    // 1. Resolve account code (use original issue's account code)
    const effectiveAccountCodeId = params.accountCodeId;
    if (!effectiveAccountCodeId) {
      throw new BadRequestError(
        "Account code is required for return GL transaction",
      );
    }

    // 2. Resolve department (use original issue's department)
    const effectiveDepartmentId = params.departmentId;

    // 3. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);

    // 4. Get GL accounts using rule engine (Debit: 1110 Inventory, Credit: 5140 Expense)
    const projectCode = await this.resolveProjectCode(params.projectId);
    const ruleContext: RuleEvaluationContext = {
      amount: params.totalCost,
      accountCodeId: effectiveAccountCodeId,
      departmentId: effectiveDepartmentId,
      areaId: params.areaId,
      projectId: params.projectId,
      projectCode,
      inventoryItemId: params.inventoryItemId,
      sku: params.inventoryItemSku,
      transactionDate: new Date(),
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      referenceNumber: params.referenceNumber,
      itemType: "INVENTORY",
      isLateCloseIssue: params.isLateCloseIssue ?? false,
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      eventType,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.DIRECT_RETURN}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // 5. Create GL transaction.
    // Same 1535 guard as createIssueTransaction.
    const storeroom1535 = await prisma.gLAccount.findFirst({
      where: { accountNumber: "1535" },
      select: { id: true },
    });

    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE", // Still expenditure type, but reversed
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        description: params.description,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          // Same 1535 guard as createIssueTransaction: balance-sheet lines must
          // never carry accountCodeId or NAV misroutes them to expense accounts.
          accountCodeId:
            storeroom1535 && acc.glAccountId === storeroom1535.id
              ? undefined
              : effectiveAccountCodeId,
          departmentId: effectiveDepartmentId,
          areaId: params.areaId,
          projectId: params.projectId,
        })),
      },
    );

    // 6. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    // 7. Update budget tracking using GL transaction as dimension source (GL-first pattern)
    // For returns, we consume with negative amount to reverse the original consumption
    let budgetUpdated = false;
    try {
      await this.budgetTrackingService.consumeBudgetFromGL(context, {
        periodId: budgetPeriod.id,
        glTransactionId,
        referenceType: "Requisition", // Returns are always requisition-related
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        totalAmount: -params.totalCost, // Negative amount to reverse consumption
      });
      budgetUpdated = true;
    } catch (_error) {
      // Budget tracking is optional - don't fail the transaction if budget doesn't exist
      budgetUpdated = false;
    }

    return {
      glTransactionId,
      accountCodeId: effectiveAccountCodeId,
      departmentId: effectiveDepartmentId,
      budgetPeriodId: budgetPeriod.id,
      budgetUpdated,
    };
  }

  /**
   * Create GL transaction for inventory adjustment
   *
   * This method handles cycle counts, corrections, damage, loss, found items:
   * - If increase: Debit 1110 (Inventory Asset), Credit 5400 (Inventory Adjustment)
   * - If decrease: Debit 5400 (Inventory Adjustment), Credit 1110 (Inventory Asset)
   *
   * @param context - Service context
   * @param params - Adjustment parameters
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createAdjustmentTransaction(
    context: ServiceContext,
    params: InventoryAdjustmentGLParams,
  ): Promise<InventoryAdjustmentGLResult> {
    // Calculate adjustment amount and direction
    const adjustmentAmount =
      Math.abs(params.newQuantity - params.oldQuantity) * params.unitCost;
    const isIncrease = params.newQuantity > params.oldQuantity;

    // Skip GL transaction if no change
    if (adjustmentAmount === 0) {
      const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);
      return {
        glTransactionId: "",
        accountCodeId: params.accountCodeId,
        departmentId: params.departmentId,
        budgetPeriodId: budgetPeriod.id,
        adjustmentAmount: 0,
        isIncrease: false,
      };
    }

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);

    // 2. Get GL accounts using rule engine (depends on increase/decrease)
    const eventType = isIncrease
      ? GLEventType.INV_ADJ_INC
      : GLEventType.INV_ADJ_DEC;

    const projectCode = await this.resolveProjectCode(params.projectId);
    const ruleContext: RuleEvaluationContext = {
      amount: adjustmentAmount,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      areaId: params.areaId,
      projectId: params.projectId,
      projectCode,
      inventoryItemId: params.inventoryItemId,
      sku: params.inventoryItemSku,
      transactionDate: new Date(),
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      referenceNumber: params.referenceNumber,
      itemType: "INVENTORY",
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      eventType,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${eventType}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // 3. Create GL transaction
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "ADJUSTMENT",
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        description: params.description,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId: params.accountCodeId,
          departmentId: params.departmentId,
          areaId: params.areaId,
        })),
      },
    );

    // 4. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      budgetPeriodId: budgetPeriod.id,
      adjustmentAmount,
      isIncrease,
    };
  }

  /**
   * Create GL transaction for a count variance (cycle count or physical count).
   *
   * This is the SINGLE entry point for all count-related GL postings.
   * It intentionally does NOT accept accountCodeId/departmentId/areaId
   * because count variances are not tied to equipment or work order context.
   *
   * This method does NOT throw. Errors are captured in the returned result
   * so callers can handle GL failures without try/catch.
   *
   * @param context - Service context
   * @param params - Count variance parameters
   * @returns GL transaction result with success/failure indicator
   */
  async createCountVarianceGL(
    context: ServiceContext,
    params: CountVarianceGLParams,
  ): Promise<CountVarianceGLResult> {
    try {
      // Calculate variance
      const adjustmentAmount =
        Math.abs(params.newQuantity - params.oldQuantity) * params.unitCost;

      // Skip GL transaction if no change
      if (adjustmentAmount === 0) {
        return {
          success: true,
          glTransactionId: "",
          budgetPeriodId: "",
          adjustmentAmount: 0,
          isIncrease: false,
          skipped: true,
        };
      }

      // Delegate to createAdjustmentTransaction with no account context
      const result = await this.createAdjustmentTransaction(context, {
        inventoryItemId: params.inventoryItemId,
        inventoryItemSku: params.inventoryItemSku,
        oldQuantity: params.oldQuantity,
        newQuantity: params.newQuantity,
        unitCost: params.unitCost,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        description: params.description,
        reason: params.reason,
        accountCodeId: undefined,
        departmentId: undefined,
        areaId: undefined,
      });

      return {
        success: true,
        glTransactionId: result.glTransactionId,
        budgetPeriodId: result.budgetPeriodId,
        adjustmentAmount: result.adjustmentAmount,
        isIncrease: result.isIncrease,
        skipped: false,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `[COUNT-VARIANCE-GL] GL entry failed for item ${params.inventoryItemId} ` +
          `(${params.referenceType} ${params.referenceNumber}): ${errorMsg}`,
      );
      return {
        success: false,
        glTransactionId: "",
        budgetPeriodId: "",
        adjustmentAmount: 0,
        isIncrease: false,
        skipped: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Resolve account code using hierarchy:
   * 1. Provided account code
   * 2. Project account code (projects override equipment)
   * 3. Equipment default (if equipment ID provided)
   * 4. Work order equipment default (if work order ID provided)
   * 5. Error if none found
   *
   * @param params - Parameters containing account code resolution data
   * @returns Resolved account code ID
   * @throws BadRequestError if no account code can be resolved
   */
  private async resolveAccountCode(params: {
    accountCodeId?: string;
    projectId?: string;
    equipmentId?: string;
    workOrderId?: string;
  }): Promise<string> {
    // Priority 1: Provided account code
    if (params.accountCodeId) {
      return params.accountCodeId;
    }

    // Priority 2: Project account code (projects override equipment)
    if (params.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: params.projectId },
        select: { accountCodeId: true, code: true },
      });
      if (project?.accountCodeId) {
        return project.accountCodeId;
      }
    }

    // Priority 3: Equipment default (direct equipment ID)
    if (params.equipmentId) {
      const equipment = await this.prisma.equipment.findUnique({
        where: { id: params.equipmentId },
        select: { defaultAccountCodeId: true, tag: true },
      });
      if (equipment?.defaultAccountCodeId) {
        return equipment.defaultAccountCodeId;
      }
    }

    // Priority 4: Work order equipment default
    if (params.workOrderId) {
      const workOrder = await this.prisma.workOrder.findUnique({
        where: { id: params.workOrderId },
        select: {
          equipmentId: true,
          equipment: {
            select: {
              defaultAccountCodeId: true,
              tag: true,
            },
          },
        },
      });
      if (workOrder?.equipment?.defaultAccountCodeId) {
        return workOrder.equipment.defaultAccountCodeId;
      }
    }

    // Priority 5: Error
    throw new BadRequestError(
      "No account code configured. Please configure equipment default account code.",
    );
  }

  /**
   * Resolve department:
   * 1. Provided department (explicit user selection)
   * 2. FinanceSettings.defaultWorkOrderDepartmentId when issuing to a work order
   * 3. undefined if not configured
   *
   * @param params - Parameters containing department resolution data
   * @returns Resolved department ID or undefined
   */
  private async resolveDepartment(params: {
    departmentId?: string;
    workOrderId?: string;
  }): Promise<string | undefined> {
    // Priority 1: Provided department
    if (params.departmentId) {
      return params.departmentId;
    }

    // Priority 2: FinanceSettings WO default when issuing to a work order
    if (params.workOrderId) {
      const { defaultWorkOrderDepartmentId } =
        await financeSettingsService.getWorkOrderDefaults();
      if (defaultWorkOrderDepartmentId) {
        return defaultWorkOrderDepartmentId;
      }
    }

    return undefined;
  }
}

// Export singleton instance
const globalForInventoryGL = globalThis as unknown as {
  inventoryGLService: InventoryGLService | undefined;
};
export const inventoryGLService =
  globalForInventoryGL.inventoryGLService ??
  (globalForInventoryGL.inventoryGLService = new InventoryGLService(prisma));
