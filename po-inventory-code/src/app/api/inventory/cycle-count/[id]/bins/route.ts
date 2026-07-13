/**
 * Master Cycle Count Bins API Route
 *
 * GET - Get list of bins in this count
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { masterCycleCountService } from "@/services/inventory/cycle-count/master-cycle-count.service";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/inventory/cycle-count/[id]/bins
 * Get list of all bins in this cycle count with statistics
 */
export const GET = createApiHandler(
  { hasParams: true },
  async (_req: NextRequest, context: ApiContextWithParams) => {
    try {
    const id = context.params.id;

    // Get all items for this cycle count
    const items = await masterCycleCountService.getCountItems(id);

    // Group by bin and calculate statistics
    const binMap = new Map<
      string,
      {
        bin: string;
        totalItems: number;
        countedItems: number;
        itemsWithVariance: number;
        totalValue: number;
      }
    >();

    for (const item of items) {
      const bin = item.bin || "MAIN";

      if (!binMap.has(bin)) {
        binMap.set(bin, {
          bin,
          totalItems: 0,
          countedItems: 0,
          itemsWithVariance: 0,
          totalValue: 0,
        });
      }

      const binStats = binMap.get(bin);
      if (!binStats) continue;

      binStats.totalItems++;

      if (
        item.status === "COUNTED" ||
        item.status === "VERIFIED" ||
        item.status === "RECOUNTED"
      ) {
        binStats.countedItems++;
      }

      if (item.hasVariance) {
        binStats.itemsWithVariance++;
      }

      binStats.totalValue +=
        Number(item.systemQuantity) * Number(item.systemUnitCost);
    }

    // Convert to array and sort alphabetically
    const bins = Array.from(binMap.values()).sort((a, b) =>
      a.bin.localeCompare(b.bin)
    );

    return success(bins, "Bins retrieved successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
