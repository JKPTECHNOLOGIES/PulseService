/**
 * Inventory Reservations API Routes
 *
 * Main CRUD endpoints for inventory reservation management.
 * Uses the reservation service layer for business logic.
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 30; // Cache for 30 seconds (more frequent updates for reservations)

import { NextRequest } from "next/server";
import { created, paginated } from "@/lib/api-response";
import {
  createApiHandler,
  createPostHandler,
  BaseApiContext,
  ApiContextWithData,
} from "@/lib/api-middleware-v2";
import { reservationService } from "@/services/inventory/reservation";
import {
  reservationCreateSchema,
  ReservationCreateDTO,
  ReservationStatus,
} from "@/services/inventory/reservation/reservation.types";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/services/shared/permissions";
import {
  buildPermissionString,
  PermissionAction,
  PermissionResource,
} from "@/types/permissions";
import { z } from "zod";
import { InternalServerError } from "@/lib/api-errors";
/**
 * Query parameters schema for listing reservations
 */
const listQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .default("1")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  limit: z
    .string()
    .optional()
    .default("10")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(100)), // Reduced from 1000 to 100 to prevent memory issues
  inventoryItemId: z.string().min(1).optional(),
  status: z.nativeEnum(ReservationStatus).optional(),
  reservedBy: z.string().min(1).optional(),
  reservedFor: z.string().optional(),
  reservedForId: z.string().min(1).optional(),
  includeExpired: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  search: z.string().optional(),
});

/**
 * GET /api/inventory/reservations
 * List all reservations with pagination, filtering, and search
 */
export const GET = createApiHandler(
  {},
  async (req: NextRequest, context: BaseApiContext) => {
    try {
    // Check permission
    const permission = buildPermissionString(
      PermissionResource.INVENTORY,
      PermissionAction.READ
    );
    await checkPermission(context.serviceContext, permission);

    // Parse and validate query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const validatedQuery = listQuerySchema.parse(queryParams);

    const {
      page,
      limit,
      search,
      inventoryItemId,
      status,
      reservedBy,
      reservedFor,
      reservedForId,
      includeExpired,
    } = validatedQuery;

    // Build where clause
    const where: Record<string, unknown> = {};
    if (inventoryItemId) where.inventoryItemId = inventoryItemId;
    if (status) where.status = status;
    if (reservedBy) where.reservedBy = reservedBy;
    if (reservedFor) where.reservedFor = reservedFor;
    if (reservedForId) where.reservedForId = reservedForId;

    // Exclude expired unless explicitly requested
    if (!includeExpired) {
      where.status = { not: ReservationStatus.EXPIRED };
    }

    // Add search filter if provided
    if (search) {
      where.notes = { contains: search, mode: "insensitive" };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Execute query
    const [reservations, total] = await Promise.all([
      prisma.inventoryReservation.findMany({
        where,
        include: {
          inventoryItem: {
            select: {
              id: true,
              sku: true,
              description: true,
              unit: true,
              unitCost: true,
              stock: {
                select: {
                  bin: true,
                  quantityOnHand: true,
                  quantityReserved: true,
                },
              },
            },
          },
          reservedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          cancelledByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          consumedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.inventoryReservation.count({ where }),
    ]);

    // Fetch work order numbers for reservations that reference work orders
    const workOrderIds = reservations
      .filter((r) => r.reservedFor === "WorkOrder" && r.reservedForId)
      .map((r) => r.reservedForId as string);

    const workOrders =
      workOrderIds.length > 0
        ? await prisma.workOrder.findMany({
            where: { id: { in: workOrderIds } },
            select: { id: true, woNumber: true, title: true },
          })
        : [];

    const workOrderMap = new Map(workOrders.map((wo) => [wo.id, wo]));

    // Fetch PM instance info for reservations that reference PM schedules
    const pmInstanceIds = reservations
      .filter((r) => r.reservedFor === "PMSchedule" && r.reservedForId)
      .map((r) => r.reservedForId as string);

    const pmInstances =
      pmInstanceIds.length > 0
        ? await prisma.pMInstance.findMany({
            where: { id: { in: pmInstanceIds } },
            select: {
              id: true,
              pmSchedule: {
                select: {
                  id: true,
                  pmTemplate: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          })
        : [];

    const pmInstanceMap = new Map(pmInstances.map((pm) => [pm.id, pm]));

    // Transform reservations with related data
    const transformedReservations = reservations.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      inventoryItem: {
        ...r.inventoryItem,
        unitCost: Number(r.inventoryItem.unitCost),
      },
      workOrder:
        r.reservedFor === "WorkOrder" && r.reservedForId
          ? workOrderMap.get(r.reservedForId) ?? null
          : null,
      pmInstance:
        r.reservedFor === "PMSchedule" && r.reservedForId
          ? pmInstanceMap.get(r.reservedForId) ?? null
          : null,
    }));

    const response = paginated(
      transformedReservations,
      {
        page,
        limit,
        total,
      },
      "Reservations retrieved successfully"
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=60"
    );
    return response;
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/inventory/reservations
 * Create a new reservation
 */
export const POST = createPostHandler(
  reservationCreateSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithData<ReservationCreateDTO>,
  ) => {
    // Call service
    const result = await reservationService.create(
      context.serviceContext,
      context.data
    );

    // Check if we got a stock check result (PROMPT_BASED mode)
    if (typeof result === 'object' && 'stockCheckResult' in result) {
      return created({
        success: true,
        stockCheckResult: result.stockCheckResult,
      }, "Stock check required");
    }

    // Normal reservation created
    return created(result, "Reservation created successfully");
  }
);
