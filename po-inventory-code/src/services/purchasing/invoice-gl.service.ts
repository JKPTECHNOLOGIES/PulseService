/**
 * Invoice GL Service
 *
 * Centralized service for creating GL transactions for invoice operations.
 * Handles account code resolution and GL posting for:
 * - Invoice match (3-way match confirmation)
 * - Invoice payments (AP payment)
 * - Purchase price variances
 *
 * Follows the pattern established by InventoryGLService and POGLService.
 */

import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { ServiceContext } from "@/services/base/types";
import { BadRequestError } from "@/lib/api-errors";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { GLEventType, type RuleEvaluationContext } from "@/types/gl-rules";
import { prisma } from "@/lib/prisma";
import type {
  InvoicePaymentGLParams,
  InvoicePaymentGLResult,
  PriceVarianceGLParams,
  PriceVarianceGLResult,
} from "./invoice-gl.types";

/**
 * Parameters for creating an invoice match GL transaction
 */
export interface InvoiceMatchGLParams {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate?: Date;
  totalAmount: number;
  supplierId: string;
  supplierName?: string;
  purchaseOrderId?: string;
  poNumber?: string;
  /**
   * Optional override for the GL transaction date.
   * Used by the GL backfill process to post entries on the original
   * invoice approval date rather than the current date.
   * Defaults to new Date() (today) when omitted.
   */
  transactionDate?: Date;
  /**
   * Optional override for the amount posted through INVOICE_MATCH (clears 2111
   * Received-Not-Invoiced and books AP). Used for MIXED invoices (SUG-000005):
   * only the PRODUCT portion accrued into 2111, so only that portion may be
   * cleared here — the SERVICE portion books its own AP via the service receipt
   * (GLR-0032: DR expense / CR 2110). When omitted, the full `totalAmount` is
   * used (unchanged behaviour for every non-mixed caller).
   */
  matchAmountOverride?: number;
}

/**
 * Result of invoice match GL transaction creation
 */
export interface InvoiceMatchGLResult {
  glTransactionId: string;
  budgetPeriodId: string;
}

/**
 * Invoice GL Service Class
 */
