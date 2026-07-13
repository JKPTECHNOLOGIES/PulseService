/**
 * Purchase Order Change Detection Utility
 *
 * Detects whether changes to a PO are financial (requiring cancellation and re-approval)
 * or non-financial (allowing direct update).
 *
 * Business Rules:
 * - Non-financial changes (text, dates, logistics, supplier) can be edited directly
 * - Price INCREASES require cancellation and requisition reset for re-approval
 * - Price DECREASES are allowed without cancellation (favorable to company)
 * - Supplier changes are NON-FINANCIAL — the supplier is a routing/vendor identity
 *   field, not a dollar amount. Changing to correct a wrong supplier# does not affect
 *   the approved dollar value, quantities, or line items. Previously this was treated
 *   as financial which caused an endless kickback loop when correcting a supplier typo.
 */

import { Decimal } from "@prisma/client/runtime/library";

/**
 * Fields that are considered financial changes.
 * Changes to these fields require PO cancellation and requisition reset.
 */
const FINANCIAL_FIELDS = [
  "totalAmount", // Direct price change
  "shippingCost", // Affects total cost
  "taxAmount", // Affects total cost
  "discount", // Affects total cost
] as const;

/**
 * Fields that are considered non-financial changes.
 * Changes to these fields can be updated directly without re-approval.
 */
const NON_FINANCIAL_FIELDS = [
  "supplierId", // Vendor identity / routing — does NOT change dollar value.
  // Correcting a wrong supplier# should never force re-approval.
  "notes", // Text only
  "internalNotes", // Text only
  "orderDate", // Date change
  "expectedDate", // Date change
  "deliveryAddress", // Logistics only
  "deliveryInstructions", // Text only
  "paymentTerms", // Terms description (not amount)
  "shippingMethod", // Logistics only
] as const;

/**
 * Purchase Order data structure for comparison
 */
export interface POData {
  supplierId: string;
  totalAmount: number | Decimal;
  shippingCost?: number | Decimal | null;
  taxAmount?: number | Decimal | null;
  discount?: number | Decimal | null;
  notes?: string | null;
  internalNotes?: string | null;
  orderDate?: Date | string | null;
  expectedDate?: Date | string | null;
  deliveryAddress?: string | null;
  deliveryInstructions?: string | null;
  paymentTerms?: string | null;
  shippingMethod?: string | null;
  lines?: POLineData[];
}

/**
 * Purchase Order Line data structure
 */
export interface POLineData {
  id?: string;
  inventoryItemId?: string | null;
  description: string;
  quantity: number | Decimal;
  unitPrice: number | Decimal;
  totalPrice: number | Decimal;
  notes?: string | null;
  deliveryDate?: Date | string | null;
}

/**
 * Result of change detection
 */
export interface ChangeDetectionResult {
  hasFinancialChanges: boolean;
  hasNonFinancialChanges: boolean;
  financialChanges: string[];
  nonFinancialChanges: string[];
  requiresCancellation: boolean;
  changesSummary: string;
}

/**
 * Tolerance for floating point comparisons (1 cent)
 */
const PRICE_TOLERANCE = 0.01;

/**
 * Convert Decimal to number for comparison
 */
function toNumber(value: number | Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value.toString());
}

/**
 * Check if price increased (with tolerance for floating point errors)
 */
function priceIncreased(newPrice: number, oldPrice: number): boolean {
  return newPrice - oldPrice > PRICE_TOLERANCE;
}

/**
 * Check if price decreased (with tolerance for floating point errors)
 */
function priceDecreased(newPrice: number, oldPrice: number): boolean {
  return oldPrice - newPrice > PRICE_TOLERANCE;
}

