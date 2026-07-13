/**
 * Invoice Approval Service
 * Handles the invoice approval workflow for service-type PO lines
 *
 * Workflow:
 * 1. Finance uploads invoice to PO
 * 2. System matches invoice to receipts
 * 3. Email sent to requestor for approval
 * 4. Requestor approves/rejects
 * 5. Email sent to inventory managers for service receipt
 * 6. Services can be received after invoice approval
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getEmailBaseUrl } from "@/lib/email/get-base-url";
import {
  Invoice,
  InvoiceMatchStatus,
  InvoiceApprovalStatus,
  Prisma,
} from "@prisma/client";
import { notificationService } from "../notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "../notifications/notification.types";
import { PURCHASING_NOTIFICATIONS } from "../notifications/notification-types-registry";
import { InvoiceReceiptMatchingService } from "./invoice-receipt-matching.service";
import { invoiceGLService } from "./invoice-gl.service";
import { glRuleEngineService } from "@/services/gl/gl-rule-engine.service";
import { glTransactionService, getCurrentBudgetPeriod } from "@/services/gl";
import { GLEventType } from "@/types/gl-rules";
import type { ServiceContext } from "../base/types";
import { type BasePermission, RoleName } from "@/types/permissions";
import { BadRequestError } from "@/lib/api-errors";
import { requisitionStatusSyncService } from "@/services/purchasing/requisition/requisition-status-sync.service";
import { generateInvoiceInternalNumber } from "./invoice-utils";
import { calculateDueDate } from "@/lib/invoice-utils";
import { parseInvoiceDate } from "@/lib/validation";
import {
  type InvoiceUploadDTO,
  type RequestorApproveDTO,
  type RequestorRejectDTO,
  type InvoiceUploadResult,
  type InvoiceMatchResult,
  type InvoiceApprovalResult,
  type InvoiceRejectionResult,
  type ServiceLineReceiptValidation,
  type BlockedServiceLine,
  type InvoiceWithApprovalRelations,
  type DuplicateInvoiceWarning,
  InvoiceDisplayStatus,
} from "./invoice-approval.types";

import { financeSettingsService } from "@/services/finance/finance-settings.service";
import { lineItemReceivingService } from "@/services/purchasing/purchase-order/line-item-receiving.service";

/**
 * Internal input type for upload (includes user info)
 */
interface InvoiceUploadInternalInput extends InvoiceUploadDTO {
  uploadedBy: string;
  uploadedByName: string;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  /** Optional explicit approver ID selected in the Upload Invoice dialog */
  approverId?: string;
  /**
   * Customer-driven prepayment flag (2026-04-20). When true, forces the
   * invoice into PENDING_REQUESTOR regardless of match tolerances so the
   * flagged approver can approve before goods ship.
   */
  paymentApprovalRequired?: boolean;
  /** Free-text reason shown on the approve page when paymentApprovalRequired is true. */
  paymentApprovalReason?: string;
  /**
   * Per-line dollar amounts keyed by PO line ID.
   * When provided for SERVICE invoices, each InvoiceLineItem gets the exact
   * user-specified amount instead of an equal split of the invoice total.
   * This amount is later used by requestorApprove() to set POLine.approvedInvoiceAmount.
   */
  lineAmounts?: Record<string, number>;
}

/**
 * Internal input type for approval (includes user info)
 */
interface RequestorApproveInternalInput extends RequestorApproveDTO {
  approvedBy: string;
  approvedByName: string;
}

/**
 * Internal input type for rejection (includes user info)
 */
interface RequestorRejectInternalInput extends RequestorRejectDTO {
  rejectedBy: string;
  rejectedByName: string;
}

/**
 * Minimal permission set for the auto-receive service account context.
 *
 * When an invoice is approved, `requestorApprove()` triggers an automatic
 * service receipt via `lineItemReceivingService.batchReceive()`. That service
 * checks `purchasing:update` permission. The approver's role may not have it
 * (Finance Approver, Requestor, etc.) — and we must never depend on who the
 * approver happens to be.
 *
 * This fixed permission set acts as a service-account identity: it is
 * independent of any user's role, covers everything `batchReceive` needs,
 * and is intentionally minimal so it can't be misused elsewhere.
 *
 * The receipt's `receivedBy` / `receivedByName` fields still record the
 * actual approver name because those come from the `receiveItems` payload,
 * not from the service context.
 */
const AUTO_RECEIVE_SERVICE_PERMISSIONS: BasePermission[] = [
  { resource: "purchasing", action: "read", isActive: true },
  { resource: "purchasing", action: "update", isActive: true },
  { resource: "inventory", action: "read", isActive: true },
  { resource: "inventory", action: "update", isActive: true },
  { resource: "gl", action: "create", isActive: true },
  { resource: "gl", action: "read", isActive: true },
];

export class InvoiceApprovalService {
  /**
   * Check for duplicate invoice number per vendor/supplier.
   * Only checks active invoices (excludes VOIDED/CANCELLED).
   * Returns the existing invoice if a duplicate is found, null otherwise.
   */
  static async checkDuplicateInvoice(
    supplierId: string,
    invoiceNumber: string,
    excludeInvoiceId?: string,
  ): Promise<DuplicateInvoiceWarning | null> {
    const whereClause: Record<string, unknown> = {
      invoiceNumber,
      supplierId,
      status: {
        notIn: ["VOIDED", "CANCELLED", "Voided", "Cancelled", "Rejected"],
      },
    };

    // Optionally exclude a specific invoice (useful for edit scenarios)
    if (excludeInvoiceId) {
      whereClause.id = { not: excludeInvoiceId };
    }

    const existingInvoice = await prisma.invoice.findFirst({
      where: whereClause,
      select: {
        id: true,
        invoiceNumber: true,
        internalNumber: true,
        totalAmount: true,
        createdAt: true,
      },
    });

    if (existingInvoice) {
      return {
        message: `Warning: Invoice number "${invoiceNumber}" already exists for this vendor (${existingInvoice.internalNumber}, $${Number(existingInvoice.totalAmount).toFixed(2)}). This may be a duplicate.`,
        existingInvoiceId: existingInvoice.id,
      };
    }

    return null;
  }

  /**
   * Compute the PRODUCT portion of an invoice for INVOICE_MATCH GL posting.
   *
   * SUG-000005 (mixed invoices): when an invoice covers both a SERVICE line and
   * product receipts, only the product portion ever accrued into 2111
   * (Received-Not-Invoiced) — so only that portion may be cleared through the
   * INVOICE_MATCH rule. The service portion books its own AP via the service
   * receipt (GLR-0032: DR expense / CR 2110) on receive/approval.
   *
   * The service portion is the sum of the SERVICE InvoiceLineItem amounts (the
   * amounts the vendor actually invoiced for services). The product portion is
   * the remainder of the invoice total — consistent with the pure-product flow,
   * which posts the INVOICED amount (not the receipt cost) through INVOICE_MATCH
   * and resolves any price variance at payment.
   *
   * Mixed is detected purely from the invoice's persisted line items — NOT from
   * the MIXED_INVOICE_ENABLED env flag. An invoice's nature is fixed at creation,
   * so the GL split must be applied correctly even if the flag is later toggled
   * off, and so the GL backfill tool posts historical mixed invoices correctly.
   * This is safe for every existing flow: a pure-product invoice has no SERVICE
   * line items (service portion 0 → not mixed) and a pure-service invoice's line
   * items sum to the full total (product remainder 0 → not mixed). Only an
   * invoice with BOTH a service portion and a product remainder — which can only
   * be created while the flag is on — is treated as mixed.
   */
  static async computeProductMatchPortion(
    invoiceId: string,
    invoiceTotal: number,
  ): Promise<{ isMixed: boolean; productPortion: number }> {
    const lineItems = await prisma.invoiceLineItem.findMany({
      where: { invoiceId },
      include: { poLine: { select: { lineType: true } } },
    });

    const servicePortion = lineItems
      .filter((ili) => ili.poLine.lineType === "SERVICE")
      .reduce((sum, ili) => sum + Number(ili.totalAmount), 0);

    const productPortion = Math.max(0, invoiceTotal - servicePortion);

    // Mixed only when BOTH a service portion and a product remainder exist.
    // The 0.005 epsilon avoids treating sub-cent rounding as a real portion.
    const isMixed = servicePortion > 0.005 && productPortion > 0.005;

    return { isMixed, productPortion };
  }

