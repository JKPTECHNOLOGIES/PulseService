/**
 * RMA Receive Items Back Service
 *
 * Handles the physical return of items to our facility from the supplier.
 * This is the INVENTORY MANAGER closure path:
 *
 *   Supplier sends replacement / repaired / rejected items back to us
 *   → Inventory manager sets per-line disposition (RESTOCK / SCRAP / REPAIR)
 *   → When all lines dispositioned → RMA auto-completes (RECEIVED_BY_SUPPLIER → COMPLETED)
 *
 * This is DISTINCT from receiveRMA() which marks that the SUPPLIER received
 * our outbound return package — a status transition, not a physical receiving event.
 *
 * Reuses:
 *   inspectLine()   — sets condition + disposition + inspectedAt on each line
 *   restockLine()   — handles RESTOCK: inventory upsert + InventoryTransaction(RMA_RESTOCK)
 *   scrapLine()     — handles SCRAP: stamps scrapedAt (stock already decremented at shipRMA)
 */

import { prisma } from "@/lib/prisma";
import { RMAStatus, ReturnDisposition } from "@prisma/client";
import { ServiceContext } from "@/types/service-types";
import { checkPermission } from "@/services/shared/permissions";
import { validateStatusTransition } from "./rma-validation";
import { buildRMAInclude, transformRMA } from "./rma-utils";
import { inspectLine, restockLine, scrapLine } from "./rma.service";
import { notificationService } from "@/services/notifications/notification.service";
import { NotificationCategory, NotificationPriority } from "@/services/notifications/notification.types";
import type { RMAWithRelations, RMAReceiveItemsBackDTO } from "./rma.types";