/**
 * Compare two values for equality
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  // Handle null/undefined
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;

  // Handle Decimal types
  if (typeof a === "object" && "toString" in a) {
    return toNumber(a as Decimal) === toNumber(b as Decimal);
  }

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (a instanceof Date || b instanceof Date) {
    const dateA = a instanceof Date ? a : new Date(a as string);
    const dateB = b instanceof Date ? b : new Date(b as string);
    return dateA.getTime() === dateB.getTime();
  }

  // Handle primitives
  return a === b;
}

/**
 * Compare line items to detect changes, separating financial from non-financial.
 *
 * NOTE: Line-level price increases are intentionally NOT classified as financial
 * changes here. The 10% threshold is applied at the overall PO total level in
 * detectPOChanges(). Flagging individual line increases as financial would bypass
 * that threshold and trigger re-approval for tiny changes (e.g. a $0.01 increase
 * on a $162,000 PO). All line-level price movements are recorded as non-financial
 * so they appear in the audit trail without forcing cancellation.
 */
function compareLineItems(
  originalLines: POLineData[] = [],
  updatedLines: POLineData[] = [],
  thresholdLabel: string = "10%",
): { financialChanges: string[]; nonFinancialChanges: string[] } {
  const financialChanges: string[] = [];
  const nonFinancialChanges: string[] = [];

  // Check if line count changed - this is non-financial
  // (the overall total amount check already catches cost increases)
  if (originalLines.length !== updatedLines.length) {
    nonFinancialChanges.push(
      `Line item count changed from ${originalLines.length} to ${updatedLines.length}`,
    );
  }

  // Build a map of original lines by id for ID-based comparison (no positional fallback — M-027)
  const originalById = new Map<string, POLineData>(
    originalLines
      .filter((l): l is POLineData & { id: string } => l.id != null)
      .map((l) => [l.id, l]),
  );

  // Compare updated lines to their originals by id.
  // Lines without an id, or whose id is not found in originals, are new — skip per-line diff.
  for (const updated of updatedLines) {
    if (!updated.id) continue;
    const original = originalById.get(updated.id);
    if (!original) continue;

    const origQty = toNumber(original.quantity);
    const updQty = toNumber(updated.quantity);
    const origUnitPrice = toNumber(original.unitPrice);
    const updUnitPrice = toNumber(updated.unitPrice);
    const origTotal = toNumber(original.totalPrice);
    const updTotal = toNumber(updated.totalPrice);

    if (priceIncreased(updTotal, origTotal)) {
      const changes_parts: string[] = [];
      if (updQty !== origQty) {
        changes_parts.push(`quantity ${origQty} → ${updQty}`);
      }
      if (priceIncreased(updUnitPrice, origUnitPrice)) {
        changes_parts.push(
          `unit price $${origUnitPrice.toFixed(2)} → $${updUnitPrice.toFixed(2)}`,
        );
      }
      const changeDesc =
        changes_parts.length > 0 ? ` (${changes_parts.join(", ")})` : "";
      nonFinancialChanges.push(
        `Line ${original.id ?? "unknown"}: Total price increased from $${origTotal.toFixed(2)} to $${updTotal.toFixed(2)}${changeDesc} - within ${thresholdLabel} total threshold`,
      );
    } else if (priceDecreased(updTotal, origTotal)) {
      nonFinancialChanges.push(
        `Line ${original.id ?? "unknown"}: Total price decreased from $${origTotal.toFixed(2)} to $${updTotal.toFixed(2)} - favorable change allowed`,
      );
    }

    if (original.inventoryItemId !== updated.inventoryItemId) {
      nonFinancialChanges.push(
        `Line ${original.id ?? "unknown"}: Inventory item changed`,
      );
    }
    if (original.description !== updated.description) {
      nonFinancialChanges.push(
        `Line ${original.id ?? "unknown"}: Description changed`,
      );
    }
    if (!valuesEqual(original.deliveryDate, updated.deliveryDate)) {
      nonFinancialChanges.push(
        `Line ${original.id ?? "unknown"}: Delivery date changed`,
      );
    }
  }

  return { financialChanges, nonFinancialChanges };
}

