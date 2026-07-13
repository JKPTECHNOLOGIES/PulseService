/**
 * Requisition Force-Approve API Route (DATA REPAIR)
 *
 * Promotes a Draft requisition that already has approvedAt set and a linked
 * PO to Approved status. Fixes stuck-in-Draft display state. Does NOT touch
 * GL/budgets/PO.
 *
 * PATCH /api/purchasing/requisitions/[id]/force-approve
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { requisitionWorkflowService } from "@/services/purchasing/requisition/requisition-workflow.service";
import { BadRequestError } from "@/lib/api-errors";

/**
 * PATCH /api/purchasing/requisitions/[id]/force-approve
 * Request body: { reason: string }
 */
export const PATCH = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = (await req.json()) as Record<string, unknown>;
    const { reason } = body;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new BadRequestError("reason is required");
    }

    const result = await requisitionWorkflowService.forceApproveDraftWithPO(
      context.serviceContext,
      context.params.id,
      reason.trim(),
    );

    return success(result, "Requisition force-approved");
  },
);
