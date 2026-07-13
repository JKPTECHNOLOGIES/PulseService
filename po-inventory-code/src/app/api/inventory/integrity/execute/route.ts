/**
 * POST /api/inventory/integrity/execute
 * Triggers a live integrity run — finds and applies all corrections.
 * Requires inventory:manage permission.
 */

import { createApiHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { AuthorizationError } from "@/lib/api-errors";
import { inventoryIntegrityMonitor } from "@/lib/cron/inventory-integrity-monitor";

export const POST = createApiHandler({}, async (_req, context) => {
  const hasPermission = context.serviceContext.permissions.some(
    (p) => p.resource === "inventory" && p.action === "manage" && p.isActive,
  );
  if (!hasPermission) {
    throw new AuthorizationError("Insufficient permissions to run integrity monitor");
  }

  await inventoryIntegrityMonitor.execute();

  return success({
    message: "Integrity run triggered",
    executedBy: context.serviceContext.userName,
    executedAt: new Date().toISOString(),
  });
});