/**
 * Detect financial and non-financial changes in a PO update
 *
 * @param original - Original PO data
 * @param updated - Updated PO data
 * @param autoApprovalThreshold - Optional dollar threshold below which re-approval is
 *   not required even if the percentage increase exceeds the variance threshold.
 *   Defaults to 0 (disabled — any increase over `thresholdPercent` triggers re-approval
 *   regardless of amount). Pass the value from
 *   financeSettingsService.getAutoApprovalThreshold() to enable the compound check.
 * @param thresholdPercent - The variance percentage threshold above which a total
 *   increase is flagged as a financial change. Defaults to 10 for backwards
 *   compatibility. Pass the value from financeSettingsService.getPoVarianceThreshold()
 *   so the configured FinanceSettings value is honored instead of a hard-coded 10%.
 * @returns Change detection result with categorized changes
 */
export function detectPOChanges(
  original: POData,
  updated: POData,
  autoApprovalThreshold: number = 0,
  thresholdPercent: number = 10,
): ChangeDetectionResult {
  const financialChanges: string[] = [];
  const nonFinancialChanges: string[] = [];

  // Supplier change is NON-FINANCIAL — vendor identity does not affect the
  // approved dollar value, quantities, or line items. A supplier change is
  // logged for audit trail but never triggers cancelForEdit / REQ kickback.
  if (original.supplierId !== updated.supplierId) {
    nonFinancialChanges.push(
      "Supplier changed (vendor identity update — no financial impact)",
    );
  }

  // Check total amount change — compound condition:
  //   1. Total increases by MORE than `thresholdPercent` (the configured variance
  //      threshold from FinanceSettings, default 10%), AND
  //   2. The new total exceeds the auto-approval threshold (i.e. a human approver
  //      would actually be required for this amount).
  // If the new total is below the auto-approval threshold, the requisition would
  // auto-approve anyway, so there is no value in kicking it back for re-approval.
  const originalTotal = toNumber(original.totalAmount);
  const updatedTotal = toNumber(updated.totalAmount);
  const variance = calculatePOVariance(updatedTotal, originalTotal);
  const thresholdLabel = `${thresholdPercent.toFixed(1).replace(/\.0$/, "")}%`;
  if (
    variance.isIncrease &&
    requiresReApproval(
      variance.variancePercent,
      updatedTotal,
      thresholdPercent,
      autoApprovalThreshold,
    )
  ) {
    financialChanges.push(
      `Total amount increased by ${variance.variancePercent.toFixed(1)}% from $${originalTotal.toFixed(2)} to $${updatedTotal.toFixed(2)} (+$${variance.varianceAmount.toFixed(2)}) - exceeds ${thresholdLabel} threshold`,
    );
  } else if (variance.isIncrease) {
    const belowThresholdNote =
      autoApprovalThreshold > 0 && updatedTotal <= autoApprovalThreshold
        ? ` (new total $${updatedTotal.toFixed(2)} is below auto-approval threshold $${autoApprovalThreshold.toFixed(2)})`
        : "";
    nonFinancialChanges.push(
      `Total amount increased within ${thresholdLabel} tolerance (${variance.variancePercent.toFixed(1)}%) from $${originalTotal.toFixed(2)} to $${updatedTotal.toFixed(2)} (+$${variance.varianceAmount.toFixed(2)})${belowThresholdNote}`,
    );
  } else if (priceDecreased(updatedTotal, originalTotal)) {
    nonFinancialChanges.push(
      `Total amount decreased from $${originalTotal.toFixed(2)} to $${updatedTotal.toFixed(2)} (-$${(originalTotal - updatedTotal).toFixed(2)}) - favorable change allowed`,
    );
  }

  // Check shipping cost change - record as non-financial (informational only).
  // The variance threshold on the overall totalAmount already captures any cost impact.
  const originalShipping = toNumber(original.shippingCost);
  const updatedShipping = toNumber(updated.shippingCost);
  if (priceIncreased(updatedShipping, originalShipping)) {
    nonFinancialChanges.push(
      `Shipping cost increased from $${originalShipping.toFixed(2)} to $${updatedShipping.toFixed(2)} (+$${(updatedShipping - originalShipping).toFixed(2)}) - within ${thresholdLabel} total threshold`,
    );
  } else if (priceDecreased(updatedShipping, originalShipping)) {
    nonFinancialChanges.push(
      `Shipping cost decreased from $${originalShipping.toFixed(2)} to $${updatedShipping.toFixed(2)} - favorable change allowed`,
    );
  }

  // Check tax amount change - record as non-financial (informational only).
  // The variance threshold on the overall totalAmount already captures any cost impact.
  const originalTax = toNumber(original.taxAmount);
  const updatedTax = toNumber(updated.taxAmount);
  if (priceIncreased(updatedTax, originalTax)) {
    nonFinancialChanges.push(
      `Tax amount increased from $${originalTax.toFixed(2)} to $${updatedTax.toFixed(2)} (+$${(updatedTax - originalTax).toFixed(2)}) - within ${thresholdLabel} total threshold`,
    );
  } else if (priceDecreased(updatedTax, originalTax)) {
    nonFinancialChanges.push(
      `Tax amount decreased from $${updatedTax.toFixed(2)} to $${originalTax.toFixed(2)} - favorable change allowed`,
    );
  }

  // Check discount change - record as non-financial (informational only).
  // The variance threshold on the overall totalAmount already captures any cost impact.
  const originalDiscount = toNumber(original.discount);
  const updatedDiscount = toNumber(updated.discount);
  if (priceDecreased(updatedDiscount, originalDiscount)) {
    nonFinancialChanges.push(
      `Discount decreased from $${originalDiscount.toFixed(2)} to $${updatedDiscount.toFixed(2)} (less savings = higher cost) - within ${thresholdLabel} total threshold`,
    );
  } else if (priceIncreased(updatedDiscount, originalDiscount)) {
    nonFinancialChanges.push(
      `Discount increased from $${originalDiscount.toFixed(2)} to $${updatedDiscount.toFixed(2)} - favorable change allowed`,
    );
  }

  // Check line item changes - categorized individually
  const lineComparison = compareLineItems(
    original.lines,
    updated.lines,
    thresholdLabel,
  );
  financialChanges.push(...lineComparison.financialChanges);
  nonFinancialChanges.push(...lineComparison.nonFinancialChanges);

  // Check non-financial fields
  if (original.notes !== updated.notes) {
    nonFinancialChanges.push("Notes updated");
  }

  if (original.internalNotes !== updated.internalNotes) {
    nonFinancialChanges.push("Internal notes updated");
  }

  if (!valuesEqual(original.orderDate, updated.orderDate)) {
    nonFinancialChanges.push("Order date changed");
  }

  if (!valuesEqual(original.expectedDate, updated.expectedDate)) {
    nonFinancialChanges.push("Expected delivery date changed");
  }

  if (original.deliveryAddress !== updated.deliveryAddress) {
    nonFinancialChanges.push("Delivery address updated");
  }

  if (original.deliveryInstructions !== updated.deliveryInstructions) {
    nonFinancialChanges.push("Delivery instructions updated");
  }

  if (original.paymentTerms !== updated.paymentTerms) {
    nonFinancialChanges.push("Payment terms updated");
  }

  if (original.shippingMethod !== updated.shippingMethod) {
    nonFinancialChanges.push("Shipping method updated");
  }

  // Build summary
  const hasFinancialChanges = financialChanges.length > 0;
  const hasNonFinancialChanges = nonFinancialChanges.length > 0;
  const requiresCancellation = hasFinancialChanges;

  let changesSummary = "";
  if (hasFinancialChanges && hasNonFinancialChanges) {
    changesSummary = `Price increases detected (${financialChanges.length}) and other changes (${nonFinancialChanges.length}). PO must be cancelled and requisitions reset for re-approval due to price increases.`;
  } else if (hasFinancialChanges) {
    changesSummary = `Price increases detected (${financialChanges.length}). PO must be cancelled and requisitions reset for re-approval.`;
  } else if (hasNonFinancialChanges) {
    changesSummary = `Changes detected (${nonFinancialChanges.length}) but no price increases. Direct update allowed.`;
  } else {
    changesSummary = "No changes detected.";
  }

  return {
    hasFinancialChanges,
    hasNonFinancialChanges,
    financialChanges,
    nonFinancialChanges,
    requiresCancellation,
    changesSummary,
  };
}

