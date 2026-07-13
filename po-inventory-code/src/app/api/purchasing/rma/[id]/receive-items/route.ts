/**
 * RMA Receive Items Back API Route
 *
 * POST /api/purchasing/rma/[id]/receive-items
 *
 * Inventory manager closure path: items physically returned to our facility.
 * Processes per-line dispositions (RESTOCK / SCRAP / REPAIR) in a single
 * request and auto-completes the RMA when all lines are dispositioned.
 */

export const dynamic = "force-dynamic";

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { receiveItemsBack } from "@/services/purchasing/rma/rma.service";
import { rmaReceiveItemsBackSchema } from "@/services/purchasing/rma/rma.types";
import { InternalServerError } from "@/lib/api-errors";

export const POST = createApiHandler(
  { hasParams: true },
  async (req, context) => {
    try {
      const body = await req.json() as Record<string, unknown>;
      const data = rmaReceiveItemsBackSchema.parse(body);

      const rma = await receiveItemsBack(
        context.serviceContext,
        context.params.id,
        data,
      );

      return success(rma, "Items received back successfully");
    } catch (error) {
      throw new InternalServerError("An error occurred while processing your request", {
        suggestion: "Please try again. If the problem persists, contact support.",
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
