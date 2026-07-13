/**
 * Batch Line Conversion API Route
 *
 * POST /api/purchasing/requisitions/convert-lines-batch
 * Converts selected lines from multiple requisitions into a SINGLE purchase order
 */

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, ApiContextWithData } from "@/lib/api-middleware-v2";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generatePONumber } from "@/services/purchasing/purchase-order/purchase-order-utils";
import { budgetResolutionService } from "@/services/budget";
import {
  RequisitionLineStatus,
  RequisitionLineWithPOTracking,
} from "@/services/purchasing/requisition/requisition.types";

/**
 * Schema for batch line conversion
 */
const batchConvertLinesSchema = z.object({
  requisitions: z
    .array(
      z.object({
        requisitionId: z.string().uuid(),
        lineIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .min(1),
  supplierId: z.string().uuid(),
});

type BatchConvertLinesInput = z.infer<typeof batchConvertLinesSchema>;

/**
 * POST /api/purchasing/requisitions/convert-lines-batch
 * Convert selected lines from multiple requisitions into a single PO
 *
 * Permission: purchase_orders:create (dedicated PO-creation permission)
 * Roles with this permission: Finance Manager, Purchasing Manager, Admin
 */
export const POST = createApiHandler(
  {
    bodySchema: batchConvertLinesSchema,
    permission: "purchase_orders:create",
  },
  async (
    _req: NextRequest,
    context: ApiContextWithData<BatchConvertLinesInput>,
  ) => {
    const { requisitions, supplierId } = context.data;
    const userId = context.serviceContext.userId;

    // Collect all line IDs across all requisitions
    const allLineIds = requisitions.flatMap((r) => r.lineIds);

    // Verify all lines exist, are approved, and belong to the same supplier
    // Include allocations and budget header for charge allocation creation
    const lines = await prisma.requisitionLine.findMany({
      where: {
        id: { in: allLineIds },
      },
      include: {
        requisition: {
          include: {
            budgetHeader: {
              include: {
                accountCode: true,
                project: {
                  select: { id: true, accountCodeId: true },
                },
                // Linked work order — used to stamp the PO-header
                // workOrderIds/workOrderNumbers arrays for reporting (Phase 1).
                workOrder: {
                  select: { id: true, woNumber: true },
                },
              },
            },
            lineAllocations: {
              where: { requisitionLineId: null },
              select: {
                id: true,
                accountCodeId: true,
                departmentId: true,
                projectId: true,
                areaId: true,
                percentage: true,
                amount: true,
              },
            },
          },
        },
        supplier: true,
        inventoryItem: true,
        allocations: true,
      },
    });

    // Validation
    if (lines.length !== allLineIds.length) {
      throw new Error("Some lines were not found");
    }

    // Check all lines are from the specified supplier
    const invalidSupplierLines = lines.filter(
      (line) => line.supplierId !== supplierId,
    );
    if (invalidSupplierLines.length > 0) {
      throw new Error("All lines must be from the same supplier");
    }

    // Check all lines are approved and not already on a PO
    const typedLines = lines as unknown as RequisitionLineWithPOTracking[];

    // Check requisition approval status, not line status
    // Lines inherit approval from their parent requisition
    const unapprovedLines = typedLines.filter((line) => {
      const requisition = line.requisition as unknown as {
        approvalStatus?: string;
      };
      return requisition.approvalStatus !== "APPROVED";
    });
    if (unapprovedLines.length > 0) {
      throw new Error("All lines must be from approved requisitions");
    }

    const alreadyOrderedLines = typedLines.filter(
      (line) => line.purchaseOrderId !== null,
    );
    if (alreadyOrderedLines.length > 0) {
      throw new Error("Some lines are already on a purchase order");
    }

    // Get supplier details
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      throw new Error("Supplier not found");
    }

    // Create a single PO with all lines
    const result = await prisma.$transaction(async (tx) => {
      // Generate PO number
      const poNumber = await generatePONumber(tx as typeof prisma);

      // Calculate total amount
      const totalAmount = typedLines.reduce((sum, line) => {
        const qty =
          typeof line.quantity === "number"
            ? line.quantity
            : line.quantity.toNumber();
        const price =
          typeof line.estimatedPrice === "number"
            ? line.estimatedPrice
            : line.estimatedPrice.toNumber();
        return sum + qty * price;
      }, 0);

      // Get unique requisition numbers for tracking
      const uniqueRequisitions = Array.from(
        new Map(
          typedLines.map((line) => [
            line.requisitionId,
            line.requisition?.reqNumber ?? "Unknown",
          ]),
        ).entries(),
      );

      const requisitionIds = uniqueRequisitions.map(([id]) => id);
      const requisitionNumbers = uniqueRequisitions.map(([, number]) => number);

      // Unique set of work orders across the selected lines' requisitions.
      // Stamped onto the PO header (metadata only — no GL/send/receive guard
      // reads these arrays) so WO-scoped reports can find this PO.
      const uniqueWorkOrders = Array.from(
        new Map(
          lines
            .map((line) => line.requisition.budgetHeader?.workOrder)
            .filter((wo): wo is { id: string; woNumber: string } => wo != null)
            .map((wo) => [wo.id, wo.woNumber] as const),
        ).entries(),
      );
      const workOrderIds = uniqueWorkOrders.map(([id]) => id);
      const workOrderNumbers = uniqueWorkOrders.map(([, number]) => number);

      // Create the purchase order with requisition tracking
      // POs created from approved requisitions start at "Approved" status,
      // skipping the Draft→Submitted→Approved workflow. GL entries happen at Send to Supplier.
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId,
          status: "Approved",
          approvedAt: new Date(),
          orderDate: new Date(),
          totalAmount,
          createdBy: userId,
          requisitionIds,
          requisitionNumbers,
          workOrderIds,
          workOrderNumbers,
        },
      });

      // Create PO lines for each requisition line with tracking notes
      // Use sequential loop instead of Promise.all so we can create charge allocations per line
      const poLines = [];
      let lineIdx = 0;
      for (const line of typedLines) {
        const qty =
          typeof line.quantity === "number"
            ? line.quantity
            : line.quantity.toNumber();
        const price =
          typeof line.estimatedPrice === "number"
            ? line.estimatedPrice
            : line.estimatedPrice.toNumber();

        // Find the line number within its requisition
        const requisitionLines = typedLines.filter(
          (l) => l.requisitionId === line.requisitionId,
        );
        const lineNumberInReq = requisitionLines.indexOf(line) + 1;

        // Build tracking note
        const reqNumber = line.requisition?.reqNumber ?? "Unknown";
        const trackingNote = `From ${reqNumber} - Line ${lineNumberInReq}`;

        // Filter out generic test notes - only keep meaningful notes
        const hasTestNote =
          line.notes && /^test\s+line\s+\d+$/i.test(line.notes.trim());
        const finalNotes =
          line.notes && !hasTestNote
            ? `${line.notes}\n\n${trackingNote}`
            : trackingNote;

        const poLine = await tx.pOLine.create({
          data: {
            purchaseOrderId: purchaseOrder.id,
            lineNumber: ++lineIdx,
            inventoryItemId: line.inventoryItemId,
            description: line.description,
            quantity: qty,
            unitPrice: price,
            totalPrice: qty * price,
            lineType: line.lineType,
            requisitionId: line.requisitionId,
            requisitionLineId: line.id,
            requisitionNumber: line.requisition?.reqNumber ?? null,
            notes: finalNotes,
          },
        });

        // CRITICAL: Create charge allocations for the PO line.
        // Without these, GL pre-validation will block receiving for non-INVENTORY lines.
        // Fallback priority:
        //   1. Line-level allocations from the requisition line
        //   2. Header-level allocations (requisitionLineId = null) from the requisition
        //   3. Budget header account code (CHARGE_TO_ACCOUNT / CHARGE_TO_PROJECT / CHARGE_TO_WORK_ORDER)
        //   4. INVENTORY lines skip — GL rules handle them via fixed account sources
        const lineAllocations = (
          line as unknown as {
            allocations: Array<{
              accountCodeId: string | null;
              departmentId: string | null;
              projectId: string | null;
              areaId: string | null;
              percentage: number | { toNumber(): number };
              amount: number | { toNumber(): number };
            }>;
          }
        ).allocations;

        if (lineAllocations.length > 0) {
          // Path 1: Copy line-level allocations directly
          for (const alloc of lineAllocations) {
            await tx.pOLineChargeAllocation.create({
              data: {
                poLineId: poLine.id,
                accountCodeId: alloc.accountCodeId,
                departmentId: alloc.departmentId,
                projectId: alloc.projectId,
                areaId: alloc.areaId,
                percentage:
                  typeof alloc.percentage === "number"
                    ? alloc.percentage
                    : alloc.percentage.toNumber(),
                amount:
                  typeof alloc.amount === "number"
                    ? alloc.amount
                    : alloc.amount.toNumber(),
                notes: null,
              },
            });
          }
        } else if (line.lineType !== "INVENTORY") {
          // Path 2: Try header-level allocations (requisitionLineId = null)
          const reqData = line.requisition as unknown as {
            budgetHeader?: {
              accountCodeId: string | null;
              projectId: string | null;
              budgetType: string;
              workOrderId?: string | null;
              project?: { id: string; accountCodeId: string | null } | null;
            } | null;
            lineAllocations?: Array<{
              accountCodeId: string | null;
              departmentId: string | null;
              projectId: string | null;
              areaId: string | null;
              percentage: number | { toNumber(): number };
              amount: number | { toNumber(): number };
            }>;
          };
          const headerAllocations = reqData.lineAllocations ?? [];
          const lineAmount = qty * price;

          if (headerAllocations.length > 0) {
            for (const alloc of headerAllocations) {
              await tx.pOLineChargeAllocation.create({
                data: {
                  poLineId: poLine.id,
                  accountCodeId: alloc.accountCodeId,
                  departmentId: alloc.departmentId,
                  projectId: alloc.projectId,
                  areaId: alloc.areaId,
                  percentage:
                    typeof alloc.percentage === "number"
                      ? alloc.percentage
                      : alloc.percentage.toNumber(),
                  amount: lineAmount * (Number(alloc.percentage) / 100),
                  notes: "Copied from requisition header allocation",
                },
              });
            }
          } else {
            // Path 3: Fallback to budget header account code
            const budgetHeader = reqData.budgetHeader;
            let fallbackAccountCodeId: string | null =
              budgetHeader?.accountCodeId ?? null;
            let fallbackProjectId: string | null = null;

            // CHARGE_TO_PROJECT: resolve the project's default account code
            if (!fallbackAccountCodeId && budgetHeader?.projectId) {
              fallbackAccountCodeId =
                budgetHeader.project?.accountCodeId ?? null;
              if (!fallbackAccountCodeId) {
                const project = await tx.project.findUnique({
                  where: { id: budgetHeader.projectId },
                  select: { accountCodeId: true },
                });
                fallbackAccountCodeId = project?.accountCodeId ?? null;
              }
              fallbackProjectId = budgetHeader.projectId;
            }

            // CHARGE_TO_WORK_ORDER: resolve from WO's project or equipment
            if (
              !fallbackAccountCodeId &&
              budgetHeader?.budgetType === "CHARGE_TO_WORK_ORDER" &&
              budgetHeader.workOrderId
            ) {
              const woResolution =
                await budgetResolutionService.resolveFromWorkOrder(
                  budgetHeader.workOrderId,
                );
              fallbackAccountCodeId = woResolution.accountCodeId;
            }

            if (fallbackAccountCodeId) {
              await tx.pOLineChargeAllocation.create({
                data: {
                  poLineId: poLine.id,
                  accountCodeId: fallbackAccountCodeId,
                  departmentId: null,
                  projectId: fallbackProjectId,
                  areaId: null,
                  percentage: 100,
                  amount: lineAmount,
                  notes: "Copied from requisition budget header",
                },
              });
            }
          }
        }
        // Path 4: INVENTORY lines without allocations are handled by GL rules — skip

        // Update the requisition line to mark it as ordered, including the per-line poLineId.
        // This must be done per-line (not via updateMany) because each line gets its own
        // unique POLine ID and updateMany cannot set per-row values.
        await tx.requisitionLine.update({
          where: { id: line.id },
          data: {
            lineStatus: RequisitionLineStatus.ORDERED,
            purchaseOrderId: purchaseOrder.id,
            purchaseOrderNumber: poNumber,
            poLineId: poLine.id,
            convertedToPOAt: new Date(),
            convertedToPOBy: userId,
          },
        });

        poLines.push(poLine);
      }

      // Update requisition statuses and track PO links
      for (const req of requisitions) {
        const requisition = await tx.requisition.findUnique({
          where: { id: req.requisitionId },
          include: { lines: true },
        });

        if (requisition) {
          const reqLines =
            requisition.lines as unknown as RequisitionLineWithPOTracking[];
          const allLinesOrdered = reqLines.every(
            (line) => line.lineStatus === RequisitionLineStatus.ORDERED,
          );
          const anyLineOrdered = reqLines.some(
            (line) => line.lineStatus === RequisitionLineStatus.ORDERED,
          );

          // Track this PO in previousPOIds for partial-order tracking (deduplicated)
          const existingPrevIds =
            (requisition as unknown as { previousPOIds?: string[] })
              .previousPOIds ?? [];
          const existingPrevNumbers =
            (requisition as unknown as { previousPONumbers?: string[] })
              .previousPONumbers ?? [];
          const updatedPrevIds = existingPrevIds.includes(purchaseOrder.id)
            ? existingPrevIds
            : [...existingPrevIds, purchaseOrder.id];
          const updatedPrevNumbers = existingPrevNumbers.includes(poNumber)
            ? existingPrevNumbers
            : [...existingPrevNumbers, poNumber];

          await tx.requisition.update({
            where: { id: req.requisitionId },
            data: {
              // Always track the PO in previousPOIds so the req knows it has at least one PO
              previousPOIds: updatedPrevIds,
              previousPONumbers: updatedPrevNumbers,
              // Set primary PO link: first PO wins (partial or full conversion)
              purchaseOrderId:
                (requisition as unknown as { purchaseOrderId?: string | null })
                  .purchaseOrderId ??
                (anyLineOrdered ? purchaseOrder.id : null),
              purchaseOrderNumber:
                (
                  requisition as unknown as {
                    purchaseOrderNumber?: string | null;
                  }
                ).purchaseOrderNumber ?? (anyLineOrdered ? poNumber : null),
              // Only advance to "Ordered" when ALL lines are now on a PO
              ...(allLinesOrdered ? { status: "Ordered" } : {}),
            },
          });
        }
      }

      return {
        purchaseOrder: {
          id: purchaseOrder.id,
          poNumber: purchaseOrder.poNumber,
          status: purchaseOrder.status,
          totalAmount: Number(purchaseOrder.totalAmount),
        },
        poLines,
        totalLines: typedLines.length,
        requisitionCount: requisitions.length,
      };
    });

    return success(
      result,
      `Successfully created PO ${result.purchaseOrder.poNumber} with ${result.totalLines} lines from ${result.requisitionCount} requisition(s)`,
    );
  },
);
