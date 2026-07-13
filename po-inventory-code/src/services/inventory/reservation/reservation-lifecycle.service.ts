/**
 * Reservation Lifecycle Service
 *
 * Service for managing reservation state transitions.
 * Handles consume, cancel, expire, and extend operations.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  ExtendedPermissionAction,
  buildPermissionString,
} from "@/types/permissions";
import { checkPermission } from "@/services/shared/permissions";
import {
  validateOrThrow,
  validateRequired,
} from "@/services/shared/validation";
import { toNumber } from "@/lib/decimal-helpers";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { logInventoryEvent } from "@/lib/event-logger";
import { inventoryStockService } from "@/services/inventory/stock";
import { logger } from "@/lib/logger";
import {
  ReservationConsumeDTO,
  ReservationCancelDTO,
  ReservationWithRelations,
  ReservationStatus,
  reservationConsumeSchema,
  reservationCancelSchema,
} from "./reservation.types";
import {
  buildReservationInclude,
  transformReservation,
  formatUserName,
  generateConsumptionNote,
  recalculateFifoActive,
} from "./reservation-utils";
import {
  validateCanConsume,
  validateCanCancel,
  validateConsumptionQuantity,
} from "./reservation-validation";

// Requisition services for auto-requisition creation




/**
 * Reservation Lifecycle Service Class
 *
 * Manages state transitions for reservations.
 * Handles consume, cancel, expire, and re-evaluation operations.
 */
