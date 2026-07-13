// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandler, createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
// Schema for approval settings
const approvalSettingsSchema = z.object({
  globalAutoApproveThreshold: z.number().min(0),
});

/**
 * GET /api/purchasing/approval-settings
 * Retrieve global approval settings
 */
export const GET = createGetHandler(
  async (_request: NextRequest, _context: BaseApiContext) => {
    // Get or create the approval settings record (single-row table)
    const settings = await prisma.approvalSettings.findFirst() ??
      await prisma.approvalSettings.create({
        data: {
          globalAutoApproveThreshold: 0,
        },
      });

    return success({
      globalAutoApproveThreshold: settings.globalAutoApproveThreshold.toNumber(),
    });
  }
);

/**
 * PUT /api/purchasing/approval-settings
 * Update global approval settings
 */
export const PUT = createApiHandler(
  {},
  async (request: NextRequest, context: BaseApiContext) => {
    try {
    const body = await request.json() as Record<string, unknown>;
    const validatedData = approvalSettingsSchema.parse(body);

    // Get or create the settings record
    let settings = await prisma.approvalSettings.findFirst();
    
    if (!settings) {
      // Create if doesn't exist
      settings = await prisma.approvalSettings.create({
        data: {
          globalAutoApproveThreshold: validatedData.globalAutoApproveThreshold,
          updatedBy: context.serviceContext.userId,
        },
      });
    } else {
      // Update existing record
      settings = await prisma.approvalSettings.update({
        where: { id: settings.id },
        data: {
          globalAutoApproveThreshold: validatedData.globalAutoApproveThreshold,
          updatedBy: context.serviceContext.userId,
          updatedAt: new Date(),
        },
      });
    }

    return success({
      globalAutoApproveThreshold: settings.globalAutoApproveThreshold.toNumber(),
    });
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
