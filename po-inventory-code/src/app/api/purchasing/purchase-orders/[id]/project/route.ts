/**
 * Purchase Order Project Reassignment API Route
 *
 * Change a purchase order's Project on every charge allocation, moving ALL
 * GL + budget data (reversals AND reserved/consumed) from the current project
 * to the target project. Works PO-wide across all lines, receipts and invoices.
 *
 * The service picks the safe mechanism by PO status:
 *   - pre-receipt  → reverse + re-post the commitment GL (budget moves with it)
 *   - post-receipt → net-zero project-reclass JE + budget transfer (receipts,
 *                    inventory and invoices are left untouched)
 *
 * Clearing the project (null) is NOT supported — a target projectId is required.
 *
 * PATCH /api/purchasing/purchase-orders/[id]/project
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";

/**
 * PATCH /api/purchasing/purchase-orders/[id]/project
 * Request body: { projectId: string, reason: string }
 */
export const PATCH = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = (await req.json()) as Record<string, unknown>;
    const { projectId, reason } = body;

    if (!projectId || typeof projectId !== "string") {
      throw new BadRequestError(
        "projectId is required (clearing the project is not allowed)",
      );
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new BadRequestError("reason is required");
    }

    const result = await purchaseOrderWorkflowService.changeProjectOnPO(
      context.params.id,
      projectId,
      reason.trim(),
      context.serviceContext.userId,
      context.serviceContext,
    );

    return success(result, "Project reassigned successfully");
  },
);
