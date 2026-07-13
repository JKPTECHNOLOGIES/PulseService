// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandlerWithParams, createApiHandler, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { NotFoundError, ValidationError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { requisitionApprovalService } from "@/services/requisitions/approval/requisition-approval.service";

/**
 * GET /api/purchasing/approval-levels/[id]
 * Fetch a specific approval level
 */
export const GET = createGetHandlerWithParams(
  async (_request: NextRequest, context: ApiContextWithParams) => {
    const level = await prisma.requisitionApprovalLevel.findUnique({
      where: { id: context.params.id },
      include: {
        userAuthorities: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!level) {
      throw new NotFoundError("Approval level not found");
    }

    return success(level);
  }
);

/**
 * PUT /api/purchasing/approval-levels/[id]
 * Update an approval level
 */
const updateLevelSchema = z.object({
  name: z.string().min(1).optional(),
  levelType: z.enum(["SUPERVISOR", "MANAGER", "EXECUTIVE", "BOARD"]).optional(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().nonnegative().nullable().optional(),
  description: z.string().optional(),
  requiresAllApprovers: z.boolean().optional(),
  isActive: z.boolean().optional(),
  autoApproveThreshold: z.number().nonnegative().nullable().optional(),
});

export const PUT = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
    const body = await request.json() as Record<string, unknown>;
    const validatedData = updateLevelSchema.parse(body);

    // Check if level exists
    const existingLevel = await prisma.requisitionApprovalLevel.findUnique({
      where: { id: context.params.id },
    });

    if (!existingLevel) {
      throw new NotFoundError("Approval level not found");
    }

    // Validate amount ranges if both are provided
    const minAmount = validatedData.minAmount ?? Number(existingLevel.minAmount);
    const maxAmount = validatedData.maxAmount ?? (existingLevel.maxAmount ? Number(existingLevel.maxAmount) : null);

    if (maxAmount !== null && maxAmount < minAmount) {
      throw new ValidationError("Maximum amount must be greater than minimum amount");
    }

    const updatedLevel = await prisma.requisitionApprovalLevel.update({
      where: { id: context.params.id },
      data: validatedData,
    });

    // If minAmount or maxAmount changed, recalculate pending approvals
    // so existing PENDING records are reassigned to the correct level.
    // Wrapped in try/catch — recalculation failures must NOT break the level update.
    const minAmountChanged = validatedData.minAmount !== undefined &&
      validatedData.minAmount !== Number(existingLevel.minAmount);
    const maxAmountChanged = validatedData.maxAmount !== undefined &&
      (existingLevel.maxAmount === null
        ? validatedData.maxAmount !== null
        : validatedData.maxAmount !== Number(existingLevel.maxAmount));

    if (minAmountChanged || maxAmountChanged) {
      try {
        const result = await requisitionApprovalService.recalculatePendingApprovals();
        logger.info(
          `[ApprovalLevels] Recalculated pending approvals after level update: ` +
          `${result.recalculated} recalculated, ${result.errors.length} error(s)`,
          result.errors.length > 0 ? result.errors : undefined,
        );
      } catch (recalcError) {
        // Non-fatal: log and continue — the level update already succeeded
        logger.error(
          `[ApprovalLevels] Failed to recalculate pending approvals after level update:`,
          recalcError instanceof Error ? recalcError.message : String(recalcError),
        );
      }
    }

    return success(updatedLevel);
  
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

/**
 * DELETE /api/purchasing/approval-levels/[id]
 * Delete an approval level (soft delete if active, hard delete if already inactive)
 */
export const DELETE = createApiHandler(
  { hasParams: true },
  async (_request: NextRequest, context: ApiContextWithParams) => {
    try {
    // Check if level exists
    const existingLevel = await prisma.requisitionApprovalLevel.findUnique({
      where: { id: context.params.id },
      include: {
        userAuthorities: true, // Get all authorities, not just active ones
      },
    });

    if (!existingLevel) {
      throw new NotFoundError("Approval level not found");
    }

    // If level is already inactive and has no authorities, allow hard delete
    if (!existingLevel.isActive && existingLevel.userAuthorities.length === 0) {
      await prisma.requisitionApprovalLevel.delete({
        where: { id: context.params.id },
      });
      return success({ message: "Approval level permanently deleted" });
    }

    // Check if there are any authorities (active or inactive)
    if (existingLevel.userAuthorities.length > 0) {
      const activeCount = existingLevel.userAuthorities.filter(a => a.isActive).length;
      throw new ValidationError(
        `Cannot delete approval level with ${activeCount > 0 ? 'active' : 'existing'} authorities. Please revoke all authorities first.`
      );
    }

    // Soft delete active levels by setting isActive to false
    const deletedLevel = await prisma.requisitionApprovalLevel.update({
      where: { id: context.params.id },
      data: { isActive: false },
    });

    return success(deletedLevel);
  
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
