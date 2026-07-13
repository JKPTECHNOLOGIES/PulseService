/**
 * Reservation Settings Types
 * 
 * Types for configurable reservation management behavior
 */

import { z } from "zod";

/**
 * Reservation Mode
 * - TIME_BASED: Current 30-day threshold logic
 * - PROMPT_BASED: Prompt planner when stock shortage or MIN QTY hit
 */
export enum ReservationMode {
  TIME_BASED = "TIME_BASED",
  PROMPT_BASED = "PROMPT_BASED",
}

/**
 * Reservation Settings Interface
 */
export interface ReservationSettings {
  id: string;
  mode: ReservationMode;
  daysThreshold: number;
  promptOnStockShortage: boolean;
  promptOnMinQty: boolean;
  autoCreateReq: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
  updatedByName: string | null;
}

/**
 * Reservation Settings Update DTO
 */
export interface ReservationSettingsUpdateDTO {
  mode?: ReservationMode;
  daysThreshold?: number;
  promptOnStockShortage?: boolean;
  promptOnMinQty?: boolean;
  autoCreateReq?: boolean;
}

/**
 * Zod schema for reservation settings update
 */
export const reservationSettingsUpdateSchema = z.object({
  mode: z.nativeEnum(ReservationMode).optional(),
  daysThreshold: z.number().int().min(1).max(365).optional(),
  promptOnStockShortage: z.boolean().optional(),
  promptOnMinQty: z.boolean().optional(),
  autoCreateReq: z.boolean().optional(),
});

/**
 * Stock Check Result
 * Used when checking if reservation should prompt for requisition
 */
export interface StockCheckResult {
  shouldPrompt: boolean;
  reason: "STOCK_SHORTAGE" | "MIN_QTY_HIT" | "NONE";
  currentStock: number;
  requestedQty: number;
  minQty: number;
  availableQty: number;
  shortageQty?: number;
  message: string;
}

/**
 * Reservation Decision
 * Result of applying settings to determine reservation behavior
 */
export interface ReservationDecision {
  shouldReserveStock: boolean;
  shouldPromptPlanner: boolean;
  stockCheckResult?: StockCheckResult;
  reason: string;
}
