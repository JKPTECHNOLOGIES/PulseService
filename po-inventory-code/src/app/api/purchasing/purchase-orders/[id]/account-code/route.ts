/**
 * Purchase Order Account Code + Department Reclass API Route
 *
 * Change a purchase order's AccountCode (and optionally Department) on every
 * charge allocation. Reverses + re-creates GL entries if the PO has posted GL.
 * Blocked for PartiallyReceived/Received/Closed — use /reclass-je for those.
 *
 * PATCH /api/purchasing/purchase-orders/[id]/account-code
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";

/**
 * PATCH /api/purchasing/purchase-orders/[id]/account-code
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

    const result = await purchaseOrderWorkflowService.updateAccountCodeOnAllocations(
      context.params.id,
      accountCodeId,
      reason.trim(),
      context.serviceContext.userId,
      context.serviceContext,
      resolvedDeptId,
    );

    return success(result, "Account code and department updated successfully");
  },
);
