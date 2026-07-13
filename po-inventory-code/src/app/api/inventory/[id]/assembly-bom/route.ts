/**
 * Assembly BOM API — list & add components for an assembly inventory item.
 *
 * GET  /api/inventory/:id/assembly-bom  → learned BOM rows for the assembly
 * POST /api/inventory/:id/assembly-bom  → manually add a component to the BOM
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createApiHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { assemblyTrackingService } from "@/services/inventory/assembly-tracking.service";

export const GET = createGetHandlerWithParams<{ id: string }>(
  async (_req: NextRequest, context: ApiContextWithParams<{ id: string }>) => {
    const bom = await assemblyTrackingService.getAssemblyBom(
      context.serviceContext,
      context.params.id,
    );
    return success(bom, "Assembly BOM retrieved successfully");
  },
);

const addBomSchema = z.object({
  componentItemId: z.string().uuid(),
  typicalQuantity: z.number().positive(),
});
type AddBomDTO = z.infer<typeof addBomSchema>;

export const POST = createApiHandler<AddBomDTO, { id: string }>(
  { bodySchema: addBomSchema, hasParams: true },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, AddBomDTO>,
  ) => {
    const entry = await assemblyTrackingService.addBomEntry(
      context.serviceContext,
      context.params.id,
      context.data,
    );
    return success(entry, "Component added to assembly BOM");
  },
);
