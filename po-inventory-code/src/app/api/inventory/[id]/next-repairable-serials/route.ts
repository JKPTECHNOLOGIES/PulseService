/**
 * GET /api/inventory/[id]/next-repairable-serials?count=N&poLineId=...
 *
 * Read-only preview of the serial numbers that will be assigned when a repairable
 * item is received via PO. No DB writes — purely informational.
 *
 * Mirrors the receive service exactly:
 *   1. If poLineId is supplied, any serial preserved from a REVERSED receipt on
 *      that line is REUSED first (so a price/packing-slip correction keeps the
 *      same serial number) — newest first.
 *   2. Remaining units get newly-minted next-in-sequence numbers, using the same
 *      prefix/sequence logic as generateRepairableTrackingId.
 *
 * Returns { serials: string[], isRepairable: boolean }.
 * If the item is not repairable, returns { serials: [], isRepairable: false }.
 * If count is missing or invalid, defaults to 1. Max 50.
 */

import { NextRequest } from "next/server";
import {
  createGetHandlerWithParams,
  type ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";
import { RepairableStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = createGetHandlerWithParams<Params>(
  async (request: NextRequest, context: ApiContextWithParams<Params>) => {
    const inventoryItemId = context.params.id;
    const { searchParams } = new URL(request.url);

    const rawCount = parseInt(searchParams.get("count") ?? "1", 10);
    // Clamp: at least 1, at most 50 (no PO line realistically receives 50+ repairables)
    const count = Math.max(1, Math.min(50, isNaN(rawCount) ? 1 : rawCount));

    // Load the inventory item
    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { id: true, sku: true, isRepairable: true },
    });

    if (!inventoryItem)
      throw new NotFoundError("InventoryItem", inventoryItemId);

    if (!inventoryItem.isRepairable) {
      return success({ serials: [], isRepairable: false });
    }

    const prefix = `REP-${inventoryItem.sku}-`;

    // Step 1 — serials reused from a REVERSED receipt on this PO line (if known).
    // These keep their original number (matches receiveInventoryItem's reuse).
    const poLineId = searchParams.get("poLineId");
    let reusedSerials: string[] = [];
    if (poLineId) {
      const reusable = await prisma.repairableItem.findMany({
        where: {
          inventoryItemId,
          status: RepairableStatus.AVAILABLE,
          sourcePOLineReceipt: { poLineId, status: "REVERSED" },
        },
        orderBy: { createdAt: "desc" },
        take: count,
        select: { serialNumber: true },
      });
      reusedSerials = reusable.map((r) => r.serialNumber);
    }

    const remaining = count - reusedSerials.length;
    if (remaining <= 0) {
      return success({
        serials: reusedSerials.slice(0, count),
        isRepairable: true,
      });
    }

    // Find all existing serials with this prefix to determine the next number.
    // Same logic as generateRepairableTrackingId — numbers > 999 are treated as
    // legacy timestamp-based IDs and excluded from the sequence calculation.
    const existing = await prisma.repairableItem.findMany({
      where: { serialNumber: { startsWith: prefix } },
      select: { serialNumber: true },
    });

    let nextNumber = 1;
    if (existing.length > 0) {
      const numbers = existing
        .map((item: { serialNumber: string }) => {
          const parts = item.serialNumber.split("-");
          const num = parts[2] ? parseInt(parts[2], 10) : 0;
          return isNaN(num) ? 0 : num;
        })
        .filter((n: number) => n > 0 && n < 1000);

      if (numbers.length > 0) {
        nextNumber = Math.max(...numbers) + 1;
      }
    }

    // Build the predicted serial list: reused serials first, then newly-minted
    // next-in-sequence numbers for the remaining units. Not reserved — if another
    // receive runs concurrently the new numbers may shift, but for a preview this
    // is accurate enough.
    const newSerials = Array.from(
      { length: remaining },
      (_, i) => `${prefix}${nextNumber + i}`,
    );

    return success({
      serials: [...reusedSerials, ...newSerials],
      isRepairable: true,
    });
  },
);