class InvoiceGLService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create GL transaction for invoice match (3-way match confirmation)
   *
   * This method records the GL entries when an invoice is matched to receipts.
   * It:
   * 1. Gets current budget period
   * 2. Builds rule evaluation context for INVOICE_MATCH
   * 3. Evaluates GL rules
   * 4. Creates GL transaction with double-entry bookkeeping
   * 5. Posts GL transaction
   *
   * @param context - Service context
   * @param params - Invoice match parameters
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists or no GL rule matches
   */
  async createInvoiceMatchTransaction(
    context: ServiceContext,
    params: InvoiceMatchGLParams,
  ): Promise<InvoiceMatchGLResult> {
    logger.info(
      `[Invoice GL] createInvoiceMatchTransaction called: invoiceId=${params.invoiceId}, invoiceNumber=${params.invoiceNumber}, totalAmount=${params.totalAmount}, supplierId=${params.supplierId}, supplierName=${params.supplierName ?? ""}, purchaseOrderId=${params.purchaseOrderId ?? ""}, poNumber=${params.poNumber ?? ""}`,
    );

    // 0. Idempotency guard — never create a duplicate clearing entry.
    //
    // This method is invoked from several approval paths (upload, match,
    // requestor-approve) and may be retried by remediation tooling. Without this
    // guard a second call creates a second RECEIPT/PENDING row and then hits the
    // unique_gl_transaction constraint on post (or double-clears 2111). If a
    // non-reversed INVOICE_MATCH (RECEIPT) transaction already exists for this
    // invoice, return it instead of creating another.
    const existingMatch = await this.prisma.gLTransaction.findFirst({
      where: {
        referenceType: "Invoice",
        referenceId: params.invoiceId,
        transactionType: "RECEIPT",
        status: { in: ["PENDING", "POSTED"] },
      },
      select: { id: true, fiscalPeriodId: true },
    });
    if (existingMatch) {
      logger.info(
        `[Invoice GL] INVOICE_MATCH GL already exists for invoice ${params.invoiceId} (tx ${existingMatch.id}) — skipping duplicate create (idempotent).`,
      );
      return {
        glTransactionId: existingMatch.id,
        budgetPeriodId: existingMatch.fiscalPeriodId,
      };
    }

    // 1. Get current budget period
    let budgetPeriod;
    try {
      budgetPeriod = await getCurrentBudgetPeriod(this.prisma);
      logger.info(`[Invoice GL] Budget period found: ${budgetPeriod.id}`);
    } catch (err) {
      logger.error(
        `[Invoice GL] Failed to get budget period: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    // 2. Build rule evaluation context for invoice match
    const effectiveTransactionDate = params.transactionDate ?? new Date();

    // For MIXED invoices, only the product portion accrued into 2111, so the
    // INVOICE_MATCH clears just that amount. Non-mixed callers omit the override
    // and the full invoice total is used exactly as before.
    const matchAmount = params.matchAmountOverride ?? params.totalAmount;

    const ruleContext: RuleEvaluationContext = {
      amount: matchAmount,
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      invoiceDate: params.invoiceDate,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      poId: params.purchaseOrderId,
      poNumber: params.poNumber,
      transactionDate: effectiveTransactionDate,
      referenceType: "Invoice",
      referenceId: params.invoiceId,
      referenceNumber: params.invoiceNumber,
    };
    logger.info(`[Invoice GL] Rule context built for INVOICE_MATCH`);

    // 3. Evaluate GL rules
    let ruleResult;
    try {
      ruleResult = await glRuleEngineService.evaluateRules(
        context,
        GLEventType.INVOICE_MATCH,
        ruleContext,
      );
      logger.info(
        `[Invoice GL] Rule evaluation result: success=${ruleResult.success}, matched=${ruleResult.matched}, ruleName=${ruleResult.rule?.name}, ruleId=${ruleResult.rule?.id}, entriesCount=${ruleResult.entries.length}, isBalanced=${ruleResult.isBalanced}, totalDebits=${ruleResult.totalDebits}, totalCredits=${ruleResult.totalCredits}`,
      );
    } catch (err) {
      logger.error(
        `[Invoice GL] Rule evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    if (!ruleResult.success || !ruleResult.matched) {
      const errMsg = `No GL rule matched for ${GLEventType.INVOICE_MATCH}. Please configure GL rules for this transaction type.`;
      logger.error(`[Invoice GL] ${errMsg}`);
      throw new BadRequestError(errMsg);
    }

    if (!ruleResult.isBalanced) {
      const errMsg = `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`;
      logger.error(`[Invoice GL] ${errMsg}`);
      throw new BadRequestError(errMsg);
    }

    // 3b. Resolve accountCodeId and departmentId from PO line charge allocation.
    //
    // GLR-0016 uses FIXED account sources and never stamps accountCodeId/departmentId on its
    // entries. NAV sync needs both fields on the DEBIT line to resolve the NAV
    // expense G/L account and department dimension.
    //
    // Resolution priority for accountCodeId:
    //   1. POLineChargeAllocation.accountCodeId  (SERVICE / CONSUMABLE lines)
    //   2. FinanceSettings.defaultInventoryAccountCodeId  (INVENTORY lines — no allocation by design)
    //   3. null — logged as warning, NAV sync will block until manually assigned
    //
    // Resolution priority for departmentId:
    //   1. POLineChargeAllocation.departmentId  (SERVICE / CONSUMABLE / WO lines with dept set)
    //   2. FinanceSettings.defaultWorkOrderDepartmentId  (WO-linked POs with no dept on alloc)
    //   3. FinanceSettings.defaultInventoryDepartmentId  (INVENTORY lines — no allocation by design)
    //   4. null
    let invoiceAccountCodeId: string | undefined;
    let invoiceDepartmentId: string | undefined;
    if (params.purchaseOrderId) {
      try {
        // Priority 1: charge allocation (accountCodeId + departmentId together)
        const allocation = await this.prisma.pOLineChargeAllocation.findFirst({
          where: {
            poLine: { purchaseOrderId: params.purchaseOrderId },
            accountCodeId: { not: null },
          },
          select: { accountCodeId: true, departmentId: true },
        });
        invoiceAccountCodeId = allocation?.accountCodeId ?? undefined;
        invoiceDepartmentId = allocation?.departmentId ?? undefined;

        if (invoiceAccountCodeId) {
          logger.info(
            `[Invoice GL] Resolved accountCodeId=${invoiceAccountCodeId} departmentId=${invoiceDepartmentId ?? "null"} from PO charge allocation for PO ${params.purchaseOrderId}`,
          );
        } else {
          // Priority 2: inventory default (for INVENTORY-type PO lines that have no allocation)
          const hasInventoryLine = await this.prisma.pOLine.findFirst({
            where: {
              purchaseOrderId: params.purchaseOrderId,
              lineType: "INVENTORY",
            },
            select: { id: true },
          });

          if (hasInventoryLine) {
            const financeSettings = await this.prisma.financeSettings.findFirst(
              {
                select: {
                  defaultInventoryAccountCodeId: true,
                  defaultInventoryDepartmentId: true,
                },
              },
            );
            invoiceAccountCodeId =
              financeSettings?.defaultInventoryAccountCodeId ?? undefined;
            invoiceDepartmentId =
              financeSettings?.defaultInventoryDepartmentId ?? undefined;
            if (invoiceAccountCodeId) {
              logger.info(
                `[Invoice GL] Resolved accountCodeId=${invoiceAccountCodeId} departmentId=${invoiceDepartmentId ?? "null"} from FinanceSettings inventory default for INVENTORY PO ${params.purchaseOrderId}`,
              );
            }
          }

          if (!invoiceAccountCodeId) {
            logger.warn(
              `[Invoice GL] No accountCodeId resolved for PO ${params.purchaseOrderId} — DEBIT line will have null accountCodeId. NAV sync will block until a cost code is manually assigned.`,
            );
          }
        }

        // If dept still not resolved, try WO default (covers WO-linked POs where alloc has
        // accountCodeId but departmentId was null before the 6040 backfill)
        if (!invoiceDepartmentId && params.purchaseOrderId) {
          const isWOPO = await this.prisma.requisitionBudgetHeader.findFirst({
            where: {
              requisition: {
                poLines: { some: { purchaseOrderId: params.purchaseOrderId } },
              },
              budgetType: "CHARGE_TO_WORK_ORDER",
            },
            select: { id: true },
          });
          if (isWOPO) {
            const woFinanceSettings =
              await this.prisma.financeSettings.findFirst({
                select: { defaultWorkOrderDepartmentId: true },
              });
            invoiceDepartmentId =
              woFinanceSettings?.defaultWorkOrderDepartmentId ?? undefined;
            if (invoiceDepartmentId) {
              logger.info(
                `[Invoice GL] Resolved departmentId=${invoiceDepartmentId} from FinanceSettings WO default for WO-linked PO ${params.purchaseOrderId}`,
              );
            }
          }
        }
      } catch (err) {
        logger.warn(
          `[Invoice GL] Could not resolve accountCodeId/departmentId (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Stamp accountCodeId and departmentId onto the DEBIT line only — the CREDIT (AP) line does not need them.
    const entries = ruleResult.entries.map((entry) => ({
      ...entry,
      ...(entry.entryType === "DEBIT"
        ? {
            ...(invoiceAccountCodeId
              ? { accountCodeId: invoiceAccountCodeId }
              : {}),
            ...(invoiceDepartmentId
              ? { departmentId: invoiceDepartmentId }
              : {}),
          }
        : {}),
    }));

    // 4. Create GL transaction
    const description = `Invoice match: ${params.invoiceNumber}${params.poNumber ? ` - PO ${params.poNumber}` : ""}${params.supplierName ? ` - ${params.supplierName}` : ""}`;

    let glTransactionId;
    try {
      glTransactionId = await glTransactionService.createTransaction(context, {
        transactionDate: effectiveTransactionDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "RECEIPT",
        referenceType: "Invoice",
        referenceId: params.invoiceId,
        referenceNumber: params.invoiceNumber,
        description,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: entries,
      });
      logger.info(`[Invoice GL] GL transaction created: ${glTransactionId}`);
    } catch (err) {
      logger.error(
        `[Invoice GL] Failed to create GL transaction: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (err instanceof Error) {
        logger.error(
          `[Invoice GL] GL transaction create error stack: ${err.stack?.split("\n").slice(0, 5).join("\n") ?? ""}`,
        );
      }
      throw err;
    }

    // 5. Post GL transaction
    try {
      await glTransactionService.postTransaction(context, glTransactionId);
      logger.info(`[Invoice GL] GL transaction posted: ${glTransactionId}`);
    } catch (err) {
      logger.error(
        `[Invoice GL] Failed to post GL transaction ${glTransactionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    return {
      glTransactionId,
      budgetPeriodId: budgetPeriod.id,
    };
  }

  /**
   * Create GL transaction for invoice payment
   *
   * This method:
   * 1. Gets current budget period
   * 2. Records payment of accounts payable
   * 3. Creates GL transaction with double-entry bookkeeping
   * 4. Posts GL transaction
   * 5. Handles price variance if provided
   *
   * @param context - Service context
   * @param params - Payment parameters
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createInvoicePaymentTransaction(
    context: ServiceContext,
    params: InvoicePaymentGLParams,
  ): Promise<InvoicePaymentGLResult> {
    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);

    // 2. Get GL accounts using rule engine for invoice payment
    // Debit: 2110 (Accounts Payable), Credit: 1000 (Cash/Bank)
    const ruleContext: RuleEvaluationContext = {
      amount: params.paymentAmount,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      areaId: params.areaId,
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      invoiceDate: params.paymentDate,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      poNumber: params.poNumber,
      transactionDate: params.paymentDate,
      referenceType: "Invoice",
      referenceId: params.invoiceId,
      referenceNumber: params.invoiceNumber,
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.INVOICE_PAY,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.INVOICE_PAY}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // 3. Create GL transaction
    const description = params.poNumber
      ? `Invoice ${params.invoiceNumber} - PO ${params.poNumber} - ${params.supplierName}`
      : `Invoice ${params.invoiceNumber} - ${params.supplierName}`;

    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: params.paymentDate,
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "EXPENDITURE", // Invoice payment is an expenditure
        referenceType: "Invoice",
        referenceId: params.invoiceId,
        referenceNumber: params.invoiceNumber,
        description: `${description} - Payment ${params.paymentReference ?? ""}`,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId: params.accountCodeId,
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        })),
      },
    );

    // 4. Post GL transaction
    await glTransactionService.postTransaction(context, glTransactionId);

    // 5. Handle price variance if provided and significant (> $0.01)
    let varianceGLTransactionId: string | undefined;
    if (params.priceVariance && Math.abs(params.priceVariance) > 0.01) {
      const varianceResult = await this.createPriceVarianceTransaction(
        context,
        {
          invoiceId: params.invoiceId,
          invoiceNumber: params.invoiceNumber,
          supplierId: params.supplierId,
          varianceAmount: Math.abs(params.priceVariance),
          description: `Price variance for Invoice ${params.invoiceNumber} - ${params.supplierName}`,
          accountCodeId: params.accountCodeId,
          departmentId: params.departmentId,
          projectId: params.projectId,
          areaId: params.areaId,
        },
      );
      varianceGLTransactionId = varianceResult.glTransactionId;
    }

    return {
      glTransactionId,
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      budgetPeriodId: budgetPeriod.id,
      varianceGLTransactionId,
    };
  }

  /**
   * Create GL transaction for purchase price variance
   *
   * This method records the difference between expected (PO) price and actual (invoice) price.
   *
   * @param context - Service context
   * @param params - Variance parameters
   * @returns GL transaction result
   * @throws BadRequestError if no budget period exists
   */
  async createPriceVarianceTransaction(
    context: ServiceContext,
    params: PriceVarianceGLParams,
  ): Promise<PriceVarianceGLResult> {
    // 1. Get current budget period
    const budgetPeriod = await getCurrentBudgetPeriod(this.prisma);

    // 2. Determine if overpayment or underpayment
    const isOverpayment = params.varianceAmount > 0;

    // 3. Get GL accounts using rule engine for price variance
    const ruleContext: RuleEvaluationContext = {
      amount: Math.abs(params.varianceAmount),
      accountCodeId: params.accountCodeId,
      departmentId: params.departmentId,
      projectId: params.projectId,
      areaId: params.areaId,
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      supplierId: params.supplierId,
      transactionDate: new Date(),
      referenceType: "Invoice",
      referenceId: params.invoiceId,
      referenceNumber: params.invoiceNumber,
      customFields: {
        isOverpayment,
        varianceType: isOverpayment ? "OVERPAYMENT" : "UNDERPAYMENT",
      },
    };

    const ruleResult = await glRuleEngineService.evaluateRules(
      context,
      GLEventType.PRICE_VAR,
      ruleContext,
    );

    if (!ruleResult.success || !ruleResult.matched) {
      throw new BadRequestError(
        `No GL rule matched for ${GLEventType.PRICE_VAR}. Please configure GL rules for this transaction type.`,
      );
    }

    if (!ruleResult.isBalanced) {
      throw new BadRequestError(
        `GL entries not balanced: Debits=${ruleResult.totalDebits}, Credits=${ruleResult.totalCredits}`,
      );
    }

    const glAccounts = ruleResult.entries;

    // 4. Create GL transaction
    const glTransactionId = await glTransactionService.createTransaction(
      context,
      {
        transactionDate: new Date(),
        fiscalPeriodId: budgetPeriod.id,
        transactionType: "ADJUSTMENT",
        referenceType: "Invoice",
        referenceId: params.invoiceId,
        referenceNumber: params.invoiceNumber,
        description: params.description,
        glTransactionRuleId: ruleResult.rule?.id,
        lines: glAccounts.map((acc) => ({
          ...acc,
          accountCodeId: params.accountCodeId,
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
      budgetPeriodId: budgetPeriod.id,
    };
  }
}

// Export singleton instance
const globalForInvoiceGLService = globalThis as unknown as {
  invoiceGLService: InvoiceGLService | undefined;
};
export const invoiceGLService =
  globalForInvoiceGLService.invoiceGLService ??
  (globalForInvoiceGLService.invoiceGLService = new InvoiceGLService(prisma));
