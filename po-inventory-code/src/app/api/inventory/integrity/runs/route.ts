/**
 * GET /api/inventory/integrity/runs
 *
 * Returns the last N inventory integrity run summaries and their individual
 * corrections from the AuditLog.  Used by the Integrity Monitor review page.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { createGetHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export type { IntegrityIssue } from "@/services/inventory/inventory-integrity.service";

export interface IntegrityRunSummary {
  id: string;
  runAt: string;
  itemsChecked: number;
  issuesFound: number;
  issuesCorrected: number;
  errorCount: number;
  durationMs: number;
  breakdown: Record<string, number>;
  errors: Array<{ checkId: string; error: string }>;
}

export interface IntegrityCorrection {
  id: string;
  timestamp: string;
  checkId: string;
  inventoryItemId: string | null;
  sku: string | null;
  description: string;
  correction: string;
}

export interface IntegrityRunsResponse {
  runs: IntegrityRunSummary[];
  corrections: IntegrityCorrection[];
  lastRunAt: string | null;
  totalRunsInPeriod: number;
}

export const GET = createGetHandler(async (req: NextRequest, _context: BaseApiContext) => {
  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "48"), 200); // max 48 runs
  const days   = parseInt(searchParams.get("days") ?? "7");
  const since  = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // ── Fetch run summaries from AuditLog ──────────────────────────────────────
  const runLogs = await prisma.auditLog.findMany({
    where: {
      action: "INVENTORY_INTEGRITY_RUN_COMPLETE",
      entityType: "System",
      timestamp: { gte: since },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      id: true,
      timestamp: true,
      metadata: true,
    },
  });

  const runs: IntegrityRunSummary[] = runLogs.map((log) => {
    // logSystemEvent stores the metadata dict in the `metadata` column, not `changes`
    const meta = (log.metadata as Record<string, unknown> | null) ?? {};
    return {
      id:              log.id,
      runAt:           log.timestamp.toISOString(),
      itemsChecked:    Number(meta.itemsChecked ?? 0),
      issuesFound:     Number(meta.issuesFound  ?? 0),
      issuesCorrected: Number(meta.issuesCorrected ?? 0),
      errorCount:      Number(meta.errorCount   ?? 0),
      durationMs:      Number(meta.durationMs   ?? 0),
      breakdown:       (meta.breakdown as Record<string, number> | null) ?? {},
      errors:          (meta.errors    as Array<{ checkId: string; error: string }> | null) ?? [],
    };
  });

  // ── Fetch individual correction events ────────────────────────────────────
  const correctionLogs = await prisma.auditLog.findMany({
    where: {
      action: "INTEGRITY_CORRECTION",
      timestamp: { gte: since },
    },
    orderBy: { timestamp: "desc" },
    take: 500,
    select: {
      id: true,
      timestamp: true,
      entityId: true,
      metadata: true,
    },
  });

  const corrections: IntegrityCorrection[] = correctionLogs.map((log) => {
    // logInventoryEvent stores the metadata dict in the `metadata` column, not `changes`
    const meta = (log.metadata as Record<string, unknown> | null) ?? {};
    return {
      id:              log.id,
      timestamp:       log.timestamp.toISOString(),
      checkId:         String(meta.checkId ?? "UNKNOWN"),
      inventoryItemId: log.entityId ?? null,
      sku:             (meta.sku as string | null) ?? null,
      description:     String(meta.description ?? ""),
      correction:      String(meta.correction ?? ""),
    };
  });

  return success<IntegrityRunsResponse>({
    runs,
    corrections,
    lastRunAt:         runs[0]?.runAt ?? null,
    totalRunsInPeriod: runs.length,
  });
});
