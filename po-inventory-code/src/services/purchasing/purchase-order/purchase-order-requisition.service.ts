/**
 * Purchase Order Requisition Service
 *
 * Responsibilities:
 * - Link requisitions to purchase orders (via notes field)
 * - Unlink requisitions from purchase orders
 * - Get purchase orders by requisition
 * - Get requisitions linked to a purchase order
 *
 * NOTE: The current Prisma schema does not have a direct requisitionId field
 * on PurchaseOrder. This service provides placeholder methods for future
 * implementation when the schema is updated to include requisition tracking.
 */

import { prisma } from "@/lib/prisma";
import type { ServiceContext } from "@/types/service-types";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";
import { checkPermission } from "@/services/shared/permissions";
import { NotFoundError } from "@/lib/api-errors";
import { transformPurchaseOrder, buildPOInclude } from "./purchase-order-utils";
import type { PurchaseOrderWithRelations } from "./purchase-order.types";

/**
 * Purchase Order Requisition Service
 *
 * Handles the relationship between purchase orders and requisitions.
 * Currently uses notes field for tracking until schema is updated.
 */
class PurchaseOrderRequisitionService {
  private readonly resource = PermissionResource.PURCHASING;

  /**
   * Link a requisition to a purchase order
   * Currently stores requisition ID in notes field
   *
   * @param ctx - Service context with user and permissions
   * @param poId - Purchase order ID
   * @param requisitionId - Requisition ID to link
   * @returns Updated purchase order
   */
  async linkRequisition(
    ctx: ServiceContext,
    poId: string,
    requisitionId: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      const permission = buildPermissionString(
        this.resource,
        PermissionAction.UPDATE,
      );
      await checkPermission(ctx, permission);

      // Verify PO exists
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
      });

      if (!po) {
        throw new NotFoundError("PurchaseOrder", poId);
      }

      // Verify requisition exists
      const requisition = await prisma.requisition.findUnique({
        where: { id: requisitionId },
      });

      if (!requisition) {
        throw new NotFoundError("Requisition", requisitionId);
      }

      // Store requisition reference in notes (temporary solution)
      const updatedNotes = po.notes
        ? `${po.notes}\n[REQ:${requisitionId}]`
        : `[REQ:${requisitionId}]`;

      await prisma.purchaseOrder.update({
        where: { id: poId },
        data: {
          notes: updatedNotes,
        },
      });

      // Log audit trail
      await auditLogService.logCrudOperation(
        ctx,
        AuditAction.UPDATE,
        "PurchaseOrder",
        poId,
        po.poNumber,
        { notes: po.notes },
        { notes: updatedNotes },
        {
          action: "link_requisition",
          requisitionId,
          requisitionNumber: requisition.reqNumber,
        },
      );

      // Return updated PO
      const updated = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: buildPOInclude(),
      });

      if (!updated) {
        throw new NotFoundError("PurchaseOrder", poId);
      }

      return transformPurchaseOrder(updated);
    } catch (error) {
      throw new Error(
        `Failed to link requisition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Unlink a requisition from a purchase order
   * Removes requisition reference from notes field
   *
   * @param ctx - Service context with user and permissions
   * @param poId - Purchase order ID
   * @returns Updated purchase order
   */
  async unlinkRequisition(
    ctx: ServiceContext,
    poId: string,
  ): Promise<PurchaseOrderWithRelations> {
    try {
      const permission = buildPermissionString(
        this.resource,
        PermissionAction.UPDATE,
      );
      await checkPermission(ctx, permission);

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
      });

      if (!po) {
        throw new NotFoundError("PurchaseOrder", poId);
      }

      // Remove requisition reference from notes
      const updatedNotes = po.notes
        ? po.notes.replace(/\[REQ:[^\]]+\]/g, "").trim()
        : null;

      await prisma.purchaseOrder.update({
        where: { id: poId },
        data: {
          notes: updatedNotes,
        },
      });

      await auditLogService.logCrudOperation(
        ctx,
        AuditAction.UPDATE,
        "PurchaseOrder",
        poId,
        po.poNumber,
        { notes: po.notes },
        { notes: updatedNotes },
        {
          action: "unlink_requisition",
        },
      );

      const updated = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: buildPOInclude(),
      });

      if (!updated) {
        throw new NotFoundError("PurchaseOrder", poId);
      }

      return transformPurchaseOrder(updated);
    } catch (error) {
      throw new Error(
        `Failed to unlink requisition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get all purchase orders linked to a requisition
   * Searches notes field for requisition reference
   *
   * @param ctx - Service context with user and permissions
   * @param requisitionId - Requisition ID
   * @returns Array of purchase orders
   */
  async getByRequisition(
    ctx: ServiceContext,
    requisitionId: string,
  ): Promise<PurchaseOrderWithRelations[]> {
    try {
      const permission = buildPermissionString(
        this.resource,
        PermissionAction.READ,
      );
      await checkPermission(ctx, permission);

      // Search for requisition reference in notes
      const pos = await prisma.purchaseOrder.findMany({
        where: {
          notes: {
            contains: `[REQ:${requisitionId}]`,
          },
        },
        include: buildPOInclude(),
      });

      return pos.map(transformPurchaseOrder);
    } catch (error) {
      throw new Error(
        `Failed to get purchase orders by requisition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get the requisition linked to a purchase order
   * Extracts requisition ID from notes field
   *
   * @param ctx - Service context with user and permissions
   * @param poId - Purchase order ID
   * @returns Requisition object or null if not linked
   */
  async getRequisitions(
    ctx: ServiceContext,
    poId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const permission = buildPermissionString(
        this.resource,
        PermissionAction.READ,
      );
      await checkPermission(ctx, permission);

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
      });

      if (!po) {
        throw new NotFoundError("PurchaseOrder", poId);
      }

      // Extract requisition ID from notes
      if (!po.notes) {
        return null;
      }

      const match = po.notes.match(/\[REQ:([^\]]+)\]/);
      if (!match) {
        return null;
      }

      const requisitionId = match[1];

      // Fetch the requisition
      const requisition = await prisma.requisition.findUnique({
        where: { id: requisitionId },
      });

      return requisition;
    } catch (error) {
      throw new Error(
        `Failed to get requisitions: ${(error as Error).message}`,
      );
    }
  }
}

export const purchaseOrderRequisitionService =
  new PurchaseOrderRequisitionService();
