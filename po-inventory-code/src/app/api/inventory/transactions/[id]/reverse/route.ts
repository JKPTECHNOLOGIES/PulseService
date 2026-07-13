import { NextRequest } from "next/server";
import {
  createApiHandler,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
  InternalServerError,
} from "@/lib/api-errors";
import { directIssueService } from "@/services/inventory/direct-issue/direct-issue.service";
import { directIssueReverseSchema } from "@/services/inventory/direct-issue/direct-issue.types";

/**
 * POST /api/inventory/transactions/[id]/reverse
 * Reverse an inventory transaction (DIRECT_ISSUE or WO_PART_ISSUED)
 *
 * Restores stock, creates a reversal transaction record,
 * marks the original as reversed, updates DirectIssue status,
 * and reverses the associated GL transaction.
 */
export const POST = createApiHandler(
  { hasParams: true, permission: "inventory:issue" },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
      const body: unknown = await request.json();
      const transactionId = context.params.id;

      // Validate the request body
      const parsed = directIssueReverseSchema.safeParse(body);
      if (!parsed.success) {
        throw ValidationError.fromZodError(parsed.error);
      }

      const result = await directIssueService.reverseIssue(
        transactionId,
        parsed.data,
        context.serviceContext,
      );

      if (!result.success) {
        throw new ValidationError(result.message);
      }

      return success(result);
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
      throw new InternalServerError(
        "An error occurred while reversing the transaction",
        {
          suggestion:
            "Please try again. If the problem persists, contact support.",
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
);
