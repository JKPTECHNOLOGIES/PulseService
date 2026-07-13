/**
 * PO GL Service
 *
 * Centralized service for creating GL transactions for purchase order operations.
 * Handles account code resolution, budget tracking, and GL posting for:
 * - PO receipts (inventory increase + AP liability)
 * - PO returns (reverse receipts)
 * - Freight/shipping costs
 *
 * Follows the pattern established by InventoryGLService.
 *
 * B0-7: All public methods now accept an optional `tx` (Prisma transaction client)
 * so that GL operations can run inside the same Prisma interactive transaction as
 * the caller's data mutations.  When `tx` is provided the service uses it for every
 * direct database call; when omitted it falls back to `this.prisma` for backward
 * compatibility.
 */

import { PrismaClient, BudgetTransactionType } from "@prisma/client";
import { ServiceContext } from "@/services/base/types";
import { BadRequestError } from "@/lib/api-errors";
import { budgetHelperService } from "@/services/budgets/budget-helpers.service";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { GLEventType, type RuleEvaluationContext } from "@/types/gl-rules";
import { prisma } from "@/lib/prisma";
import type {
  POReceiptGLParams,
  POReceiptGLResult,
  POReturnGLParams,
  POReturnGLResult,
  FreightCostGLParams,
  FreightCostGLResult,
  ServiceReceiptGLParams,
  ServiceReceiptGLResult,
  ConsumableReceiptGLParams,
  ConsumableReceiptGLResult,
  NonStockReceiptGLParams,
  NonStockReceiptGLResult,
  TaxGLParams,
  TaxGLResult,
} from "./po-gl.types";

/**
 * Prisma interactive transaction client type.
 * Compatible with both PrismaClient (full) and the limited client inside $transaction().
 */
type PrismaTxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * PO statuses that are considered "open" and allowed to generate GL entries.
 * Closed and Cancelled POs should never hit the GL.
 */
const GL_ELIGIBLE_PO_STATUSES = [
  "Draft",
  "Submitted",
  "Approved",
  "Ordered",
  "PartiallyReceived",
  "Received",
];

/**
 * PO GL Service Class
 */