/**
 * Check if a specific field is financial
 */
export function isFinancialField(fieldName: string): boolean {
  return FINANCIAL_FIELDS.includes(
    fieldName as (typeof FINANCIAL_FIELDS)[number],
  );
}

/**
 * Check if a specific field is non-financial
 */
export function isNonFinancialField(fieldName: string): boolean {
  return NON_FINANCIAL_FIELDS.includes(
    fieldName as (typeof NON_FINANCIAL_FIELDS)[number],
  );
}

/**
 * Get list of all financial fields
 */
export function getFinancialFields(): readonly string[] {
  return FINANCIAL_FIELDS;
}

/**
 * Get list of all non-financial fields
 */
export function getNonFinancialFields(): readonly string[] {
  return NON_FINANCIAL_FIELDS;
}

// ============================================================================
// PRICE VARIANCE UTILITIES (Phase 2 - PO Price Variance GL Updates)
// ============================================================================

/**
 * Calculate price variance between current and approved totals.
 *
 * @param currentTotal - Current PO total (at send time)
 * @param approvedTotal - Approved PO total (snapshot from approval)
 * @returns Variance details including amount, percentage, and direction
 */
export function calculatePOVariance(
  currentTotal: number,
  approvedTotal: number,
): { varianceAmount: number; variancePercent: number; isIncrease: boolean } {
  const varianceAmount = currentTotal - approvedTotal;
  const variancePercent =
    approvedTotal > 0 ? (varianceAmount / approvedTotal) * 100 : 0;
  return {
    varianceAmount,
    variancePercent,
    isIncrease: varianceAmount > PRICE_TOLERANCE,
  };
}

