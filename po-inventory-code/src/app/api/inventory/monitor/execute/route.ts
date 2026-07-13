/**
 * Inventory Monitor Execute API
 *
 * POST /api/inventory/monitor/execute - Execute inventory monitor to check levels and create requisitions
 */

import { success } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { inventoryMonitor } from "@/lib/cron/inventory-monitor";
import { AuthorizationError, ValidationError, NotFoundError, InternalServerError } from "@/lib/api-errors";

/**
 * POST /api/inventory/monitor/execute
 *
 * Execute the inventory monitor to check stock levels and create requisitions
 * for items below reorder points. This can be run manually by administrators
 * or automatically by the cron job.
 *
 * @permission inventory:create (to create requisitions)
 *
 * Response:
 * - success: boolean
 * - itemsChecked: number
 * - itemsBelowReorder: number
 * - requisitionsCreated: number
 * - errors: array of error objects
 * - duration: number (milliseconds)
 * - message: string
 */
export const POST = createApiHandler({}, async (_req, context) => {
    try {
  // Check if user has permission to create requisitions
  const hasPermission = context.serviceContext.permissions.some(
    (p) => p.resource === "inventory" && p.action === "create" && p.isActive
  );

  if (!hasPermission) {
    throw new AuthorizationError(
      "Insufficient permissions to execute inventory monitor"
    );
  }

  // Execute inventory monitor
  const startTime = Date.now();
  await inventoryMonitor.execute();
  const duration = Date.now() - startTime;

  // Note: The actual results are logged internally by the monitor
  // This endpoint just triggers the execution
  return success({
    success: true,
    message: "Inventory monitor executed successfully",
    duration,
    executedBy: context.serviceContext.userName,
    executedAt: new Date().toISOString(),
  });

    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthorizationError
      ) {
        throw error;
      }
      
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
