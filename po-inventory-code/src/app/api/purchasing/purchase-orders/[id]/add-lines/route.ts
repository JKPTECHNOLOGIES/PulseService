/**
 * Purchase Order Add Lines API Route
 *
 * POST /api/purchasing/purchase-orders/[id]/add-lines
 * Add approved requisition lines to an existing purchase order.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { purchaseOrderAddLinesService } from "@/services/purchasing/purchase-order/purchase-order-add-lines.service";

/**
 * Schema for add-lines request body
 */
const addLinesToPOSchema = z.object({
  lines: z
    .array(
      z.object({
        requisitionId: z.string().uuid("Invalid requisition ID"),
        requisitionLineIds: z
          .array(z.string().uuid("Invalid requisition line ID"))
          .min(1, "At least one requisition line ID is required"),
      }),
    )
    .min(1, "At least one requisition with lines is required"),
});

type AddLinesToPOBody = z.infer<typeof addLinesToPOSchema>;

/**
 * POST /api/purchasing/purchase-orders/[id]/add-lines
 * Add approved requisition lines to an existing purchase order
 *
 * Permission: purchase_orders:create (dedicated PO-creation permission)
 * (Adding lines to a PO creates new committed procurement records;
 * gated to same roles that can create a PO: Finance Manager, Purchasing Manager, Admin)
 */
export const POST = createApiHandler(
  {
    bodySchema: addLinesToPOSchema,
    hasParams: true,
    permission: "purchase_orders:create",
  },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, AddLinesToPOBody>,
  ) => {
    const result = await purchaseOrderAddLinesService.addLinesToPO(
      context.params.id,
      context.data,
      context.serviceContext,
    );

    return success(
      result,
      `Successfully added ${result.addedLineCount} line(s) to purchase order`,
    );
  },
);
