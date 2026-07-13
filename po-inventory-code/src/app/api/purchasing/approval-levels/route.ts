// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandler, createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { success, created } from "@/lib/api-response";
import { ValidationError, NotFoundError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/**
 * GET /api/purchasing/approval-levels
 * Fetch all approval levels
 */
export const GET = createGetHandler(
  async (_request: NextRequest, _context: BaseApiContext) => {
    const levels = await prisma.requisitionApprovalLevel.findMany({
      orderBy: { level: "asc" },
    });

    return success(levels);
  }
);

/**
 * POST /api/purchasing/approval-levels
 * Create a new approval level
 */
const createLevelSchema = z.object({
  level: z.number().int().positive(),
  name: z.string().min(1),
  levelType: z.enum(["SUPERVISOR", "MANAGER", "EXECUTIVE", "BOARD"]),
  minAmount: z.number().nonnegative(),
  maxAmount: z.number().nonnegative().nullable(),
  description: z.string().optional(),
  requiresAllApprovers: z.boolean().default(false),
  autoApproveThreshold: z.number().nonnegative().nullable().optional(),
});

export const POST = createApiHandler(
  {},
  async (request: NextRequest, _context: BaseApiContext) => {
    try {
    const body = await request.json() as Record<string, unknown>;
    const validatedData = createLevelSchema.parse(body);

    // Check if level number already exists
    const existingLevel = await prisma.requisitionApprovalLevel.findFirst({
      where: {
        level: validatedData.level
      },
    });

    if (existingLevel) {
      throw new ValidationError(
        `A level with this number already exists (${existingLevel.isActive ? 'active' : 'inactive'}). Please use a different level number or edit the existing level.`
      );
    }

    // Validate amount ranges
    if (
      validatedData.maxAmount !== null &&
      validatedData.maxAmount < validatedData.minAmount
    ) {
      throw new ValidationError("Maximum amount must be greater than minimum amount");
    }

    const newLevel = await prisma.requisitionApprovalLevel.create({
      data: {
        level: validatedData.level,
        name: validatedData.name,
        levelType: validatedData.levelType,
        minAmount: validatedData.minAmount,
        maxAmount: validatedData.maxAmount,
        description: validatedData.description,
        requiresAllApprovers: validatedData.requiresAllApprovers,
        isActive: true,
      },
    });

    return created(newLevel);
  
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
