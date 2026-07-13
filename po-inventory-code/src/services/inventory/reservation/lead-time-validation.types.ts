/**
 * Lead Time Validation Types
 *
 * Types and schemas for lead-time-aware reservation validation.
 * Ensures planners are alerted when parts cannot arrive in time.
 */

import { z } from "zod";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Lead time warning severity levels
 */
export enum LeadTimeWarningSeverity {
  CRITICAL = "CRITICAL", // Lead time exceeds work order date
  HIGH = "HIGH", // Less than 7 days buffer
  MEDIUM = "MEDIUM", // 7-14 days buffer
  LOW = "LOW", // 14-30 days buffer
  OK = "OK", // Sufficient time
}

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Lead time calculation result
 */
export interface LeadTimeCalculation {
  inventoryItemId: string;
  inventoryItemSku: string;
  inventoryItemDescription: string;
  leadTimeDays: number;
  source: string; // 'item_supplier' | 'item_default' | 'supplier_default' | 'system_default'
  confidence: string; // 'high' | 'medium' | 'low'
  supplierId: string | null;
  supplierName: string | null;
}

/**
 * Lead time validation result
 */
export interface LeadTimeValidationResult {
  isValid: boolean;
  severity: LeadTimeWarningSeverity;
  leadTimeDays: number;
  workOrderStartDate: Date;
  orderByDate: Date;
  daysUntilOrderNeeded: number;
  daysUntilWorkOrder: number;
  bufferDays: number; // Days between arrival and work order start
  message: string;
  recommendation: string;
  calculation: LeadTimeCalculation;
}

/**
 * Lead time warning for dashboard
 */
export interface LeadTimeWarning {
  id: string;
  reservationId: string | null;
  inventoryItemId: string;
  inventoryItemSku: string;
  inventoryItemDescription: string;
  quantity: number;
  workOrderId: string;
  workOrderNumber: string;
  workOrderTitle: string;
  plannedStartDate: Date;
  leadTimeDays: number;
  orderByDate: Date;
  daysUntilOrderNeeded: number;
  daysUntilWorkOrder: number;
  bufferDays: number;
  severity: LeadTimeWarningSeverity;
  isUrgent: boolean;
  message: string;
  recommendation: string;
  createdAt: Date;
}

/**
 * Lead time warning summary
 */
export interface LeadTimeWarningSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  urgent: number; // Warnings requiring immediate action
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Schema for lead time validation request
 */
export const leadTimeValidationRequestSchema = z.object({
  inventoryItemId: z.string().uuid("Invalid inventory item ID"),
  workOrderId: z.string().uuid("Invalid work order ID"),
  plannedStartDate: z.string().datetime("Invalid planned start date"),
  quantity: z.number().positive("Quantity must be positive").optional(),
  supplierId: z.string().uuid("Invalid supplier ID").optional().nullable(),
});

/**
 * Schema for lead time warning filters
 */
