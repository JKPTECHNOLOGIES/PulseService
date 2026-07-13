/**
 * Assembly Tracking Service
 *
 * Retroactive ("backfill") counterpart to the live per-direct-issue learning
 * hook in DirectIssueService._tryUpdateAssemblyTracking.
 *
 * The live hook only fires in afterCreate of a NEW direct issue, so flipping
 * InventoryItem.isAssembly = true does nothing for historical data on its own.
 * This service reconstructs, from existing work orders + direct issues, the same
 * state the live hook WOULD have produced had tracking been on all along:
 *
 *   1. RepairableAssemblyBOM rows — one per (assembly type, component type),
 *      with typicalQuantity (first occurrence) and occurrenceCount (count).
 *   2. RepairableItem.parentAssemblyId — the component serial nested inside the
 *      assembly serial it was last issued into, plus an ADDED_TO_ASSEMBLY event.
 *
 * It is invoked automatically from InventoryService.update() when isAssembly is
 * toggled false -> true, and can also be run dry (no writes) for review.
 *
 * Idempotency / safety (this is what makes it differ from the increment-based
 * live hook):
 *   - BOM occurrenceCount is SET to the recomputed historical count, never
 *     incremented — re-running cannot double-count.
 *   - typicalQuantity is only written on row CREATE; existing rows keep theirs
 *     (respecting any manual override).
 *   - A parent link is only written when the component serial currently has NO
 *     parent. A serial already inside a DIFFERENT assembly is reported as a
 *     conflict and left untouched (never silently re-homed).
 *   - ADDED_TO_ASSEMBLY history is de-duplicated against existing events.
 *
 * Direct issues that did not result in consumption (CANCELLED, REVERSED,
 * FULLY_RETURNED) are excluded so the learned BOM reflects real usage.
 */

