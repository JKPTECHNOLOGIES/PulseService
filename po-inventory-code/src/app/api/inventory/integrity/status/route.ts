/**
 * GET /api/inventory/integrity/status
 * Returns whether the integrity monitor cron is active and when it last ran.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { createGetHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { inventoryIntegrityMonitor } from "@/lib/cron/inventory-integrity-monitor";
import { jobRegistry } from "@/lib/cron/job-registry";

const JOB_NAME = "inventory-integrity-monitor";

export const GET = createGetHandler((_req: NextRequest, _context: BaseApiContext) => {
  const status   = jobRegistry.getJobStatus(JOB_NAME);
  const isActive = inventoryIntegrityMonitor.isActive();
  const envEnabled = process.env.INVENTORY_INTEGRITY_ENABLED === "true";

  return success({
    envEnabled,
    cronActive:     isActive,
    isRunning:      status?.isRunning ?? false,
    lastRun:        status?.lastRun ?? null,
    nextRunAt:      status?.nextRunAt ?? null,
    schedule:       inventoryIntegrityMonitor.getSchedule(),
    totalRuns:      status?.totalRuns ?? 0,
    totalFailures:  status?.totalFailures ?? 0,
  });
});
