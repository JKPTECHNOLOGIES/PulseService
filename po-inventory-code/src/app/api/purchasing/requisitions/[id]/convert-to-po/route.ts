/**
 * Requisition Convert to PO API Route
 *
 * POST /api/purchasing/requisitions/:id/convert-to-po - Convert requisition to purchase order
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import {
  requisitionWorkflowService,
  requisitionConvertToPOSchema,
  RequisitionConvertToPODTO,
} from "@/services/purchasing/requisition";

/**
 * POST /api/purchasing/requisitions/:id/convert-to-po
 * Convert a requisition to a purchase order
 *
 * Permission: purchase_orders:create (dedicated PO-creation permission)
 * Roles with this permission: Finance Manager, Purchasing Manager, Admin
 */
export const POST = createApiHandler(
  {
    hasParams: true,
    bodySchema: requisitionConvertToPOSchema,
    permission: "purchase_orders:create",
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<
      { id: string },
      RequisitionConvertToPODTO
    >,
  ) => {
    const purchaseOrderId = await requisitionWorkflowService.convertToPO(
      context.serviceContext,
      context.params.id,
      context.data,
    );

    return success(
      { purchaseOrderId },
      "Requisition converted to purchase order successfully",
    );
  },
);
