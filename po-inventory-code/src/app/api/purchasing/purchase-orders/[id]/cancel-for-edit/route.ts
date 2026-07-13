/**
 * Purchase Order Cancel for Edit API Route
 *
 * POST /api/purchasing/purchase-orders/:id/cancel-for-edit
 *
 * Cancels a PO due to financial changes and resets linked requisitions to DRAFT status.
 * This endpoint is used when editing a PO with financial changes (supplier, quantities, prices, etc.)
 * that require re-approval of the requisitions.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
  createGetHandlerWithParams,
} from "@/lib/api-middleware-v2";
import { purchaseOrderCancellationService } from "@/services/purchasing/purchase-order/purchase-order-cancellation.service";
/**
 * Schema for cancel-for-edit request
 */
const cancelForEditSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required"),
  financialChanges: z
    .array(z.string())
    .min(1, "At least one financial change must be specified"),
  supersededByPOId: z.string().uuid().optional(),
  supersededByPONumber: z.string().optional(),
  updatedLineItems: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        // Coerce empty string / non-UUID to null so the form never sends a bad UUID
        inventoryItemId: z.preprocess(
          (val) => (val === "" || val === undefined ? null : val),
          z.string().uuid().nullable().optional(),
        ),
        description: z.string(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        estimatedPrice: z.number().nonnegative(),
        lineType: z.string(),
      }),
    )
    .optional(),
});

type CancelForEditData = z.infer<typeof cancelForEditSchema>;

/**
 * POST /api/purchasing/purchase-orders/:id/cancel-for-edit
 *
 * Cancel a PO for edit and reset linked requisitions
 */
export const POST = createApiHandler(
  { hasParams: true, bodySchema: cancelForEditSchema },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, CancelForEditData>,
  ) => {
    const result = await purchaseOrderCancellationService.cancelForEdit(
      context.serviceContext,
      context.params.id,
      {
        reason: context.data.reason,
        financialChanges: context.data.financialChanges,
        supersededByPOId: context.data.supersededByPOId,
        supersededByPONumber: context.data.supersededByPONumber,
        updatedLineItems: context.data.updatedLineItems,
      },
    );

    return success(
      result,
      `PO ${result.cancelledPONumber} cancelled and ${result.resetRequisitions.length} requisition(s) reset for re-approval`,
    );
  },
);

/**
 * GET /api/purchasing/purchase-orders/:id/cancel-for-edit
 *
 * Check if a PO can be cancelled for edit
 */
export const GET = createGetHandlerWithParams(async (_req, context) => {
  const canCancel = await purchaseOrderCancellationService.canCancelForEdit(
    context.serviceContext,
    context.params.id,
  );

  return success(canCancel, "PO cancellation eligibility checked");
});