export const leadTimeWarningFilterSchema = z.object({
  plannerId: z.string().uuid().optional(),
  workOrderId: z.string().uuid().optional(),
  severity: z.nativeEnum(LeadTimeWarningSeverity).optional(),
  urgentOnly: z.boolean().optional(),
  daysAhead: z.number().int().positive().max(365).optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * DTO for lead time validation request
 */
export type LeadTimeValidationRequestDTO = z.infer<
  typeof leadTimeValidationRequestSchema
>;

/**
 * DTO for lead time warning filters
 */
export type LeadTimeWarningFilterDTO = z.infer<
  typeof leadTimeWarningFilterSchema
>;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate severity based on buffer days
 */
export function calculateSeverity(
  bufferDays: number,
  daysUntilOrderNeeded: number,
): LeadTimeWarningSeverity {
  // Critical: Lead time exceeds work order date (negative buffer)
  if (bufferDays < 0) {
    return LeadTimeWarningSeverity.CRITICAL;
  }

  // High: Less than 7 days buffer OR order needed within 7 days
  if (bufferDays < 7 || daysUntilOrderNeeded <= 7) {
    return LeadTimeWarningSeverity.HIGH;
  }

  // Medium: 7-14 days buffer
  if (bufferDays < 14) {
    return LeadTimeWarningSeverity.MEDIUM;
  }

  // Low: 14-30 days buffer
  if (bufferDays < 30) {
    return LeadTimeWarningSeverity.LOW;
  }

  // OK: 30+ days buffer
  return LeadTimeWarningSeverity.OK;
}

/**
 * Get severity color for UI
 */
export function getSeverityColor(severity: LeadTimeWarningSeverity): string {
  switch (severity) {
    case LeadTimeWarningSeverity.CRITICAL:
      return "red";
    case LeadTimeWarningSeverity.HIGH:
      return "orange";
    case LeadTimeWarningSeverity.MEDIUM:
      return "yellow";
    case LeadTimeWarningSeverity.LOW:
      return "blue";
    case LeadTimeWarningSeverity.OK:
      return "green";
    default:
      return "gray";
  }
}

/**
 * Get severity label
 */
export function getSeverityLabel(severity: LeadTimeWarningSeverity): string {
  switch (severity) {
    case LeadTimeWarningSeverity.CRITICAL:
      return "Critical";
    case LeadTimeWarningSeverity.HIGH:
      return "High";
    case LeadTimeWarningSeverity.MEDIUM:
      return "Medium";
    case LeadTimeWarningSeverity.LOW:
      return "Low";
    case LeadTimeWarningSeverity.OK:
      return "OK";
    default:
      return "Unknown";
  }
}

/**
 * Generate warning message based on severity
 */
export function generateWarningMessage(
  severity: LeadTimeWarningSeverity,
  leadTimeDays: number,
  bufferDays: number,
  daysUntilOrderNeeded: number,
): string {
  switch (severity) {
    case LeadTimeWarningSeverity.CRITICAL:
      return `⚠️ CRITICAL: Lead time (${leadTimeDays} days) exceeds work order date by ${Math.abs(bufferDays)} days. Part cannot arrive in time!`;

    case LeadTimeWarningSeverity.HIGH:
      if (daysUntilOrderNeeded <= 0) {
        return `🚨 URGENT: Order should have been placed ${Math.abs(daysUntilOrderNeeded)} days ago! Lead time: ${leadTimeDays} days.`;
      }
      return `⚠️ HIGH: Order must be placed within ${daysUntilOrderNeeded} days. Only ${bufferDays} days buffer before work order.`;

    case LeadTimeWarningSeverity.MEDIUM:
      return `⚠️ MEDIUM: ${bufferDays} days buffer. Order by ${daysUntilOrderNeeded} days before work order.`;

    case LeadTimeWarningSeverity.LOW:
      return `ℹ️ LOW: ${bufferDays} days buffer. Plan to order within ${daysUntilOrderNeeded} days.`;

    case LeadTimeWarningSeverity.OK:
      return `✓ OK: Sufficient time. ${bufferDays} days buffer available.`;

    default:
      return "Unknown severity";
  }
}

/**
 * Generate recommendation based on severity
 */
export function generateRecommendation(
  severity: LeadTimeWarningSeverity,
  daysUntilOrderNeeded: number,
  supplierName: string | null,
): string {
  const supplier = supplierName ? ` from ${supplierName}` : "";

  switch (severity) {
    case LeadTimeWarningSeverity.CRITICAL:
      return `Immediate action required: Reschedule work order OR find expedited supplier OR use alternative part. Current supplier${supplier} cannot meet deadline.`;

    case LeadTimeWarningSeverity.HIGH:
      if (daysUntilOrderNeeded <= 0) {
        return `Place order immediately${supplier}! Consider expedited shipping or alternative suppliers.`;
      }
      return `Place order within ${daysUntilOrderNeeded} days${supplier}. Set calendar reminder. Consider expedited shipping.`;

    case LeadTimeWarningSeverity.MEDIUM:
      return `Plan to order within ${daysUntilOrderNeeded} days${supplier}. Monitor stock levels and confirm supplier availability.`;

    case LeadTimeWarningSeverity.LOW:
      return `Order within ${daysUntilOrderNeeded} days${supplier}. Standard lead time should be sufficient.`;

    case LeadTimeWarningSeverity.OK:
      return `No immediate action needed. Review closer to order date.`;

    default:
      return "Review lead time requirements";
  }
}

/**
 * Check if warning is urgent (requires immediate action)
 */
export function isUrgentWarning(
  severity: LeadTimeWarningSeverity,
  daysUntilOrderNeeded: number,
): boolean {
  return (
    severity === LeadTimeWarningSeverity.CRITICAL ||
    severity === LeadTimeWarningSeverity.HIGH ||
    daysUntilOrderNeeded <= 7
  );
}