class ReservationLifecycleService {
  private prisma: PrismaClient;
  private readonly resource = PermissionResource.INVENTORY;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Consume a reservation (mark as consumed and create work order parts)
   * Does NOT issue stock - that's the inventory manager's job
   */
  async consume(
    context: ServiceContext,
    id: string,
    data: ReservationConsumeDTO,
  ): Promise<ReservationWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.CONSUME,
    );
    await checkPermission(context, permission);

    // Validate consume data
    validateOrThrow(reservationConsumeSchema, data);

    // Get reservation with full context
    const reservation = await this.prisma.inventoryReservation.findUnique({
      where: { id },
      include: {
        inventoryItem: true,
        reservedByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!reservation) {
      throw new NotFoundError("Inventory Reservation", id);
    }

    // Validate can consume
    validateCanConsume({
      status: reservation.status as ReservationStatus,
      expiresAt: reservation.expiresAt,
    });

    // Validate quantity
    const reservedQty = toNumber(reservation.quantity) ?? 0;
    validateConsumptionQuantity(data.quantityConsumed, reservedQty);

    // Get work order context if this reservation is for a work order
    let workOrderContext: {
      workOrderId?: string;
      workOrderNumber?: string;
      equipmentId?: string;
      equipmentTag?: string;
    } = {};

    if (reservation.reservedFor === "WorkOrder" && reservation.reservedForId) {
      const workOrder = await this.prisma.workOrder.findUnique({
        where: { id: reservation.reservedForId },
        include: {
          equipment: {
            select: {
              id: true,
              tag: true,
            },
          },
        },
      });

      if (workOrder) {
        workOrderContext = {
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.woNumber,
          equipmentId: workOrder.equipment?.id ?? undefined,
          equipmentTag: workOrder.equipment?.tag ?? undefined,
        };
      }
    }

    // Get user details for tracking
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      select: {
        firstName: true,
        lastName: true,
      },
    });

    const userName = formatUserName(user);

    // Perform consumption in transaction
    await this.prisma.$transaction(async (tx) => {
      // Update reservation status
      await tx.inventoryReservation.update({
        where: { id },
        data: {
          status: ReservationStatus.CONSUMED,
          consumedAt: new Date(),
          consumedBy: context.userId,
          notes: data.notes
            ? `${reservation.notes ?? ""}\n\nConsumed: ${data.notes}`.trim()
            : reservation.notes,
        },
      });

      // If this is a work order reservation, create a WorkOrderPart entry
      if (
        reservation.reservedFor === "WorkOrder" &&
        reservation.reservedForId
      ) {
        // Check if a part already exists for this item on this work order
        const existingPart = await tx.workOrderPart.findFirst({
          where: {
            workOrderId: reservation.reservedForId,
            inventoryItemId: reservation.inventoryItemId,
            issuedAt: null, // Only match unissued parts
          },
        });

        const unitCost = toNumber(reservation.inventoryItem.unitCost) ?? 0;
        const consumeNote = generateConsumptionNote(
          userName,
          data.quantityConsumed,
          data.notes,
        );

        if (existingPart) {
          // Update existing part quantity
          const existingQty = toNumber(existingPart.quantityPlanned) ?? 0;
          const newQty = existingQty + data.quantityConsumed;

          await tx.workOrderPart.update({
            where: { id: existingPart.id },
            data: {
              quantityPlanned: newQty,
              totalCost: newQty * unitCost,
              notes: `${existingPart.notes ?? ""}\n\n${consumeNote}`.trim(),
              // Mark the WOP as ISSUED (the correct terminal status for a physically issued part).
              // "CONSUMED" is not a valid WorkOrderPartStatus — ISSUED is the correct value.
              status: "ISSUED",
              consumedAt: new Date(),
              consumedBy: context.userId,
            },
          });
        } else {
          // Create new WorkOrderPart entry
          await tx.workOrderPart.create({
            data: {
              workOrderId: reservation.reservedForId,
              inventoryItemId: reservation.inventoryItemId,
              quantityPlanned: data.quantityConsumed,
              quantityUsed: null, // NOT issued yet - inventory manager will issue later
              unitCost,
              totalCost: data.quantityConsumed * unitCost,
              issuedAt: null, // NOT issued yet - inventory manager will issue later
              notes: consumeNote,
            },
          });
        }
      }
    });

    // NOTE: Do NOT issue stock here - that's the inventory manager's job
    // Technicians "consume" reservations by moving them to work order parts
    // Inventory managers later "issue" the parts, which deducts from physical stock

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATION_CONSUMED",
      reservation.inventoryItemId,
      `Consumed ${data.quantityConsumed} units from reservation`,
      {
        reservationId: id,
        quantityConsumed: data.quantityConsumed,
        workOrderId: workOrderContext.workOrderId,
      },
    );

    // Return updated reservation
    const updated = await this.prisma.inventoryReservation.findUnique({
      where: { id },
      include: buildReservationInclude(),
    });

    return transformReservation(updated);
  }

  /**
   * Cancel a reservation (mark as cancelled, unreserve stock, and delete associated work order part)
   */
  async cancel(
    context: ServiceContext,
    id: string,
    data: ReservationCancelDTO,
  ): Promise<ReservationWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    // Validate cancel data
    validateOrThrow(reservationCancelSchema, data);

    // Get reservation
    const reservation = await this.prisma.inventoryReservation.findUnique({
      where: { id },
      include: { inventoryItem: true },
    });

    if (!reservation) {
      throw new NotFoundError("Inventory Reservation", id);
    }

    // Validate can cancel
    validateCanCancel({
      status: reservation.status as ReservationStatus,
    });

    const wasActive = reservation.status === ReservationStatus.ACTIVE;

    // Find and delete associated work order part if this is a work order reservation.
    // IMPORTANT: filter by reservationId to avoid deleting the wrong part when a
    // work order has multiple parts for the same inventory item (different reservations).
    if (reservation.reservedFor === "WorkOrder" && reservation.reservedForId) {
      const workOrderPart = await this.prisma.workOrderPart.findFirst({
        where: {
          workOrderId: reservation.reservedForId,
          inventoryItemId: reservation.inventoryItemId,
          reservationId: id, // Scope to THIS reservation only — prevents wrong-part deletion
          issuedAt: null, // Only delete unissued parts
        },
      });

      if (workOrderPart) {
        // Delete the work order part directly (bypassing the beforeDelete hook) to
        // prevent double-unreserving: the stock unreserve is handled below by this
        // method after the reservation is cancelled.
        await this.prisma.workOrderPart.delete({
          where: { id: workOrderPart.id },
        });

        // Recalculate FIFO flags for the remaining RESERVED parts so the next
        // work order in the queue correctly gets fifoActive=true.
        await recalculateFifoActive(this.prisma, reservation.inventoryItemId);
      }
    }

    // Update reservation
    await this.prisma.inventoryReservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: context.userId,
        notes: `${reservation.notes ?? ""}\n\nCancelled: ${data.reason}${
          data.notes ? `\n${data.notes}` : ""
        }`.trim(),
      },
    });

    // Unreserve stock (only if it was ACTIVE and had stock reserved)
    if (wasActive) {
      await inventoryStockService.unreserve(
        reservation.inventoryItemId,
        toNumber(reservation.quantity) ?? 0,
        {
          context,
          storeId: undefined, // Unreserve across all stores
          reason: data.reason,
          referenceType:
            reservation.reservedFor === "WorkOrder"
              ? "WORK_ORDER"
              : reservation.reservedFor === "PMSchedule"
                ? "RESERVATION"
                : "MANUAL",
          referenceId: id,
        },
      );
    }

    // AUTO-CANCEL LINKED REQUISITIONS
    // When a reservation is cancelled, automatically cancel any linked requisitions
    // that were created specifically for this reservation (via create-with-requisition).
    // The link is indirect: requisitions are matched by inventoryItemId and optionally
    // scoped to the same workOrderId (via budgetHeader) when this is a work order reservation.
    //
    // Cancellable states: Draft, Submitted, Approved
    // Non-cancellable (too far along): Ordered, PartiallyFulfilled, Fulfilled
    // Already terminal: Cancelled, Rejected (skip silently)
    try {
      const inventoryItemId = reservation.inventoryItemId;
      const workOrderId =
        reservation.reservedFor === "WorkOrder" && reservation.reservedForId
          ? reservation.reservedForId
          : null;

      // Find requisitions linked to this inventory item
      // If this is a work order reservation, scope to the same work order via budgetHeader
      const linkedRequisitions = await this.prisma.requisition.findMany({
        where: {
          lines: {
            some: {
              inventoryItemId,
            },
          },
          // Scope to same work order when this is a work order reservation
          ...(workOrderId ? { budgetHeader: { workOrderId } } : {}),
        },
        select: {
          id: true,
          reqNumber: true,
          status: true,
          approvalStatus: true,
          purchaseOrderId: true,
          lines: {
            where: { inventoryItemId },
            select: { quantity: true },
          },
        },
      });

      if (linkedRequisitions.length > 0) {
        logger.info(
          `[RESERVATION-CANCEL] Found ${linkedRequisitions.length} linked requisition(s) for reservation ${id} ` +
          `(inventoryItemId=${inventoryItemId}, workOrderId=${workOrderId ?? "none"})`,
        );

        // States that are safe to auto-cancel
        const CANCELLABLE_STATUSES = ["Draft", "Submitted", "Approved"];
        // States that are too far along to auto-cancel
        const TOO_FAR_STATUSES = ["Ordered", "PartiallyFulfilled", "Fulfilled"];

        for (const req of linkedRequisitions) {
          if (req.status === "Cancelled" || req.status === "Rejected") {
            // Already in a terminal state — skip silently
            logger.info(
              `[RESERVATION-CANCEL] Requisition ${req.reqNumber} (${req.id}) is already ${req.status} — skipping`,
            );
            continue;
          }

          if (TOO_FAR_STATUSES.includes(req.status)) {
            // Requisition has progressed too far (has a PO or is being fulfilled)
            // Do NOT auto-cancel — log a warning instead
            logger.warn(
              `[RESERVATION-CANCEL] Requisition ${req.reqNumber} (${req.id}) is in status "${req.status}" ` +
              `— too far along to auto-cancel when reservation ${id} was cancelled. Manual review required.`,
            );
            continue;
          }

          if (CANCELLABLE_STATUSES.includes(req.status)) {
            // Safe to auto-cancel this requisition
            try {
              // If the requisition was approved, we need to reverse GL entries
              // Use the same pattern as requisitionWorkflowService.cancel()
              if (req.status === "Approved") {
                try {
                  const { glReversalService } = await import("@/services/gl/gl-reversal.service");
                  const glTransactions = await this.prisma.gLTransaction.findMany({
                    where: {
                      referenceType: "Requisition",
                      referenceId: req.id,
                      transactionType: "ENCUMBRANCE",
                      status: "POSTED",
                    },
                  });

                  for (const glTxn of glTransactions) {
                    await glReversalService.reverseTransaction(
                      glTxn.id,
                      `Requisition auto-cancelled: linked reservation ${id} was cancelled`,
                      context.userId,
                    );
                  }

                  if (glTransactions.length > 0) {
                    logger.info(
                      `[RESERVATION-CANCEL] Reversed ${glTransactions.length} GL transaction(s) for requisition ${req.reqNumber} (${req.id})`,
                    );
                  }
                } catch (glError) {
                  // Non-fatal — log but continue with cancellation
                  logger.error(
                    `[RESERVATION-CANCEL] GL reversal failed for requisition ${req.reqNumber} (${req.id}): ` +
                    `${glError instanceof Error ? glError.message : String(glError)}`,
                  );
                }
              }

              // Cancel the requisition
              await this.prisma.requisition.update({
                where: { id: req.id },
                data: {
                  status: "Cancelled",
                  approvalStatus: "CANCELLED",
                  cancelledAt: new Date(),
                  cancelledBy: context.userId,
                  rejectionReason: `Auto-cancelled: linked inventory reservation was cancelled. Reason: ${data.reason}`,
                },
              });

              logger.info(
                `[RESERVATION-CANCEL] Auto-cancelled requisition ${req.reqNumber} (${req.id}) ` +
                `because linked reservation ${id} was cancelled`,
              );

              // Decrement quantityCommitted: the on-order units are no longer promised
              try {
                const committedQty = req.lines.reduce(
                  (sum, l) => sum + (toNumber(l.quantity) ?? 0),
                  0,
                );
                if (committedQty > 0) {
                  await inventoryStockService.decrementCommitted(inventoryItemId, committedQty);
                  logger.info(
                    `[RESERVATION-CANCEL] quantityCommitted decremented by ${committedQty} for item ${inventoryItemId}`,
                  );
                }
              } catch (commitErr) {
                // Non-fatal: log but don't fail the cancellation
                logger.error(
                  `[RESERVATION-CANCEL] Failed to decrement quantityCommitted for item ${inventoryItemId}: ` +
                  `${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
                );
              }
            } catch (reqCancelError) {
              // Don't fail the reservation cancellation if requisition cancellation fails
              // The reservation cancellation is the primary action
              logger.error(
                `[RESERVATION-CANCEL] Failed to auto-cancel requisition ${req.reqNumber} (${req.id}): ` +
                `${reqCancelError instanceof Error ? reqCancelError.message : String(reqCancelError)}`,
              );
            }
          } else {
            // Unknown status — log a warning
            logger.warn(
              `[RESERVATION-CANCEL] Requisition ${req.reqNumber} (${req.id}) has unexpected status "${req.status}" ` +
              `— skipping auto-cancel`,
            );
          }
        }
      }
    } catch (autoReqCancelError) {
      // Don't fail the reservation cancellation if the auto-cancel logic fails
      logger.error(
        `[RESERVATION-CANCEL] Auto-cancel requisition logic failed for reservation ${id}: ` +
        `${autoReqCancelError instanceof Error ? autoReqCancelError.message : String(autoReqCancelError)}`,
      );
    }

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATION_CANCELLED",
      reservation.inventoryItemId,
      `Reservation cancelled: ${data.reason}`,
      {
        reservationId: id,
        reason: data.reason,
      },
    );

    // Return updated reservation
    const updated = await this.prisma.inventoryReservation.findUnique({
      where: { id },
      include: buildReservationInclude(),
    });

    return transformReservation(updated);
  }

  /**
   * Expire reservations that have passed their expiration date
   * Returns count of expired reservations
   */
  async expire(context: ServiceContext): Promise<number> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    const now = new Date();

    // Find expired reservations
    const expiredReservations = await this.prisma.inventoryReservation.findMany(
      {
        where: {
          status: ReservationStatus.ACTIVE,
          expiresAt: {
            lte: now,
          },
        },
      },
    );

    if (expiredReservations.length === 0) {
      return 0;
    }

    // Update all expired reservations
    await this.prisma.inventoryReservation.updateMany({
      where: {
        id: { in: expiredReservations.map((r) => r.id) },
      },
      data: {
        status: ReservationStatus.EXPIRED,
      },
    });

    // Unreserve stock for expired reservations
    for (const expiredRes of expiredReservations) {
      await inventoryStockService.unreserve(
        expiredRes.inventoryItemId,
        toNumber(expiredRes.quantity) ?? 0,
        {
          context,
          storeId: undefined, // Unreserve across all stores
          reason: "Reservation expired",
          referenceType: "MANUAL",
          referenceId: expiredRes.id,
        },
      );
    }

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATIONS_EXPIRED",
      expiredReservations[0]?.inventoryItemId ?? "system",
      `Expired ${expiredReservations.length} reservation(s)`,
      {
        count: expiredReservations.length,
        reservationIds: expiredReservations.map((r) => r.id),
      },
    );

    return expiredReservations.length;
  }

  /**
   * Extend reservation expiration date
   * Useful when work order dates change
   */
  async extendReservation(
    context: ServiceContext,
    id: string,
    newExpirationDate: Date,
  ): Promise<ReservationWithRelations> {
    // Check permission
    const permission = buildPermissionString(
      this.resource,
      ExtendedPermissionAction.RESERVE,
    );
    await checkPermission(context, permission);

    validateRequired(id, "id");

    // Get reservation
    const reservation = await this.prisma.inventoryReservation.findUnique({
      where: { id },
    });

    if (!reservation) {
      throw new NotFoundError("Inventory Reservation", id);
    }

    // Validate status
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestError(
        `Cannot extend ${reservation.status.toLowerCase()} reservation`,
      );
    }

    // Validate new date is in the future
    if (newExpirationDate <= new Date()) {
      throw new BadRequestError("New expiration date must be in the future");
    }

    // Update reservation
    const updated = await this.prisma.inventoryReservation.update({
      where: { id },
      data: {
        expiresAt: newExpirationDate,
        notes:
          `${reservation.notes ?? ""}\n\nExpiration extended to ${newExpirationDate.toISOString()}`.trim(),
      },
      include: buildReservationInclude(),
    });

    // Log event
    await logInventoryEvent(
      context,
      "RESERVATION_EXTENDED",
      reservation.inventoryItemId,
      `Reservation expiration extended to ${newExpirationDate.toISOString()}`,
      {
        reservationId: id,
        newExpirationDate: newExpirationDate.toISOString(),
      },
    );

    return transformReservation(updated);
  }

  /**
   * Re-evaluate reservation when work order planned date is added or changed
   * Called by work order service when plannedStartDate is updated
   *
   * FIXED: Now respects reservation mode setting (TIME_BASED vs PROMPT_BASED)
   * FIXED: Now creates a SINGLE consolidated requisition for all items needing reorder
   */
  async reevaluateForWorkOrder(
    context: ServiceContext,
    workOrderId: string,
    newPlannedStartDate: Date,
  ): Promise<void> {
    // Get reservation settings to determine behavior
    const { reservationSettingsService } = await import(
      "./reservation-settings.service"
    );
    const settings = await reservationSettingsService.getSettingsInternal();

    // Get all PENDING_REVIEW reservations for this work order
    const reservations = await this.prisma.inventoryReservation.findMany({
      where: {
        reservedFor: "WorkOrder",
        reservedForId: workOrderId,
        status: ReservationStatus.PENDING_REVIEW,
      },
      include: {
        inventoryItem: {
          include: {
            stock: true,
            defaultSupplier: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (reservations.length === 0) {
      return;
    }

    const now = new Date();
    const daysUntilStart = Math.ceil(
      (newPlannedStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    // PROMPT_BASED mode: Do NOT automatically activate reservations based on time
    // Reservations should only be activated when planner explicitly confirms
    if (settings.mode === "PROMPT_BASED") {
      // Just update review dates, don't activate
      for (const reservation of reservations) {
        const reviewDate = new Date(newPlannedStartDate);
        reviewDate.setDate(reviewDate.getDate() - (settings.daysThreshold || 30));

        await this.prisma.inventoryReservation.update({
          where: { id: reservation.id },
          data: { reviewDate },
        });
      }
      return;
    }

    // TIME_BASED mode: Use time-based logic to determine activation
    // Only activate if within threshold days
    if (daysUntilStart > (settings.daysThreshold || 30)) {
      // Still long-lead, update review dates
      for (const reservation of reservations) {
        const reviewDate = new Date(newPlannedStartDate);
        reviewDate.setDate(reviewDate.getDate() - (settings.daysThreshold || 30));

        await this.prisma.inventoryReservation.update({
          where: { id: reservation.id },
          data: { reviewDate },
        });
      }
      return;
    }

    // Get work order context for requisition
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        woNumber: true,
        title: true,
        plannedStartDate: true,
        equipmentId: true,
      },
    });

    if (!workOrder) {
      return;
    }

    // Collect items that will need reordering after activation
    const itemsNeedingReorder: Array<{
      inventoryItem: {
        id: string;
        sku: string;
        description: string;
        maxQuantity?: number | null;
        minQuantity?: number | null;
        unitCost?: number | null;
        unit?: string;
        defaultSupplierId?: string | null;
      };
      availableQty: number;
      quantityToOrder: number;
      shortfall: number;
      belowMin: number;
    }> = [];

    // Activate each reservation and check stock levels
    for (const reservation of reservations) {
      // Skip if reservation is already ACTIVE (manually reserved)
      if (reservation.status === ReservationStatus.ACTIVE) {
        continue;
      }

      const inventoryItem = reservation.inventoryItem;
      const reservationQty = toNumber(reservation.quantity) ?? 0;
      const minQuantity = toNumber(inventoryItem.minQuantity) ?? 0;
      const maxQuantity = toNumber(inventoryItem.maxQuantity) ?? 10;
      const unitCost = toNumber(inventoryItem.unitCost) ?? 0;

      // Perform activation in transaction to ensure atomicity
      await this.prisma.$transaction(async (tx) => {
        // 1. Convert reservation to ACTIVE
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: {
            status: ReservationStatus.ACTIVE,
            reviewDate: null,
          },
        });

        // 2. Create WorkOrderPart record with RESERVED status
        const existingPart = await tx.workOrderPart.findFirst({
          where: {
            workOrderId: workOrderId,
            inventoryItemId: reservation.inventoryItemId,
          },
        });

        if (existingPart) {
          // Update existing part - add quantity and link to reservation
          const existingQty = toNumber(existingPart.quantityPlanned) ?? 0;
          const newQty = existingQty + reservationQty;

          await tx.workOrderPart.update({
            where: { id: existingPart.id },
            data: {
              quantityPlanned: newQty,
              totalCost: newQty * unitCost,
              status: "RESERVED",
              reservedAt: new Date(),
              reservedBy: reservation.reservedBy,
              reservationId: reservation.id,
              notes: `${existingPart.notes ?? ""}\n\nReservation ${reservation.id} activated - ${reservationQty} units added`.trim(),
            },
          });
        } else {
          // Create new WorkOrderPart with RESERVED status
          await tx.workOrderPart.create({
            data: {
              workOrderId: workOrderId,
              inventoryItemId: reservation.inventoryItemId,
              quantityPlanned: reservationQty,
              quantityUsed: null,
              unitCost,
              totalCost: reservationQty * unitCost,
              status: "RESERVED",
              reservedAt: new Date(),
              reservedBy: reservation.reservedBy,
              reservationId: reservation.id,
              notes: `Reservation ${reservation.id} activated when planned date was set`,
            },
          });
        }
      });

      // 3. Reserve stock (outside transaction to avoid deadlocks)
      await inventoryStockService.reserve(
        reservation.inventoryItemId,
        reservationQty,
        {
          context,
          storeId: undefined,
          reason: `Reservation ${reservation.id} activated`,
          referenceType: "WORK_ORDER",
          referenceId: reservation.id,
        },
      );

      // 4. Check stock levels AFTER reserving
      const updatedItem = await this.prisma.inventoryItem.findUnique({
        where: { id: reservation.inventoryItemId },
        include: { stock: true },
      });

      const newOnHand =
        updatedItem?.stock.reduce(
          (sum, s) => sum + (toNumber(s.quantityOnHand) ?? 0),
          0,
        ) ?? 0;
      const newReserved =
        updatedItem?.stock.reduce(
          (sum, s) => sum + (toNumber(s.quantityReserved) ?? 0),
          0,
        ) ?? 0;
      const availableAfter = newOnHand - newReserved;

      // 5. Collect items needing reorder
      if (availableAfter < minQuantity && reservation.autoReqEnabled) {
        const shortfall = Math.max(0, reservationQty - newOnHand);
        const belowMin = Math.max(0, minQuantity - availableAfter);
        const quantityToOrder = Math.max(maxQuantity - availableAfter, 1);

        itemsNeedingReorder.push({
          inventoryItem: {
            id: inventoryItem.id,
            sku: inventoryItem.sku,
            description: inventoryItem.description,
            maxQuantity: toNumber(inventoryItem.maxQuantity),
            minQuantity: toNumber(inventoryItem.minQuantity),
            unitCost: toNumber(inventoryItem.unitCost),
            unit: inventoryItem.unit,
            defaultSupplierId: inventoryItem.defaultSupplierId,
          },
          availableQty: availableAfter,
          quantityToOrder,
          shortfall,
          belowMin,
        });
      }

      // Log activation event
      await logInventoryEvent(
        context,
        "RESERVATION_ACTIVATED",
        reservation.inventoryItemId,
        `Reservation activated due to work order date change`,
        {
          reservationId: reservation.id,
          workOrderId,
          daysUntilStart,
        },
      );
    }

    // 6. Create SINGLE consolidated requisition for all items needing reorder
    if (itemsNeedingReorder.length > 0) {
      try {
        const { reservationAutomationService } = await import(
          "./reservation-automation.service"
        );

        const result = await reservationAutomationService.createConsolidatedAutoRequisition(
          context,
          workOrderId,
          itemsNeedingReorder,
          {
            woNumber: workOrder.woNumber,
            title: workOrder.title || undefined,
            equipmentId: workOrder.equipmentId ?? undefined,
            plannedStartDate: workOrder.plannedStartDate,
          },
        );

        if (result) {
          // Log consolidated requisition creation
          await logInventoryEvent(
            context,
            "AUTO_REQUISITION_CREATED",
            workOrderId,
            `Consolidated auto-requisition ${result.reqNumber} created with ${itemsNeedingReorder.length} items`,
            {
              requisitionId: result.requisitionId,
              reqNumber: result.reqNumber,
              workOrderId,
              itemCount: itemsNeedingReorder.length,
            },
          );
        }
      } catch (_error) {
        // Error creating consolidated requisition - non-critical
        // Don't throw - log the error but continue
      }
    }
  }
}

// Export singleton instance
const globalForReservationLifecycle = globalThis as unknown as { reservationLifecycleService: ReservationLifecycleService | undefined };
export const reservationLifecycleService = globalForReservationLifecycle.reservationLifecycleService ?? (globalForReservationLifecycle.reservationLifecycleService = new ReservationLifecycleService(
  prisma,
));
