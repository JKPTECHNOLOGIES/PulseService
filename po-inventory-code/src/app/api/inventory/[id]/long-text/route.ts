import { NextRequest } from "next/server";
import { createApiHandler, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import { z } from "zod";

const updateLongTextSchema = z.object({
  longText: z.string().nullable(),
});

export const PATCH = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
    const body = await request.json() as Record<string, unknown>;
    const { longText } = updateLongTextSchema.parse(body);

    // Check if inventory item exists
    const existingItem = await prisma.inventoryItem.findUnique({
      where: { id: context.params.id },
    });

    if (!existingItem) {
      throw new NotFoundError("Inventory item not found");
    }

    // Update the long text field
    const updatedItem = await prisma.inventoryItem.update({
      where: { id: context.params.id },
      data: {
        longText,
        updatedAt: new Date(),
      },
    });

    return success(updatedItem);
  
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
