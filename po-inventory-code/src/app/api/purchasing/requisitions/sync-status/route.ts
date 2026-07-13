/**
 * Requisition Status Sync API Route
 *
 * POST /api/purchasing/requisitions/sync-status - Sync all requisition statuses
 * POST /api/purchasing/requisitions/sync-status?requisitionId=xxx - Sync a single requisition
 *
 * Retroactively syncs requisition header & line statuses based on
 * actual PO receiving data. Run once after deploying the sync service
 * to fix existing data, or on-demand as needed.
 */

import { NextRequest } from "next/server";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { requisitionStatusSyncService } from "@/services/purchasing/requisition/requisition-status-sync.service";

export const POST = createApiHandler(
  {},
  async (req: NextRequest, _context: BaseApiContext) => {
    const url = new URL(req.url);
    const requisitionId = url.searchParams.get("requisitionId");

    if (requisitionId) {
      // Sync a single requisition
      const result = await requisitionStatusSyncService.syncRequisitionStatus(requisitionId);
      return success(result, `Requisition ${result.reqNumber} sync: ${result.changed ? "updated" : "no change"}`);
    }

    // Sync all linked requisitions
    const results = await requisitionStatusSyncService.syncAllLinkedRequisitions();
    const changed = results.filter((r) => r.changed);
    const summary = {
      total: results.length,
      updated: changed.length,
      unchanged: results.length - changed.length,
      details: changed,
    };

    return success(summary, `Synced ${results.length} requisitions, ${changed.length} updated`);
  }
);