import {
  PrismaClient,
  Prisma,
  DirectIssueStatus,
  RepairableEventType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { repairableItemHistoryService } from "@/services/repairable-items/repairable-item-history.service";
import { checkPermission } from "@/services/shared/permissions";
import {
  PermissionResource,
  PermissionAction,
  buildPermissionString,
} from "@/types/permissions";
import { BadRequestError, NotFoundError } from "@/lib/api-errors";

export interface AssemblyBomBackfillRow {
  componentItemId: string;
  componentSku: string;
  componentName: string;
  typicalQuantity: number;
  occurrenceCount: number;
  action: "create" | "update" | "update-qty-preserved";
}

export interface AssemblyParentLinkRow {
  componentSerial: string;
  componentRepairableItemId: string;
  assemblySerial: string;
  assemblyRepairableItemId: string;
  workOrderNumber: string;
  action: "link" | "already-linked" | "conflict";
}

export interface AssemblyBackfillReport {
  dryRun: boolean;
  inventoryItemId: string;
  sku: string;
  isAssembly: boolean;
  globalTrackingEnabled: boolean;
  assemblySerialCount: number;
  workOrdersScanned: number;
  directIssuesScanned: number;
  bomRows: AssemblyBomBackfillRow[];
  parentLinks: AssemblyParentLinkRow[];
  notes: string[];
}

/** A single row of an assembly's learned bill of materials, for review/management. */
export interface AssemblyBomEntry {
  id: string;
  assemblyItemId: string;
  componentItemId: string;
  componentSku: string;
  componentName: string;
  typicalQuantity: number;
  occurrenceCount: number;
  lastSeenAt: Date;
  isManualOverride: boolean;
}

// Direct issues that actually represent consumption (mirror real usage).
const CONSUMING_DI_STATUSES: DirectIssueStatus[] = [
  DirectIssueStatus.ISSUED,
  DirectIssueStatus.PARTIALLY_RETURNED,
];

class AssemblyTrackingService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Reconstruct assembly BOM + sub-serial parent links for one inventory item
   * from its historical repair work orders and direct issues.
   *
   * Intentionally does NOT gate on InventoryItem.isAssembly so it can be run as a
   * preview BEFORE the flag is flipped. The caller decides when to enable.
   *
   * @returns a structured report of every row it created/updated (or would, when
   *          options.dryRun is true).
   */
  async backfillAssemblyTracking(
    context: ServiceContext,
    inventoryItemId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<AssemblyBackfillReport> {
    const dryRun = options.dryRun ?? false;
    const notes: string[] = [];

    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { id: true, sku: true, isAssembly: true },
    });
    if (!item) {
      throw new Error(`InventoryItem ${inventoryItemId} not found`);
    }

    const settings = await this.prisma.inventorySettings.findFirst({
      select: { assemblyTrackingEnabled: true },
    });
    const globalTrackingEnabled = settings?.assemblyTrackingEnabled ?? false;

    const report: AssemblyBackfillReport = {
      dryRun,
      inventoryItemId: item.id,
      sku: item.sku,
      isAssembly: item.isAssembly,
      globalTrackingEnabled,
      assemblySerialCount: 0,
      workOrdersScanned: 0,
      directIssuesScanned: 0,
      bomRows: [],
      parentLinks: [],
      notes,
    };

    // ── Assembly serials (instances) of this item ────────────────────────────
    const serials = await this.prisma.repairableItem.findMany({
      where: { inventoryItemId: item.id },
      select: { id: true, serialNumber: true },
    });
    report.assemblySerialCount = serials.length;
    const serialById = new Map(serials.map((s) => [s.id, s]));
    const serialIds = serials.map((s) => s.id);

    if (serialIds.length === 0) {
      notes.push("No serials exist for this item — nothing to backfill.");
      return report;
    }

    // ── Repair work orders whose linked serial IS one of this item's serials ──
    // This mirrors the live hook's gates exactly: the WO must point at an
    // assembly serial (repairableItemId) of an assembly-type item.
    const wos = await this.prisma.workOrder.findMany({
      where: { repairableItemId: { in: serialIds } },
      select: { id: true, woNumber: true, repairableItemId: true },
    });
    report.workOrdersScanned = wos.length;
    const woById = new Map(wos.map((w) => [w.id, w]));
    const woIds = wos.map((w) => w.id);

    if (woIds.length === 0) {
      notes.push("No repair work orders are linked to this item's serials.");
      return report;
    }

    // ── Consuming direct issues to those work orders ─────────────────────────
    const dis = await this.prisma.directIssue.findMany({
      where: {
        workOrderId: { in: woIds },
        status: { in: CONSUMING_DI_STATUSES },
      },
      select: {
        id: true,
        issueNumber: true,
        inventoryItemId: true,
        serialNumber: true,
        quantity: true,
        workOrderId: true,
        issuedAt: true,
        inventoryItem: { select: { sku: true, name: true } },
      },
      orderBy: { issuedAt: "asc" },
    });
    report.directIssuesScanned = dis.length;

    if (dis.length === 0) {
      notes.push(
        "No consuming direct issues found on the linked work orders — no BOM to learn.",
      );
      return report;
    }

    // ── 1) BOM rows (type-level) ─────────────────────────────────────────────
    // Group consuming DIs by component item. Skip the assembly issuing itself.
    interface BomAgg {
      componentItemId: string;
      sku: string;
      name: string;
      firstQuantity: number;
      occurrenceCount: number;
      lastSeenAt: Date;
    }
    const bomAgg = new Map<string, BomAgg>();
    for (const di of dis) {
      if (di.inventoryItemId === item.id) continue; // no self-component
      const existing = bomAgg.get(di.inventoryItemId);
      const qty = Number(di.quantity);
      if (!existing) {
        bomAgg.set(di.inventoryItemId, {
          componentItemId: di.inventoryItemId,
          sku: di.inventoryItem.sku,
          name: di.inventoryItem.name ?? "",
          firstQuantity: qty,
          occurrenceCount: 1,
          lastSeenAt: di.issuedAt,
        });
      } else {
        existing.occurrenceCount += 1;
        if (di.issuedAt > existing.lastSeenAt)
          existing.lastSeenAt = di.issuedAt;
      }
    }

    for (const agg of bomAgg.values()) {
      const existingRow = await this.prisma.repairableAssemblyBOM.findUnique({
        where: {
          assemblyItemId_componentItemId: {
            assemblyItemId: item.id,
            componentItemId: agg.componentItemId,
          },
        },
        select: { id: true, isManualOverride: true },
      });

      let action: AssemblyBomBackfillRow["action"];
      if (!existingRow) {
        action = "create";
      } else if (existingRow.isManualOverride) {
        action = "update-qty-preserved";
      } else {
        action = "update";
      }

      report.bomRows.push({
        componentItemId: agg.componentItemId,
        componentSku: agg.sku,
        componentName: agg.name,
        typicalQuantity: agg.firstQuantity,
        occurrenceCount: agg.occurrenceCount,
        action,
      });

      if (dryRun) continue;

      if (!existingRow) {
        await this.prisma.repairableAssemblyBOM.create({
          data: {
            assemblyItemId: item.id,
            componentItemId: agg.componentItemId,
            typicalQuantity: agg.firstQuantity,
            occurrenceCount: agg.occurrenceCount,
            lastSeenAt: agg.lastSeenAt,
          },
        });
      } else {
        // SET (not increment) for idempotency; never overwrite typicalQuantity
        // on an existing row (respects first-occurrence value + manual override).
        await this.prisma.repairableAssemblyBOM.update({
          where: { id: existingRow.id },
          data: {
            occurrenceCount: agg.occurrenceCount,
            lastSeenAt: agg.lastSeenAt,
          },
        });
      }
    }

    // ── 2) Sub-serial parent links (instance-level) ──────────────────────────
    // For each serialized component, the CURRENT containment is the assembly it
    // was LAST issued into (latest issuedAt among consuming DIs).
    const latestSerialDi = new Map<string, (typeof dis)[number]>();
    for (const di of dis) {
      if (!di.serialNumber) continue;
      const prev = latestSerialDi.get(di.serialNumber);
      if (!prev || di.issuedAt > prev.issuedAt) {
        latestSerialDi.set(di.serialNumber, di);
      }
    }

    for (const [serialNumber, di] of latestSerialDi) {
      const workOrderId = di.workOrderId;
      if (!workOrderId) continue;
      const wo = woById.get(workOrderId);
      const assemblySerial = wo?.repairableItemId
        ? serialById.get(wo.repairableItemId)
        : undefined;
      if (!wo || !assemblySerial) continue; // WO not assembly-linked → BOM only

      const component = await this.prisma.repairableItem.findUnique({
        where: { serialNumber },
        select: { id: true, serialNumber: true, parentAssemblyId: true },
      });
      if (!component) {
        notes.push(
          `Component serial ${serialNumber} (DI ${di.issueNumber}) has no RepairableItem row — counted in BOM only.`,
        );
        continue;
      }

      let action: AssemblyParentLinkRow["action"];
      if (component.parentAssemblyId === assemblySerial.id) {
        action = "already-linked";
      } else if (component.parentAssemblyId) {
        action = "conflict"; // already inside a different assembly — never overwrite
      } else {
        action = "link";
      }

      report.parentLinks.push({
        componentSerial: component.serialNumber,
        componentRepairableItemId: component.id,
        assemblySerial: assemblySerial.serialNumber,
        assemblyRepairableItemId: assemblySerial.id,
        workOrderNumber: wo.woNumber,
        action,
      });

      if (dryRun || action !== "link") continue;

      await this.prisma.repairableItem.update({
        where: { id: component.id },
        data: { parentAssemblyId: assemblySerial.id },
      });

      // De-dupe the history event against any pre-existing ADDED_TO_ASSEMBLY.
      const existingEvent = await this.prisma.repairableItemHistory.findFirst({
        where: {
          repairableItemId: component.id,
          eventType: RepairableEventType.ADDED_TO_ASSEMBLY,
          assemblyId: assemblySerial.id,
        },
        select: { id: true },
      });
      if (!existingEvent) {
        await repairableItemHistoryService.logAddedToAssembly(context, {
          repairableItemId: component.id,
          eventType: "ADDED_TO_ASSEMBLY" as const,
          assemblyId: assemblySerial.id,
          assemblySerial: assemblySerial.serialNumber,
          workOrderId: wo.id,
          workOrderNumber: wo.woNumber,
          notes:
            `Backfilled: installed inside assembly ${assemblySerial.serialNumber} ` +
            `via DI ${di.issueNumber} on WO ${wo.woNumber}`,
        });
      }
    }

    if (!globalTrackingEnabled) {
      notes.push(
        "Global InventorySettings.assemblyTrackingEnabled is OFF — historical data " +
          "is backfilled, but FUTURE direct issues will not learn until it is enabled.",
      );
    }

    return report;
  }

  // ===========================================================================
  // ASSEMBLY BOM — REVIEW & MANAGE
  // ===========================================================================

  private toBomEntry(row: {
    id: string;
    assemblyItemId: string;
    componentItemId: string;
    typicalQuantity: Prisma.Decimal;
    occurrenceCount: number;
    lastSeenAt: Date;
    isManualOverride: boolean;
    componentItem: {
      sku: string;
      name: string | null;
      description: string;
    };
  }): AssemblyBomEntry {
    return {
      id: row.id,
      assemblyItemId: row.assemblyItemId,
      componentItemId: row.componentItemId,
      componentSku: row.componentItem.sku,
      componentName: row.componentItem.name ?? row.componentItem.description,
      typicalQuantity: Number(row.typicalQuantity),
      occurrenceCount: row.occurrenceCount,
      lastSeenAt: row.lastSeenAt,
      isManualOverride: row.isManualOverride,
    };
  }

  /**
   * List the learned bill of materials for an assembly inventory item,
   * ordered by how often each component has been seen.
   */
  async getAssemblyBom(
    context: ServiceContext,
    assemblyItemId: string,
  ): Promise<AssemblyBomEntry[]> {
    await checkPermission(
      context,
      buildPermissionString(
        PermissionResource.INVENTORY,
        PermissionAction.READ,
      ),
    );

    const rows = await this.prisma.repairableAssemblyBOM.findMany({
      where: { assemblyItemId },
      include: {
        componentItem: {
          select: { sku: true, name: true, description: true },
        },
      },
      orderBy: [{ occurrenceCount: "desc" }, { lastSeenAt: "desc" }],
    });

    return rows.map((r) => this.toBomEntry(r));
  }

  /**
   * Update the typical quantity of a learned BOM row. Setting it flags the row
   * as a manual override so future auto-learning will not change it.
   */
  async updateBomEntry(
    context: ServiceContext,
    bomId: string,
    data: { typicalQuantity: number },
  ): Promise<AssemblyBomEntry> {
    await checkPermission(
      context,
      buildPermissionString(
        PermissionResource.INVENTORY,
        PermissionAction.UPDATE,
      ),
    );

    if (!(data.typicalQuantity > 0)) {
      throw new BadRequestError("typicalQuantity must be greater than 0");
    }

    const existing = await this.prisma.repairableAssemblyBOM.findUnique({
      where: { id: bomId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("RepairableAssemblyBOM", bomId);

    const updated = await this.prisma.repairableAssemblyBOM.update({
      where: { id: bomId },
      data: { typicalQuantity: data.typicalQuantity, isManualOverride: true },
      include: {
        componentItem: {
          select: { sku: true, name: true, description: true },
        },
      },
    });
    return this.toBomEntry(updated);
  }

  /**
   * Remove a component from an assembly's learned BOM (e.g. a part that was
   * issued by mistake and should not be part of the typical kit).
   */
  async deleteBomEntry(context: ServiceContext, bomId: string): Promise<void> {
    await checkPermission(
      context,
      buildPermissionString(
        PermissionResource.INVENTORY,
        PermissionAction.UPDATE,
      ),
    );

    const existing = await this.prisma.repairableAssemblyBOM.findUnique({
      where: { id: bomId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("RepairableAssemblyBOM", bomId);

    await this.prisma.repairableAssemblyBOM.delete({ where: { id: bomId } });
  }

  /**
   * Manually add a component to an assembly's BOM. Useful when a part belongs in
   * the kit but has not been issued under tracking yet. Created as a manual
   * override with occurrenceCount 0 (no observed issues yet).
   */
  async addBomEntry(
    context: ServiceContext,
    assemblyItemId: string,
    data: { componentItemId: string; typicalQuantity: number },
  ): Promise<AssemblyBomEntry> {
    await checkPermission(
      context,
      buildPermissionString(
        PermissionResource.INVENTORY,
        PermissionAction.UPDATE,
      ),
    );

    if (!(data.typicalQuantity > 0)) {
      throw new BadRequestError("typicalQuantity must be greater than 0");
    }
    if (data.componentItemId === assemblyItemId) {
      throw new BadRequestError("An assembly cannot be its own component");
    }

    const [assembly, component] = await Promise.all([
      this.prisma.inventoryItem.findUnique({
        where: { id: assemblyItemId },
        select: { id: true },
      }),
      this.prisma.inventoryItem.findUnique({
        where: { id: data.componentItemId },
        select: { id: true },
      }),
    ]);
    if (!assembly) throw new NotFoundError("InventoryItem", assemblyItemId);
    if (!component) {
      throw new NotFoundError("InventoryItem", data.componentItemId);
    }

    const duplicate = await this.prisma.repairableAssemblyBOM.findUnique({
      where: {
        assemblyItemId_componentItemId: {
          assemblyItemId,
          componentItemId: data.componentItemId,
        },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestError(
        "That component is already in this assembly's BOM",
      );
    }

    const created = await this.prisma.repairableAssemblyBOM.create({
      data: {
        assemblyItemId,
        componentItemId: data.componentItemId,
        typicalQuantity: data.typicalQuantity,
        occurrenceCount: 0,
        isManualOverride: true,
      },
      include: {
        componentItem: {
          select: { sku: true, name: true, description: true },
        },
      },
    });
    return this.toBomEntry(created);
  }

  /**
   * Link components already issued to a repair work order to the assembly serial
   * that has just been assigned to it.
   *
   * The live per-DI hook learns the BOM the moment a part is issued (using the
   * WO's repair TYPE), but it can only set instance-level parentAssemblyId once a
   * specific assembly SERIAL is known. When parts were issued BEFORE the removed
   * assembly serial was assigned to the auto-created repair WO, their parent links
   * are missing. This method fills them in — call it right after a serial is
   * attached to a repair WO.
   *
   * Non-fatal by contract: callers should wrap in try/catch; it also guards every
   * sub-step. Only links serials that currently have NO parent (never re-homes a
   * component already inside a different assembly).
   *
   * @returns the number of component serials linked.
   */
  async reconcileWorkOrderAssembly(
    context: ServiceContext,
    workOrderId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<{ linked: number }> {
    const dryRun = options.dryRun ?? false;
    // Global tracking must be on (same gate as the live hook).
    const settings = await this.prisma.inventorySettings.findFirst({
      select: { assemblyTrackingEnabled: true },
    });
    if (!settings?.assemblyTrackingEnabled) return { linked: 0 };

    const wo = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { woNumber: true, repairableItemId: true },
    });
    if (!wo?.repairableItemId) return { linked: 0 };

    // The assigned serial must itself be an assembly type.
    const assemblySerial = await this.prisma.repairableItem.findUnique({
      where: { id: wo.repairableItemId },
      select: {
        id: true,
        serialNumber: true,
        inventoryItem: { select: { isAssembly: true } },
      },
    });
    if (!assemblySerial?.inventoryItem.isAssembly) return { linked: 0 };

    // Consuming, serialized direct issues already made to this work order.
    const dis = await this.prisma.directIssue.findMany({
      where: {
        workOrderId,
        status: { in: CONSUMING_DI_STATUSES },
        serialNumber: { not: null },
      },
      select: { issueNumber: true, serialNumber: true },
      orderBy: { issuedAt: "asc" },
    });

    let linked = 0;
    for (const di of dis) {
      if (!di.serialNumber) continue;
      const component = await this.prisma.repairableItem.findUnique({
        where: { serialNumber: di.serialNumber },
        select: { id: true, parentAssemblyId: true },
      });
      // Skip if missing, already linked here, or inside a different assembly.
      if (!component || component.parentAssemblyId) continue;

      if (dryRun) {
        linked += 1;
        continue;
      }

      await this.prisma.repairableItem.update({
        where: { id: component.id },
        data: { parentAssemblyId: assemblySerial.id },
      });

      const existingEvent = await this.prisma.repairableItemHistory.findFirst({
        where: {
          repairableItemId: component.id,
          eventType: RepairableEventType.ADDED_TO_ASSEMBLY,
          assemblyId: assemblySerial.id,
        },
        select: { id: true },
      });
      if (!existingEvent) {
        await repairableItemHistoryService.logAddedToAssembly(context, {
          repairableItemId: component.id,
          eventType: "ADDED_TO_ASSEMBLY" as const,
          assemblyId: assemblySerial.id,
          assemblySerial: assemblySerial.serialNumber,
          workOrderId,
          workOrderNumber: wo.woNumber,
          notes:
            `Linked to assembly ${assemblySerial.serialNumber} on serial ` +
            `assignment to WO ${wo.woNumber} (issued via DI ${di.issueNumber})`,
        });
      }
      linked += 1;
    }

    return { linked };
  }
}

const globalForAssemblyTracking = globalThis as unknown as {
  assemblyTrackingService: AssemblyTrackingService | undefined;
};

export const assemblyTrackingService =
  globalForAssemblyTracking.assemblyTrackingService ??
  (globalForAssemblyTracking.assemblyTrackingService =
    new AssemblyTrackingService(prisma));
