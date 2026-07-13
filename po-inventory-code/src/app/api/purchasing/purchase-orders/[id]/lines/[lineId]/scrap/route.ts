/**
 * Scrap Repairable PO Line API Route
 *
 * POST /api/purchasing/purchase-orders/:id/lines/:lineId/scrap
 *
 * Scraps a REPAIRABLE_RETURN line from the PO when the vendor cannot repair the
 * part: cancels the single line (lineStatus=CANCELLED, REPAIRABLE_SCRAP), scraps
 * the linked serial, marks the repair history/WO SCRAPPED, recomputes the PO
 * total, and releases the line's commitment GL. Scrap-only — no replacement line.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { purchaseOrderLineScrapService } from "@/services/purchasing/purchase-order/purchase-order-line-scrap.service";

const scrapLineSchema = z.object({
  reason: z.string().min(1, "A scrap reason is required").max(500),
});

type ScrapLineData = z.infer<typeof scrapLineSchema>;

export const POST = createApiHandler(
  { hasParams: true, bodySchema: scrapLineSchema },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<
      { id: string; lineId: string },
      ScrapLineData
    >,
  ) => {
    const result = await purchaseOrderLineScrapService.scrapRepairableLine(
      context.serviceContext,
      context.params.id,
      context.params.lineId,
      { reason: context.data.reason },
    );

    return success(
      result,
      result.serialNumber
        ? `${result.serialNumber} scrapped and line cancelled on PO ${result.poNumber}.`
        : `Line cancelled on PO ${result.poNumber}.`,
    );
  },
);
