/**
 * API Route: Update Requisition Line Supplier
 * PATCH /api/purchasing/requisitions/[id]/lines/[lineId]/supplier
 *
 * Allows correcting the supplier on a requisition line that has NOT yet
 * been converted to a purchase order (purchaseOrderId is null on the line).
 *
 * Guard: Rejects if the line already has a purchaseOrderId (i.e. it is
 * ORDERED or beyond) — the PO must be addressed separately in that case.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiHandler, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import {
  ValidationError,
  NotFoundError,
  BadRequestError,
  InternalServerError,
  isApiError,
} from "@/lib/api-errors";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";

const patchSupplierSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID").nullable(),
});

export const PATCH = createApiHandler(
  { hasParams: true },
  async (request: NextRequest, context: ApiContextWithParams) => {
    try {
      const { id: requisitionId, lineId } = context.params as {
        id: string;
        lineId: string;
      };

      // Parse body
      const raw = await request.json() as unknown;
      const parsed = patchSupplierSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((e) => e.message).join(", "),
        );
      }
      const { supplierId } = parsed.data;

      // Load the line and verify it belongs to this requisition
      const line = await prisma.requisitionLine.findFirst({
        where: { id: lineId, requisitionId },
        select: {
          id: true,
          description: true,
          supplierId: true,
          purchaseOrderId: true,
          lineStatus: true,
        },
      });

      if (!line) {
        throw new NotFoundError("RequisitionLine", lineId);
      }

      // Guard: do not allow editing if the line is already on a PO
      if (line.purchaseOrderId !== null) {
        throw new BadRequestError(
          `Line "${line.description}" is already linked to purchase order ${line.purchaseOrderId} and cannot have its supplier changed here. ` +
            `Cancel or correct the purchase order first.`,
        );
      }

      // Validate the new supplier exists (if provided)
      if (supplierId !== null) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: supplierId },
          select: { id: true, name: true, code: true, isActive: true },
        });
        if (!supplier) {
          throw new NotFoundError("Supplier", supplierId);
        }
        if (!supplier.isActive) {
          throw new BadRequestError(
            `Supplier "${supplier.name}" (${supplier.code}) is inactive and cannot be assigned.`,
          );
        }
      }

      const previousSupplierId = line.supplierId;

      // Apply the update
      const updated = await prisma.requisitionLine.update({
        where: { id: lineId },
        data: { supplierId },
        include: {
          supplier: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      // Audit log
      await auditLogService.logCrudOperation(
        context.serviceContext,
        AuditAction.UPDATE,
        "RequisitionLine",
        lineId,
        line.description,
        { supplierId: previousSupplierId },
        { supplierId },
        { action: "update_line_supplier", requisitionId },
      );

      return success(
        {
          id: updated.id,
          supplierId: updated.supplierId,
          supplier: updated.supplier,
        },
        supplierId
          ? `Supplier updated to ${updated.supplier?.name ?? supplierId}`
          : "Supplier cleared from line",
      );
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new InternalServerError(
        "An error occurred while updating the line supplier",
        {
          suggestion:
            "Please try again. If the problem persists, contact support.",
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
);
