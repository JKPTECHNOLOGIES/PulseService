/**
 * ABC Classification Settings API Routes
 *
 * GET - Get current classification settings
 * PUT - Update classification settings
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandler, createApiHandler } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { abcClassificationService } from "@/services/inventory/abc-classification";
import { updateSettingsSchema } from "@/services/inventory/abc-classification/abc-classification.types";
import { InternalServerError } from "@/lib/api-errors";
/**
 * GET /api/inventory/abc-classification/settings
 * Get current classification settings
 */
export const GET = createGetHandler(async (_req: NextRequest, _context) => {
  const settings = await abcClassificationService.getSettings();
  return success(settings, "Settings retrieved successfully");
});

/**
 * PUT /api/inventory/abc-classification/settings
 * Update classification settings
 */
export const PUT = createApiHandler(
  { bodySchema: updateSettingsSchema },
  async (_req: NextRequest, context) => {
    try {
    const userId = context.serviceContext.userId;

    const settings = await abcClassificationService.updateSettings(
      context.data,
      userId
    );

    return success(settings, "Settings updated successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