export async function receiveItemsBack(
  context: ServiceContext,
  rmaId: string,
  data: RMAReceiveItemsBackDTO,
): Promise<RMAWithRelations> {
  await checkPermission(context, "rma:process");

  // Validate RMA exists and is in the right status
  const rma = await prisma.purchaseOrderReturn.findUnique({
    where: { id: rmaId },
    include: {
      lines: true,
      purchaseOrder: { select: { poNumber: true } },
      supplier:      { select: { name: true } },
    },
  });

  if (!rma) throw new Error("RMA not found");

  if (rma.status !== RMAStatus.RECEIVED_BY_SUPPLIER) {
    throw new Error(
      `Cannot receive items back on an RMA with status ${rma.status}. ` +
      `RMA must be in RECEIVED_BY_SUPPLIER status.`,
    );
  }

  // Validate requested lines all belong to this RMA
  for (const lineInput of data.lines) {
    const exists = rma.lines.some((l) => l.id === lineInput.lineReturnId);
    if (!exists) {
      throw new Error(`Line ${lineInput.lineReturnId} does not belong to RMA ${rma.rmaNumber}`);
    }
    // RESTOCK requires storeId
    if (lineInput.disposition === ReturnDisposition.RESTOCK && !lineInput.storeId) {
      throw new Error(`storeId is required for RESTOCK disposition on line ${lineInput.lineReturnId}`);
    }
    // SCRAP requires scrapReason
    if (lineInput.disposition === ReturnDisposition.SCRAP && !lineInput.scrapReason) {
      throw new Error(`scrapReason is required for SCRAP disposition on line ${lineInput.lineReturnId}`);
    }
  }

  // ── Process each line using existing service functions ──────────────────
  for (const lineInput of data.lines) {
    const line = rma.lines.find((l) => l.id === lineInput.lineReturnId)!;
    const qtyToReceive = lineInput.quantityToReceive ?? Number(line.quantityToReturn);

    // Step 1: Inspect the line (sets inspectedAt + disposition — required before restock/scrap)
    await inspectLine(context, rmaId, {
      lineReturnId:     lineInput.lineReturnId,
      condition:        lineInput.condition,
      disposition:      lineInput.disposition,
      inspectionNotes:  lineInput.inspectionNotes ?? undefined,
      dispositionNotes: lineInput.dispositionNotes ?? undefined,
    });

    // Step 2: Apply the chosen disposition
    if (lineInput.disposition === ReturnDisposition.RESTOCK) {
      // restockLine() does: inventoryStock upsert + InventoryTransaction(RMA_RESTOCK) + stamps restockedAt
      await restockLine(context, rmaId, {
        lineReturnId:       lineInput.lineReturnId,
        storeId:            lineInput.storeId!,
        quantityToRestock:  qtyToReceive,
        notes:              lineInput.dispositionNotes ?? `Received back via RMA ${rma.rmaNumber}`,
      });
    } else if (lineInput.disposition === ReturnDisposition.SCRAP) {
      // scrapLine() stamps scrapedAt; no stock write (already decremented at shipRMA)
      await scrapLine(context, rmaId, {
        lineReturnId: lineInput.lineReturnId,
        reason:       lineInput.scrapReason!,
      });
    }
    // REPAIR, RETURN_TO_SUPPLIER, PENDING_INSPECTION: inspectLine is sufficient
  }

  // ── Check if all lines are fully dispositioned → auto-complete ──────────
  const undisposedCount = await prisma.pOLineReturn.count({
    where: {
      returnId: rmaId,
      OR: [
        { disposition: null },
        { disposition: ReturnDisposition.PENDING_INSPECTION },
        // RESTOCK lines must also have restockedAt
        { disposition: ReturnDisposition.RESTOCK, restockedAt: null },
        // SCRAP lines must also have scrapedAt
        { disposition: ReturnDisposition.SCRAP,   scrapedAt: null },
      ],
    },
  });

  const completedAt = new Date();

  if (undisposedCount === 0) {
    // All lines dispositioned — validate status transition is allowed
    const transitionCheck = validateStatusTransition(
      RMAStatus.RECEIVED_BY_SUPPLIER,
      RMAStatus.COMPLETED,
    );
    if (!transitionCheck.valid) throw new Error(transitionCheck.error);

    const restocked = data.lines.filter((l) => l.disposition === ReturnDisposition.RESTOCK).length;
    const scrapped  = data.lines.filter((l) => l.disposition === ReturnDisposition.SCRAP).length;
    const other     = data.lines.length - restocked - scrapped;

    const summary = [
      restocked > 0 ? `${restocked} restocked` : "",
      scrapped  > 0 ? `${scrapped} scrapped`   : "",
      other     > 0 ? `${other} other`          : "",
    ].filter(Boolean).join(", ");

    await prisma.purchaseOrderReturn.update({
      where: { id: rmaId },
      data: {
        status:               RMAStatus.COMPLETED,
        completedAt,
        completedBy:          context.userId,
        completedByName:      context.userName ?? "",
        actualResolutionDate: completedAt,
        internalNotes:        `Physical return received and dispositioned by ${context.userName ?? ""}. ${summary}.`,
        notes:                data.notes ?? undefined,
      },
    });

    await prisma.rMAApprovalHistory.create({
      data: {
        returnId:       rmaId,
        approverUserId: context.userId,
        approverName:   context.userName ?? "Unknown",
        action:         "COMPLETED",
        previousStatus: RMAStatus.RECEIVED_BY_SUPPLIER,
        newStatus:      RMAStatus.COMPLETED,
        comments:       `Physical return complete — ${summary}. All ${data.lines.length} line(s) processed.`,
      },
    });

    // Notify the original requester that the RMA is closed
    try {
      await notificationService.sendNotification(context, {
        userId: rma.requestedById,
        type: "rma.completed",
        category: NotificationCategory.PURCHASING,
        title: `RMA Closed — ${rma.rmaNumber}`,
        message:
          `RMA ${rma.rmaNumber} is now complete. ` +
          `Items returned by ${rma.supplier?.name ?? "supplier"} have been ${summary}.`,
        priority: NotificationPriority.NORMAL,
        actionUrl: `/purchasing/rma/${rmaId}`,
        actionLabel: "View RMA",
        data: {
          rmaId,
          rmaNumber:    rma.rmaNumber,
          supplierName: rma.supplier?.name ?? "",
          poNumber:     rma.purchaseOrder?.poNumber ?? "",
          linesRestocked: restocked,
          linesScrapped:  scrapped,
        },
      });
    } catch {
      // Notification failure is non-critical
    }
  } else {
    // Partial — add history note
    await prisma.rMAApprovalHistory.create({
      data: {
        returnId:       rmaId,
        approverUserId: context.userId,
        approverName:   context.userName ?? "Unknown",
        action:         "ITEMS_PARTIALLY_RECEIVED",
        previousStatus: RMAStatus.RECEIVED_BY_SUPPLIER,
        newStatus:      RMAStatus.RECEIVED_BY_SUPPLIER,
        comments:       `${data.lines.length} line(s) processed. ${undisposedCount} line(s) still pending disposition.`,
      },
    });
  }

  // Return the refreshed RMA
  const updated = await prisma.purchaseOrderReturn.findUnique({
    where:   { id: rmaId },
    include: buildRMAInclude(),
  });
  if (!updated) throw new Error("RMA not found after update");
  return transformRMA(updated);
}
