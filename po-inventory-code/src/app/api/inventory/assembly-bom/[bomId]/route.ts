/**
 * Assembly BOM row API — update & delete a single learned BOM row.
 *
 * PATCH  /api/inventory/assembly-bom/:bomId  → set typicalQuantity (manual override)
 * DELETE /api/inventory/assembly-bom/:bomId  → remove the component from the BOM
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { success, noContent } from "@/lib/api-response";
import {
  createApiHandler,
  createDeleteHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { assemblyTrackingService } from "@/services/inventory/assembly-tracking.service";

const updateBomSchema = z.object({
  typicalQuantity: z.number().positive(),
});
type UpdateBomDTO = z.infer<typeof updateBomSchema>;

export const PATCH = createApiHandler<UpdateBomDTO, { bomId: string }>(
  { bodySchema: updateBomSchema, hasParams: true },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ bomId: string }, UpdateBomDTO>,
  ) => {
    const entry = await assemblyTrackingService.updateBomEntry(
      context.serviceContext,
      context.params.bomId,
      context.data,
    );
    return success(entry, "Assembly BOM updated");
  },
);

export const DELETE = createDeleteHandler<{ bomId: string }>(
  async (
    _req: NextRequest,
    context: ApiContextWithParams<{ bomId: string }>,
  ) => {
    await assemblyTrackingService.deleteBomEntry(
      context.serviceContext,
      context.params.bomId,
    );
    return noContent();
  },
);