/**
 * Check if a variance percentage exceeds the configured threshold.
 * Only positive (unfavorable) variances can exceed the threshold.
 *
 * @param variancePercent - The variance percentage (can be negative for decreases)
 * @param thresholdPercent - The threshold percentage (default 10%)
 * @returns True if the variance exceeds the threshold
 */
export function exceedsVarianceThreshold(
  variancePercent: number,
  thresholdPercent: number = 10,
): boolean {
  return variancePercent > thresholdPercent;
}

/**
 * Compound re-approval check: requires BOTH conditions to be true.
 *
 * Re-approval is only triggered when:
 *   1. The price increase percentage exceeds the variance threshold (e.g. > 10%), AND
 *   2. The new total exceeds the auto-approval threshold (i.e. the amount is large
 *      enough that a human approver would be required anyway).
 *
 * Rationale: A $1.00 → $1.25 change is a 25% increase but the new total ($1.25) is
 * trivially small. If the requisition would auto-approve at that amount, there is no
 * point kicking it back for re-approval — the re-approval cycle would complete
 * instantly with no human review. Only kick back when the new total is large enough
 * to actually require a human approver.
 *
 * @param variancePercent - The variance percentage (positive = increase)
 * @param newTotal - The new PO/line total after the price change
 * @param thresholdPercent - The variance percentage threshold (default 10%)
 * @param autoApprovalThreshold - The minimum dollar amount requiring human approval.
 *   Pass 0 to disable the dollar-amount guard (everything requires approval).
 * @returns True if re-approval is required
 */
export function requiresReApproval(
  variancePercent: number,
  newTotal: number,
  thresholdPercent: number = 10,
  autoApprovalThreshold: number = 0,
): boolean {
  const exceedsPercentThreshold = variancePercent > thresholdPercent;
  const exceedsDollarThreshold = newTotal > autoApprovalThreshold;
  return exceedsPercentThreshold && exceedsDollarThreshold;
}
