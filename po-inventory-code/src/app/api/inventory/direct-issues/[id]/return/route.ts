/**
 * Direct Issue Return API Route
 *
 * POST /api/inventory/direct-issues/[id]/return - Process return from direct issue
 */

import { createApiHandler } from "@/lib/api-middleware-v2";
import { created, badRequest, serverError } from "@/lib/api-response";
import { directIssueService } from "@/services/inventory/direct-issue";
import { directIssueReturnSchema } from "@/services/inventory/direct-issue/direct-issue.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * POST /api/inventory/direct-issues/[id]/return
 * Process return from direct issue
 */
export const POST = createApiHandler(
  { bodySchema: directIssueReturnSchema, hasParams: true },
  async (_req, context) => {
    try {
    const result = await directIssueService.returnIssue(
      context.serviceContext,
      context.params.id,
      context.data
    );

    if (!result.success) {
      if (result.errorCode === "INVALID_RETURN") {
        return badRequest(result.error ?? "Invalid return");
      }
      return serverError(result.error ?? "Failed to process return");
    }

    return created(
      {
        return: result.return,
        updatedIssue: result.updatedIssue,
      },
      "Return processed successfully"
    );
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
