/**
 * POST /api/inventory/integrity/scan
 * Dry-run — returns what the integrity monitor WOULD correct without applying any writes.
 * Safe to call at any time. Requires inventory:read permission.
 */

import { createApiHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { AuthorizationError } from "@/lib/api-errors";
import { inventoryIntegrityService } from "@/services/inventory/inventory-integrity.service";

export const POST = createApiHandler({}, async (_req, context) => {
  const hasPermission = context.serviceContext.permissions.some(
    (p) => p.resource === "inventory" && p.action === "read" && p.isActive,
  );
  if (!hasPermission) {
    throw new AuthorizationError("Insufficient permissions");
  }

  const issues = await inventoryIntegrityService.scan();

  return success({
    issuesFound: issues.length,
    scannedAt:   new Date().toISOString(),
    issues,
  });
});
