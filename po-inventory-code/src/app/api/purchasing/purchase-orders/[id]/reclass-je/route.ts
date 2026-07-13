/**
 * Purchase Order Reclass Adjustment JE API Route
 *
 * Post a stand-alone ADJUSTMENT journal entry to move expense dollars from
 * one AccountCode (and optionally Department) to another WITHOUT touching
 * receipts, inventory, or invoices. Used for PartiallyReceived/Received/Closed
 * POs where the normal reclass flow is blocked.
 *
 * PATCH /api/purchasing/purchase-orders/[id]/reclass-je
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";

/**
 * PATCH /api/purchasing/purchase-orders/[id]/reclass-je
 * Request body: { accountCodeId: string, reason: string, departmentId?: string | null }
 */
export const PATCH = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = (await req.json()) as Record<string, unknown>;
    const { accountCodeId, reason, departmentId } = body;

    if (!accountCodeId || typeof accountCodeId !== "string") {
      throw new BadRequestError("accountCodeId is required");
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new BadRequestError("reason is required");
    }
    // departmentId is optional: string UUID → set, null/empty string → clear, undefined → no change
    const resolvedDeptId: string | null | undefined =
      departmentId === undefined
        ? undefined
        : departmentId === null || departmentId === ""
          ? null
          : typeof departmentId === "string"
            ? departmentId
            : undefined;

    const result = await purchaseOrderWorkflowService.createReclassAdjustmentJE(
      context.params.id,
      accountCodeId,
      reason.trim(),
      context.serviceContext.userId,
      context.serviceContext,
      resolvedDeptId,
    );

    return success(result, "Reclass JE posted successfully");
  },
);