class POGLService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Return the effective database client.
   * When an outer transaction client is supplied, use it so every write
   * participates in the same transaction.  Otherwise fall back to the
   * service-level PrismaClient.
   */
  private db(tx?: PrismaTxClient): PrismaTxClient {
    return tx ?? this.prisma;
  }

  /**
   * Coerce an accountCodeId value to either a valid non-empty string or
   * undefined.
   *
   * `validateChargeAllocations` returns '' (empty string) for INVENTORY lines
   * that have no charge allocations and no work-order link.  GLTransactionLine
   * has a FK on accountCodeId → AccountCode.id, so storing '' would throw a
   * foreign-key constraint violation ("Invalid prisma.gLTransactionLine.create()
   * invocation").  Converting '' to undefined causes Prisma to write NULL, which
   * is valid for the nullable FK column.
   */
  private safeAccountCodeId(value: string | undefined): string | undefined {
    return value && value.trim() !== "" ? value : undefined;
  }

  /**
   * Assert that a PO is in an open/active status eligible for GL entries.
   * Closed and Cancelled POs must never generate GL transactions.
   *
   * @param purchaseOrderId - The PO to check
   * @param tx - Optional transaction client
   * @throws BadRequestError if PO is Closed or Cancelled
   */
  private async assertPOIsOpenForGL(
    purchaseOrderId: string,
    tx?: PrismaTxClient,
  ): Promise<void> {
    const db = this.db(tx);
    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { status: true, poNumber: true },
    });
    if (!po) {
      throw new BadRequestError(`Purchase order ${purchaseOrderId} not found`);
    }
    if (!GL_ELIGIBLE_PO_STATUSES.includes(po.status)) {
      throw new BadRequestError(
        `Cannot create GL entries for PO ${po.poNumber} — status is "${po.status}". Only open POs (${GL_ELIGIBLE_PO_STATUSES.join(", ")}) are eligible for GL transactions.`,
      );
    }
  }

  /**
   * Guard: non-INVENTORY receipt methods (SERVICE, CONSUMABLE, NON-STOCK) must
   * never post to GL account 1535 (Store Room Inventory).
   *
   * Account 1535 is the storeroom balance-sheet account. Only PO_RECEIPT_INV
   * (physical stock items with an InventoryItem record) should debit it.
   * If a GL rule misconfiguration routes SERVICE / CONSUMABLE / NSI receipts
   * to 1535, the result is a GL entry with no corresponding InventoryItem row —
   * the GL_ONLY audit failure pattern confirmed in the 2026-05 1535 audit
   * ($550k of misrouted entries).
   *
   * Throwing here surfaces the misconfiguration at receive-time (immediate
   * visible error) rather than letting it accumulate silently into the next
   * quarterly GL reconciliation.
   *
   * @param glAccounts  Resolved GL entries from the rule engine.
   * @param eventType   The GL event type being processed (for the error message).
   * @param tx          Optional Prisma transaction client.
   */
  private async assertNotStoreroomAccount(
    glAccounts: Array<{ glAccountId: string }>,
    eventType: string,
    tx?: PrismaTxClient,
  ): Promise<void> {
    const storeroom = await this.db(tx).gLAccount.findFirst({
      where: { accountNumber: "1535" },
      select: { id: true },
    });
    if (!storeroom) return; // Account 1535 not found in this environment — nothing to guard.
    const hits = glAccounts.filter((a) => a.glAccountId === storeroom.id);
    if (hits.length > 0) {
      throw new BadRequestError(
        `GL rule misconfiguration: a ${eventType} receipt resolved to account 1535 ` +
          `(Store Room Inventory). Only INVENTORY-type PO lines may post to account 1535. ` +
          `Correct the GL rule for this event type before receiving this line.`,
      );
    }
  }

  /**
   * Look up project code from projectId
   */
  private async resolveProjectCode(
    projectId?: string,
    tx?: PrismaTxClient,
  ): Promise<string | undefined> {
    if (!projectId) return undefined;
    const db = this.db(tx);
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { code: true },
    });
    return project?.code ?? undefined;
  }

  /**
   * Create GL transaction for PO receipt
   *
   * This method:
   * 1. Gets current budget period
   * 2. Releases commitment (from PO approval)
   * 3. Records actual inventory receipt and AP liability
   * 4. Updates budget tracking (charges variance only)
   * 5. Creates GL transaction with double-entry bookkeeping
   * 6. Posts GL transaction
   * 7. Handles freight costs if provided
   *
   * @param context - Service context
   * @param params - Receipt parameters
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createReceiptTransaction(
    context: ServiceContext,
    params: POReceiptGLParams,
    tx?: PrismaTxClient,
  ): Promise<POReceiptGLResult> {
    const db = this.db(tx);

    // Guard: Only open POs can generate GL entries
    await this.assertPOIsOpenForGL(params.purchaseOrderId, tx);

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(db);

    // 2. Get GL accounts using rule engine for PO receipt
    // This includes: Release commitment + Record actual receipt
    const projectCode = await this.resolveProjectCode(params.projectId, tx);
    const ruleContext: RuleEvaluationContext = {
      amount: params.totalCost,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      projectCode,
      areaId: params.areaId,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      receiptId: params.receiptId,
      receiptNumber: params.receiptNumber,
      inventoryItemId: params.inventoryItemId,
      transactionDate: params.receiptDate,
      referenceType: "POLineReceipt",
      referenceId: params.receiptId,
      referenceNumber: params.receiptNumber,
      itemType: "INVENTORY",
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.PO_RECEIPT_INV,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.PO_RECEIPT_INV}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // 3. Update budget tracking (charge variance only)
    // The reserved amount was already charged when the PO was approved
    // We only charge the difference between actual and reserved
    const budgetUpdated = await this.updateBudgetTrackingForReceipt(
      context,
      {
        accountCodeId: params.accountCodeId,
        departmentId: params.departmentId,
        projectId: params.projectId,
        areaId: params.areaId,
        amount: params.totalCost,
        budgetPeriodId: budgetPeriod.id,
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.description} - Receipt ${params.receiptNumber}`,
        purchaseOrderId: params.purchaseOrderId,
      },
      tx,
    );

    // 4. Create GL transaction
    //
    // IMPORTANT — accountCodeId on the 1535 DEBIT line must be NULL.
    // If accountCodeId is set on the balance-sheet (1535) line, the NAV sync
    // maps the DEBIT to the expense account linked to that code (e.g. 6501
    // M&R Materials) instead of 1680 (Capitalized Spares), silently misrouting
    // every storeroom receipt in NAV.  Only the credit (AP) leg should carry
    // charge dimensions.  Balance-sheet accounts never need a charge code.
    const storeroom1535 = await this.db(tx).gLAccount.findFirst({
      where: { accountNumber: "1535" },
      select: { id: true },
    });

    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: params.receiptDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE",
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.supplierName} - ${params.description}`,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          // 1535 (balance-sheet): no charge code — NAV routes via account number.
          // Any other line (AP, accrual): carry the charge dimensions normally.
          accountCodeId:
            storeroom1535 && acc.glAccountId === storeroom1535.id
              ? undefined
              : this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        })),
      },
    );

    // 5. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    // 6. Handle freight costs if provided
    let freightGLTransactionId: string | undefined;
    if (params.freightCost && params.freightCost > 0) {
      const freightResult = await this.createFreightTransaction(
        context,
        {
          purchaseOrderId: params.purchaseOrderId,
          poNumber: params.poNumber,
          supplierId: params.supplierId,
          freightCost: params.freightCost,
          description: `Freight for PO ${params.poNumber} - ${params.description}`,
          referenceNumber: params.receiptNumber,
          accountCodeId: params.accountCodeId,
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
          capitalizeToInventory: params.capitalizeFreight ?? true, // Default to capitalize
          inventoryItemId: params.inventoryItemId,
        },
        tx,
      );
      freightGLTransactionId = freightResult.glTransactionId;
    }

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      budgetPeriodId: budgetPeriod.id,
      budgetUpdated,
      freightGLTransactionId,
    };
  }

  /**
   * Create GL transaction for PO return
   *
   * This method reverses the original receipt transaction:
   * - Debit: 2110 (Accounts Payable) - Reduce liability
   * - Credit: 1110 (Inventory Asset) - Reduce inventory
   *
   * @param context - Service context
   * @param params - Return parameters
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createReturnTransaction(
    context: ServiceContext,
    params: POReturnGLParams,
    tx?: PrismaTxClient,
  ): Promise<POReturnGLResult> {
    const db = this.db(tx);

    // Guard: Only open POs can generate GL entries
    await this.assertPOIsOpenForGL(params.purchaseOrderId, tx);

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(db);

    // 2. Get GL accounts using rule engine for PO return (reverses receipt)
    const projectCode = await this.resolveProjectCode(params.projectId, tx);
    const ruleContext: RuleEvaluationContext = {
      amount: Math.abs(params.totalCost),
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      projectCode,
      areaId: params.areaId,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      transactionDate: params.returnDate,
      referenceType: "POLineReceipt",
      referenceId: params.returnId,
      referenceNumber: params.returnNumber,
      itemType: "INVENTORY",
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.PO_RETURN,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.PO_RETURN}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // 3. Update budget tracking (reverse the consumption)
    const budgetUpdated = await this.updateBudgetTrackingForReturn(
      context,
      {
        accountCodeId: params.accountCodeId,
        departmentId: params.departmentId,
        projectId: params.projectId,
        areaId: params.areaId,
        amount: Math.abs(params.totalCost),
        budgetPeriodId: budgetPeriod.id,
        referenceType: "POLineReceipt",
        referenceId: params.returnId,
        referenceNumber: params.returnNumber,
        description: `PO ${params.poNumber} - Return ${params.returnNumber} - ${params.reason}`,
      },
      tx,
    );

    // 4. Create GL transaction
    // Same 1535 guard as createReceiptTransaction: balance-sheet lines must
    // never carry an accountCodeId or NAV misroutes them to expense accounts.
    const storeroom1535return = await this.db(tx).gLAccount.findFirst({
      where: { accountNumber: "1535" },
      select: { id: true },
    });

    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: params.returnDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "REVERSAL", // PO return is a reversal of a receipt — not an expenditure
        referenceType: "POLineReceipt",
        referenceId: params.returnId,
        referenceNumber: params.returnNumber,
        description: `PO ${params.poNumber} - ${params.supplierName} - Return: ${params.reason}`,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId:
            storeroom1535return && acc.glAccountId === storeroom1535return.id
              ? undefined
              : this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        })),
      },
    );

    // 5. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      budgetPeriodId: budgetPeriod.id,
      budgetUpdated,
    };
  }

  /**
   * Create GL transaction for freight/shipping costs
   *
   * @param context - Service context
   * @param params - Freight cost parameters
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createFreightTransaction(
    context: ServiceContext,
    params: FreightCostGLParams,
    tx?: PrismaTxClient,
  ): Promise<FreightCostGLResult> {
    const db = this.db(tx);

    // Guard: Only open POs can generate GL entries
    await this.assertPOIsOpenForGL(params.purchaseOrderId, tx);

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(db);

    // 2. Get GL accounts using rule engine for freight cost
    const eventType = params.capitalizeToInventory
      ? GLEventType.FREIGHT_CAP
      : GLEventType.FREIGHT_EXP;

    const projectCode = await this.resolveProjectCode(params.projectId, tx);
    const ruleContext: RuleEvaluationContext = {
      amount: params.freightCost,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      projectCode,
      areaId: params.areaId,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      supplierId: params.supplierId,
      inventoryItemId: params.inventoryItemId,
      transactionDate: new Date(),
      referenceType: "PurchaseOrder",
      referenceId: params.purchaseOrderId,
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
        transactionType: "EXPENDITURE",
        referenceType: "PurchaseOrder",
        referenceId: params.purchaseOrderId,
        referenceNumber: params.referenceNumber,
        description: params.description,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId: this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        })),
      },
    );

    // 4. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      budgetPeriodId: budgetPeriod.id,
    };
  }

  /**
   * Create GL transaction for SERVICE receipt
   *
   * This method:
   * 1. Gets current budget period
   * 2. Releases commitment (from PO approval)
   * 3. Records actual service expense and AP liability
   * 4. Updates budget tracking (charges variance only)
   * 5. Creates GL transaction with double-entry bookkeeping
   * 6. Posts GL transaction
   *
   * @param context - Service context
   * @param params - Service receipt parameters
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createServiceReceiptTransaction(
    context: ServiceContext,
    params: ServiceReceiptGLParams,
    tx?: PrismaTxClient,
  ): Promise<ServiceReceiptGLResult> {
    const db = this.db(tx);

    // Guard: Only open POs can generate GL entries
    await this.assertPOIsOpenForGL(params.purchaseOrderId, tx);

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(db);

    // 2. Get GL accounts using rule engine for SERVICE receipt
    const projectCode = await this.resolveProjectCode(params.projectId, tx);
    const ruleContext: RuleEvaluationContext = {
      amount: params.totalCost,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      projectCode,
      areaId: params.areaId,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      receiptId: params.receiptId,
      receiptNumber: params.receiptNumber,
      transactionDate: params.receiptDate,
      referenceType: "POLineReceipt",
      referenceId: params.receiptId,
      referenceNumber: params.receiptNumber,
      itemType: "SERVICE",
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.PO_RECEIPT_SVC,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.PO_RECEIPT_SVC}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // Guard: SERVICE receipts must never route to account 1535 (storeroom balance sheet).
    // SERVICE lines have no InventoryItem — a 1535 hit here = GL_ONLY audit failure.
    await this.assertNotStoreroomAccount(glAccounts, "SERVICE", tx);

    // 3. Update budget tracking (charge variance only)
    const budgetUpdated = await this.updateBudgetTrackingForReceipt(
      context,
      {
        accountCodeId: params.accountCodeId,
        departmentId: params.departmentId,
        projectId: params.projectId,
        areaId: params.areaId,
        amount: params.totalCost,
        budgetPeriodId: budgetPeriod.id,
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.description} - Receipt ${params.receiptNumber}`,
        purchaseOrderId: params.purchaseOrderId,
      },
      tx,
    );

    // 4. Create GL transaction
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: params.receiptDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE",
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.supplierName} - ${params.description}`,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId: this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        })),
      },
    );

    // 5. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      budgetPeriodId: budgetPeriod.id,
      budgetUpdated,
    };
  }

  /**
   * Create GL transaction for CONSUMABLE receipt
   *
   * This method:
   * 1. Gets current budget period
   * 2. Releases commitment (from PO approval)
   * 3. Records actual consumable expense and AP liability
   * 4. Updates budget tracking (charges variance only)
   * 5. Creates GL transaction with double-entry bookkeeping
   * 6. Posts GL transaction
   *
   * @param context - Service context
   * @param params - Consumable receipt parameters
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createConsumableReceiptTransaction(
    context: ServiceContext,
    params: ConsumableReceiptGLParams,
    tx?: PrismaTxClient,
  ): Promise<ConsumableReceiptGLResult> {
    const db = this.db(tx);

    // Guard: Only open POs can generate GL entries
    await this.assertPOIsOpenForGL(params.purchaseOrderId, tx);

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(db);

    // 2. Get GL accounts using rule engine for CONSUMABLE receipt
    const projectCode = await this.resolveProjectCode(params.projectId, tx);
    const ruleContext: RuleEvaluationContext = {
      amount: params.totalCost,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      projectCode,
      areaId: params.areaId,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      receiptId: params.receiptId,
      receiptNumber: params.receiptNumber,
      transactionDate: params.receiptDate,
      referenceType: "POLineReceipt",
      referenceId: params.receiptId,
      referenceNumber: params.receiptNumber,
      itemType: "CONSUMABLE",
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.PO_RECEIPT_CON,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.PO_RECEIPT_CON}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // Guard: CONSUMABLE receipts must never route to account 1535 (storeroom balance sheet).
    // CONSUMABLE lines are expensed immediately — a 1535 hit here = GL_ONLY audit failure.
    await this.assertNotStoreroomAccount(glAccounts, "CONSUMABLE", tx);

    // 3. Update budget tracking (charge variance only)
    const budgetUpdated = await this.updateBudgetTrackingForReceipt(
      context,
      {
        accountCodeId: params.accountCodeId,
        departmentId: params.departmentId,
        projectId: params.projectId,
        areaId: params.areaId,
        amount: params.totalCost,
        budgetPeriodId: budgetPeriod.id,
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.description} - Receipt ${params.receiptNumber}`,
        purchaseOrderId: params.purchaseOrderId,
      },
      tx,
    );

    // 4. Create GL transaction
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: params.receiptDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE",
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.supplierName} - ${params.description}`,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId: this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        })),
      },
    );

    // 5. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      budgetPeriodId: budgetPeriod.id,
      budgetUpdated,
    };
  }

  /**
   * Create GL transaction for NON_STOCK receipt
   *
   * NON_STOCK items are linked to inventory items but do NOT update stock levels.
   * Uses PO_RECEIPT_NSI event type and charge allocations for account resolution
   * (same pattern as SERVICE/CONSUMABLE).
   *
   * This method:
   * 1. Gets current budget period
   * 2. Releases commitment (from PO approval)
   * 3. Records actual non-stock expense and AP liability
   * 4. Updates budget tracking (charges variance only)
   * 5. Creates GL transaction with double-entry bookkeeping
   * 6. Posts GL transaction
   *
   * @param context - Service context
   * @param params - Non-stock receipt parameters
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createNonStockReceiptTransaction(
    context: ServiceContext,
    params: NonStockReceiptGLParams,
    tx?: PrismaTxClient,
  ): Promise<NonStockReceiptGLResult> {
    const db = this.db(tx);

    // Guard: Only open POs can generate GL entries
    await this.assertPOIsOpenForGL(params.purchaseOrderId, tx);

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(db);

    // 2. Get GL accounts using rule engine for NON_STOCK receipt
    const projectCode = await this.resolveProjectCode(params.projectId, tx);
    const ruleContext: RuleEvaluationContext = {
      amount: params.totalCost,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      projectCode,
      areaId: params.areaId,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      receiptId: params.receiptId,
      receiptNumber: params.receiptNumber,
      inventoryItemId: params.inventoryItemId,
      transactionDate: params.receiptDate,
      referenceType: "POLineReceipt",
      referenceId: params.receiptId,
      referenceNumber: params.receiptNumber,
      itemType: "NON_STOCK",
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.PO_RECEIPT_NSI,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.PO_RECEIPT_NSI}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // Guard: NON-STOCK receipts must never route to account 1535 (storeroom balance sheet).
    // NSI items have no InventoryItem record — a 1535 hit here = GL_ONLY audit failure.
    await this.assertNotStoreroomAccount(glAccounts, "NON-STOCK", tx);

    // 3. Update budget tracking (charge variance only)
    const budgetUpdated = await this.updateBudgetTrackingForReceipt(
      context,
      {
        accountCodeId: params.accountCodeId,
        departmentId: params.departmentId,
        projectId: params.projectId,
        areaId: params.areaId,
        amount: params.totalCost,
        budgetPeriodId: budgetPeriod.id,
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.description} - Receipt ${params.receiptNumber}`,
        purchaseOrderId: params.purchaseOrderId,
      },
      tx,
    );

    // 4. Create GL transaction
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: params.receiptDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE",
        referenceType: "POLineReceipt",
        referenceId: params.receiptId,
        referenceNumber: params.receiptNumber,
        description: `PO ${params.poNumber} - ${params.supplierName} - ${params.description}`,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId: this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        })),
      },
    );

    // 5. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      budgetPeriodId: budgetPeriod.id,
      budgetUpdated,
    };
  }

  /**
   * Update budget tracking for PO receipt
   *
   * Consumes the actual receipt amount against the matching budget dimension.
   *
   * PREVIOUS BUG (fixed): This function previously tried to calculate a
   * "reservedAmount" by summing ALL allocations across ALL lines of the linked
   * requisition for the matching account code. For multi-line requisitions this
   * produced the entire requisition total (e.g. $2.7M) as the "reserved" figure,
   * making variance = actual_receipt - $2.7M = large negative number, which was
   * written directly to consumedAmount with no floor guard. A requisition with
   * 1,004 receipts accumulated -$305M in consumed.
   *
   * FIX: Reservation tracking on this path is removed entirely. Reservation
   * encumbrance is created by reserveBudgetFromGL (on REQ approval) and released
   * by releaseBudgetFromGL (on PO approval / GL reversal). This function's only
   * job is to consume the actual receipt amount.
   *
   * A Math.max(0, ...) floor is applied so consumed can never go below zero from
   * this path.
   *
   * B0-7: When `tx` is supplied, budget operations run on the same transaction
   * client instead of creating nested `$transaction()` calls.
   *
   * @param context - Service context
   * @param params  - Budget tracking parameters
   * @param tx      - Optional Prisma transaction client
   * @returns True if budget was updated, false if no budget found
   */
  private async updateBudgetTrackingForReceipt(
    context: ServiceContext,
    params: {
      accountCodeId: string;
      departmentId?: string;
      projectId?: string;
      areaId?: string;
      amount: number;
      budgetPeriodId: string;
      referenceType: string;
      referenceId: string;
      referenceNumber: string;
      description: string;
      purchaseOrderId: string;
    },
    tx?: PrismaTxClient,
  ): Promise<boolean> {
    const db = this.db(tx);
    try {
      // Receipts with zero or negative amounts (e.g. returns) don't affect consumed.
      // Return receipts are handled by the return path which calls unconsumeBudgetFromGL.
      if (params.amount <= 0) return false;

      const budgetMatches = await budgetHelperService.findBudgetForAllocation(
        db,
        {
          accountCodeId: params.accountCodeId,
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        },
        params.budgetPeriodId,
      );

      if (budgetMatches.length === 0) return false;

      // If the PO approval already created a CONSUME budget transaction for this
      // purchase order, the full commitment was charged to consumed at approval
      // time. The receipt path should not add to consumed again — doing so would
      // double-count the same spend. Only consume on receipt when the PO has no
      // prior commitment consume (e.g. Tabware-imported POs that bypassed the
      // standard approval GL path).
      const existingPOConsume = await db.budgetTransaction.findFirst({
        where: {
          referenceType: "PurchaseOrder",
          referenceId: params.purchaseOrderId,
          transactionType: "CONSUME",
          amount: { gt: 0 },
        },
      });
      if (existingPOConsume) return false;

      for (const budgetInfo of budgetMatches) {
        const budget = await budgetHelperService.getBudgetById(
          db,
          budgetInfo.budgetType,
          budgetInfo.budgetId,
        );
        if (!budget) continue;

        // Consume the actual receipt amount. Floor at 0 — consumed must never go
        // negative from a receipt operation.
        const previousConsumed = Number(budget.consumedAmount);
        const newConsumed = Math.max(0, previousConsumed + params.amount);

        if (tx) {
          await budgetHelperService.updateBudgetAmount(
            db,
            budgetInfo.budgetType,
            budgetInfo.budgetId,
            "consumedAmount",
            newConsumed,
          );
          await budgetHelperService.createBudgetTransaction(db, {
            budgetType: budgetInfo.budgetType,
            budgetId: budgetInfo.budgetId,
            transactionType: BudgetTransactionType.INVENTORY_RECEIPT,
            amount: params.amount,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
            referenceNumber: params.referenceNumber,
            description: params.description,
            previousBalance: previousConsumed,
            newBalance: newConsumed,
            createdBy: context.userId,
          });
        } else {
          await this.prisma.$transaction(async (innerTx) => {
            await budgetHelperService.updateBudgetAmount(
              innerTx,
              budgetInfo.budgetType,
              budgetInfo.budgetId,
              "consumedAmount",
              newConsumed,
            );
            await budgetHelperService.createBudgetTransaction(innerTx, {
              budgetType: budgetInfo.budgetType,
              budgetId: budgetInfo.budgetId,
              transactionType: BudgetTransactionType.INVENTORY_RECEIPT,
              amount: params.amount,
              referenceType: params.referenceType,
              referenceId: params.referenceId,
              referenceNumber: params.referenceNumber,
              description: params.description,
              previousBalance: previousConsumed,
              newBalance: newConsumed,
              createdBy: context.userId,
            });
          });
        }
      }

      return true;
    } catch (_error) {
      // Don't throw — budget tracking is optional
      return false;
    }
  }

  /**
   * Update budget tracking for PO return
   *
   * Reverses the consumed amount from the original receipt.
   *
   * B0-7: When `tx` is supplied, budget operations run on the same transaction client.
   *
   * @param context - Service context
   * @param params - Budget tracking parameters
   * @param tx - Optional Prisma transaction client
   * @returns True if budget was updated, false if no budget found
   */
  private async updateBudgetTrackingForReturn(
    context: ServiceContext,
    params: {
      accountCodeId: string;
      departmentId?: string;
      projectId?: string;
      areaId?: string;
      amount: number;
      budgetPeriodId: string;
      referenceType: string;
      referenceId: string;
      referenceNumber: string;
      description: string;
    },
    tx?: PrismaTxClient,
  ): Promise<boolean> {
    const db = this.db(tx);
    try {
      // Find ALL applicable budgets for allocation (multi-match)
      const budgetMatches = await budgetHelperService.findBudgetForAllocation(
        db,
        {
          accountCodeId: params.accountCodeId,
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        },
        params.budgetPeriodId,
      );

      if (budgetMatches.length === 0) {
        return false;
      }

      // Reverse the SAME amount from EACH matched budget dimension
      for (const budgetInfo of budgetMatches) {
        // Get current budget
        const budget = await budgetHelperService.getBudgetById(
          db,
          budgetInfo.budgetType,
          budgetInfo.budgetId,
        );

        if (!budget) continue;

        // Decrease consumed amount (reverse the original consumption)
        const newConsumed = Math.max(
          0,
          Number(budget.consumedAmount) - params.amount,
        );

        if (tx) {
          await budgetHelperService.updateBudgetAmount(
            db,
            budgetInfo.budgetType,
            budgetInfo.budgetId,
            "consumedAmount",
            newConsumed,
          );
          await budgetHelperService.createBudgetTransaction(db, {
            budgetType: budgetInfo.budgetType,
            budgetId: budgetInfo.budgetId,
            transactionType: BudgetTransactionType.RELEASE,
            amount: -params.amount,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
            referenceNumber: params.referenceNumber,
            description: params.description,
            previousBalance: Number(budget.consumedAmount),
            newBalance: newConsumed,
            createdBy: context.userId,
          });
        } else {
          await this.prisma.$transaction(async (innerTx) => {
            await budgetHelperService.updateBudgetAmount(
              innerTx,
              budgetInfo.budgetType,
              budgetInfo.budgetId,
              "consumedAmount",
              newConsumed,
            );
            await budgetHelperService.createBudgetTransaction(innerTx, {
              budgetType: budgetInfo.budgetType,
              budgetId: budgetInfo.budgetId,
              transactionType: BudgetTransactionType.RELEASE,
              amount: -params.amount,
              referenceType: params.referenceType,
              referenceId: params.referenceId,
              referenceNumber: params.referenceNumber,
              description: params.description,
              previousBalance: Number(budget.consumedAmount),
              newBalance: newConsumed,
              createdBy: context.userId,
            });
          });
        }
      }

      return true;
    } catch (_error) {
      // Don't throw - budget tracking is optional
      return false;
    }
  }
  /**
   * Create GL transaction for tax (PO_TAX event).
   *
   * This method posts a dedicated GL entry for the tax amount on a purchase order.
   * It is called at PO approval/send time when:
   *   - the tax module is enabled (taxConfig.enabled === true)
   *   - taxAmount > 0
   *   - taxGLAccountId is configured
   *
   * The double-entry for tax is:
   *   DEBIT  : Tax Expense account  (taxGLAccountId as determined by GL rule for PO_TAX)
   *   CREDIT : Tax Payable account  (taxGLAccountId as determined by GL rule for PO_TAX)
   *
   * If no GL rule is configured for PO_TAX the method falls back to a direct
   * manual double-entry using the supplied taxGLAccountId as the credit (payable)
   * leg. The debit (expense) leg is also mapped to the same account until an
   * admin configures a proper PO_TAX GL rule. This keeps the books balanced.
   *
   * IMPORTANT: This is a NON-FATAL operation by design. Callers should wrap it in
   * try/catch and log failures without blocking the primary workflow. Tax GL entries
   * can be posted manually by the admin if the automated posting fails.
   *
   * @param context - Service context
   * @param params - Tax GL parameters
   * @param tx - Optional Prisma transaction client
   * @returns Tax GL transaction result
   */
  async createTaxGLEntry(
    context: ServiceContext,
    params: TaxGLParams,
    tx?: PrismaTxClient,
  ): Promise<TaxGLResult> {
    const db = this.db(tx);

    // Guard: Only open POs can generate GL entries
    await this.assertPOIsOpenForGL(params.purchaseOrderId, tx);

    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(db);

    // 2. Build rule evaluation context
    const ruleContext: RuleEvaluationContext = {
      amount: params.taxAmount,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      areaId: params.areaId,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      transactionDate: params.transactionDate ?? new Date(),
      referenceType: "PurchaseOrder",
      referenceId: params.purchaseOrderId,
      referenceNumber: params.poNumber,
    };

    // 3. Try GL rule engine first (PO_TAX event)
    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.PO_TAX,
      ruleContext,
    );

    let glLines: Array<{
      entryType: "DEBIT" | "CREDIT";
      glAccountId: string;
      amount: number;
      description: string;
      accountCodeId?: string;
      departmentId?: string;
      projectId?: string;
      areaId?: string;
    }>;
    let glTransactionRuleId: string | undefined;

    if (ruleResult.success && ruleResult.matched && ruleResult.isBalanced) {
      // Use rule-engine-generated entries (preferred path)
      glLines = ruleResult.entries.map((e) => ({
        entryType: e.entryType,
        glAccountId: e.glAccountId,
        amount: e.amount,
        description: e.description,
        accountCodeId: this.safeAccountCodeId(
          params.accountCodeId ?? e.accountCodeId,
        ),
        departmentId: params.departmentId ?? e.departmentId,
        projectId: params.projectId ?? e.projectId,
        areaId: params.areaId ?? e.areaId,
      }));
      glTransactionRuleId = ruleResult.rule?.id;
    } else {
      // Fallback: manual balanced entry using taxGLAccountId for both legs.
      // Both DEBIT and CREDIT go to taxGLAccountId until an admin configures
      // a proper PO_TAX GL rule with separate expense and payable accounts.
      glLines = [
        {
          entryType: "DEBIT" as const,
          glAccountId: params.taxGLAccountId,
          amount: params.taxAmount,
          description: `${params.taxLabel} expense - PO ${params.poNumber}`,
          accountCodeId: this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        },
        {
          entryType: "CREDIT" as const,
          glAccountId: params.taxGLAccountId,
          amount: params.taxAmount,
          description: `${params.taxLabel} payable - PO ${params.poNumber}`,
          accountCodeId: this.safeAccountCodeId(params.accountCodeId),
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        },
      ];
    }

    // 4. Create GL transaction
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: params.transactionDate ?? new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE",
        referenceType: "PurchaseOrderTax",
        referenceId: params.purchaseOrderId,
        referenceNumber: params.poNumber,
        description: `${params.taxLabel} - PO ${params.poNumber}`,
        glTransactionRuleId,
        lines: glLines,
      },
    );

    // 5. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    return {
      glTransactionId,
      budgetPeriodId: budgetPeriod.id,
    };
  }
}

// Export singleton instance
const globalForPOGL = globalThis as unknown as {
  poGLService: POGLService | undefined;
};
export const poGLService =
  globalForPOGL.poGLService ??
  (globalForPOGL.poGLService = new POGLService(prisma));