  /**
   * Upload invoice and initiate approval workflow
   * Step 1: Finance uploads invoice to PO
   */
  static async uploadInvoice(
    context: ServiceContext,
    input: InvoiceUploadInternalInput,
  ): Promise<InvoiceUploadResult> {
    const {
      purchaseOrderId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      totalAmount,
      notes,
      uploadedBy,
      uploadedByName,
      receiptIds,
      lineIds,
      lineAmounts,
      filePath,
      fileName,
      fileSize,
      mimeType,
      subtotal: inputSubtotal,
      shippingCost: inputShippingCost,
      tax: inputTax,
      approverId: explicitApproverId,
      paymentApprovalRequired: inputPaymentApprovalRequired,
      paymentApprovalReason: inputPaymentApprovalReason,
    } = input;
    const paymentApprovalRequired = Boolean(inputPaymentApprovalRequired);
    const paymentApprovalReason = inputPaymentApprovalReason?.trim() ?? null;

    // Use provided values or fall back to defaults
    const subtotal = inputSubtotal ?? totalAmount;
    const tax = inputTax ?? 0;
    const shippingCost = inputShippingCost ?? 0;

    // Get PO with lines to check for service types
    // paymentTermsOverride is a scalar on PurchaseOrder and is returned automatically
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        lines: true,
        supplier: {
          select: {
            name: true,
            paymentTerms: true,
            creditTermsDays: true,
          },
        },
      },
    });

    if (!po) {
      throw new Error("Purchase order not found");
    }

    // If an explicit approver was specified, look them up now (before the transaction)
    let explicitApprover: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null = null;
    if (explicitApproverId) {
      explicitApprover = await prisma.user.findUnique({
        where: { id: explicitApproverId, isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      if (!explicitApprover) {
        logger.warn(
          `[Invoice Upload] Explicit approver ID "${explicitApproverId}" not found or inactive — ignoring`,
        );
      }
    }
    const explicitApproverFullName = explicitApprover
      ? `${explicitApprover.firstName} ${explicitApprover.lastName}`.trim()
      : "";
    const explicitApproverName = explicitApprover
      ? explicitApproverFullName !== ""
        ? explicitApproverFullName
        : explicitApprover.email
      : null;

    // Check for duplicate invoice number per vendor (soft warning, not a block)
    const duplicateWarning = await InvoiceApprovalService.checkDuplicateInvoice(
      po.supplierId,
      invoiceNumber,
    );

    // ── Mixed-invoice detection (SUG-000005) ────────────────────────────────
    // A "mixed" invoice covers BOTH a SERVICE/tariff line (via lineIds) AND
    // product/material deliveries (via receiptIds) on the same PO. Gated behind
    // MIXED_INVOICE_ENABLED (default off) because the GL posting must be split
    // by portion (product → INVOICE_MATCH/2111 clear, service → direct expense)
    // before this can be safely enabled. While the flag is off, behaviour is
    // identical to before: the receiptIds-first branch wins and the invoice is
    // treated as a pure product invoice.
    const mixedInvoiceEnabled = process.env.MIXED_INVOICE_ENABLED === "true";
    const invoicedLineIdSet = new Set(input.lineIds ?? []);
    const coversServiceLine = po.lines.some(
      (line) => line.lineType === "SERVICE" && invoicedLineIdSet.has(line.id),
    );
    const coversReceipts = (input.receiptIds?.length ?? 0) > 0;
    const isMixedInvoice =
      mixedInvoiceEnabled && coversServiceLine && coversReceipts;

    // Check if the invoice being uploaded is for service lines (context-aware).
    // A mixed PO (INVENTORY/CONSUMABLE + SERVICE) must not force PENDING_REQUESTOR
    // when the invoice is matched to physical GR receipts.
    let hasServiceLines: boolean;

    if (isMixedInvoice) {
      // Mixed invoice: route through the SERVICE approval flow (PENDING_REQUESTOR)
      // so the service portion is verified by the requestor and received after
      // approval. The product receipts are still linked at upload (the receiptIds
      // block below runs regardless of hasServiceLines), and the product lines are
      // marked invoiceMatched at upload via the isMixedInvoice guard further down.
      hasServiceLines = true;
    } else if (input.receiptIds && input.receiptIds.length > 0) {
      // Invoice is matched to physical GR receipts → always a goods invoice, never needs requestor approval
      hasServiceLines = false;
    } else if (input.lineIds && input.lineIds.length > 0) {
      // Invoice is matched to specific PO line IDs → check if those specific lines are SERVICE type
      const invoicedLineIds = new Set(input.lineIds);
      hasServiceLines = po.lines.some(
        (line) => line.lineType === "SERVICE" && invoicedLineIds.has(line.id),
      );
    } else if (paymentApprovalRequired) {
      // Prepayment invoice: by definition there are no receipts yet (vendor
      // hasn't shipped) and no completed service lines to match against.
      // The whole point is to approve PAYMENT so the vendor WILL ship/work.
      // Skip the require-explicit-selection guard and route purely on the
      // prepayment flag. We treat `hasServiceLines=false` here so the
      // SERVICE-line canReceive gate (line-item-receiving.service.ts:1228)
      // is NOT opened — receipts still require a proper matched invoice
      // later on. This prepayment invoice is a standalone AP authorization.
      hasServiceLines = false;
    } else {
      // No receipts or lines specified — check if this PO has service lines at all
      const poHasServiceLines = po.lines.some(
        (line) => line.lineType === "SERVICE",
      );
      if (poHasServiceLines) {
        // Check whether ALL service lines are already fully invoiced.
        // If so, this new invoice must be a supplemental charge — freight, tax,
        // or other variance that arrives after the main service billing is complete.
        // Route it through the auto-approve product path instead of blocking.
        const allServiceLinesFullyInvoiced = po.lines
          .filter((l) => l.lineType === "SERVICE")
          .every(
            (l) =>
              Number(l.approvedInvoiceAmount) >= Number(l.totalPrice) - 0.01,
          );

        if (!allServiceLinesFullyInvoiced) {
          // Some service lines still have remaining capacity — require explicit selection
          // so the invoice is routed to the correct approver for that service work.
          throw new BadRequestError(
            "This purchase order contains service lines. Please specify which lines this invoice covers by providing lineIds (for service lines) or receiptIds (for product lines).",
          );
        }
        // All service lines fully invoiced → supplemental/variance charge.
        // Fall through with hasServiceLines = false (auto-approve path, no receipt to open).
        logger.info(
          `[Invoice Upload] All SERVICE lines on PO ${po.poNumber} are fully invoiced — ` +
            `treating as supplemental/variance charge (freight/tax/other). Auto-approve path.`,
        );
      }
      // Pure product PO (or fully-invoiced SERVICE PO variance): safe to default to false
      hasServiceLines = false;
    }

    // ── Blanket SERVICE PO over-budget guard ─────────────────────────────────
    // For SERVICE POs, the PO total is the agreed blanket dollar amount.
    // If cumulative invoiced (existing active invoices + this one) exceeds that
    // amount, block the upload immediately with a clear message so the uploader
    // knows to ask the purchasing manager to increase the PO before retrying.
    //
    // This runs BEFORE the transaction so we never create a partially-committed
    // invoice that then fails — the user gets a clean, actionable 400 error.
    //
    // EXCEPTION: Closed POs — late invoices for work completed before closure
    // are expected to exceed the PO total (all budget was consumed). Never block
    // a Closed PO upload on budget grounds; the work is done and the invoice
    // is a legitimate AP document arriving after the fact.
    if (hasServiceLines && purchaseOrderId && po.status !== "Closed") {
      const poTotal = Number(po.totalAmount);

      if (poTotal > 0) {
        const existingInvoiceAgg = await prisma.invoice.aggregate({
          where: {
            purchaseOrderId,
            approvalStatus: {
              in: [
                InvoiceApprovalStatus.FULLY_APPROVED,
                InvoiceApprovalStatus.PENDING_REQUESTOR,
                InvoiceApprovalStatus.PENDING_REVIEW,
              ],
            },
            voidedAt: null,
            status: { notIn: ["VOIDED", "CANCELLED", "Voided", "Cancelled"] },
          },
          _sum: { subtotal: true },
        });

        // Freight, tax, and misc "other" charges are vendor add-ons that are
        // never part of the PO line totals, so they must NOT count against the
        // PO budget — this mirrors how consumable/non-stock/inventory invoices
        // behave (they skip this guard entirely). The invoice `subtotal` column
        // is exactly totalAmount − shipping − tax − other (see the upload route),
        // so comparing subtotals on both sides excludes all three add-ons
        // consistently. Previously only freight was excluded, which wrongly
        // blocked a valid service invoice carrying a $25 tax/other charge.
        const alreadyInvoiced = Number(existingInvoiceAgg._sum.subtotal ?? 0);
        const cumulativeWithThis = alreadyInvoiced + subtotal;

        // Compare with a half-cent epsilon so IEEE-754 float noise from the
        // upstream subtraction (totalAmount − shipping − tax − other) can never
        // produce a phantom sub-cent overage that falsely blocks a balanced
        // invoice. Only a real overage of at least a cent is treated as exceeding.
        const OVER_BUDGET_EPSILON = 0.005;
        if (cumulativeWithThis - poTotal > OVER_BUDGET_EPSILON) {
          const available = Math.max(0, poTotal - alreadyInvoiced);
          const overage = cumulativeWithThis - poTotal;

          const fmt = (n: number) =>
            new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(n);

          throw new BadRequestError(
            `PO amount exceeded — this invoice (${fmt(totalAmount)}) cannot be uploaded.\n\n` +
              `PO total:           ${fmt(poTotal)}\n` +
              `Already invoiced:   ${fmt(alreadyInvoiced)}\n` +
              `Remaining balance:  ${fmt(available)}\n` +
              `Over by:            ${fmt(overage)}\n\n` +
              `Please ask your Purchasing Manager to increase the PO amount by at least ${fmt(overage)} before uploading this invoice.`,
          );
        }
      }
    }

    // Determine initial statuses
    const matchStatus = InvoiceMatchStatus.UNMATCHED;
    // approvalStatus is computed inside the transaction (needs DB queries for amount validation)
    // Using `as InvoiceApprovalStatus` to prevent TS literal narrowing — value is reassigned in the tx closure
    let approvalStatus =
      InvoiceApprovalStatus.PENDING_REQUESTOR as InvoiceApprovalStatus;

    // Use transaction to ensure atomicity - if any part fails, everything rolls back
    let invoice;
    try {
      invoice = await prisma.$transaction(async (tx) => {
        // Generate internal tracking number
        const internalNumber = await generateInvoiceInternalNumber(tx);

        // Variables for new Invoice columns (populated during approval logic)
        let poTotalAtUpload: number | null = null;
        let cumulativeInvoicedAmount: number | null = null;
        let matchVariancePercent: number | null = null;
        let matchValidationNotes: string | null = null;
        let autoApprovalEligible = false;

        // Compute approval status based on service lines and amount validation.
        //
        // Precedence order (top = wins):
        //  1. hasServiceLines         → existing service-invoice flow, UNCHANGED.
        //     Service invoices keep their original message, notification
        //     title, approver resolution, receive-after-approval behavior.
        //     The prepay flag is ignored + stripped on service invoices.
        //  2. paymentApprovalRequired → NEW — non-service invoice flagged for
        //     prepayment by the uploader, forces PENDING_REQUESTOR.
        //  3. normal amount-match tolerances for product POs.
        if (hasServiceLines) {
          // Service invoices: UNCHANGED from before this feature was added.
          // The prepay flag is silently ignored here (and stripped before
          // persisting) so the existing service-invoice process — upload,
          // requestor approval, receive-after-approval, GL — stays identical.
          approvalStatus = InvoiceApprovalStatus.PENDING_REQUESTOR;
          matchValidationNotes =
            "Service invoice — requires requestor approval";
        } else if (paymentApprovalRequired) {
          approvalStatus = InvoiceApprovalStatus.PENDING_REQUESTOR;
          matchValidationNotes =
            `Payment approval required before goods ship: ` +
            (paymentApprovalReason ?? "(no reason provided)");
          autoApprovalEligible = false;
        } else if (purchaseOrderId) {
          // ── Amount-match tolerance check ─────────────────────────────────────
          //
          // FREIGHT / SHIPPING RULE:
          //   `shippingCost` is a vendor add-on charge that is never included in
          //   the PO line totals.  Comparing totalAmount (which includes freight)
          //   against poTotalForApproval (PO lines only) would artificially inflate
          //   the ratio and incorrectly flag freight-inclusive invoices.
          //   We use `subtotal + tax` (= totalAmount − shippingCost) as the
          //   "matchable" amount throughout this block.
          const matchableAmount = subtotal + tax; // freight-excluded invoice value

          // RECEIPT-BASED PARTIAL INVOICE RULE:
          //   When receipts are provided, each receipt is a discrete delivery that
          //   is invoiced exactly once.  The denominator must be the SUM OF THOSE
          //   RECEIPTS — not the full PO total — so that a $500 invoice against a
          //   $500 receipt on a $17 000 PO auto-approves instead of going to review.
          //   We also skip the cumulative-invoiced check for receipt-based invoices
          //   because prior invoices covered different receipts on the same PO.
          //
          // LINE-BASED / NO-MATCH RULE:
          //   For service-line invoices (lineIds) and plain PO invoices (no match
          //   context) the cumulative total is still meaningful, so we keep it.
          //   We sum prior invoices by `subtotal` (not totalAmount) to stay
          //   consistent with the freight-excluded matchableAmount numerator.

          let poTotalForApproval: number;
          let isReceiptBased = false;
          // Set to true when the invoice is a supplemental charge on a fully-invoiced
          // SERVICE PO — the coverage ratio check is meaningless in this case.
          let skipRatioCheck = false;

          if (input.receiptIds && input.receiptIds.length > 0) {
            // ── Receipt-based: denominator = sum of selected receipts ──────────
            const receiptAgg = await tx.pOLineReceipt.aggregate({
              where: {
                id: { in: input.receiptIds },
                isReturn: false,
              },
              _sum: { totalCost: true },
            });
            poTotalForApproval = Number(receiptAgg._sum.totalCost ?? 0);
            if (poTotalForApproval === 0) {
              // Fallback to non-service line total if receipts sum to zero (data edge case)
              const nonServiceLines = po.lines.filter(
                (l) => l.lineType !== "SERVICE",
              );
              poTotalForApproval = nonServiceLines.reduce(
                (s, l) => s + Number(l.totalPrice),
                0,
              );
              if (poTotalForApproval === 0)
                poTotalForApproval = Number(po.totalAmount);
            }
            isReceiptBased = true;
          } else if (input.lineIds && input.lineIds.length > 0) {
            // ── Line-based: denominator = sum of targeted lines ───────────────
            const targetedLineIdSet = new Set(input.lineIds);
            const targetedLines = po.lines.filter((l) =>
              targetedLineIdSet.has(l.id),
            );
            poTotalForApproval = targetedLines.reduce(
              (s, l) => s + Number(l.totalPrice),
              0,
            );
            if (poTotalForApproval === 0)
              poTotalForApproval = Number(po.totalAmount);
          } else {
            // ── No match context: full PO total ───────────────────────────────
            // EXCEPTION: supplemental charge on a fully-invoiced SERVICE PO.
            // A $250 freight/tax/other charge on a fully-billed $4,882 PO will
            // always fail the 95% coverage ratio check — that check is meaningless
            // here. Detect it and auto-approve directly, skipping the ratio block.
            const poSvcLines = po.lines.filter((l) => l.lineType === "SERVICE");
            if (
              poSvcLines.length > 0 &&
              poSvcLines.every(
                (l) =>
                  Number(l.approvedInvoiceAmount) >=
                  Number(l.totalPrice) - 0.01,
              )
            ) {
              skipRatioCheck = true;
              approvalStatus = InvoiceApprovalStatus.FULLY_APPROVED;
              autoApprovalEligible = true;
              matchValidationNotes =
                "Auto-approved: supplemental charge (freight/tax/other) on fully-invoiced SERVICE PO";
              poTotalForApproval = 0; // unused when skipRatioCheck=true
            } else {
              poTotalForApproval = Number(po.totalAmount);
            }
          }

          // Determine if this PO contains only CONSUMABLE lines.
          // CONSUMABLE POs are blanket/VMI orders where vendors send many progressive
          // partial invoices against a budget cap — the 95% cumulative-coverage
          // threshold used for INVENTORY (single-delivery) POs does NOT apply here.
          // A CONSUMABLE invoice auto-approves as long as cumulative invoicing does
          // not EXCEED the PO total by more than 10% (over-invoice guard only).
          const isConsumablePO = po.lines.every(
            (line) => line.lineType === "CONSUMABLE",
          );

          const APPROVAL_TOLERANCE = 0.05; // 5% — stricter for auto-approval (INVENTORY only)

          // Sum existing approved invoices by subtotal (freight-excluded) for
          // line-based and no-match paths.  Receipt-based paths skip cumulative.
          const existingApprovedInvoices = await tx.invoice.aggregate({
            where: {
              purchaseOrderId,
              approvalStatus: "FULLY_APPROVED",
              voidedAt: null,
            },
            _sum: { subtotal: true },
          });
          const alreadyInvoiced = Number(
            existingApprovedInvoices._sum.subtotal ?? 0,
          );

          // For receipt-based invoicing: compare this invoice directly against its
          // receipts — no cumulative (prior invoices covered different receipts).
          // For all other paths: cumulative total vs denominator as before.
          const effectiveNumerator = isReceiptBased
            ? matchableAmount
            : alreadyInvoiced + matchableAmount;

          // Tracking fields stored on the invoice record (display only)
          const cumulativeWithThis = alreadyInvoiced + totalAmount; // totalAmount for display; subtotal used for ratio
          poTotalAtUpload = poTotalForApproval;
          cumulativeInvoicedAmount = cumulativeWithThis;

          if (!skipRatioCheck && poTotalForApproval > 0) {
            const ratio = effectiveNumerator / poTotalForApproval;
            matchVariancePercent = ratio;

            if (isConsumablePO) {
              // CONSUMABLE / VMI blanket PO: individual partial invoices always auto-approve.
              // Only flag PENDING_REVIEW if cumulative invoicing exceeds PO total by >10%
              // (over-invoice guard — prevents runaway billing beyond the agreed budget).
              if (ratio > 1.1) {
                approvalStatus = InvoiceApprovalStatus.PENDING_REVIEW;
                matchValidationNotes = `Over-matched (consumable PO): cumulative invoicing at ${(ratio * 100).toFixed(1)}% of PO total`;
                logger.warn(
                  `[Invoice Approval] Consumable PO invoice requires finance review (over-matched): ` +
                    `cumulative invoiced $${effectiveNumerator.toFixed(2)} vs PO total $${poTotalForApproval.toFixed(2)} ` +
                    `(ratio: ${(ratio * 100).toFixed(1)}%)`,
                );
              } else {
                approvalStatus = InvoiceApprovalStatus.FULLY_APPROVED;
                autoApprovalEligible = true;
                matchValidationNotes = `Auto-approved (consumable PO): progressive partial invoice at ${(ratio * 100).toFixed(1)}% cumulative coverage`;
              }
            } else if (ratio >= 1 - APPROVAL_TOLERANCE && ratio <= 1.1) {
              // Invoice covers the matched amount within acceptable range → auto-approve
              approvalStatus = InvoiceApprovalStatus.FULLY_APPROVED;
              autoApprovalEligible = true;
              matchValidationNotes = isReceiptBased
                ? `Auto-approved: invoice covers ${(ratio * 100).toFixed(1)}% of matched receipts (within ${APPROVAL_TOLERANCE * 100}% tolerance)`
                : `Auto-approved: invoice covers ${(ratio * 100).toFixed(1)}% of PO total (within ${APPROVAL_TOLERANCE * 100}% tolerance)`;
            } else if (ratio > 1.1) {
              // Over-matched: exceeds the expected amount beyond tolerance
              approvalStatus = InvoiceApprovalStatus.PENDING_REVIEW;
              matchValidationNotes = isReceiptBased
                ? `Over-matched: invoice at ${(ratio * 100).toFixed(1)}% of matched receipt total`
                : `Over-matched: cumulative invoicing at ${(ratio * 100).toFixed(1)}% of PO total`;
              logger.warn(
                `[Invoice Approval] Invoice requires finance review (over-matched): ` +
                  `effective $${effectiveNumerator.toFixed(2)} vs reference $${poTotalForApproval.toFixed(2)} ` +
                  `(ratio: ${(ratio * 100).toFixed(1)}%, tolerance: ${APPROVAL_TOLERANCE * 100}%)`,
              );
            } else {
              // Below tolerance — flag for finance review
              approvalStatus = InvoiceApprovalStatus.PENDING_REVIEW;
              matchValidationNotes = isReceiptBased
                ? `Pending review: invoice covers ${(ratio * 100).toFixed(1)}% of matched receipt total (below ${((1 - APPROVAL_TOLERANCE) * 100).toFixed(0)}% threshold)`
                : `Pending review: invoice covers ${(ratio * 100).toFixed(1)}% of PO total (below ${((1 - APPROVAL_TOLERANCE) * 100).toFixed(0)}% threshold)`;
              logger.warn(
                `[Invoice Approval] Invoice requires finance review: ` +
                  `effective $${effectiveNumerator.toFixed(2)} vs reference $${poTotalForApproval.toFixed(2)} ` +
                  `(ratio: ${(ratio * 100).toFixed(1)}%)`,
              );
            }
          } else if (!skipRatioCheck && matchableAmount > 0) {
            // Positive invoice against zero-value reference — needs finance review
            approvalStatus = InvoiceApprovalStatus.PENDING_REVIEW;
            matchValidationNotes = `Pending review: positive invoice $${matchableAmount.toFixed(2)} against zero-value reference`;
            logger.warn(
              `[Invoice Approval] Positive invoice $${matchableAmount.toFixed(2)} against zero-value reference — requires review`,
            );
          } else if (!skipRatioCheck) {
            // Zero-value reference + zero-value invoice — auto-approve
            approvalStatus = InvoiceApprovalStatus.FULLY_APPROVED;
            autoApprovalEligible = true;
            matchValidationNotes =
              "Auto-approved: zero-value reference and zero-value invoice";
          }
          // skipRatioCheck=true: approvalStatus already set to FULLY_APPROVED above
        } else {
          // No PO linked — needs finance review
          approvalStatus = InvoiceApprovalStatus.PENDING_REVIEW;
          matchValidationNotes = "Pending review: no PO linked to invoice";
        }

        // Create invoice
        // Only pre-assign the approver for SERVICE invoices that need requestor approval.
        // Non-service invoices are auto-approved or sent to finance review — writing
        // requestorApprovedBy would confuse the frontend into showing "Pending approval"
        // when no approval is actually needed.

        // Priority: 1) Explicit approver chosen in Upload dialog, 2) PO-level invoice approver
        let finalApprover: {
          id: string;
          firstName: string;
          lastName: string;
          email: string;
        } | null = null;
        let finalApproverName: string | null = null;

        if (explicitApprover && explicitApproverName) {
          finalApprover = explicitApprover;
          finalApproverName = explicitApproverName;
        } else if (
          (hasServiceLines || paymentApprovalRequired) &&
          po.invoiceApproverId
        ) {
          // Fall back to the PO-level invoice approver for service invoices
          // AND prepayment invoices that went straight to PENDING_REQUESTOR.
          finalApprover = await tx.user.findUnique({
            where: { id: po.invoiceApproverId, isActive: true },
            select: { id: true, firstName: true, lastName: true, email: true },
          });
          if (finalApprover) {
            const finalApproverFullName =
              `${finalApprover.firstName} ${finalApprover.lastName}`.trim();
            finalApproverName =
              finalApproverFullName !== ""
                ? finalApproverFullName
                : finalApprover.email;
          } else {
            logger.warn(
              `[Invoice Upload] PO-level invoice approver ID "${po.invoiceApproverId}" not found or inactive — ignoring`,
            );
          }
        }

        // Pre-assign requestorApprovedBy for invoices that need approval
        // (service lines OR the prepayment flag). Prevents the UI from showing
        // "no approver" while PENDING_REQUESTOR.
        const shouldPreAssignApprover =
          (hasServiceLines || paymentApprovalRequired) &&
          finalApprover &&
          finalApproverName;

        // Auto-calculate due date from vendor payment terms if not provided.
        // parseInvoiceDate enforces MIN_INVOICE_YEAR (rejects bogus years like 1926
        // from 2-digit-year parses) and anchors to local midnight (no UTC day-off).
        const invoiceDateObj = parseInvoiceDate(invoiceDate, "invoiceDate");
        let resolvedDueDate = dueDate
          ? parseInvoiceDate(dueDate, "dueDate")
          : null;
        resolvedDueDate ??= calculateDueDate(invoiceDateObj, {
          paymentTermsOverride: po.paymentTermsOverride,
          paymentTermsString: po.supplier.paymentTerms,
          creditTermsDays: po.supplier.creditTermsDays,
        });

        const newInvoice = await tx.invoice.create({
          data: {
            internalNumber,
            invoiceNumber,
            invoiceDate: invoiceDateObj,
            dueDate: resolvedDueDate,
            totalAmount,
            subtotal,
            tax,
            shippingCost,
            balanceAmount: totalAmount,
            supplierId: po.supplierId,
            purchaseOrderId,
            notes,
            status:
              InvoiceApprovalService.syncInvoiceStatusFields(approvalStatus)
                .status,
            uploadedAt: new Date(),
            uploadedBy,
            uploadedByName,
            matchStatus,
            approvalStatus,
            // Only pre-assign the approver for SERVICE invoices
            ...(shouldPreAssignApprover && finalApprover
              ? {
                  requestorApprovedBy: finalApprover.id,
                  requestorApprovedByName: finalApproverName,
                }
              : {}),
            // B1-7 (TD-013): canReceiveServices removed — was set but never read
            // New amount-validation columns
            poTotalAtUpload,
            cumulativeInvoicedAmount,
            matchVariancePercent,
            matchValidationNotes,
            autoApprovalEligible,
            // Prepayment (customer 2026-04-20).
            // Only persisted for NON-service invoices. Service invoices use
            // their own approval flow, so storing the prepay flag on them
            // would just add a confusing banner to normal service approvals.
            paymentApprovalRequired: hasServiceLines
              ? false
              : paymentApprovalRequired,
            paymentApprovalReason: hasServiceLines
              ? null
              : paymentApprovalReason,
          },
        });

        // If lineIds provided (SERVICE-only matching), create invoice line items
        if (lineIds && lineIds.length > 0) {
          const lines = await tx.pOLine.findMany({
            where: {
              id: { in: lineIds },
              purchaseOrderId,
            },
          });

          // The dollar amount the line items must sum to.
          //
          // Start from the FREIGHT-EXCLUDED allocatable amount: subtotal
          // (= totalAmount − shippingCost − tax). Freight is a vendor add-on
          // stored on the invoice header (shippingCost), included in the invoice
          // total and the GL/AP posting, but NEVER allocated to a PO line. When
          // there is no freight/tax, subtotal === totalAmount, so this is a no-op
          // for existing freight-free invoices.
          //
          // For a MIXED invoice (SUG-000005) the lineIds are the SERVICE lines,
          // which cover only the SERVICE portion — the rest of the
          // (freight-excluded) invoice is covered by the product receipts — so we
          // further subtract the product receipt total.
          let lineMatchTarget = subtotal;
          if (
            isMixedInvoice &&
            input.receiptIds &&
            input.receiptIds.length > 0
          ) {
            const receiptAgg = await tx.pOLineReceipt.aggregate({
              where: { id: { in: input.receiptIds }, isReturn: false },
              _sum: { totalCost: true },
            });
            const productPortion = Number(receiptAgg._sum.totalCost ?? 0);
            lineMatchTarget = Math.max(0, subtotal - productPortion);
          }

          // Create invoice line items for each selected PO line.
          // Use the user-specified per-line amount when provided (lineAmounts map),
          // otherwise fall back to an equal split of the line match target.
          // The per-line amount stored here is consumed by requestorApprove()
          // to set POLine.approvedInvoiceAmount exactly as the user entered it.
          const equalSplit = lineMatchTarget / lines.length;

          // Compute raw per-line amounts, then normalise so they always sum to
          // lineMatchTarget. This is defense-in-depth against a frontend bug where
          // the PO line's full price is seeded as the default amount — if the
          // user doesn't change it, the sum deviates wildly from the target
          // (M-027). Normalising here keeps ILI amounts proportionally correct and
          // prevents approvedInvoiceAmount / auto-receive from being inflated
          // beyond the targeted (service, freight-excluded) portion.
          const rawLineAmounts = lines.map((line) => {
            const lineAmount = lineAmounts?.[line.id];
            return {
              line,
              amount: lineAmount ?? equalSplit,
            };
          });
          const rawSum = rawLineAmounts.reduce((s, r) => s + r.amount, 0);
          if (rawSum > 0 && Math.abs(rawSum - lineMatchTarget) > 0.01) {
            logger.warn(
              `[InvoiceUpload] lineAmounts sum ($${rawSum.toFixed(2)}) != target ` +
                `($${lineMatchTarget.toFixed(2)}) for PO ${purchaseOrderId} — rescaling ` +
                `ILI amounts proportionally to match the target portion (freight excluded).`,
            );
          }
          const normalizedLineAmounts =
            rawSum > 0 && Math.abs(rawSum - lineMatchTarget) > 0.01
              ? rawLineAmounts.map((r) => ({
                  ...r,
                  amount: (r.amount / rawSum) * lineMatchTarget,
                }))
              : rawLineAmounts;

          for (const { line, amount } of normalizedLineAmounts) {
            await tx.invoiceLineItem.create({
              data: {
                invoiceId: newInvoice.id,
                poLineId: line.id,
                description: line.description,
                quantity: Number(line.quantity),
                unitPrice: Number(line.unitPrice),
                totalAmount: amount,
              },
            });
          }
        }

        // If receiptIds provided, match invoice to receipts immediately
        // NOTE: Must use tx (transaction client) here, not the separate prisma client,
        // because the invoice was just created in this transaction and isn't visible
        // to other connections until the transaction commits.
        if (receiptIds && receiptIds.length > 0) {
          // Link receipts to invoice directly within the transaction.
          // PARTIAL INVOICING: Only set invoiceId on receipts that don't already
          // have one linked. Vendors frequently send partial invoices against the
          // same receipt, so we must not steal the receipt from a prior invoice.
          // Receipts already linked to another invoice keep their original link;
          // the new invoice is still connected to the PO via purchaseOrderId.
          await tx.pOLineReceipt.updateMany({
            where: {
              id: { in: receiptIds },
              invoiceId: null, // Only update receipts not yet linked to an invoice
            },
            data: {
              invoiceId: newInvoice.id,
              invoiceNumber: newInvoice.invoiceNumber,
              invoiceDate: newInvoice.invoiceDate,
            },
          });

          // Determine match status based on cumulative invoice amount vs PO total
          const MATCH_TOLERANCE = 0.1; // 10%
          let resolvedMatchStatus: InvoiceMatchStatus =
            InvoiceMatchStatus.UNMATCHED;

          if (purchaseOrderId) {
            const poTotal = Number(po.totalAmount);

            // Sum ALL existing approved/pending invoices for this PO (excluding voided)
            const existingInvoices = await tx.invoice.aggregate({
              where: {
                purchaseOrderId,
                approvalStatus: {
                  in: ["FULLY_APPROVED", "PENDING_REQUESTOR", "PENDING_REVIEW"],
                }, // B1-6: PENDING_MANAGER removed
                voidedAt: null,
                status: {
                  notIn: ["VOIDED", "CANCELLED", "Voided", "Cancelled"],
                },
              },
              _sum: { totalAmount: true, shippingCost: true },
            });
            // Exclude freight/shipping for the same reason as the upload guard
            // above — freight is never part of the PO budget and must not push a
            // service invoice past the coverage tolerance into OVER_MATCHED.
            const existingInvoicedTotal =
              Number(existingInvoices._sum.totalAmount) -
              Number(existingInvoices._sum.shippingCost ?? 0);

            // aggregate already includes the new invoice created earlier in this transaction
            const cumulativeInvoiceTotal = existingInvoicedTotal;

            if (poTotal > 0) {
              const coverageRatio = cumulativeInvoiceTotal / poTotal;

              if (coverageRatio > 1.1) {
                // Cumulative invoicing exceeds PO total beyond 10% tolerance → OVER_MATCHED
                resolvedMatchStatus = InvoiceMatchStatus.OVER_MATCHED;
                logger.info(
                  `[Invoice Upload] Cumulative invoiced $${cumulativeInvoiceTotal.toFixed(2)} exceeds PO total $${poTotal.toFixed(2)} by >${((coverageRatio - 1) * 100).toFixed(1)}% — setting OVER_MATCHED`,
                );
              } else if (coverageRatio >= 1 - MATCH_TOLERANCE) {
                // Invoiced amount covers PO total within tolerance → FULLY_MATCHED
                resolvedMatchStatus = InvoiceMatchStatus.FULLY_MATCHED;
                logger.info(
                  `[Invoice Upload] Cumulative invoiced $${cumulativeInvoiceTotal.toFixed(2)} covers PO total $${poTotal.toFixed(2)} (${(coverageRatio * 100).toFixed(1)}%) — setting FULLY_MATCHED`,
                );
              } else if (cumulativeInvoiceTotal > 0) {
                // Some amount invoiced but not enough → PARTIALLY_MATCHED
                resolvedMatchStatus = InvoiceMatchStatus.PARTIALLY_MATCHED;
                logger.info(
                  `[Invoice Upload] Cumulative invoiced $${cumulativeInvoiceTotal.toFixed(2)} partially covers PO total $${poTotal.toFixed(2)} (${(coverageRatio * 100).toFixed(1)}%) — setting PARTIALLY_MATCHED`,
                );
              }
              // else stays UNMATCHED
            }
          }

          // Update match status
          await tx.invoice.update({
            where: { id: newInvoice.id },
            data: {
              matchStatus: resolvedMatchStatus,
              matchedAt: new Date(),
              matchedBy: uploadedBy,
              matchedByName: uploadedByName,
            },
          });

          // Mark INVENTORY/CONSUMABLE PO lines as invoiceMatched only when cumulative invoiced
          // amount covers PO total within tolerance (SERVICE lines handled in requestorApprove()).
          // For a mixed invoice (isMixedInvoice) hasServiceLines is true, but the product lines
          // covered by these receipts must still be matched here — the block already filters to
          // INVENTORY/CONSUMABLE lines, so SERVICE lines remain untouched and are handled on approval.
          if (purchaseOrderId && (!hasServiceLines || isMixedInvoice)) {
            const linkedReceipts = await tx.pOLineReceipt.findMany({
              where: { id: { in: receiptIds } },
              select: { poLineId: true },
            });

            const uniqueLineIds = [
              ...new Set(linkedReceipts.map((r) => r.poLineId)),
            ];

            if (uniqueLineIds.length > 0) {
              // Check if cumulative invoiced amount covers PO total
              const LINE_MATCH_TOLERANCE = 0.1;
              const poTotalForLines = Number(po.totalAmount);

              // Sum ALL invoices for this PO (excluding voided, the new one isn't committed yet)
              const allInvoicesForPO = await tx.invoice.aggregate({
                where: {
                  purchaseOrderId,
                  voidedAt: null,
                  status: {
                    notIn: ["VOIDED", "CANCELLED", "Voided", "Cancelled"],
                  },
                },
                _sum: { totalAmount: true },
              });
              // aggregate already includes the new invoice created earlier in this transaction
              const totalInvoiced = Number(allInvoicesForPO._sum.totalAmount);

              const shouldMatch =
                poTotalForLines > 0 &&
                totalInvoiced >= poTotalForLines * (1 - LINE_MATCH_TOLERANCE);

              if (shouldMatch) {
                await tx.pOLine.updateMany({
                  where: {
                    id: { in: uniqueLineIds },
                    purchaseOrderId,
                    lineType: { in: ["INVENTORY", "CONSUMABLE"] },
                  },
                  data: {
                    invoiceMatched: true,
                  },
                });
                logger.info(
                  `[Invoice Upload] Marked ${uniqueLineIds.length} INVENTORY/CONSUMABLE line(s) as invoiceMatched for PO ${purchaseOrderId} (invoiced $${totalInvoiced.toFixed(2)} vs PO total $${poTotalForLines.toFixed(2)})`,
                );
              } else {
                logger.info(
                  `[Invoice Upload] Skipping invoiceMatched for PO ${purchaseOrderId}: invoiced $${totalInvoiced.toFixed(2)} < PO total $${poTotalForLines.toFixed(2)} * ${(1 - LINE_MATCH_TOLERANCE).toFixed(2)}`,
                );
              }
            }
          }
        }

        // Create approval history
        await tx.invoiceApprovalHistory.create({
          data: {
            invoiceId: newInvoice.id,
            approverType: "FINANCE",
            approvedBy: uploadedBy,
            approvedByName: uploadedByName,
            action: "UPLOADED",
            comments: notes ?? undefined,
            previousStatus: null,
            newStatus: approvalStatus,
          },
        });

        // Create Document record if file was uploaded
        if (filePath && fileName && fileSize && mimeType) {
          await tx.document.create({
            data: {
              title: `Invoice ${invoiceNumber}`,
              description: `Invoice PDF for PO ${po.poNumber}`,
              fileName,
              filePath,
              fileSize,
              mimeType,
              documentType: "INVOICE",
              invoiceId: newInvoice.id,
              purchaseOrderId,
              uploadedById: uploadedBy,
              tags: ["invoice", "purchasing"],
            },
          });
        }

        return newInvoice;
      });
    } catch (error) {
      // P2002 = unique constraint violation. Determine WHICH constraint fired so we
      // give an accurate error instead of always blaming the vendor invoice number.
      // Constraints inside this transaction:
      //   1. Invoice.internalNumber @unique          ← counter out of sync
      //   2. @@unique([invoiceNumber, supplierId])   ← genuine vendor duplicate
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = error.meta?.target as string[] | string | undefined;
        const targetStr = Array.isArray(target)
          ? target.join(",")
          : (target ?? "");
        if (targetStr.includes("internalNumber")) {
          // Counter drift — log loudly so it gets fixed immediately
          logger.error(
            `[Invoice Upload] INTERNAL NUMBER COLLISION on "${invoiceNumber}": ` +
              `DocumentCounter INV is out of sync. Run fix-invoice-counter.js to repair.`,
          );
          throw new BadRequestError(
            "Invoice could not be saved: internal numbering sequence is out of sync. " +
              "Please contact your system administrator.",
          );
        }
        throw new BadRequestError(
          `Invoice number "${invoiceNumber}" already exists for this supplier. Each vendor invoice number must be unique per supplier.`,
        );
      }
      logger.error(
        `[Invoice Upload] Transaction failed for PO ${po.poNumber}: ${JSON.stringify(
          {
            errorName: error instanceof Error ? error.name : "Unknown",
            errorMessage:
              error instanceof Error ? error.message : String(error),
            errorStack:
              error instanceof Error
                ? error.stack?.split("\n").slice(0, 5).join("\n")
                : undefined,
            invoiceNumber,
            purchaseOrderId,
            hasServiceLines,
            approvalStatus,
            receiptIdsCount: receiptIds?.length ?? 0,
            lineIdsCount: lineIds?.length ?? 0,
          },
        )}`,
      );
      throw error;
    }

    logger.info(
      `[Invoice Upload] Invoice created successfully: ${invoice.id} (${invoice.internalNumber}) for PO ${po.poNumber}`,
    );

    // Create INVOICE_MATCH GL entries when:
    //   (a) receipts were matched during upload (standard product/inventory path), OR
    //   (b) the invoice was auto-approved as a supplemental charge on a fully-invoiced
    //       SERVICE PO (freight/tax/other — no receipts, no line IDs).
    //       The GL dims (accountCodeId, departmentId, projectId) are read from the PO's
    //       existing POLineChargeAllocation by createInvoiceMatchTransaction, so the
    //       supplemental charge is booked to the same cost centre as the main service.
    // M-024 fix: an auto-approved invoice on a PO that already carries an
    // un-cleared 2111 (Received-Not-Invoiced) accrual MUST clear it via the
    // standard INVOICE_MATCH path — even when no receiptIds were supplied at
    // upload. Previously such invoices were misrouted to the supplemental
    // branch (or skipped entirely), leaving 2111 / NAV 2302 permanently
    // inflated. createInvoiceMatchTransaction is idempotent, so this is safe.
    let poHas2111Accrual = false;
    if (purchaseOrderId) {
      const poReceiptIds = (
        await prisma.pOLineReceipt.findMany({
          where: {
            poLine: { purchaseOrderId },
            status: "ACTIVE",
            isReturn: false,
          },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (poReceiptIds.length > 0) {
        const accrual = await prisma.gLTransaction.findFirst({
          where: {
            referenceType: "POLineReceipt",
            referenceId: { in: poReceiptIds },
            status: "POSTED",
            lines: {
              some: {
                entryType: "CREDIT",
                glAccount: { accountNumber: "2111" },
              },
            },
          },
          select: { id: true },
        });
        poHas2111Accrual = accrual !== null;
      }
    }

    // True supplemental charge (freight/tax on a fully-invoiced SERVICE PO):
    // auto-approved, no receipts, no line IDs, and NO 2111 accrual to clear.
    const isSupplementalGLNeeded =
      invoice.approvalStatus === InvoiceApprovalStatus.FULLY_APPROVED &&
      (!receiptIds || receiptIds.length === 0) &&
      (!lineIds || lineIds.length === 0) &&
      !!purchaseOrderId &&
      po.lines.some((l) => l.lineType === "SERVICE") &&
      !poHas2111Accrual;

    // Auto-approved invoice whose PO has a 2111 accrual but no receiptIds were
    // passed at upload — still needs the standard 2111 clearing entry.
    const needsStandardRniClear =
      invoice.approvalStatus === InvoiceApprovalStatus.FULLY_APPROVED &&
      (!receiptIds || receiptIds.length === 0) &&
      !!purchaseOrderId &&
      poHas2111Accrual;

    if (
      (receiptIds && receiptIds.length > 0) ||
      isSupplementalGLNeeded ||
      needsStandardRniClear
    ) {
      try {
        const supplierData = await prisma.supplier.findUnique({
          where: { id: po.supplierId },
          select: { name: true },
        });

        if (isSupplementalGLNeeded) {
          // ── Supplemental charge: single EXPENDITURE step ─────────────────────────
          //
          // GLR-0032 (SERVICE receipt) posts DR expense / CR 2110 AP directly —
          // it does NOT route through 2111 AP-RNI. That means calling
          // createInvoiceMatchTransaction (GLR-0016, "clear RNI") AFTER this step
          // would post DR 2111 / CR 2110 against an empty 2111 (phantom entry) AND
          // double-credit 2110 (double AP liability). One EXPENDITURE step is the
          // complete and correct accounting entry for a supplemental service charge.

          // Fetch allocation dims (accountCodeId / departmentId / projectId / areaId)
          const allocation = await prisma.pOLineChargeAllocation.findFirst({
            where: {
              poLine: { purchaseOrderId },
              accountCodeId: { not: null },
            },
            select: {
              accountCodeId: true,
              departmentId: true,
              projectId: true,
              areaId: true,
            },
          });

          const budgetPeriod = await getCurrentBudgetPeriod(prisma);

          const ruleCtx = {
            amount: Number(invoice.totalAmount),
            accountCodeId: allocation?.accountCodeId ?? undefined,
            departmentId: allocation?.departmentId ?? undefined,
            projectId: allocation?.projectId ?? undefined,
            areaId: allocation?.areaId ?? undefined,
            poId: purchaseOrderId,
            poNumber: po.poNumber,
            supplierId: po.supplierId,
            supplierName: supplierData?.name ?? undefined,
            // Use invoice as the receipt reference — no POLineReceipt exists for a supplemental charge
            receiptId: invoice.id,
            receiptNumber: invoice.internalNumber,
            transactionDate: new Date(),
            referenceType: "Invoice" as const,
            referenceId: invoice.id,
            referenceNumber: invoice.internalNumber,
            itemType: "SERVICE" as const,
          };

          // Fire PO_RECEIPT_SVC: DR expense (6520) / CR 2110 AP  (same rule as service receipt)
          logger.info(
            `[Invoice Upload] Creating SERVICE_RECEIPT GL for supplemental charge on PO ${po.poNumber}`,
          );
          const ruleResult = await glRuleEngineService.evaluateRules(
            context,
            GLEventType.PO_RECEIPT_SVC,
            ruleCtx,
          );

          if (
            ruleResult.success &&
            ruleResult.matched &&
            ruleResult.isBalanced
          ) {
            const receiptGLId = await glTransactionService.createTransaction(
              context,
              {
                transactionDate: new Date(),
                fiscalPeriodId: budgetPeriod.id,
                transactionType: "EXPENDITURE",
                referenceType: "Invoice",
                referenceId: invoice.id,
                referenceNumber: invoice.internalNumber,
                description: `Supplemental charge: ${invoice.invoiceNumber} — PO ${po.poNumber} — ${supplierData?.name ?? ""}`,
                glTransactionRuleId: ruleResult.rule?.id,
                lines: ruleResult.entries.map((acc) => ({
                  ...acc,
                  accountCodeId: allocation?.accountCodeId ?? undefined,
                  departmentId: allocation?.departmentId ?? undefined,
                  projectId: allocation?.projectId ?? undefined,
                  areaId: allocation?.areaId ?? undefined,
                })),
              },
            );
            await glTransactionService.postTransaction(context, receiptGLId);
            logger.info(
              `[Invoice Upload] SERVICE_RECEIPT GL posted (${receiptGLId}) for supplemental charge`,
            );
          } else {
            logger.warn(
              `[Invoice Upload] PO_RECEIPT_SVC rule not matched for supplemental charge on PO ${po.poNumber} ` +
                `— no GL posted for this supplemental charge. Invoice remains FULLY_APPROVED.`,
            );
          }
          // No Step 2 (invoice match): GLR-0032 already credited 2110 directly.
          // GLR-0016 would debit 2111 (never credited) and double-credit 2110 — incorrect.
        } else {
          // ── Standard path: receipts were matched during upload ──────────────────
          // SUG-000005: for a MIXED invoice, clear only the PRODUCT portion of
          // 2111 here — the SERVICE portion books its own AP via the service
          // receipt on approval. Non-mixed invoices use the full total unchanged.
          const { isMixed, productPortion } =
            await InvoiceApprovalService.computeProductMatchPortion(
              invoice.id,
              Number(invoice.totalAmount),
            );
          logger.info(
            `[Invoice Upload] Creating INVOICE_MATCH GL for invoice ${invoice.id}, PO ${po.poNumber}` +
              (isMixed
                ? ` (mixed invoice — product portion $${productPortion.toFixed(2)} of $${Number(invoice.totalAmount).toFixed(2)})`
                : ""),
          );
          await invoiceGLService.createInvoiceMatchTransaction(context, {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: new Date(invoice.invoiceDate),
            totalAmount: Number(invoice.totalAmount),
            supplierId: po.supplierId,
            supplierName: supplierData?.name,
            purchaseOrderId,
            poNumber: po.poNumber,
            ...(isMixed ? { matchAmountOverride: productPortion } : {}),
          });
          logger.info(
            `[Invoice Upload] INVOICE_MATCH GL entries created successfully`,
          );
        }
      } catch (glError) {
        logger.error(
          `[Invoice Upload] GL error (non-fatal): ${JSON.stringify({
            errorName: glError instanceof Error ? glError.name : "Unknown",
            errorMessage:
              glError instanceof Error ? glError.message : String(glError),
            errorStack:
              glError instanceof Error
                ? glError.stack?.split("\n").slice(0, 5).join("\n")
                : undefined,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            poNumber: po.poNumber,
            supplierId: po.supplierId,
            isSupplementalGLNeeded,
          })}`,
        );
        // GL error logged but don't fail the upload operation
      }
    }

    // Sync linked requisition statuses after invoice upload/matching
    if (purchaseOrderId) {
      try {
        await requisitionStatusSyncService.syncRequisitionsForPO(
          purchaseOrderId,
        );
      } catch (syncError) {
        logger.error(
          `[Invoice Upload] Failed to sync requisition statuses: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
        );
      }
    }

    // Auto-close is handled exclusively by the 90-day inactivity cron job (po-auto-close.ts).
    // Event-driven auto-close was removed here.

    // B3-7: INVOICE_APPROVED notification (auto-approved)
    if (approvalStatus === InvoiceApprovalStatus.FULLY_APPROVED) {
      try {
        await notificationService.sendNotification(context, {
          userId: uploadedBy,
          type: PURCHASING_NOTIFICATIONS.INVOICE_APPROVED.type,
          category: NotificationCategory.PURCHASING,
          title: `Invoice ${invoice.invoiceNumber} Approved`,
          message: `Invoice ${invoice.invoiceNumber} for PO ${po.poNumber} has been auto-approved.`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/invoices`,
          actionLabel: "View Invoices",
          data: {
            invoiceNumber: invoice.invoiceNumber,
            invoiceId: invoice.id,
            poNumber: po.poNumber,
          },
        });
      } catch (notifError) {
        logger.error(
          "[B3-7] Failed to send invoice approved notification",
          notifError,
        );
      }
    }

    // B3-10: INVOICE_PENDING_REVIEW notification for finance team
    if (approvalStatus === InvoiceApprovalStatus.PENDING_REVIEW) {
      try {
        // Notify the uploader that their invoice requires finance review
        await notificationService.sendNotification(context, {
          userId: uploadedBy,
          type: PURCHASING_NOTIFICATIONS.INVOICE_PENDING_REVIEW.type,
          category: NotificationCategory.PURCHASING,
          title: `Invoice ${invoice.invoiceNumber} Requires Finance Review`,
          message: `Invoice ${invoice.invoiceNumber} for PO ${po.poNumber} has been flagged for finance review due to amount variance.`,
          priority: NotificationPriority.HIGH,
          actionUrl: `/purchasing/invoices`,
          actionLabel: "View Invoices",
          data: {
            invoiceNumber: invoice.invoiceNumber,
            invoiceId: invoice.id,
            poNumber: po.poNumber,
            variancePercent: 0,
          },
        });
      } catch (notifError) {
        logger.error(
          "[B3-10] Failed to send invoice pending review notification",
          notifError,
        );
      }
    }

    // Send notification to the designated approver when the invoice needs one.
    // Covers (a) service-line invoices, (b) prepayment-flagged invoices.
    // Priority: 1) Explicit approver chosen in Upload dialog, 2) PO-level invoice approver, 3) REQ approver from requisition
    let requestorNotified = false;
    if ((hasServiceLines || paymentApprovalRequired) && po.id) {
      // Determine who to notify
      let notifyUserId: string | null = null;

      if (explicitApprover && explicitApproverName) {
        // Finance explicitly chose an approver — use them directly
        notifyUserId = explicitApprover.id;
      } else if (po.invoiceApproverId) {
        // Use the PO-level invoice approver if set
        notifyUserId = po.invoiceApproverId;
      } else {
        // Fall back to auto-detection: find the REQ approver (the person who approved the requisition)
        const requisitions = await prisma.requisition.findMany({
          where: {
            lines: {
              some: {
                purchaseOrderId: po.id,
              },
            },
          },
          include: {
            requestedBy: true,
            approvals: {
              where: {
                status: "APPROVED",
              },
              include: {
                approver: true,
              },
              orderBy: {
                levelNumber: "desc", // Get highest-level approver
              },
              take: 1,
            },
          },
          take: 1,
        });

        // Use the REQ approver if available, otherwise fall back to REQ creator
        // (auto-approved REQs have no RequisitionApproval records)
        const requisition = requisitions[0];
        const requestor =
          requisition?.approvals[0]?.approver ?? requisition?.requestedBy;
        if (requestor) {
          notifyUserId = requestor.id;
        } else {
          logger.warn(
            `[InvoiceApproval] No requestor found for PO ${po.poNumber} (${po.id}) — ` +
              `invoice ${invoice.id} set to PENDING_REQUESTOR but no notification sent. ` +
              `Check if a requisition exists with lines linked to this PO.`,
          );
        }
      }

      if (notifyUserId) {
        const otherPending =
          await InvoiceApprovalService.getOtherPendingInvoicesForApprover(
            notifyUserId,
            invoice.id,
          );
        await notificationService.sendNotification(context, {
          userId: notifyUserId,
          type: PURCHASING_NOTIFICATIONS.INVOICE_APPROVAL_REQUIRED.type,
          category: NotificationCategory.PURCHASING,
          // Service invoices ALWAYS use the original "Invoice Approval
          // Required" title to preserve the established workflow naming.
          // Only non-service invoices flagged for prepayment get the new
          // pre-shipment title.
          title:
            paymentApprovalRequired && !hasServiceLines
              ? "Payment Approval Required (Pre-Shipment)"
              : "Invoice Approval Required",
          message:
            paymentApprovalRequired && !hasServiceLines
              ? `Invoice ${invoiceNumber} for PO ${po.poNumber} requires payment approval before goods ship${paymentApprovalReason ? `: ${paymentApprovalReason}` : ""}`
              : `Invoice ${invoiceNumber} for PO ${po.poNumber} requires your approval`,
          priority: NotificationPriority.HIGH,
          actionUrl: `/purchasing/invoices/${invoice.id}/approve`,
          actionLabel: "Review & Approve Invoice",
          data: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            vendorName: po.supplier.name,
            amount: totalAmount,
            currency: "USD",
            poNumber: po.poNumber,
            poId: po.id,
            otherPendingInvoices: otherPending,
          },
        });
        requestorNotified = true;
      }
    }
    // Non-service invoices do NOT need requestor approval — they are either auto-approved
    // (FULLY_APPROVED) or sent to finance review (PENDING_REVIEW).  Sending an
    // INVOICE_APPROVAL_REQUIRED notification for these would mislead users into thinking
    // an action is needed when none is required.

    return {
      invoice,
      matchStatus,
      approvalStatus,
      requestorNotified,
      message: paymentApprovalRequired
        ? "Prepayment invoice uploaded. Payment approval notification sent to approver."
        : hasServiceLines
          ? "Invoice uploaded successfully. Requestor notification sent."
          : approvalStatus === InvoiceApprovalStatus.FULLY_APPROVED
            ? "Invoice uploaded and auto-approved (amount within tolerance)."
            : "Invoice uploaded. Requires review — amount outside tolerance.",
      duplicateWarning,
    };
  }

  /**
   * Match invoice to receipts
   * Step 2: System matches invoice to receipts (can be partial for services)
   */
  static async matchInvoiceToReceipts(
    context: ServiceContext,
    invoiceId: string,
    receiptIds: string[],
    matchedBy: string,
    matchedByName: string,
  ): Promise<InvoiceMatchResult> {
    // Use existing matching service
    const matchResult =
      await InvoiceReceiptMatchingService.matchInvoiceToReceipts(
        invoiceId,
        receiptIds,
      );

    if (!matchResult.success) {
      throw new Error(
        matchResult.message ?? "Failed to match invoice to receipts",
      );
    }

    // B1-1: Determine match status based on dollar coverage, not just receipt count
    const MATCH_TOLERANCE = 0.1; // 10%
    let matchStatus: InvoiceMatchStatus = InvoiceMatchStatus.UNMATCHED;

    if (receiptIds.length > 0) {
      // Calculate total dollar amount of all linked receipts for this invoice
      const linkedReceipts = await prisma.pOLineReceipt.findMany({
        where: {
          invoiceId: invoiceId,
          status: "ACTIVE", // B5-7: Only consider active receipts for match calculations
        },
        select: { totalCost: true },
      });
      const totalReceiptDollars = linkedReceipts.reduce(
        (sum, r) => sum + Number(r.totalCost),
        0,
      );

      // Get the invoice's total amount
      const invoiceRecord = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { totalAmount: true },
      });
      const invoiceTotal =
        invoiceRecord != null ? Number(invoiceRecord.totalAmount) : 0;

      if (invoiceTotal > 0 && totalReceiptDollars > 0) {
        const coverage = totalReceiptDollars / invoiceTotal;
        if (coverage > 1 + MATCH_TOLERANCE) {
          // Receipt dollars exceed invoice total by > 10%
          matchStatus = InvoiceMatchStatus.OVER_MATCHED;
        } else if (coverage >= 1 - MATCH_TOLERANCE) {
          // Receipt dollars cover invoice total within 10% tolerance
          matchStatus = InvoiceMatchStatus.FULLY_MATCHED;
        } else {
          // Some receipts linked but coverage < 90%
          matchStatus = InvoiceMatchStatus.PARTIALLY_MATCHED;
        }
      } else if (totalReceiptDollars > 0) {
        matchStatus = InvoiceMatchStatus.PARTIALLY_MATCHED;
      }
      // else: no receipt dollars → stays UNMATCHED
    }

    // Update invoice match status
    const invoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        matchStatus,
        matchedAt: new Date(),
        matchedBy,
        matchedByName,
      },
      include: {
        purchaseOrder: {
          include: {
            lines: true,
          },
        },
        supplier: {
          select: { name: true },
        },
        receipts: true,
      },
    });

    // Create approval history
    await prisma.invoiceApprovalHistory.create({
      data: {
        invoiceId,
        approverType: "FINANCE",
        approvedBy: matchedBy,
        approvedByName: matchedByName,
        action: "MATCHED",
        comments: `Matched to ${receiptIds.length} receipt(s)`,
        previousStatus: invoice.approvalStatus,
        newStatus: invoice.approvalStatus,
      },
    });

    // Create INVOICE_MATCH GL entries.
    // SUG-000005: cap at the product portion for a MIXED invoice (service portion
    // books via the service receipt). No-op override for every non-mixed invoice.
    try {
      const { isMixed, productPortion } =
        await InvoiceApprovalService.computeProductMatchPortion(
          invoice.id,
          Number(invoice.totalAmount),
        );
      await invoiceGLService.createInvoiceMatchTransaction(context, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: new Date(invoice.invoiceDate),
        totalAmount: Number(invoice.totalAmount),
        supplierId: invoice.supplierId,
        supplierName: invoice.supplier.name,
        purchaseOrderId: invoice.purchaseOrderId ?? undefined,
        poNumber: invoice.purchaseOrder?.poNumber,
        ...(isMixed ? { matchAmountOverride: productPortion } : {}),
      });
    } catch (glError) {
      // Non-fatal: the match itself succeeds even if GL creation fails, but the
      // failure MUST be visible (it leaves 2111 un-cleared). Surfaced by the
      // daily AP/RNI health check.
      logger.error(
        `[Invoice Match] GL error creating INVOICE_MATCH entries (non-fatal): invoiceId=${invoice.id} internalNumber=${invoice.internalNumber} error=${glError instanceof Error ? glError.message : String(glError)}`,
      );
    }

    // Sync linked requisition statuses after invoice matching
    if (invoice.purchaseOrderId) {
      try {
        await requisitionStatusSyncService.syncRequisitionsForPO(
          invoice.purchaseOrderId,
        );
      } catch (syncError) {
        logger.error(
          `[Invoice Match] Failed to sync requisition statuses: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
        );
      }
    }

    return {
      invoice,
      matchedReceipts: invoice.receipts,
      matchStatus,
      approvalStatus: invoice.approvalStatus,
      requestorNotified: false,
      message: `Invoice matched to ${receiptIds.length} receipt(s)`,
    };
  }

  /**
   * Requestor approves invoice
   * Step 3: Requestor approves the invoice
   */
  static async requestorApprove(
    context: ServiceContext,
    invoiceId: string,
    input: RequestorApproveInternalInput,
  ): Promise<InvoiceApprovalResult> {
    const { approvedBy, approvedByName, comments } = input;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        purchaseOrder: {
          include: {
            lines: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    // Verify the current user is the designated approver (or has elevated role to override)
    if (
      invoice.requestorApprovedBy &&
      context.userId !== invoice.requestorApprovedBy
    ) {
      if (!InvoiceApprovalService.isElevatedApprovalRole(context.userRole)) {
        throw new Error("You are not the designated approver for this invoice");
      }
      // Elevated role override - this is acceptable but logged in the audit history
      logger.info(
        `[InvoiceApproval] Elevated role override: ${context.userName} (${context.userRole}) approving invoice ${invoiceId} designated for ${invoice.requestorApprovedByName}`,
      );
    }

    // If already approved, return success (idempotent operation)
    if (invoice.approvalStatus === InvoiceApprovalStatus.REQUESTOR_APPROVED) {
      return {
        invoice,
        approvalStatus: InvoiceApprovalStatus.REQUESTOR_APPROVED,
        unblockedLines: [],
        managerNotified: false,
        message: "Invoice is already approved.",
      };
    }

    // Only allow approval from PENDING_REQUESTOR status
    if (invoice.approvalStatus !== InvoiceApprovalStatus.PENDING_REQUESTOR) {
      throw new Error(
        `Invoice cannot be approved in current status: ${invoice.approvalStatus}`,
      );
    }

    // Update invoice (B1-4: sync status string with approvalStatus enum)
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        approvalStatus: InvoiceApprovalStatus.REQUESTOR_APPROVED,
        status:
          InvoiceApprovalService.syncInvoiceStatusFields("REQUESTOR_APPROVED")
            .status,
        requestorApprovedAt: new Date(),
        requestorApprovedBy: approvedBy,
        requestorApprovedByName: approvedByName,
        matchStatus: InvoiceMatchStatus.MATCH_APPROVED,
      },
    });

    // Create approval history
    await prisma.invoiceApprovalHistory.create({
      data: {
        invoiceId,
        approverType: "REQUESTOR",
        approvedBy,
        approvedByName,
        action: "APPROVED",
        comments,
        previousStatus: InvoiceApprovalStatus.PENDING_REQUESTOR,
        newStatus: InvoiceApprovalStatus.REQUESTOR_APPROVED,
      },
    });

    // Create INVOICE_MATCH GL entries on requestor approval.
    // For SERVICE-line POs the requestor approval IS the match confirmation —
    // receipts cannot exist before approval so the upload path never fires.
    // Non-fatal: log the error but do not fail the approval operation.
    try {
      const supplierRecord = await prisma.supplier.findUnique({
        where: { id: invoice.supplierId },
        select: { name: true },
      });
      // SUG-000005: for a MIXED invoice the product portion was already cleared
      // through INVOICE_MATCH at upload (idempotent), and the service portion
      // books via the service receipt below — so cap this call at the product
      // portion too. Idempotency makes this a no-op when upload already posted,
      // but it keeps the amount correct for any path where approval fires first.
      const { isMixed, productPortion } =
        await InvoiceApprovalService.computeProductMatchPortion(
          invoice.id,
          Number(invoice.totalAmount),
        );
      await invoiceGLService.createInvoiceMatchTransaction(context, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: new Date(invoice.invoiceDate),
        totalAmount: Number(invoice.totalAmount),
        supplierId: invoice.supplierId,
        supplierName: supplierRecord?.name,
        purchaseOrderId: invoice.purchaseOrderId ?? undefined,
        poNumber: invoice.purchaseOrder?.poNumber,
        ...(isMixed ? { matchAmountOverride: productPortion } : {}),
      });
      logger.info(
        `[InvoiceApproval] INVOICE_MATCH GL entries created for invoice ${invoice.internalNumber}`,
      );
    } catch (glError) {
      logger.error(
        `[InvoiceApproval] GL error creating INVOICE_MATCH entries (non-fatal): invoiceId=${invoice.id} internalNumber=${invoice.internalNumber} error=${glError instanceof Error ? glError.message : String(glError)}`,
      );
    }

    // Detect closed PO early — drives several guards below.
    // For Closed POs the work is already done; this invoice is a late charge
    // arriving after closure. We approve it for GL/AP tracking but skip all
    // receive-gating logic (canReceive, approvedInvoiceAmount, auto-receive).
    const isPOClosed = invoice.purchaseOrder?.status === "Closed";

    // Update PO lines to allow service receipt and set approved invoice amount
    let unblockedLines: Prisma.POLineGetPayload<object>[] = [];
    // lineAmountMap holds the M-027 rescaled per-line dollar amounts. It is
    // populated inside the `if (invoice.purchaseOrderId)` block below but is
    // ALSO read by the auto-receive path further down (outside that block), so
    // it must live at function scope alongside unblockedLines. Declaring it as a
    // block-scoped const previously caused `ReferenceError: lineAmountMap is not
    // defined`, which silently broke auto-receive on every invoice approval.
    let lineAmountMap = new Map<string, number>();
    if (invoice.purchaseOrderId) {
      // B1-2: Get the specific PO lines that this invoice covers via InvoiceLineItem junction
      const invoiceLineItems = await prisma.invoiceLineItem.findMany({
        where: { invoiceId: invoice.id },
        include: { poLine: true },
      });

      // Filter to only SERVICE lines that this invoice actually covers
      const invoicedServiceLines = invoiceLineItems
        .filter((ili) => ili.poLine.lineType === "SERVICE")
        .map((ili) => ili.poLine);

      // Guard: if this PO has service lines but we have no InvoiceLineItem records,
      // something went wrong at upload time — fail loudly instead of silently no-opping.
      // EXCEPTION: prepayment invoices never have InvoiceLineItems because the work
      // hasn't been performed yet (that's the whole point). For prepay, we skip the
      // "open canReceive" step — real receive-after-approval still waits for a
      // proper invoice with lineIds later.
      // EXCEPTION: Closed POs — late invoices may not have InvoiceLineItem records
      // if the line was not specified at upload time. We never need to open canReceive
      // on a Closed PO so the guard is irrelevant.
      if (
        invoicedServiceLines.length === 0 &&
        !invoice.paymentApprovalRequired &&
        !isPOClosed
      ) {
        const poServiceLines =
          invoice.purchaseOrder?.lines.filter(
            (line) => line.lineType === "SERVICE",
          ) ?? [];
        if (poServiceLines.length > 0 && invoiceLineItems.length === 0) {
          throw new Error(
            `Invoice ${invoice.invoiceNumber} has no line item records but PO ${invoice.purchaseOrder?.poNumber} has ` +
              `${poServiceLines.length} service line(s). The invoice was uploaded without specifying which ` +
              `service lines it covers. Please void this invoice and re-upload, selecting the service lines ` +
              `this invoice applies to.`,
          );
        }
      }

      // Use the per-line amount stored on the InvoiceLineItem junction record.
      // This was set at upload time from the user-specified lineAmounts (exact
      // per-line values from the invoice PDF) or an equal split as fallback.
      // Using InvoiceLineItem.totalAmount here ensures the receiving gate
      // (POLine.approvedInvoiceAmount) reflects exactly what the vendor invoiced
      // per line — not a proportional guess based on the PO line's totalPrice.
      const invoiceAmount = Number(updatedInvoice.totalAmount);

      // Build a map of lineId → allocatedAmount from the InvoiceLineItem records.
      // Fall back to proportional distribution if no junction amounts exist (legacy data).
      // Assigns to the function-scoped lineAmountMap declared above so the
      // auto-receive path below can read the rescaled values.
      lineAmountMap = new Map<string, number>(
        invoiceLineItems
          .filter((ili) => ili.poLine.lineType === "SERVICE")
          .map((ili) => [ili.poLine.id, Number(ili.totalAmount)]),
      );

      // Proportional fallback: if all InvoiceLineItem.totalAmount are 0 or missing,
      // distribute proportionally by PO line totalPrice (old behavior — safe for
      // invoices created before this change).
      const junctionTotal = Array.from(lineAmountMap.values()).reduce(
        (s, v) => s + v,
        0,
      );
      if (junctionTotal === 0 && invoicedServiceLines.length > 0) {
        const totalLineValue = invoicedServiceLines.reduce(
          (sum, line) => sum + Number(line.totalPrice),
          0,
        );
        for (const line of invoicedServiceLines) {
          const proportion =
            totalLineValue > 0
              ? Number(line.totalPrice) / totalLineValue
              : 1 / invoicedServiceLines.length;
          lineAmountMap.set(line.id, invoiceAmount * proportion);
        }
      }

      // Defense-in-depth: ensure lineAmountMap values never sum to more than
      // invoiceAmount. If InvoiceLineItem.totalAmount was stored incorrectly
      // at upload time (e.g. the full PO line price instead of the partial
      // invoice amount), this rescales proportionally so approvedInvoiceAmount
      // and the auto-receive quantityReceived are always capped at the real
      // invoice total (M-027 fix).
      const mapTotal = Array.from(lineAmountMap.values()).reduce(
        (s, v) => s + v,
        0,
      );
      if (mapTotal > invoiceAmount * 1.001 && mapTotal > 0) {
        for (const [lineId, amt] of lineAmountMap.entries()) {
          lineAmountMap.set(lineId, (amt / mapTotal) * invoiceAmount);
        }
        logger.warn(
          `[InvoiceApproval] lineAmountMap sum ($${mapTotal.toFixed(2)}) exceeded ` +
            `invoice total ($${invoiceAmount.toFixed(2)}) for invoice ` +
            `${invoice.internalNumber} — rescaled to invoice total. ` +
            `InvoiceLineItem.totalAmount was likely stored as the PO line price at upload.`,
        );
      }

      for (const line of invoicedServiceLines) {
        if (isPOClosed) {
          // Closed PO: mark invoiceMatched for AP tracking only.
          // Do NOT set canReceive or increment approvedInvoiceAmount — the work
          // was already completed and received (or the PO was closed) before
          // this late invoice arrived. Opening receive gates on a Closed PO
          // would be incorrect and would break assertPOIsOpenForGL downstream.
          await prisma.pOLine.update({
            where: { id: line.id },
            data: { invoiceMatched: true },
          });
        } else {
          const allocatedAmount = lineAmountMap.get(line.id) ?? 0;
          await prisma.pOLine.update({
            where: { id: line.id },
            data: {
              invoiceMatched: true,
              canReceive: true,
              approvedInvoiceAmount: { increment: allocatedAmount },
            },
          });
        }
      }

      // Get the updated lines for the invoiced service lines only
      // (used by auto-receive path; empty for Closed POs since we skip receive)
      if (!isPOClosed) {
        const invoicedServiceLineIds = invoicedServiceLines.map((l) => l.id);
        unblockedLines = await prisma.pOLine.findMany({
          where: {
            id: { in: invoicedServiceLineIds },
          },
        });
      }
    }

    // Fetch supplier name for notifications / auto-receive context
    let supplierNameForNotif = "";
    try {
      const supplierRecord = await prisma.supplier.findUnique({
        where: { id: invoice.supplierId },
        select: { name: true },
      });
      supplierNameForNotif = supplierRecord?.name ?? "";
    } catch {
      // non-fatal
    }

    // Check whether Finance has enabled the service auto-receive bypass.
    // Reading from DB here (not cached) so the setting takes effect immediately
    // after toggling without requiring a server restart.
    let serviceAutoReceiveEnabled = false;
    try {
      const finSettings = await financeSettingsService.getSettings(context);
      serviceAutoReceiveEnabled = finSettings.serviceAutoReceiveEnabled;
    } catch (settingsError) {
      logger.warn(
        "[InvoiceApproval] Could not read finance settings for auto-receive check — defaulting to manual receive",
        settingsError,
      );
    }

    let managerNotified = false;

    if (isPOClosed) {
      // ── CLOSED PO LATE-INVOICE PATH ──────────────────────────────────────────
      // PO was already closed before this invoice arrived. The invoice match GL
      // was created above (non-fatal). No receipt needs to be created and no
      // inventory manager notification is needed.
      logger.info(
        `[InvoiceApproval] Late invoice approved on Closed PO — skipping auto-receive and ` +
          `SERVICE_RECEIPT_READY notification. Invoice ${invoice.internalNumber} (${invoice.invoiceNumber}) ` +
          `PO ${invoice.purchaseOrder?.poNumber ?? invoice.purchaseOrderId ?? "unknown"}. ` +
          `Invoice match GL was created above (non-fatal path).`,
      );
    }

    // Capture original intent before the auto-receive block.
    // Failures inside that block must NOT flip this — if Finance turned on
    // auto-receive, the IM is not responsible for manually receiving on failure.
    const autoReceiveIntended = serviceAutoReceiveEnabled;

    if (
      !isPOClosed &&
      serviceAutoReceiveEnabled &&
      invoice.purchaseOrderId &&
      unblockedLines.length > 0
    ) {
      // ── AUTO-RECEIVE PATH ────────────────────────────────────────────────────
      // Finance has enabled auto-receive. Build a receive batch from the
      // InvoiceLineItem records that were already fetched and used to set
      // approvedInvoiceAmount per line. Each line's InvoiceLineItem.totalAmount
      // is the exact dollar amount Finance entered at upload time.
      //
      // The context used is an elevated copy of the approver's context with
      // userRole=ADMIN so that the receiving service's permission check passes.
      // This is a trusted server-side operation — the user has already been
      // authenticated and authorised to approve the invoice.
      try {
        // Re-fetch the invoiceLineItems we already used above (they may be out
        // of scope here). We scope to SERVICE lines only.
        const serviceLineItems = (
          await prisma.invoiceLineItem.findMany({
            where: { invoiceId: invoice.id },
            include: { poLine: true },
          })
        ).filter((ili) => ili.poLine.lineType === "SERVICE");

        if (serviceLineItems.length > 0) {
          const now = new Date();
          const receiveItems = serviceLineItems.map((ili) => ({
            lineType: "SERVICE" as const,
            itemId: ili.poLineId,
            // SERVICE quantity = dollar amount (qty × $1 = totalCost).
            // IMPORTANT: use lineAmountMap (already M-027 rescaled in-memory) instead
            // of ili.totalAmount (raw DB value). The M-027 rescaling caps the per-line
            // amount at the real invoice total — but only in-memory. If we re-read
            // ili.totalAmount from DB here we bypass that cap entirely, which is exactly
            // the bug that caused over-stated receipts when Finance entered the remaining
            // PO balance as the invoice amount instead of the actual invoice amount.
            quantityReceived:
              lineAmountMap.get(ili.poLineId) ?? Number(ili.totalAmount),
            receivedBy: approvedBy,
            receivedByName: approvedByName,
            receivedAt: now,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate,
            serviceDate: now,
            serviceProvider: supplierNameForNotif || null,
            hoursOrUnits:
              lineAmountMap.get(ili.poLineId) ?? Number(ili.totalAmount),
            completionNotes: `Auto-received on approval of invoice ${invoice.invoiceNumber}`,
            qualityRating: null,
            documentNumber: invoice.invoiceNumber,
            notes: null,
            isReturn: false,
            originalReceiptId: null,
          }));

          // Build a service-account context for the auto-receive call.
          // - userId / userName are kept from the approver so the log entry
          //   shows who triggered the receive (audit trail).
          // - permissions is replaced with AUTO_RECEIVE_SERVICE_PERMISSIONS —
          //   a fixed minimal set that passes the purchasing:update gate in
          //   batchReceive regardless of the approver's role. This means any
          //   user (Finance Approver, Requestor, Manager, etc.) can approve
          //   a service invoice and the GR is always created automatically.
          // - The receipt's receivedBy / receivedByName come from the
          //   receiveItems payload (set to approvedBy / approvedByName above),
          //   so the PO receipt log correctly shows the approver, not a
          //   generic service account.
          const elevatedCtx: ServiceContext = {
            ...context,
            userRole: RoleName.ADMIN,
            permissions: AUTO_RECEIVE_SERVICE_PERMISSIONS,
          };

          const receiveResult = await lineItemReceivingService.batchReceive(
            elevatedCtx,
            invoice.purchaseOrderId,
            {
              items: receiveItems,
              notes: `Auto-received on invoice approval by ${approvedByName}`,
              freightCost: 0,
              capitalizeFreight: false,
            },
          );

          if (receiveResult.success) {
            logger.info(
              `[InvoiceApproval] Auto-receive SUCCEEDED for invoice ${invoice.internalNumber}: ` +
                `${receiveResult.receipts.length} line(s) received, total $${receiveResult.totalCost.toFixed(2)}`,
              {
                invoiceId,
                poId: invoice.purchaseOrderId,
                receiptCount: receiveResult.receipts.length,
              },
            );
          } else {
            // Partial failure — log errors. IM notification is NOT sent when
            // auto-receive is enabled (autoReceiveIntended=true).
            logger.error(
              `[InvoiceApproval] Auto-receive PARTIAL FAILURE for invoice ${invoice.internalNumber}: ` +
                `${receiveResult.errors.length} error(s). Auto-receive was enabled — IM will NOT be notified.`,
              { invoiceId, errors: receiveResult.errors },
            );
            // Auto-receive failed — log only. Do NOT flip autoReceiveIntended;
            // the IM is not responsible for fixing a system-side receive failure.
          }
        }
      } catch (autoReceiveError) {
        logger.error(
          `[InvoiceApproval] Auto-receive FAILED for invoice ${invoice.internalNumber}. ` +
            `Auto-receive was enabled — IM will NOT be notified. Review server logs for root cause.`,
          {
            invoiceId,
            error:
              autoReceiveError instanceof Error
                ? autoReceiveError.message
                : String(autoReceiveError),
          },
        );
        // Auto-receive threw — log only. Do NOT flip autoReceiveIntended;
        // the IM is not responsible for fixing a system-side receive failure.
      }
    }

    if (!isPOClosed && !autoReceiveIntended) {
      // ── MANUAL RECEIVE PATH (default) ────────────────────────────────────────
      // Send SERVICE_RECEIPT_READY notification to Inventory Managers so they
      // know to go to the receiving page and record the receipt manually.
      // Only fires when auto-receive was NOT enabled at call time — failures
      // in the auto-receive path never trigger this (IM can't fix them).
      // "System Administrator" is a ghost name — map to RoleName.Admin
      const inventoryManagers = await prisma.user.findMany({
        where: {
          role: {
            name: {
              in: [RoleName.INVENTORY_MANAGER, RoleName.ADMIN],
            },
          },
          isActive: true,
        },
      });

      for (const manager of inventoryManagers) {
        try {
          await notificationService.sendNotification(context, {
            userId: manager.id,
            type: PURCHASING_NOTIFICATIONS.SERVICE_RECEIPT_READY.type,
            category: NotificationCategory.PURCHASING,
            title: `Service Receipt Ready: PO ${invoice.purchaseOrder?.poNumber ?? ""}`,
            message: `Invoice ${invoice.invoiceNumber} approved by requestor — service line(s) on PO ${invoice.purchaseOrder?.poNumber} can now be received.`,
            priority: NotificationPriority.HIGH,
            actionUrl: `/purchasing/purchase-orders/${invoice.purchaseOrderId}`,
            actionLabel: "Receive Services",
            data: {
              invoiceId,
              invoiceNumber: invoice.invoiceNumber,
              purchaseOrderId: invoice.purchaseOrderId,
              poNumber: invoice.purchaseOrder?.poNumber,
              vendorName: supplierNameForNotif,
              invoiceAmount: Number(invoice.totalAmount),
              currency: "USD",
              approvedBy: approvedByName,
            },
          });
          managerNotified = true;
        } catch (_notificationError) {
          logger.error(
            "[InvoiceApproval] Failed to send service receipt ready notification",
            _notificationError,
          );
          // Continue with approval even if notification fails
        }
      }
    }

    // Auto-close is handled exclusively by the 90-day inactivity cron job (po-auto-close.ts).
    // Event-driven auto-close was removed here.

    // B3-7: INVOICE_APPROVED notification (service invoice approved by requestor)
    try {
      const invoiceCreatorId = invoice.uploadedBy;
      if (invoiceCreatorId) {
        await notificationService.sendNotification(context, {
          userId: invoiceCreatorId,
          type: PURCHASING_NOTIFICATIONS.INVOICE_APPROVED.type,
          category: NotificationCategory.PURCHASING,
          title: `Invoice ${invoice.invoiceNumber} Approved`,
          message: `Invoice ${invoice.invoiceNumber} for PO ${invoice.purchaseOrder?.poNumber} has been approved by the requestor.`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/invoices`,
          actionLabel: "View Invoices",
          data: {
            invoiceNumber: invoice.invoiceNumber,
            invoiceId: invoice.id,
            poNumber: invoice.purchaseOrder?.poNumber ?? "",
          },
        });
      }
    } catch (notifError) {
      logger.error(
        "[B3-7] Failed to send invoice approved notification (requestor approve)",
        notifError,
      );
    }

    return {
      invoice: updatedInvoice,
      approvalStatus: InvoiceApprovalStatus.REQUESTOR_APPROVED,
      unblockedLines,
      managerNotified,
      message: "Invoice approved successfully. Service lines unblocked.",
    };
  }

  /**
   * Requestor rejects invoice (or places on hold)
   * Step 3 (alternate): Requestor rejects the invoice
   *
   * @param isApproverHold - When true, the assigned approver is disputing/holding
   *   the invoice (not a full finance rejection). Sets display status to "On Hold"
   *   and preserves the invoice number for potential resubmission.
   */
  static async requestorReject(
    context: ServiceContext,
    invoiceId: string,
    input: RequestorRejectInternalInput,
    isApproverHold = false,
  ): Promise<InvoiceRejectionResult> {
    const { rejectedBy, rejectedByName, reason } = input;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        purchaseOrder: true,
      },
    });

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    // Verify the current user is the designated approver (or has elevated role to override)
    if (
      invoice.requestorApprovedBy &&
      context.userId !== invoice.requestorApprovedBy
    ) {
      if (!InvoiceApprovalService.isElevatedApprovalRole(context.userRole)) {
        throw new Error("You are not the designated approver for this invoice");
      }
      // Elevated role override - this is acceptable but logged in the audit history
      logger.info(
        `[InvoiceApproval] Elevated role override: ${context.userName} (${context.userRole}) rejecting invoice ${invoiceId} designated for ${invoice.requestorApprovedByName}`,
      );
    }

    if (invoice.approvalStatus !== InvoiceApprovalStatus.PENDING_REQUESTOR) {
      throw new Error(
        `Invoice cannot be rejected in current status: ${invoice.approvalStatus}`,
      );
    }

    // Determine display status and invoice number handling based on hold vs reject.
    // Approver hold: keep original invoice number (can be resubmitted), display "On Hold".
    // Finance/admin rejection: rename invoice number to free it, display "Rejected".
    const displayStatus = isApproverHold
      ? InvoiceDisplayStatus.ON_HOLD
      : InvoiceApprovalService.syncInvoiceStatusFields("REQUESTOR_REJECTED")
          .status;

    const invoiceNumberUpdate = isApproverHold
      ? invoice.invoiceNumber // preserve original number for on-hold invoices
      : invoice.invoiceNumber.includes("-REJECTED-")
        ? invoice.invoiceNumber // already suffixed — don't double-suffix
        : `${invoice.invoiceNumber}-REJECTED-${Date.now()}`;

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        approvalStatus: InvoiceApprovalStatus.REQUESTOR_REJECTED,
        status: displayStatus,
        requestorRejectedAt: new Date(),
        requestorRejectionReason: reason,
        invoiceNumber: invoiceNumberUpdate,
      },
    });

    // Create approval history
    const historyAction = isApproverHold ? "HOLD" : "REJECTED";
    await prisma.invoiceApprovalHistory.create({
      data: {
        invoiceId,
        approverType: "REQUESTOR",
        approvedBy: rejectedBy,
        approvedByName: rejectedByName,
        action: historyAction,
        comments: isApproverHold ? `[On Hold] ${reason}` : reason,
        previousStatus: InvoiceApprovalStatus.PENDING_REQUESTOR,
        newStatus: InvoiceApprovalStatus.REQUESTOR_REJECTED,
      },
    });

    // Reverse any INVOICE_MATCH GL entries that were posted during upload/matching
    // (only for full rejections — on-hold invoices may be resubmitted)
    if (!isApproverHold) {
      try {
        const { glReversalService } =
          await import("@/services/gl/gl-reversal.service");

        const invoiceGLTransactions = await prisma.gLTransaction.findMany({
          where: {
            referenceType: "Invoice",
            referenceId: invoice.id,
            status: "POSTED",
          },
        });

        for (const glTxn of invoiceGLTransactions) {
          await glReversalService.reverseTransaction(
            glTxn.id,
            `Invoice ${invoice.invoiceNumber} rejected by requestor: ${reason}`,
            context.userId,
          );
        }

        if (invoiceGLTransactions.length > 0) {
          logger.info(
            `[Invoice Reject] Reversed ${invoiceGLTransactions.length} GL transaction(s) for invoice ${invoice.id}`,
          );
        }
      } catch (glError) {
        logger.error(
          `[Invoice Reject] GL reversal failed for invoice ${invoice.id}: ${glError instanceof Error ? glError.message : String(glError)}`,
        );
        // Non-fatal — don't fail the rejection
      }
    }

    // Notify finance team
    let financeNotified = false;
    const notifTitle = isApproverHold ? "Invoice On Hold" : "Invoice Rejected";
    const notifMessage = isApproverHold
      ? `Invoice ${invoice.invoiceNumber} has been placed on hold by approver: ${reason}`
      : `Invoice ${invoice.invoiceNumber} was rejected by requestor: ${reason}`;

    if (invoice.uploadedBy) {
      await notificationService.sendNotification(context, {
        userId: invoice.uploadedBy,
        type: PURCHASING_NOTIFICATIONS.INVOICE_REJECTED.type,
        category: NotificationCategory.PURCHASING,
        title: notifTitle,
        message: notifMessage,
        priority: NotificationPriority.HIGH,
        actionUrl: `/purchasing/invoices/${invoiceId}`,
        actionLabel: "View Invoice",
        data: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          poNumber: invoice.purchaseOrder?.poNumber ?? "",
          poId: invoice.purchaseOrderId ?? "",
        },
      });
      financeNotified = true;
    }

    return {
      invoice: updatedInvoice,
      approvalStatus: InvoiceApprovalStatus.REQUESTOR_REJECTED,
      financeNotified,
      message: isApproverHold
        ? "Invoice placed on hold. Finance team notified."
        : "Invoice rejected. Finance team notified.",
    };
  }

  /**
   * B1-5: Resubmit a rejected invoice for re-approval.
   * Transitions: REQUESTOR_REJECTED → PENDING_REQUESTOR
   */
  static async resubmitInvoice(
    invoiceId: string,
    ctx: ServiceContext,
    data: { notes?: string | null },
  ): Promise<Invoice> {
    // 1. Find the invoice, verify it exists
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        purchaseOrder: {
          select: { poNumber: true, id: true },
        },
      },
    });

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    // 2. Verify current approvalStatus is 'REQUESTOR_REJECTED'
    if (invoice.approvalStatus !== InvoiceApprovalStatus.REQUESTOR_REJECTED) {
      throw new Error(
        `Invoice cannot be resubmitted in current status: ${invoice.approvalStatus}. Only rejected invoices can be resubmitted.`,
      );
    }

    const previousStatus = invoice.approvalStatus;

    // 3. Update approvalStatus to 'PENDING_REQUESTOR'
    // 4. Use the syncInvoiceStatusFields() helper to also update status string
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        approvalStatus: InvoiceApprovalStatus.PENDING_REQUESTOR,
        status:
          InvoiceApprovalService.syncInvoiceStatusFields("PENDING_REQUESTOR")
            .status,
      },
    });

    // 5. Create an audit history entry
    await prisma.invoiceApprovalHistory.create({
      data: {
        invoiceId,
        approverType: "FINANCE",
        approvedBy: ctx.userId,
        approvedByName: ctx.userName,
        action: "RESUBMITTED",
        comments: data.notes ?? "Invoice resubmitted for re-approval",
        previousStatus,
        newStatus: InvoiceApprovalStatus.PENDING_REQUESTOR,
      },
    });

    // 6. Log the resubmission
    logger.info(
      `[Invoice Resubmit] Invoice ${invoiceId} (${invoice.invoiceNumber}) resubmitted by ${ctx.userName} (${ctx.userId}). ` +
        `Status: ${previousStatus} → PENDING_REQUESTOR`,
    );

    // 7. Send notification to the designated approver
    if (invoice.requestorApprovedBy) {
      try {
        const [otherPending, supplierRecord] = await Promise.all([
          InvoiceApprovalService.getOtherPendingInvoicesForApprover(
            invoice.requestorApprovedBy,
            invoice.id,
          ),
          invoice.supplierId
            ? prisma.supplier.findUnique({
                where: { id: invoice.supplierId },
                select: { name: true },
              })
            : Promise.resolve(null),
        ]);
        await notificationService.sendNotification(ctx, {
          userId: invoice.requestorApprovedBy,
          type: PURCHASING_NOTIFICATIONS.INVOICE_APPROVAL_REQUIRED.type,
          category: NotificationCategory.PURCHASING,
          title: "Invoice Approval Required (Resubmitted)",
          message: `Invoice ${invoice.invoiceNumber} for PO ${invoice.purchaseOrder?.poNumber ?? "N/A"} has been resubmitted for your approval.`,
          priority: NotificationPriority.HIGH,
          actionUrl: `/purchasing/invoices/${invoice.id}/approve`,
          actionLabel: "Review & Approve Invoice",
          data: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            vendorName: supplierRecord?.name ?? "",
            amount: Number(invoice.totalAmount),
            currency: "USD",
            poNumber: invoice.purchaseOrder?.poNumber ?? "",
            poId: invoice.purchaseOrderId ?? "",
            otherPendingInvoices: otherPending,
          },
        });
      } catch (notifError) {
        logger.error(
          `[Invoice Resubmit] Failed to send notification for invoice ${invoiceId}: ${notifError instanceof Error ? notifError.message : String(notifError)}`,
        );
      }
    }

    // 8. Return the updated invoice
    return updatedInvoice;
  }

  /**
   * Check if a role should see all pending invoices (not filtered by requestor).
   * Admin, Manager, and MaintenanceManager can see all.
   */
  private static isElevatedApprovalRole(userRole?: string): boolean {
    if (!userRole) return false;
    // Compare against canonical RoleName enum values (exact match, case-insensitive)
    const elevatedRoles: string[] = [
      RoleName.ADMIN,
      RoleName.MANAGER,
      RoleName.MAINTENANCE_MANAGER,
    ];
    return elevatedRoles.some(
      (role) => role.toLowerCase() === userRole.toLowerCase(),
    );
  }

  /**
   * Get invoices pending approval for a user.
   * All users (including elevated roles) see only invoices personally assigned to them
   * or linked to POs from requisitions they created or approved.
   * This powers the "My Approvals" banner — it is intentionally personal/scoped.
   */
  static async getPendingApprovalsForUser(
    userId: string,
    _userRole?: string,
  ): Promise<InvoiceWithApprovalRelations[]> {
    // Single query: find all requisitions where the user is creator OR an approver.
    // Capped at 500 to avoid unbounded scans on large installations.
    const userRequisitions = await prisma.requisition.findMany({
      where: {
        OR: [
          { requestedById: userId },
          {
            approvals: {
              some: { approverId: userId, status: "APPROVED" },
            },
          },
        ],
      },
      select: { purchaseOrderId: true },
      take: 500,
    });

    const poIds = [
      ...new Set(
        userRequisitions
          .map((r) => r.purchaseOrderId)
          .filter((id): id is string => id !== null),
      ),
    ];

    // Single query: find PENDING_REQUESTOR invoices for those POs OR directly
    // assigned to this user. Capped at 100 — the "My Approvals" panel is a
    // compact list; bulk review goes through the main table.
    // Heavy relations (PO lines, receipts, approval history) are excluded here
    // because the list view does not render them. receipts/approvalHistory are
    // returned as empty arrays to satisfy the InvoiceWithApprovalRelations type.
    const invoices = await prisma.invoice.findMany({
      where: {
        approvalStatus: InvoiceApprovalStatus.PENDING_REQUESTOR,
        OR: [
          ...(poIds.length > 0 ? [{ purchaseOrderId: { in: poIds } }] : []),
          { requestorApprovedBy: userId },
        ],
      },
      include: {
        // Full supplier row — small, needed for display name/code.
        supplier: true,
        // PO row only — no nested lines/receipts/approvals. The PO itself is
        // a single row (~30 scalar columns) and is needed for poNumber display.
        purchaseOrder: true,
        // receipts and approvalHistory are required by InvoiceWithApprovalRelations
        // but not needed for the list view — fetch zero rows to satisfy the type.
        receipts: { take: 0 },
        approvalHistory: { take: 0 },
      },
      orderBy: { uploadedAt: "desc" },
      take: 100,
    });

    return invoices as unknown as InvoiceWithApprovalRelations[];
  }

  /**
   * Get invoice approval history
   */
  static getApprovalHistory(invoiceId: string) {
    return prisma.invoiceApprovalHistory.findMany({
      where: {
        invoiceId,
      },
      orderBy: {
        approvedAt: "asc",
      },
    });
  }

  /**
   * Check if PO line can be received (for services)
   */
  static async canReceivePOLine(
    poLineId: string,
  ): Promise<ServiceLineReceiptValidation> {
    const poLine = await prisma.pOLine.findUnique({
      where: { id: poLineId },
      include: {
        purchaseOrder: {
          include: {
            invoices: {
              where: {
                approvalStatus: {
                  in: [
                    InvoiceApprovalStatus.REQUESTOR_APPROVED,
                    // B1-6: MANAGER_APPROVED removed — dead enum value
                    InvoiceApprovalStatus.FULLY_APPROVED,
                  ],
                },
              },
            },
          },
        },
      },
    });

    if (!poLine) {
      return {
        canReceive: false,
        poLineId,
        lineType: "UNKNOWN",
        requiresInvoiceMatch: false,
        invoiceMatched: false,
        blockReason: "PO line not found",
        invoice: null,
      };
    }

    // Inventory and consumables can always be received
    if (poLine.lineType !== "SERVICE") {
      return {
        canReceive: true,
        poLineId,
        lineType: poLine.lineType,
        requiresInvoiceMatch: false,
        invoiceMatched: false,
        invoice: null,
      };
    }

    // Services require invoice approval
    const canReceive = poLine.invoiceMatched && poLine.canReceive;
    const approvedInvoice = poLine.purchaseOrder.invoices[0];

    return {
      canReceive,
      poLineId,
      lineType: poLine.lineType,
      requiresInvoiceMatch: true,
      invoiceMatched: poLine.invoiceMatched,
      blockReason: !canReceive
        ? "Service line requires approved invoice before receipt"
        : undefined,
      invoice: approvedInvoice
        ? {
            id: approvedInvoice.id,
            invoiceNumber: approvedInvoice.invoiceNumber,
            approvalStatus: approvedInvoice.approvalStatus,
          }
        : null,
    };
  }

  /**
   * Get service lines that cannot be received (no approved invoice)
   */
  static async getBlockedServiceLines(
    purchaseOrderId: string,
  ): Promise<BlockedServiceLine[]> {
    const lines = await prisma.pOLine.findMany({
      where: {
        purchaseOrderId,
        lineType: "SERVICE",
        invoiceMatched: false,
      },
      include: {
        purchaseOrder: {
          include: {
            invoices: {
              where: {
                approvalStatus: {
                  in: [
                    InvoiceApprovalStatus.PENDING_REQUESTOR,
                    InvoiceApprovalStatus.REQUESTOR_REJECTED,
                  ],
                },
              },
            },
          },
        },
      },
    });

    return lines.map((line) => ({
      poLineId: line.id,
      poNumber: line.purchaseOrder.poNumber,
      description: line.description,
      lineType: line.lineType,
      requiresInvoiceMatch: line.requiresInvoiceMatch,
      invoiceMatched: line.invoiceMatched,
      canReceive: line.canReceive,
      blockReason:
        line.purchaseOrder.invoices.length > 0
          ? `Invoice pending approval (${line.purchaseOrder.invoices[0]?.approvalStatus})`
          : "No invoice uploaded for this service",
    }));
  }

  /**
   * Fetch other pending invoices for the same approver (to enrich approval email).
   * Excludes the current invoice. Capped at 10 to keep the email reasonable.
   */
  private static async getOtherPendingInvoicesForApprover(
    approverId: string,
    excludeInvoiceId: string,
  ): Promise<
    Array<{
      id: string;
      invoiceNumber: string;
      internalNumber: string;
      totalAmount: number;
      vendorName: string;
      poNumber?: string;
      approvalUrl: string;
    }>
  > {
    try {
      const baseUrl = getEmailBaseUrl();

      // Find PO IDs linked to requisitions where this user is creator or approver
      const [createdReqs, approvedReqs] = await Promise.all([
        prisma.requisition.findMany({
          where: { requestedById: approverId },
          select: { purchaseOrderId: true },
        }),
        prisma.requisition.findMany({
          where: { approvals: { some: { approverId, status: "APPROVED" } } },
          select: { purchaseOrderId: true },
        }),
      ]);

      const poIds = new Set<string>();
      for (const r of [...createdReqs, ...approvedReqs]) {
        if (r.purchaseOrderId) poIds.add(r.purchaseOrderId);
      }

      if (poIds.size === 0) return [];

      const invoices = await prisma.invoice.findMany({
        where: {
          purchaseOrderId: { in: [...poIds] },
          approvalStatus: InvoiceApprovalStatus.PENDING_REQUESTOR,
          id: { not: excludeInvoiceId },
        },
        select: {
          id: true,
          invoiceNumber: true,
          internalNumber: true,
          totalAmount: true,
          supplier: { select: { name: true } },
          purchaseOrder: { select: { poNumber: true } },
        },
        orderBy: { uploadedAt: "asc" },
        take: 10,
      });

      return invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        internalNumber: inv.internalNumber,
        totalAmount: Number(inv.totalAmount),
        vendorName: inv.supplier.name,
        poNumber: inv.purchaseOrder?.poNumber,
        approvalUrl: `${baseUrl}/purchasing/invoices/${inv.id}/approve`,
      }));
    } catch (err) {
      logger.warn(
        `[InvoiceApproval] getOtherPendingInvoicesForApprover failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Finance review approve — transitions PENDING_REVIEW → FULLY_APPROVED.
   * Only Finance/Admin roles can perform this action.
   */
  static async financeReviewApprove(
    context: ServiceContext,
    invoiceId: string,
    input: { comments?: string | null },
  ): Promise<Invoice> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        purchaseOrder: { select: { poNumber: true, id: true } },
      },
    });

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    if (invoice.approvalStatus !== InvoiceApprovalStatus.PENDING_REVIEW) {
      throw new Error(
        `Invoice cannot be finance-reviewed in current status: ${invoice.approvalStatus}. Only PENDING_REVIEW invoices can be reviewed.`,
      );
    }

    const previousStatus = invoice.approvalStatus;

    // Update invoice to FULLY_APPROVED
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        approvalStatus: InvoiceApprovalStatus.FULLY_APPROVED,
        status:
          InvoiceApprovalService.syncInvoiceStatusFields("FULLY_APPROVED")
            .status,
        requestorApprovedAt: new Date(),
        requestorApprovedBy: context.userId,
        requestorApprovedByName: context.userName,
      },
    });

    // Create audit history
    await prisma.invoiceApprovalHistory.create({
      data: {
        invoiceId,
        approverType: "FINANCE",
        approvedBy: context.userId,
        approvedByName: context.userName,
        action: "APPROVED",
        comments:
          input.comments ?? "Finance review approved — variance accepted",
        previousStatus,
        newStatus: InvoiceApprovalStatus.FULLY_APPROVED,
      },
    });

    logger.info(
      `[Finance Review] Invoice ${invoiceId} (${invoice.invoiceNumber}) approved by ${context.userName}. ` +
        `Status: ${previousStatus} → FULLY_APPROVED`,
    );

    // Auto-close is handled exclusively by the 90-day inactivity cron job (po-auto-close.ts).
    // Event-driven auto-close was removed here.

    // Sync linked requisition statuses
    if (invoice.purchaseOrderId) {
      try {
        await requisitionStatusSyncService.syncRequisitionsForPO(
          invoice.purchaseOrderId,
        );
      } catch (syncError) {
        logger.error(
          `[Finance Review] Failed to sync requisition statuses: ${
            syncError instanceof Error ? syncError.message : String(syncError)
          }`,
        );
      }
    }

    // Send approval notification
    try {
      if (invoice.uploadedBy) {
        await notificationService.sendNotification(context, {
          userId: invoice.uploadedBy,
          type: PURCHASING_NOTIFICATIONS.INVOICE_APPROVED.type,
          category: NotificationCategory.PURCHASING,
          title: `Invoice ${invoice.invoiceNumber} Approved (Finance Review)`,
          message: `Invoice ${invoice.invoiceNumber} for PO ${invoice.purchaseOrder?.poNumber ?? "N/A"} has been approved after finance review.`,
          priority: NotificationPriority.NORMAL,
          actionUrl: `/purchasing/invoices`,
          actionLabel: "View Invoices",
          data: {
            invoiceNumber: invoice.invoiceNumber,
            invoiceId: invoice.id,
            poNumber: invoice.purchaseOrder?.poNumber ?? "",
          },
        });
      }
    } catch (notifError) {
      logger.error(
        "[Finance Review] Failed to send approval notification",
        notifError,
      );
    }

    return updatedInvoice;
  }

  /**
   * Finance review reject — transitions PENDING_REVIEW → REQUESTOR_REJECTED.
   * Only Finance/Admin roles can perform this action.
   */
  static async financeReviewReject(
    context: ServiceContext,
    invoiceId: string,
    input: { reason: string },
  ): Promise<Invoice> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        purchaseOrder: { select: { poNumber: true, id: true } },
      },
    });

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    if (invoice.approvalStatus !== InvoiceApprovalStatus.PENDING_REVIEW) {
      throw new Error(
        `Invoice cannot be finance-rejected in current status: ${invoice.approvalStatus}. Only PENDING_REVIEW invoices can be rejected.`,
      );
    }

    const previousStatus = invoice.approvalStatus;

    // Rename invoiceNumber at rejection time so the original number is freed immediately.
    const rejectedInvoiceNumberFR = invoice.invoiceNumber.includes("-REJECTED-")
      ? invoice.invoiceNumber
      : `${invoice.invoiceNumber}-REJECTED-${Date.now()}`;

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        approvalStatus: InvoiceApprovalStatus.REQUESTOR_REJECTED,
        status:
          InvoiceApprovalService.syncInvoiceStatusFields("REQUESTOR_REJECTED")
            .status,
        requestorRejectedAt: new Date(),
        requestorRejectionReason: input.reason,
        invoiceNumber: rejectedInvoiceNumberFR,
      },
    });

    await prisma.invoiceApprovalHistory.create({
      data: {
        invoiceId,
        approverType: "FINANCE",
        approvedBy: context.userId,
        approvedByName: context.userName,
        action: "REJECTED",
        comments: input.reason,
        previousStatus,
        newStatus: InvoiceApprovalStatus.REQUESTOR_REJECTED,
      },
    });

    logger.info(
      `[Finance Review] Invoice ${invoiceId} (${invoice.invoiceNumber}) rejected by ${context.userName}. ` +
        `Status: ${previousStatus} → REQUESTOR_REJECTED. Reason: ${input.reason}`,
    );

    // Reverse any GL entries
    try {
      const { glReversalService } =
        await import("@/services/gl/gl-reversal.service");
      const glTxns = await prisma.gLTransaction.findMany({
        where: {
          referenceType: "Invoice",
          referenceId: invoice.id,
          status: "POSTED",
        },
      });
      for (const glTxn of glTxns) {
        await glReversalService.reverseTransaction(
          glTxn.id,
          `Invoice ${invoice.invoiceNumber} rejected in finance review: ${input.reason}`,
          context.userId,
        );
      }
      if (glTxns.length > 0) {
        logger.info(
          `[Finance Review Reject] Reversed ${glTxns.length} GL transaction(s) for invoice ${invoice.id}`,
        );
      }
    } catch (glError) {
      logger.error(
        `[Finance Review Reject] GL reversal failed: ${glError instanceof Error ? glError.message : String(glError)}`,
      );
    }

    // Notify uploader
    try {
      if (invoice.uploadedBy) {
        await notificationService.sendNotification(context, {
          userId: invoice.uploadedBy,
          type: PURCHASING_NOTIFICATIONS.INVOICE_REJECTED.type,
          category: NotificationCategory.PURCHASING,
          title: `Invoice ${invoice.invoiceNumber} Rejected (Finance Review)`,
          message: `Invoice ${invoice.invoiceNumber} was rejected during finance review: ${input.reason}`,
          priority: NotificationPriority.HIGH,
          actionUrl: `/purchasing/invoices`,
          actionLabel: "View Invoice",
          data: {
            invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            poNumber: invoice.purchaseOrder?.poNumber ?? "",
          },
        });
      }
    } catch (notifError) {
      logger.error(
        "[Finance Review Reject] Failed to send rejection notification",
        notifError,
      );
    }

    return updatedInvoice;
  }

  /**
   * B1-4: Sync guard — ensures Invoice.status string and Invoice.approvalStatus enum are consistent.
   * Call after any update to either field.
   * B8-1: Uses InvoiceDisplayStatus enum instead of string literals.
   */
  private static syncInvoiceStatusFields(approvalStatus: string): {
    status: string;
    approvalStatus: string;
  } {
    const statusMap: Record<string, string> = {
      PENDING_REQUESTOR: InvoiceDisplayStatus.PENDING_APPROVAL,
      REQUESTOR_APPROVED: InvoiceDisplayStatus.APPROVED,
      REQUESTOR_REJECTED: InvoiceDisplayStatus.REJECTED,
      FULLY_APPROVED: InvoiceDisplayStatus.APPROVED,
      PENDING_REVIEW: InvoiceDisplayStatus.PENDING_REVIEW,
      // B1-6: PENDING_MANAGER, MANAGER_APPROVED, MANAGER_REJECTED, REJECTED removed — dead enum values
    };

    return {
      status: statusMap[approvalStatus] ?? InvoiceDisplayStatus.PENDING,
      approvalStatus,
    };
  }
}
