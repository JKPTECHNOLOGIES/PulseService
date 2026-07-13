/**
 * PATCH /api/purchasing/purchase-orders/[id]/lines/[lineId]/long-text
 *
 * Updates ONLY the longTextOverride on a single PO line.
 *
 * This is intentionally a standalone endpoint so users can edit supplier-facing
 * material notes at any point in the PO lifecycle without triggering a full PO
 * save (which re-validates quantities, prices, status guards, etc.).
 *
 * The material master (InventoryItem.longText) is NEVER touched here.
 *
 * null  → not yet set; print view falls back to inventoryItem.longText
 * ""    → explicitly cleared; print view shows nothing for this line
 * "..." → user-edited snapshot; print view shows this text
 */

export const dynamic = "force-dynamic";

import { z } from "zod";
import { success } from "@/lib/api-response";
import { createPutHandler } from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";

const updateLongTextSchema = z.object({
  // null = clear override (fall back to material master on print)
  // ""   = suppress (show nothing on print)
  // str  = PO-specific snapshot
  longTextOverride: z.string().max(5000).nullable(),
});

export const PATCH = createPutHandler<
  { longTextOverride: string | null },
  { id: string; lineId: string }
>(
  updateLongTextSchema,
  async (_req, context) => {
    const { id: poId, lineId } = context.params;

    // Verify the line belongs to this PO to prevent cross-tenant edits
    const existing = await prisma.pOLine.findFirst({
      where: { id: lineId, purchaseOrderId: poId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError("POLine", lineId);
    }

    const updated = await prisma.pOLine.update({
      where: { id: lineId },
      data: { longTextOverride: context.data.longTextOverride },
      select: {
        id: true,
        longTextOverride: true,
      },
    });

    return success(updated, "Line notes updated successfully");
  },
);
