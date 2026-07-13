/**
 * Purchase Order Admin Status Change API Route
 *
 * Admin-only endpoint to force-change the status of a purchase order.
 * Bypasses normal workflow validation — intended as an escape-hatch for
 * administrators to correct stuck or invalid PO states.
 *
 * POST /api/purchasing/purchase-orders/[id]/status
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { purchaseOrderWorkflowService } from "@/services/purchasing/purchase-order";
import { BadRequestError } from "@/lib/api-errors";
import { PurchaseOrderStatus } from "@/services/purchasing/purchase-order/purchase-order.types";

/**
 * POST /api/purchasing/purchase-orders/[id]/status
 * Admin-only: Force-change the status of a purchase order
 *
 * Request body:
 *   { status: PurchaseOrderStatus, reason: string }
 */
export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    const body = await req.json() as Record<string, unknown>;
    const { status, reason } = body;

    if (!status || typeof status !== "string") {
      throw new BadRequestError("New status is required");
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new BadRequestError("Reason for status change is required");
    }

    // Validate the provided status is a valid PurchaseOrderStatus
    const validStatuses = Object.values(PurchaseOrderStatus);
    if (!validStatuses.includes(status as PurchaseOrderStatus)) {
      throw new BadRequestError(
        `Invalid status "${status}". Valid statuses are: ${validStatuses.join(", ")}`,
      );
    }

    const purchaseOrder = await purchaseOrderWorkflowService.adminChangeStatus(
      context.serviceContext,
      context.params.id,
      status as PurchaseOrderStatus,
      reason.trim(),
    );

    return success(
      purchaseOrder,
      `Purchase order status changed to "${status}" successfully`,
    );
  },
);
