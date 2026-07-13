/**
 * Direct Issue Service
 *
 * Service layer for direct inventory issue operations.
 * Allows issuing inventory to departments/account codes without work orders.
 * Extends the base CrudService to provide direct issue-specific functionality.
 * Uses InventoryStockService for all stock operations.
 */

import {
  PrismaClient,
  DirectIssueStatus,
  ReturnCondition,
} from "@prisma/client";
import { CrudService } from "@/services/base/crud.service";
import { inventoryGLService } from "@/services/inventory/inventory-gl.service";
import { getCurrentBudgetPeriod } from "@/services/gl";
import { financeSettingsService } from "@/services/finance/finance-settings.service";
import {
  ServiceContext,
  ValidationResult,
  ServiceConfig,
} from "@/services/base/types";
import {
  DirectIssueCreateDTO,
  DirectIssueUpdateDTO,
  DirectIssueReturnDTO,
  DirectIssueFilterDTO,
  DirectIssueSummaryFilterDTO,
  DirectIssueWithRelations,
  DirectIssueReturnWithRelations,
  DirectIssueSummary,
  IssueOperationResult,
  ReturnOperationResult,
  DirectIssueReverseInput,
  ReverseIssueResult,
  directIssueCreateSchema,
  directIssueUpdateSchema,
  directIssueReturnSchema,
  calculateTotalCost,
  calculateQuantityRemaining,
  determineStatus,
  canRestock,
} from "./direct-issue.types";
import { prisma } from "@/lib/prisma";
import { PermissionResource, RoleName } from "@/types/permissions";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { inventoryStockService } from "@/services/inventory/stock";
import { inventoryTransactionService } from "@/services/inventory/transaction.service";
import { InventoryTransactionType } from "@/services/inventory/transaction.types";
import { repairableItemHistoryService } from "@/services/repairable-items/repairable-item-history.service";
import { inventorySettingsService } from "@/services/inventory/inventory-settings.service";
import { repairWorkOrderService } from "@/services/inventory/repair-work-order.service";
import { repairWorkflowService } from "@/services/repairable-items/repair-workflow.service";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import { notificationService } from "@/services/notifications/notification.service";
import {
  NotificationCategory,
  NotificationPriority,
} from "@/services/notifications/notification.types";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";

/**
 * Direct Issue Service Class
 *
 * Provides CRUD operations and business logic for direct issue management.
 */
class DirectIssueService extends CrudService<
  DirectIssueWithRelations,
  DirectIssueCreateDTO,
  DirectIssueUpdateDTO
> {
  constructor(prismaClient: PrismaClient) {
    const config: ServiceConfig = {
      resourceName: "DirectIssue",
      permissions: {
        read: `${PermissionResource.INVENTORY}:read`,
        create: `${PermissionResource.INVENTORY}:issue`,
        update: `${PermissionResource.INVENTORY}:issue`,
        delete: `${PermissionResource.INVENTORY}:issue`,
      },
      softDelete: false,
      trackAudit: false,
      defaultLimit: 50,
      maxLimit: 200,
    };

    super(prismaClient, prismaClient.directIssue, config);
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate direct issue creation data
   * Checks:
   * - Inventory item exists and is active
   * - Store exists
   * - Department exists and is active
   * - Account code exists and is active
   * - Work order exists and is valid (if provided)
   * - Sufficient inventory available
   * - Quantity is positive
   */
  protected override async validateCreate(
    data: DirectIssueCreateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation = directIssueCreateSchema.safeParse(data);
    if (!schemaValidation.success) {
      schemaValidation.error.issues.forEach((err) => {
        errors.push({
          field: err.path.join("."),
          message: err.message,
          code: err.code,
        });
      });
      return { valid: false, errors };
    }

    // Validate inventory item exists and is active
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      include: {
        stock: true,
      },
    });

    if (!inventoryItem) {
      errors.push({
        field: "inventoryItemId",
        message: "Inventory item not found",
        code: "INVENTORY_ITEM_NOT_FOUND",
      });
    } else if (!inventoryItem.isActive) {
      errors.push({
        field: "inventoryItemId",
        message: "Inventory item is not active",
        code: "INVENTORY_ITEM_INACTIVE",
      });
    }

    // Validate store exists (only if storeId is provided)
    // For serialized/repairable items, storeId is optional
    if (data.storeId) {
      const store = await this.prisma.store.findUnique({
        where: { id: data.storeId },
      });

      if (!store) {
        errors.push({
          field: "storeId",
          message: "Store not found",
          code: "STORE_NOT_FOUND",
        });
      }
    } else if (!data.serialNumber) {
      // storeId is required for non-serialized items
      errors.push({
        field: "storeId",
        message: "Store is required for non-serialized items",
        code: "STORE_REQUIRED",
      });
    }

    // Validate department exists and is active (only if provided)
    if (data.departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: data.departmentId },
      });

      if (!department) {
        errors.push({
          field: "departmentId",
          message: "Department not found",
          code: "DEPARTMENT_NOT_FOUND",
        });
      } else if (!department.isActive) {
        errors.push({
          field: "departmentId",
          message: "Department is not active",
          code: "DEPARTMENT_INACTIVE",
        });
      }
    }

    // Validate account code exists and is active (only if provided)
    if (data.accountCodeId) {
      const accountCode = await this.prisma.accountCode.findUnique({
        where: { id: data.accountCodeId },
      });

      if (!accountCode) {
        errors.push({
          field: "accountCodeId",
          message: "Account code not found",
          code: "ACCOUNT_CODE_NOT_FOUND",
        });
      } else if (!accountCode.isActive) {
        errors.push({
          field: "accountCodeId",
          message: "Account code is not active",
          code: "ACCOUNT_CODE_INACTIVE",
        });
      }
    }

    // Validate project if provided
    if (data.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: data.projectId },
        select: { id: true, status: true, code: true },
      });

      if (!project) {
        errors.push({
          field: "projectId",
          message: "Project not found",
          code: "PROJECT_NOT_FOUND",
        });
      } else if (
        project.status === "CANCELLED" ||
        project.status === "CLOSED"
      ) {
        errors.push({
          field: "projectId",
          message: `Project ${project.code} is ${project.status.toLowerCase()} and cannot receive charges`,
          code: "PROJECT_INACTIVE",
        });
      }
    }

    // Validate area if provided - Area is now a Location with isBudgetArea=true or locationType='Area'
    if (data.areaId) {
      const location = await this.prisma.location.findUnique({
        where: { id: data.areaId },
      });

      if (!location) {
        errors.push({
          field: "areaId",
          message: "Budget area location not found",
          code: "AREA_NOT_FOUND",
        });
      } else if (!location.isBudgetArea && location.locationType !== "Area") {
        errors.push({
          field: "areaId",
          message: "Location is not configured as a budget area",
          code: "AREA_INVALID",
        });
      } else if (!location.isActive) {
        errors.push({
          field: "areaId",
          message: "Budget area is not active",
          code: "AREA_INACTIVE",
        });
      }
    }

    // Validate work order if provided
    if (data.workOrderId) {
      const workOrder = await this.prisma.workOrder.findUnique({
        where: { id: data.workOrderId },
        select: {
          id: true,
          woNumber: true,
          status: true,
        },
      });

      if (!workOrder) {
        errors.push({
          field: "workOrderId",
          message: "Work order not found",
          code: "WORK_ORDER_NOT_FOUND",
        });
      } else if (workOrder.status === "Cancelled") {
        // Cancelled WOs are always rejected — terminal state.
        errors.push({
          field: "workOrderId",
          message: "Cannot issue to cancelled work order",
          code: "WORK_ORDER_INVALID_STATUS",
        });
      }
      // NOTE: "Closed" WOs were previously rejected here. The gate has been
      // relaxed so Inventory Managers can issue late parts for work that
      // physically arrived after a WO was closed. The policy enforcement
      // (role + verifiedClosedAt + reason) lives in beforeCreate where we
      // have access to the service context (role, userId). See beforeCreate.
    }

    // Validate pmEquipmentId if provided - must belong to the PM work order
    if (data.pmEquipmentId) {
      if (!data.workOrderId) {
        errors.push({
          field: "pmEquipmentId",
          message: "pmEquipmentId requires workOrderId to be set",
          code: "PM_EQUIPMENT_REQUIRES_WORK_ORDER",
        });
      } else {
        const pmWorkOrder = await this.prisma.pMWorkOrder.findUnique({
          where: { workOrderId: data.workOrderId },
          select: { equipmentIds: true },
        });
        if (!pmWorkOrder) {
          errors.push({
            field: "pmEquipmentId",
            message: "Work order is not a PM work order",
            code: "NOT_PM_WORK_ORDER",
          });
        } else if (!pmWorkOrder.equipmentIds.includes(data.pmEquipmentId)) {
          errors.push({
            field: "pmEquipmentId",
            message: "Equipment is not part of this PM work order",
            code: "PM_EQUIPMENT_NOT_IN_WO",
          });
        }
      }
    }

    // Check inventory availability (warn but don't block)
    // Skip validation for serialized items as they're tracked individually
    if (inventoryItem && !data.serialNumber && data.quantity) {
      const validation = await inventoryStockService.validateAvailability(
        data.inventoryItemId,
        data.quantity,
        data.storeId,
      );

      if (!validation.valid) {
        // Insufficient stock warning - don't block
      }
    }

    // Validate serial number if provided
    if (data.serialNumber) {
      const repairableItem = await this.prisma.repairableItem.findUnique({
        where: { serialNumber: data.serialNumber },
        include: { inventoryItem: true },
      });

      if (!repairableItem) {
        errors.push({
          field: "serialNumber",
          message: "Serial number not found",
          code: "SERIAL_NUMBER_NOT_FOUND",
        });
      } else if (repairableItem.inventoryItemId !== data.inventoryItemId) {
        errors.push({
          field: "serialNumber",
          message: "Serial number does not belong to this inventory item",
          code: "SERIAL_NUMBER_MISMATCH",
        });
      } else if (repairableItem.status !== "AVAILABLE") {
        errors.push({
          field: "serialNumber",
          message: `Serial number is not available (current status: ${repairableItem.status})`,
          code: "SERIAL_NUMBER_NOT_AVAILABLE",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Validate direct issue update data
   */
  protected override async validateUpdate(
    id: string,
    data: DirectIssueUpdateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation = directIssueUpdateSchema.safeParse(data);
    if (!schemaValidation.success) {
      schemaValidation.error.issues.forEach((err) => {
        errors.push({
          field: err.path.join("."),
          message: err.message,
          code: err.code,
        });
      });
      return { valid: false, errors };
    }

    // Get existing issue
    const existingIssue = await this.prisma.directIssue.findUnique({
      where: { id },
    });

    if (!existingIssue) {
      errors.push({
        field: "id",
        message: "Direct issue not found",
        code: "DIRECT_ISSUE_NOT_FOUND",
      });
      return { valid: false, errors };
    }

    // Cannot update cancelled issues
    if (existingIssue.status === DirectIssueStatus.CANCELLED) {
      errors.push({
        field: "status",
        message: "Cannot update cancelled direct issue",
        code: "DIRECT_ISSUE_CANCELLED",
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ============================================================================
  // DATA TRANSFORMATION
  // ============================================================================

  /**
   * Transform create DTO to Prisma data
   */
  protected override async transformCreateDTO(
    data: DirectIssueCreateDTO,
    context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    // Get inventory item for unit cost
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      select: {
        unitCost: true,
        isRepairable: true,
      },
    });

    if (!inventoryItem) {
      throw new NotFoundError("Inventory Item", data.inventoryItemId);
    }

    const unitCost = Number(inventoryItem.unitCost);

    // ── Cost anomaly check ────────────────────────────────────────────────
    // Compare the item's current unitCost against its most recent RECEIVE
    // transaction. If cost is 5× higher than the last receive price, log a
    // structured audit warning. This detects cases where the item's cost was
    // changed incorrectly and issues are being created at an inflated cost.
    // We DO NOT block the issue — it may be legitimate. We create an audit
    // trail so Finance can review.
    if (unitCost > 0) {
      try {
        const lastReceive = await this.prisma.inventoryTransaction.findFirst({
          where: {
            inventoryItemId: data.inventoryItemId,
            transactionType: "RECEIVE",
            unitCost: { gt: 0 },
          },
          orderBy: { transactionDate: "desc" },
          select: {
            unitCost: true,
            transactionDate: true,
            referenceNumber: true,
          },
        });
        if (lastReceive) {
          const receiveCost = Number(lastReceive.unitCost);
          const ratio = unitCost / receiveCost;
          if (ratio > 5 && unitCost - receiveCost > 50) {
            await auditLogService.log({
              userId: context.userId,
              userName: context.userName ?? "Unknown",
              action: AuditAction.CREATE,
              entityType: "DirectIssue",
              entityId: data.inventoryItemId,
              entityName: `Anomalous cost on issue`,
              changes: {
                warning: "COST_ANOMALY_ON_ISSUE",
                inventoryItemId: data.inventoryItemId,
                issueCost: unitCost,
                lastReceiveCost: receiveCost,
                ratio: Math.round(ratio * 10) / 10,
                lastReceiveDate: lastReceive.transactionDate?.toISOString(),
                lastReceiveRef: lastReceive.referenceNumber,
                message: `Item is being issued at $${unitCost.toFixed(2)}/unit but was last received at $${receiveCost.toFixed(2)}/unit (${Math.round(ratio * 10) / 10}× higher). Verify unitCost is correct before proceeding.`,
              },
            });
          }
        }
      } catch {
        // Non-critical — never block an issue due to an audit log failure
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // For serialized items, quantity is always 1
    const quantity = data.serialNumber ? 1 : (data.quantity ?? 0);
    const totalCost = calculateTotalCost(quantity, unitCost);

    // For serialized items without storeId, use a default store
    // The actual store is tracked on the RepairableItem record
    let storeId = data.storeId;
    if (data.serialNumber && !storeId) {
      // Get the default/first store as a placeholder
      const defaultStore = await this.prisma.store.findFirst({
        orderBy: { name: "asc" },
      });
      if (defaultStore) {
        storeId = defaultStore.id;
      } else {
        throw new NotFoundError("Store", "No stores found in system");
      }
    }

    if (!storeId) {
      throw new BadRequestError(
        "Store ID is required for non-serialized items",
      );
    }

    // Generate issue number
    const issueNumber = await this.generateIssueNumber();

    // Get current budget period
    let budgetPeriod: { id: string } | null = null;
    try {
      budgetPeriod = await getCurrentBudgetPeriod(this.prisma);
    } catch {
      // No active budget period found — leave as null
    }

    // Get user details
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      select: { firstName: true, lastName: true },
    });

    const userName = user
      ? `${user.firstName} ${user.lastName}`
      : "Unknown User";

    // Build the data object, only including departmentId and accountCodeId if they're provided
    const prismaData: Record<string, unknown> = {
      issueNumber,
      inventoryItemId: data.inventoryItemId,
      storeId,
      bin: "MAIN", // Will be updated in afterCreate with actual bin
      quantity,
      serialNumber: data.serialNumber ?? null,
      unitCost,
      totalCost,
      areaId: data.areaId ?? null,
      projectId: data.projectId ?? null,
      workOrderId: data.workOrderId ?? null,
      budgetPeriodId: budgetPeriod?.id ?? null,
      issuedBy: context.userId,
      issuedByName: userName,
      purpose: data.purpose ?? null,
      notes: data.notes ?? null,
      quantityReturned: 0,
      status: DirectIssueStatus.ISSUED,
    };

    // Resolve departmentId and accountCodeId so the DI row is NEVER written
    // with NULL values. The GL layer resolves these at posting time, but that
    // leaves the direct_issues table orphaned for reports that don't join GL.
    //
    // Priority (mirrors inventoryGLService.resolveAccountCode / resolveDepartment):
    //   accountCodeId: provided
    //                  -> projectId  → project.accountCodeId          (NEW — project overrides equipment)
    //                  -> workOrderId → WO.equipment.defaultAccountCodeId
    //                  -> FinanceSettings.defaultInventoryAccountCodeId
    //   departmentId:  provided
    //                  -> workOrderId → WO.equipment.departmentId
    //                  -> FinanceSettings.defaultWorkOrderDepartmentId (WO/project mode)
    //                  -> FinanceSettings.defaultInventoryDepartmentId (non-WO)
    let resolvedAccountCodeId: string | null = data.accountCodeId ?? null;
    let resolvedDepartmentId: string | null = data.departmentId ?? null;

    // Project: resolve account code from project.accountCodeId
    if (data.projectId && !resolvedAccountCodeId) {
      const project = await this.prisma.project.findUnique({
        where: { id: data.projectId },
        select: { accountCodeId: true },
      });
      if (project?.accountCodeId) {
        resolvedAccountCodeId = project.accountCodeId;
      }
    }

    // Work order: resolve account code + department from equipment
    if (data.workOrderId && (!resolvedAccountCodeId || !resolvedDepartmentId)) {
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: data.workOrderId },
        select: {
          equipment: {
            select: {
              defaultAccountCodeId: true,
              departmentId: true,
            },
          },
        },
      });
      if (!resolvedAccountCodeId && wo?.equipment?.defaultAccountCodeId) {
        resolvedAccountCodeId = wo.equipment.defaultAccountCodeId;
      }
      if (!resolvedDepartmentId && wo?.equipment?.departmentId) {
        resolvedDepartmentId = wo.equipment.departmentId;
      }
    }

    // FinanceSettings fallback — guarantees non-NULL whenever settings are configured
    if (!resolvedAccountCodeId || !resolvedDepartmentId) {
      const [woDefaults, invDefaults] = await Promise.all([
        financeSettingsService.getWorkOrderDefaults(),
        financeSettingsService.getInventoryDefaults(),
      ]);
      if (!resolvedAccountCodeId) {
        resolvedAccountCodeId =
          invDefaults.defaultInventoryAccountCodeId ??
          woDefaults.defaultWorkOrderAccountCodeId ??
          null;
      }
      if (!resolvedDepartmentId) {
        // Project mode: department is NOT recorded — the project is the sole
        // budget dimension. Storing a default dept on a project DI is misleading
        // (it shows "Dept: Maintenance" on what is actually a project charge).
        // WO mode: fall back to WO department default.
        // Department mode: fall back to inventory department default.
        if (data.projectId) {
          // Leave resolvedDepartmentId = null intentionally
        } else {
          resolvedDepartmentId = data.workOrderId
            ? (woDefaults.defaultWorkOrderDepartmentId ??
              invDefaults.defaultInventoryDepartmentId ??
              null)
            : (invDefaults.defaultInventoryDepartmentId ??
              woDefaults.defaultWorkOrderDepartmentId ??
              null);
        }
      }
    }

    if (resolvedAccountCodeId) {
      prismaData.accountCodeId = resolvedAccountCodeId;
    }
    if (resolvedDepartmentId) {
      prismaData.departmentId = resolvedDepartmentId;
    }

    // Include pmEquipmentId if provided (tracks which specific equipment a part was used on in a PM WO)
    prismaData.pmEquipmentId = data.pmEquipmentId ?? null;

    return prismaData;
  }

  /**
   * Transform update DTO to Prisma data
   */
  protected override transformUpdateDTO(
    data: DirectIssueUpdateDTO,
    _context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    const transformed: Record<string, unknown> = {};

    if (data.notes !== undefined) transformed.notes = data.notes;
    if (data.purpose !== undefined) transformed.purpose = data.purpose;

    return Promise.resolve(transformed);
  }

  /**
   * Transform model to include relations
   */
  protected override async transformModel(
    model: Record<string, unknown>,
  ): Promise<DirectIssueWithRelations> {
    // If relations are already included, convert Decimals
    if (model.inventoryItem !== undefined) {
      const quantity = Number(model.quantity);
      const quantityReturned = Number(model.quantityReturned);

      return {
        ...model,
        quantity,
        quantityReturned,
        quantityRemaining: calculateQuantityRemaining(
          quantity,
          quantityReturned,
          model.status as DirectIssueStatus,
        ),
        unitCost: Number(model.unitCost),
        totalCost: Number(model.totalCost),
        serialNumber: model.serialNumber as string | null, // Explicitly include serial number
        inventoryItem: {
          ...(model.inventoryItem as Record<string, unknown>),
          unitCost: Number(
            (model.inventoryItem as Record<string, unknown>).unitCost,
          ),
        },
      } as unknown as DirectIssueWithRelations;
    }

    // Otherwise, fetch relations
    const modelWithId = model as Record<string, unknown> & { id: string };
    const issue = await this.prisma.directIssue.findUnique({
      where: { id: modelWithId.id },
      include: {
        inventoryItem: true,
        store: true,
        department: true,
        accountCode: true,
        area: true,
        budgetPeriod: true,
        workOrder: {
          select: {
            id: true,
            woNumber: true,
            title: true,
            status: true,
            equipment: {
              select: {
                id: true,
                tag: true,
                description: true,
              },
            },
          },
        },
        project: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        returns: {
          orderBy: { returnedAt: "desc" },
        },
        autoGeneratedSerial: {
          select: {
            serialNumber: true,
          },
        },
      },
    });

    if (!issue) {
      throw new NotFoundError("DirectIssue", modelWithId.id);
    }

    const quantity = Number(issue.quantity);
    const quantityReturned = Number(issue.quantityReturned);

    // Use auto-generated serial number if direct serial number is null
    const serialNumber =
      issue.serialNumber ?? issue.autoGeneratedSerial?.serialNumber ?? null;

    return {
      ...issue,
      quantity,
      quantityReturned,
      quantityRemaining: calculateQuantityRemaining(
        quantity,
        quantityReturned,
        issue.status,
      ),
      unitCost: Number(issue.unitCost),
      totalCost: Number(issue.totalCost),
      serialNumber, // Use direct serial or auto-generated serial
      inventoryItem: {
        ...issue.inventoryItem,
        unitCost: Number(issue.inventoryItem.unitCost),
      },
      returns: issue.returns.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
      })),
    } as unknown as DirectIssueWithRelations;
  }

  // ============================================================================
  // HOOKS
  // ============================================================================

  /**
   * Before create hook — runs BEFORE the DB write (no row exists yet).
   *
   * Two checks in order:
   *
   * 1. Serial AVAILABLE gate (G6)
   *    When a serialNumber is supplied, the referenced RepairableItem must be
   *    AVAILABLE.  Checking here (not in afterCreate) ensures the rejection
   *    happens before the DirectIssue row is committed.  A throw here leaves
   *    zero rows written.
   *
   * 2. Late-close work-order gate
   *    Techs often close a WO the same day, but receiving/put-away for parts
   *    trails by a day or two. Rather than forcing the WO to be re-opened or
   *    forcing the late parts to be issued against a different WO (which
   *    distorts the cost reports), we allow an Inventory Manager (or Admin)
   *    to issue parts directly to a Closed WO — provided Finance has not yet
   *    verified the close and the user supplies an explicit reason.
   *
   *    Rules, in order:
   *      a. Only applies when workOrderId is set AND the WO status is "Closed".
   *      b. Role must be Admin or Inventory Manager.
   *      c. WO.verifiedClosedAt must be null (Finance-verified = sealed).
   *      d. A non-empty `purpose` is required for the audit trail.
   *
   * All other validation (store, quantity, item) already ran in
   * validateCreate. This hook is the last check before transformCreateDTO.
   */
  protected override async beforeCreate(
    data: DirectIssueCreateDTO,
    context: ServiceContext,
  ): Promise<void> {
    // ── G6: Serial AVAILABLE gate ─────────────────────────────────────────
    // Must run BEFORE the DB write (here, not in afterCreate) so a rejection
    // leaves zero rows committed and is safe to retry.
    if (data.serialNumber) {
      const serial = await this.prisma.repairableItem.findUnique({
        where: { serialNumber: data.serialNumber },
        select: { status: true },
      });
      if (serial && serial.status !== "AVAILABLE") {
        throw new BadRequestError(
          `Serial ${data.serialNumber} cannot be issued — its current status is ` +
            `${serial.status}. Only AVAILABLE serials can be direct-issued.`,
        );
      }
    }

    // ── Stock sufficiency gate (non-serialized) ───────────────────────────
    // Issuing MORE than is physically on hand previously slipped past
    // validateCreate (warn-only) and only failed later in afterCreate — AFTER
    // the DirectIssue row was already committed. That left a "ghost" issue with
    // no stock movement which could then be erroneously RETURNED, crediting
    // stock that was never removed and minting phantom inventory
    // (e.g. SKU 30960 / DI-2026-01562: 30,960 issued from 16 on hand).
    // Block it HERE, before any row is written, so a failed issue leaves zero
    // rows committed.
    if (!data.serialNumber && data.quantity && data.quantity > 0) {
      // A work order with an ACTIVE reservation covering this quantity may draw
      // its earmarked stock even if free stock is short (mirrors the
      // afterCreate "hasReservationForThisWO" allowance).
      let coveredByReservation = false;
      if (data.workOrderId) {
        const reservation = await this.prisma.inventoryReservation.findFirst({
          where: {
            inventoryItemId: data.inventoryItemId,
            reservedForId: data.workOrderId,
            status: "ACTIVE",
          },
          select: { quantity: true },
        });
        if (reservation && Number(reservation.quantity) >= data.quantity) {
          coveredByReservation = true;
        }
      }

      if (!coveredByReservation) {
        const stockAgg = await this.prisma.inventoryStock.aggregate({
          where: { inventoryItemId: data.inventoryItemId },
          _sum: { quantityOnHand: true },
        });
        const onHand = Number(stockAgg._sum.quantityOnHand ?? 0);
        if (onHand < data.quantity) {
          throw new BadRequestError(
            `Insufficient stock on hand. On hand: ${onHand}, Requested: ` +
              `${data.quantity}. The direct issue was not created.`,
          );
        }
      }
    }

    // ── Late-close work-order gate ────────────────────────────────────────
    if (!data.workOrderId) return;

    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
      select: {
        status: true,
        woNumber: true,
        verifiedClosedAt: true,
        completedAt: true,
      },
    });
    if (!workOrder || workOrder.status !== "Closed") return;

    // 2. Role gate — only Inventory Manager and Admin can issue to Closed WOs.
    const role = context.userRole;
    const allowedRoles: string[] = [RoleName.ADMIN, RoleName.INVENTORY_MANAGER];
    if (!role || !allowedRoles.includes(role)) {
      throw new BadRequestError(
        `Only Inventory Managers can issue parts to a closed work order ` +
          `(${workOrder.woNumber}). Please contact an Inventory Manager.`,
      );
    }

    // 3. Verified-closed WOs are sealed — never accept late issues.
    if (workOrder.verifiedClosedAt !== null) {
      throw new BadRequestError(
        `Work order ${workOrder.woNumber} has been finance-verified and is ` +
          `sealed. Late parts cannot be issued against a verified-closed WO.`,
      );
    }

    // 4. Reason is mandatory for the audit trail.
    const reason = (data.purpose ?? "").trim();
    if (reason.length === 0) {
      throw new BadRequestError(
        `A reason is required when issuing parts to a closed work order ` +
          `(${workOrder.woNumber}). Please fill in the Purpose / Reason field.`,
      );
    }
  }

  /**
   * After create hook - issue stock and check for auto-requisition
   * Also handles auto-serialization for repairable items issued to work orders
   */
  protected override async afterCreate(
    result: DirectIssueWithRelations,
    context: ServiceContext,
  ): Promise<void> {
    try {
      // Handle serialized items differently
      if (result.serialNumber) {
        // Fetch work order if issuing to one
        let workOrderNumber = "";
        let equipmentId: string | null = null;
        if (result.workOrderId) {
          const workOrder = await this.prisma.workOrder.findUnique({
            where: { id: result.workOrderId },
            select: {
              woNumber: true,
              equipmentId: true,
            },
          });
          workOrderNumber = workOrder?.woNumber ?? result.workOrderId;
          equipmentId = workOrder?.equipmentId ?? null;
        }

        // Determine location based on whether it's issued to work order or department
        // Use null-safe access: department/accountCode may be null if not provided in the request
        const location = result.workOrderId
          ? `Work Order ${workOrderNumber}`
          : `${result.department?.name ?? "Unknown"} - ${result.accountCode?.code ?? "Unknown"}`;

        // Note: the AVAILABLE status check (G6) lives in beforeCreate — it fires
        // BEFORE the DB write.  We do not re-check here because by the time we
        // reach afterCreate the DI row is already committed and throwing would
        // leave the DB in a half-updated state.

        // Outgoing serial always transitions to IN_USE (good spare installed on equipment).
        // The initialStatus field is reserved for future API use but unused by the UI.
        // Good spare transitions to IN_USE — it is being installed on equipment.
        // Use the Prisma enum directly to avoid type assertion drift when new
        // RepairableStatus values are added (e.g. AWAITING_REPAIR_EVALUATION).
        const repairableStatus: import("@prisma/client").RepairableStatus =
          "IN_USE";

        // Update repairable item status, link to equipment if available, and link to this direct issue.
        // Select id so subsequent history log calls use the RepairableItem.id UUID
        // (the FK that repairableItemHistory.repairableItemId references), not the
        // serial number string which is NOT the FK value and would fail the constraint.
        const { id: repairableItemRecordId } =
          await this.prisma.repairableItem.update({
            where: { serialNumber: result.serialNumber },
            data: {
              status: repairableStatus,
              currentLocation: location,
              sourceDirectIssueId: result.id, // Link repairable item to this direct issue
              ...(equipmentId !== null && { equipmentId }),
            },
            select: { id: true },
          });

        // Fetch equipment tag once — reused for both history log calls below.
        let equipmentTag: string | undefined;
        if (equipmentId) {
          const equipment = await this.prisma.equipment.findUnique({
            where: { id: equipmentId },
            select: { tag: true },
          });
          equipmentTag = equipment?.tag;

          // Log equipment assignment
          try {
            await repairableItemHistoryService.logAssignedToEquipment(
              context,
              repairableItemRecordId,
              equipmentId,
              equipmentTag ?? equipmentId,
              `Assigned to equipment via Direct Issue ${result.issueNumber}`,
            );
          } catch (_error) {
            // Failed to log equipment assignment
          }
        }

        // Log direct issue event
        try {
          await repairableItemHistoryService.logDirectIssued(context, {
            repairableItemId: repairableItemRecordId,
            eventType: "DIRECT_ISSUED" as const,
            directIssueId: result.id,
            directIssueNumber: result.issueNumber,
            equipmentId: equipmentId ?? undefined,
            equipmentTag, // already resolved above — no second fetch
            notes: `Direct issued to ${location}`,
          });
        } catch (_error) {
          // Failed to log direct issue
        }

        // Fetch inventory item to check isRepairable flag.
        // Used below to gate repair WO creation and set correct GL event type.
        const invItemMeta = await this.prisma.inventoryItem.findUnique({
          where: { id: result.inventoryItemId },
          select: { isRepairable: true, sku: true },
        });
        const isRepairableItem = invItemMeta?.isRepairable ?? false;

        // CRITICAL: Decrement inventory stock for serialized item (quantity = 1).
        //
        // For serialized items, result.storeId is a PLACEHOLDER (the first store
        // alphabetically — set in transformCreateDTO because the schema requires a
        // storeId).  The actual stock record may be in a different store.  We
        // therefore search by inventoryItemId only (highest quantityOnHand wins),
        // NOT by result.storeId, to avoid missing the real record.
        const stock = await this.prisma.inventoryStock.findFirst({
          where: {
            inventoryItemId: result.inventoryItemId,
          },
          orderBy: {
            quantityOnHand: "desc",
          },
        });

        if (stock) {
          await this.prisma.inventoryStock.update({
            where: { id: stock.id },
            data: {
              quantityOnHand: { decrement: 1 },
            },
          });
        } else {
          // G4: No stock record found — DI row and RepairableItem.status are
          // already committed.  We CANNOT throw here (afterCreate runs after the
          // DB write; throwing causes client confusion and potential duplicate
          // retries while leaving the books inconsistent).  Log prominently so
          // an Inventory Manager can reconcile the on-hand count manually.
          console.error(
            `[DirectIssueService] STOCK RECONCILIATION NEEDED: ` +
              `DI ${result.issueNumber} (${result.id}) committed for serial ` +
              `${result.serialNumber} but no InventoryStock record found for ` +
              `inventoryItemId=${result.inventoryItemId}. ` +
              `On-hand count was NOT decremented. Manual adjustment required.`,
          );
        }

        // Record transaction for serialized item
        const transactionNotes = result.workOrderId
          ? `Direct issue of serial number ${result.serialNumber} to Work Order ${workOrderNumber}${result.purpose ? `: ${result.purpose}` : ""}`
          : `Direct issue of serial number ${result.serialNumber} to ${result.department?.name ?? "Unknown"} - ${result.accountCode?.code ?? "Unknown"}${result.purpose ? `: ${result.purpose}` : ""}`;

        await inventoryTransactionService.recordWorkOrderTransaction(context, {
          inventoryItemId: result.inventoryItemId,
          storeId: result.storeId,
          transactionType: InventoryTransactionType.DIRECT_ISSUE,
          quantity: 1,
          unitCost: result.unitCost,
          // workOrderId must be a real WorkOrder ID or undefined.
          // Never fall back to the DI's own ID — that's a DI ID, not a WO ID.
          workOrderId: result.workOrderId ?? undefined,
          workOrderNumber: result.workOrderId
            ? workOrderNumber
            : result.issueNumber,
          directIssueId: result.id,
          directIssueNumber: result.issueNumber,
          userId: context.userId,
          userName: result.issuedByName,
          notes: transactionNotes,
        });

        // AUTO-CREATE repair WO only for repairable items.
        // Guard on isRepairable so non-repairable serials (rare but possible)
        // don't generate spurious repair WOs.
        if (isRepairableItem)
          try {
            const repairableItem = await this.prisma.repairableItem.findUnique({
              where: { serialNumber: result.serialNumber },
              include: { inventoryItem: true },
            });
            if (repairableItem) {
              await repairWorkOrderService.createNonSerializedRepairWorkOrder(
                context,
                {
                  inventoryItemId: repairableItem.inventoryItemId,
                  quantity: 1,
                  problemDescription: `Part removed and needs repair — Direct Issue ${result.issueNumber}`,
                  estimatedCost: undefined,
                  scheduledStartDate: undefined,
                  priority: "F",
                  equipmentId: equipmentId ?? undefined,
                  notes:
                    `Auto-created from direct issue ${result.issueNumber}. ` +
                    `Serial ${result.serialNumber} was issued to ` +
                    `${result.workOrderId ? `work order ${workOrderNumber}` : "a department"}.`,
                  // DB-level traceability: FK back to the equipment WO and the DI
                  sourceWorkOrderId: result.workOrderId ?? undefined,
                  sourceDirectIssueId: result.id,
                },
              );
            }
          } catch (_error) {
            // Non-fatal — don't block the direct issue
          }

        // G3: GL posting for serialized items.
        // invItemMeta already fetched above (isRepairable + sku).
        try {
          // Detect late-close issues (WO already Closed at issue time)
          let isLateCloseIssue = false;
          if (result.workOrderId) {
            const woForGL = await this.prisma.workOrder.findUnique({
              where: { id: result.workOrderId },
              select: { status: true, completedAt: true },
            });
            isLateCloseIssue =
              woForGL?.status === "Closed" &&
              (woForGL.completedAt == null ||
                result.issuedAt.getTime() > woForGL.completedAt.getTime());
          }
          await inventoryGLService.createIssueTransaction(context, {
            inventoryItemId: result.inventoryItemId,
            inventoryItemSku: invItemMeta?.sku ?? "UNKNOWN",
            quantity: 1,
            unitCost: Number(result.unitCost),
            totalCost: Number(result.totalCost),
            referenceType: "DIRECT_ISSUE",
            referenceId: result.id,
            referenceNumber: result.issueNumber,
            description: `Direct issue ${result.issueNumber} serial ${result.serialNumber} to ${location}`,
            workOrderId: result.workOrderId ?? undefined,
            // Pass accountCodeId for dept/project mode DIs so GL debit lines
            // carry the correct account dimension (trackAccountCode=true in rules).
            accountCodeId: result.workOrderId
              ? undefined
              : (result.accountCodeId ?? undefined),
            departmentId: result.departmentId ?? undefined,
            areaId: result.areaId ?? undefined,
            projectId: result.projectId ?? undefined,
            // Use REPAIR_ISSUE GL event type for repairable items — matches
            // the non-serialized path and ensures trackDepartment=true on the
            // debit line for consistent repair-cost reporting.
            isRepairIssue: isRepairableItem,
            isLateCloseIssue,
          });
        } catch (glError) {
          console.error(
            `[DirectIssueService] GL posting failed for serialized DI ${result.issueNumber} (${result.id}):`,
            glError instanceof Error ? glError.message : String(glError),
          );
        }

        // Assembly BOM learning + sub-serial parent link — non-fatal.
        try {
          await this._tryUpdateAssemblyTracking(context, result);
        } catch (assemblyError) {
          console.error(
            `[DirectIssueService] Assembly tracking failed for serialized DI ${result.issueNumber}:`,
            assemblyError instanceof Error
              ? assemblyError.message
              : String(assemblyError),
          );
        }

        return;
      }

      // AUTO-SERIALIZATION: Check if this is a repairable item issued to a work order without serial number
      // This triggers automatic tracking ID generation
      if (result.workOrderId && !result.serialNumber) {
        const inventoryItem = await this.prisma.inventoryItem.findUnique({
          where: { id: result.inventoryItemId },
          select: { isRepairable: true, sku: true },
        });

        if (inventoryItem?.isRepairable) {
          // Generate unique tracking ID in format REP-SKU-Number
          const trackingId = await this.generateTrackingId(
            result.inventoryItemId,
          );

          // Get work order details for location
          const workOrder = await this.prisma.workOrder.findUnique({
            where: { id: result.workOrderId },
            select: {
              woNumber: true,
              equipmentId: true,
            },
          });

          const location = workOrder
            ? `Work Order ${workOrder.woNumber}`
            : `Work Order ${result.workOrderId}`;

          // Create RepairableItem record with auto-generated tracking ID
          // NOTE: RepairableItem -> WorkOrder is a one-to-many relationship
          // The FK is on the WorkOrder side (repairableItemId), not here
          // This repairable item will be linked when the work order references it

          await this.prisma.repairableItem.create({
            data: {
              serialNumber: trackingId,
              inventoryItemId: result.inventoryItemId,
              condition: "GOOD",
              status: "IN_USE",
              currentLocation: location,
              equipmentId: workOrder?.equipmentId ?? null,
              isAutoGenerated: true,
              sourceDirectIssueId: result.id,
              autoGenQuantity: result.quantity,
              createdBy: context.userId,
              lastModifiedBy: context.userId,
            },
          });

          // AUTO-CREATE repair WO for non-serialized repairable items
          try {
            const inventoryItemForWO =
              await this.prisma.inventoryItem.findUnique({
                where: { id: result.inventoryItemId },
              });
            if (inventoryItemForWO) {
              await repairWorkOrderService.createNonSerializedRepairWorkOrder(
                context,
                {
                  inventoryItemId: result.inventoryItemId,
                  quantity: Number(result.quantity),
                  problemDescription: `Part removed and needs repair — Direct Issue ${result.issueNumber}`,
                  estimatedCost: undefined,
                  scheduledStartDate: undefined,
                  priority: "F",
                  equipmentId: workOrder?.equipmentId ?? undefined,
                  notes:
                    `Auto-created from direct issue to work order ${workOrder?.woNumber ?? result.workOrderId}` +
                    `${workOrder?.equipmentId ? `. Equipment: ${workOrder.equipmentId}` : ""}`,
                  // DB-level traceability FKs
                  sourceWorkOrderId: result.workOrderId ?? undefined,
                  sourceDirectIssueId: result.id,
                },
              );
            }
          } catch (_error) {
            // Non-fatal — don't block the direct issue
          }
        }
      }

      // Validate stock availability.
      // Special case: when issuing to a WO that already has an ACTIVE reservation
      // for this item, the reservation quantity IS available stock for this WO.
      // In that case we check quantityOnHand (total physical stock) rather than
      // quantityOnHand - quantityReserved (free stock), because the reserved qty
      // is earmarked for exactly this issue.
      let hasReservationForThisWO = false;
      if (result.workOrderId) {
        const res = await this.prisma.inventoryReservation.findFirst({
          where: {
            inventoryItemId: result.inventoryItemId,
            reservedForId: result.workOrderId,
            status: "ACTIVE",
          },
          select: { id: true, quantity: true },
        });
        if (res && Number(res.quantity) >= result.quantity) {
          hasReservationForThisWO = true;
        }
      }

      // Get the stock record first — needed for both validation and the issue itself.
      const stock = await this.prisma.inventoryStock.findFirst({
        where: {
          inventoryItemId: result.inventoryItemId,
          storeId: result.storeId,
        },
        orderBy: {
          quantityOnHand: "desc", // Prefer the record with most stock
        },
      });

      if (!stock) {
        throw new NotFoundError(
          "Inventory Stock",
          `${result.inventoryItemId}:${result.storeId}`,
        );
      }

      const onHand = Number(stock.quantityOnHand);
      const currentReserved = Number(stock.quantityReserved);

      if (!hasReservationForThisWO) {
        // FIFO-AWARE AVAILABILITY CHECK
        //
        // Inventory managers can always issue physical stock as long as it exists
        // on the shelf (onHand >= quantity).  "Available" (onHand − reserved) is
        // a FIFO-queue concept for work-order scheduling — it must NOT block
        // inventory managers from performing a direct issue.
        //
        // When free stock (onHand − reserved) is insufficient but on-hand is
        // sufficient, this is a "FIFO override": the manager is drawing from stock
        // that was earmarked for work orders in the queue.  We allow the issue but
        // annotate every displaced reservation so the WO planner knows what happened
        // and can take corrective action (reorder, reschedule, etc.).
        if (onHand < result.quantity) {
          // Defence-in-depth: beforeCreate's pre-write guard should already have
          // blocked this. If a multi-store edge still reaches here, remove the
          // just-created DirectIssue row so no "ghost" issue (with no stock
          // movement) can later be returned and mint phantom inventory.
          await this.prisma.directIssue.deleteMany({
            where: { id: result.id },
          });
          throw new BadRequestError(
            `Insufficient stock on hand. On hand: ${onHand}, Requested: ${result.quantity}`,
          );
        }
      }

      // Update the DirectIssue record with the actual bin
      await this.prisma.directIssue.update({
        where: { id: result.id },
        data: { bin: stock.bin },
      });

      // Detect FIFO override BEFORE modifying stock.
      // A FIFO override occurs when free stock (onHand − reserved) is insufficient
      // for the requested quantity — meaning the issue will draw from reserved stock.
      const freeAvailable = onHand - currentReserved;
      const isFifoOverride =
        !hasReservationForThisWO && freeAvailable < result.quantity;

      // ─── RESERVATION SATISFACTION ──────────────────────────────────────────
      // When issuing to a work order that has an existing ACTIVE reservation for
      // this item, the batch direct issue SATISFIES that reservation — it should
      // not be treated as a fresh draw against free stock.
      //
      // Without this block, afterCreate only decrements quantityOnHand, leaving
      // quantityReserved inflated and the InventoryReservation still ACTIVE.
      // That causes the item to appear double-reserved in the UI and makes the
      // available quantity go negative.
      let reservationSatisfied = false;

      if (result.workOrderId) {
        const activeReservation =
          await this.prisma.inventoryReservation.findFirst({
            where: {
              inventoryItemId: result.inventoryItemId,
              reservedForId: result.workOrderId,
              status: "ACTIVE",
            },
            include: {
              workOrderPart: true,
            },
          });

        if (activeReservation) {
          reservationSatisfied = true;

          // Mark the reservation as CONSUMED and decrement quantityReserved
          await this.prisma.inventoryReservation.update({
            where: { id: activeReservation.id },
            data: {
              status: "CONSUMED",
              consumedAt: new Date(),
              consumedBy: context.userId,
              notes:
                `${activeReservation.notes ?? ""}\n\nSatisfied by batch direct issue ${result.issueNumber}`.trim(),
            },
          });

          // Decrement both quantityOnHand (stock issued) and quantityReserved
          // (reservation released) atomically
          await this.prisma.inventoryStock.update({
            where: { id: stock.id },
            data: {
              quantityOnHand: { decrement: result.quantity },
              quantityReserved: {
                decrement: Number(activeReservation.quantity),
              },
            },
          });

          // Sync the linked WorkOrderPart to ISSUED so the WO parts list is correct
          if (activeReservation.workOrderPart) {
            const wop = activeReservation.workOrderPart;
            const prevUsed = Number(wop.quantityUsed ?? 0);
            const totalUsed = prevUsed + result.quantity;
            const isFullyIssued = totalUsed >= Number(wop.quantityPlanned);

            const user = await this.prisma.user.findUnique({
              where: { id: context.userId },
              select: { firstName: true, lastName: true },
            });
            const userName = user
              ? `${user.firstName} ${user.lastName}`
              : "Unknown User";

            await this.prisma.workOrderPart.update({
              where: { id: wop.id },
              data: {
                status: isFullyIssued ? "ISSUED" : "RESERVED",
                quantityUsed: totalUsed,
                issuedAt: isFullyIssued ? new Date() : wop.issuedAt,
                consumedBy: isFullyIssued ? context.userId : wop.consumedBy,
                consumedByName: isFullyIssued ? userName : wop.consumedByName,
                consumedAt: isFullyIssued ? new Date() : wop.consumedAt,
                consumedFrom: isFullyIssued ? "DIRECT_ISSUE" : wop.consumedFrom,
              },
            });
          }
        }
      }

      if (!reservationSatisfied) {
        // No reservation to satisfy — standard direct decrement of quantityOnHand only.
        // quantityReserved is unaffected because no reservation exists for this issue.
        await this.prisma.inventoryStock.update({
          where: { id: stock.id },
          data: {
            quantityOnHand: { decrement: result.quantity },
          },
        });

        // FIFO OVERRIDE: The issue drew from stock that was reserved for work orders.
        // Annotate each displaced FIFO reservation and notify the reservation holders
        // so they know their parts were taken and can take corrective action.
        if (isFifoOverride) {
          await this._notifyFifoOverrideDisplacements(
            context,
            result,
            stock.id,
          );
        }
      }

      // CRITICAL: Check if stock falls below reorder point AFTER issuing
      // Stock has been decremented above, so the DB now reflects post-issue levels.
      await this.checkAndCreateRequisition(context, result);

      // Fetch work order if issuing to one
      let workOrderNumber = "";
      if (result.workOrderId) {
        const workOrder = await this.prisma.workOrder.findUnique({
          where: { id: result.workOrderId },
          select: { woNumber: true },
        });
        workOrderNumber = workOrder?.woNumber ?? result.workOrderId;
      }

      // Record DIRECT_ISSUE transaction for audit trail
      const transactionNotes = result.workOrderId
        ? `Direct issue to Work Order ${workOrderNumber}${result.purpose ? `: ${result.purpose}` : ""}`
        : `Direct issue to ${result.department?.name ?? "Unknown"} - ${result.accountCode?.code ?? "Unknown"}${result.purpose ? `: ${result.purpose}` : ""}`;

      await inventoryTransactionService.recordWorkOrderTransaction(context, {
        inventoryItemId: result.inventoryItemId,
        storeId: result.storeId,
        transactionType: InventoryTransactionType.DIRECT_ISSUE,
        quantity: result.quantity,
        unitCost: result.unitCost,
        workOrderId: result.workOrderId ?? result.id,
        workOrderNumber: result.workOrderId
          ? workOrderNumber
          : result.issueNumber,
        directIssueId: result.id,
        directIssueNumber: result.issueNumber,
        userId: context.userId,
        userName: result.issuedByName,
        notes: transactionNotes,
      });

      // CRITICAL: Create GL transaction for financial tracking
      try {
        // Get inventory item SKU for reference
        const inventoryItem = await this.prisma.inventoryItem.findUnique({
          where: { id: result.inventoryItemId },
          select: { sku: true },
        });

        // Check if this is a repair work order, and detect "late-close" issues
        // (WO was already Closed at issue time — fulfilled receipts lagging
        // behind WO closure). The late-close flag is forwarded into GL rule
        // context so clients can optionally route those issues to a distinct
        // account via rule conditions. Default behaviour is unchanged.
        let isRepairIssue = false;
        let isLateCloseIssue = false;
        if (result.workOrderId) {
          const workOrder = await this.prisma.workOrder.findUnique({
            where: { id: result.workOrderId },
            select: {
              isRepairWorkOrder: true,
              status: true,
              completedAt: true,
            },
          });
          isRepairIssue = workOrder?.isRepairWorkOrder ?? false;
          // A late-close issue is one where the WO is already Closed at the
          // moment of issue. Derived from status rather than stored — the
          // status + issuedAt pair is the source of truth. If completedAt
          // is set and the issuedAt is after it, that's also late, but the
          // Closed-status check is the tighter signal.
          isLateCloseIssue =
            workOrder?.status === "Closed" &&
            (workOrder.completedAt == null ||
              result.issuedAt.getTime() > workOrder.completedAt.getTime());
        }

        // IMPORTANT: When issuing to a work order, do NOT pass accountCodeId
        // This allows the GL service to resolve the equipment default account code
        // from the work order's equipment. Only pass accountCodeId if NOT issuing to work order.
        const glParams: {
          inventoryItemId: string;
          inventoryItemSku: string;
          quantity: number;
          unitCost: number;
          totalCost: number;
          referenceType: "DIRECT_ISSUE";
          referenceId: string;
          referenceNumber: string;
          description: string;
          workOrderId?: string;
          accountCodeId?: string;
          departmentId?: string;
          areaId?: string;
          projectId?: string;
          isRepairIssue?: boolean;
          isLateCloseIssue?: boolean;
        } = {
          inventoryItemId: result.inventoryItemId,
          inventoryItemSku: inventoryItem?.sku ?? "UNKNOWN",
          quantity: result.quantity,
          unitCost: result.unitCost,
          totalCost: result.totalCost,
          referenceType: "DIRECT_ISSUE",
          referenceId: result.id,
          referenceNumber: result.issueNumber,
          description: result.workOrderId
            ? `Direct issue ${result.issueNumber} to Work Order ${workOrderNumber}`
            : `Direct issue ${result.issueNumber} to ${result.department?.name ?? "Unknown"}`,
          workOrderId: result.workOrderId ?? undefined,
          departmentId: result.departmentId ?? undefined,
          areaId: result.areaId ?? undefined,
          isRepairIssue, // Pass repair context flag
          isLateCloseIssue, // Pass late-close flag for GL rule conditioning
        };

        // Only include accountCodeId if NOT issuing to a work order
        // For work orders, let the GL service resolve account code from equipment hierarchy
        // For non-work orders (department or project), use the stored account code
        if (result.workOrderId) {
          // For work orders, don't pass accountCodeId - let hierarchy resolve from equipment
          glParams.accountCodeId = undefined;
        } else {
          // For department or project issues, use the stored account code
          glParams.accountCodeId = result.accountCodeId ?? undefined;
        }

        // Pass projectId so GL lines carry the project dimension and
        // ProjectBudget.consumedAmount is incremented (priority 1 in budget tracking)
        glParams.projectId = result.projectId ?? undefined;

        // Use centralized inventory GL service
        await inventoryGLService.createIssueTransaction(context, glParams);

        // GL transaction created and posted successfully
      } catch (error) {
        // Don't fail the issue creation if GL transaction fails, but DO log it.
        // Previously this catch was silent, which allowed DI rows to end up
        // with NULL acc/dept whenever GL posting hit any error. Logging surfaces
        // future configuration problems (e.g. missing GL rule, missing budget
        // period) so they can be fixed instead of silently accumulating holes.
        console.error(
          `[DirectIssueService] GL posting failed for DI ${result.issueNumber} (${result.id}):`,
          error instanceof Error ? error.message : String(error),
        );
      }

      // Assembly BOM learning — non-serialized items (consumables, non-repairable
      // parts) still contribute to the type-level BOM when issued to an assembly
      // repair WO. No sub-serial parent link fires here (no serialNumber).
      try {
        await this._tryUpdateAssemblyTracking(context, result);
      } catch (assemblyError) {
        console.error(
          `[DirectIssueService] Assembly tracking failed for DI ${result.issueNumber}:`,
          assemblyError instanceof Error
            ? assemblyError.message
            : String(assemblyError),
        );
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Before delete hook - validate and reverse stock if not returned
   */
  protected override async beforeDelete(
    id: string,
    context: ServiceContext,
  ): Promise<void> {
    // Get the issue with full details
    const issue = await this.prisma.directIssue.findUnique({
      where: { id },
      include: {
        returns: true,
      },
    });

    if (!issue) {
      throw new NotFoundError("DirectIssue", id);
    }

    // Cannot delete if there are returns
    if (issue.returns.length > 0) {
      throw new BadRequestError(
        "Cannot delete direct issue with returns. Please cancel returns first.",
      );
    }

    // Return stock to inventory
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      select: { firstName: true, lastName: true },
    });

    const userName: string =
      user?.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`
        : "Unknown User";

    // storeId should never be null for a valid direct issue, but handle it defensively
    if (!issue.storeId) {
      throw new BadRequestError("Direct issue has no store ID");
    }

    const receiveResult = await inventoryStockService.receive(
      issue.inventoryItemId,
      Number(issue.quantity),
      {
        context,
        storeId: issue.storeId,
        userId: context.userId,
        userName: userName,
        notes: `Stock returned after direct issue ${issue.issueNumber} deletion`,
      },
    );

    if (!receiveResult.success) {
      // Failed to return stock
    }
  }

  // ============================================================================
  // CUSTOM METHODS
  // ============================================================================
  // registerBrokenUnit() was removed. Broken parts are now tracked exclusively
  // via the auto-created repair WO (see afterCreate → repairWorkOrderService).
  // The serial is assigned from the repair WO page, not at Direct Issue time.

  /**
   * Issue inventory directly to department/account code
   *
   * Process:
   * 1. Validate stock availability
   * 2. Issue stock via InventoryStockService
   * 3. Create DirectIssue record
   * 4. Create inventory transaction
   * 5. Check for auto-requisition trigger
   *
   * @param context - Service context
   * @param data - Issue data
   * @returns Created direct issue with auto-requisition info
   */
  async issue(
    context: ServiceContext,
    data: DirectIssueCreateDTO,
  ): Promise<IssueOperationResult> {
    try {
      // Use the base create method which handles validation and hooks
      const directIssue = await this.create(context, data);

      // Check if auto-requisition was created (stored in context by afterCreate hook)
      const contextWithReq = context as unknown as {
        autoCreatedRequisition?: { reqNumber: string; id: string };
      };

      return {
        success: true,
        directIssue,
        autoCreatedRequisition: contextWithReq.autoCreatedRequisition,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to issue inventory",
        errorCode:
          error instanceof BadRequestError
            ? "INSUFFICIENT_STOCK"
            : "ISSUE_FAILED",
      };
    }
  }

  /**
   * Return parts from a direct issue
   *
   * Process:
   * 1. Validate issue exists and has unreturned quantity
   * 2. Validate return quantity
   * 3. Check return condition
   * 4. Receive stock back (if condition is GOOD)
   * 5. Create DirectIssueReturn record
   * 6. Update DirectIssue quantityReturned and status
   * 7. Create inventory transaction
   *
   * @param context - Service context
   * @param issueId - Direct issue ID
   * @param data - Return data
   * @returns Created return record and updated issue
   */
  async returnIssue(
    context: ServiceContext,
    issueId: string,
    data: DirectIssueReturnDTO,
  ): Promise<ReturnOperationResult> {
    try {
      // Check permission
      await this.checkPermission(context, this.config.permissions.update);

      // Validate return data
      const schemaValidation = directIssueReturnSchema.safeParse(data);
      if (!schemaValidation.success) {
        throw new BadRequestError(
          schemaValidation.error.issues.map((i) => i.message).join(", "),
        );
      }

      // Get issue with relations
      const issue = await this.prisma.directIssue.findUnique({
        where: { id: issueId },
        include: {
          inventoryItem: true,
          store: true,
          department: true,
          accountCode: true,
          area: true,
          budgetPeriod: true,
          project: { select: { id: true, code: true, name: true } },
        },
      });

      if (!issue) {
        throw new NotFoundError("DirectIssue", issueId);
      }

      // Cannot return from cancelled issue
      if (issue.status === DirectIssueStatus.CANCELLED) {
        throw new BadRequestError("Cannot return from cancelled direct issue");
      }

      // Handle serialized item returns
      if (issue.serialNumber) {
        // Update repairable item status back to AVAILABLE
        const repairableItem = await this.prisma.repairableItem.findUnique({
          where: { serialNumber: issue.serialNumber },
          select: {
            id: true,
            equipmentId: true,
            equipment: { select: { tag: true } },
            parentAssemblyId: true,
            parentAssembly: { select: { serialNumber: true } },
          },
        });

        // Log equipment removal if was assigned.
        // repairableItem is non-null inside this block (equipmentId guards it).
        // Use repairableItem.id (UUID FK) not issue.serialNumber (string, wrong type).
        if (repairableItem?.equipmentId) {
          try {
            await repairableItemHistoryService.logRemovedFromEquipment(
              context,
              repairableItem.id,
              repairableItem.equipmentId,
              repairableItem.equipment?.tag ?? repairableItem.equipmentId,
              `Removed from equipment via Direct Issue return`,
            );
          } catch (_error) {
            // Failed to log equipment removal
          }
        }

        await this.prisma.repairableItem.update({
          where: { serialNumber: issue.serialNumber },
          data: {
            status: "AVAILABLE",
            currentLocation: null,
            equipmentId: null, // Clear equipment link when returned
            parentAssemblyId: null, // Clear assembly link when returned
          },
        });

        // Log direct issue return event.
        // Guard on repairableItem?.id — if the RepairableItem row doesn't exist
        // there is nothing to write history against (and passing the serial string
        // as the UUID FK would cause a constraint violation).
        try {
          if (repairableItem?.id) {
            await repairableItemHistoryService.logDirectIssueReturned(context, {
              repairableItemId: repairableItem.id,
              eventType: "DIRECT_ISSUE_RETURNED" as const,
              directIssueId: issue.id,
              directIssueNumber: issue.issueNumber,
              equipmentId: repairableItem?.equipmentId ?? undefined,
              equipmentTag: repairableItem?.equipment?.tag,
              notes: `Returned from ${issue.department?.name ?? "Unknown"} - ${issue.accountCode?.code ?? "Unknown"}`,
            });
          }
        } catch (_error) {
          // Failed to log direct issue return
        }

        // If this serial was inside an assembly, log its removal from the assembly.
        // The parentAssemblyId DB write already happened in the update above;
        // here we record the event on the serial's history timeline.
        if (repairableItem?.id && repairableItem.parentAssemblyId) {
          try {
            await repairableItemHistoryService.logRemovedFromAssembly(context, {
              repairableItemId: repairableItem.id,
              eventType: "REMOVED_FROM_ASSEMBLY" as const,
              assemblyId: repairableItem.parentAssemblyId,
              assemblySerial:
                repairableItem.parentAssembly?.serialNumber ??
                repairableItem.parentAssemblyId,
              notes: `Removed from assembly ${
                repairableItem.parentAssembly?.serialNumber ??
                repairableItem.parentAssemblyId
              } via Direct Issue return ${issue.issueNumber}`,
            });
          } catch (_error) {
            // Non-fatal — the stock and status updates are already committed
          }
        }
      }

      // Validate return quantity
      const quantityIssued = Number(issue.quantity);
      const quantityReturned = Number(issue.quantityReturned);
      const quantityRemaining = quantityIssued - quantityReturned;

      if (data.quantity > quantityRemaining) {
        throw new BadRequestError(
          `Cannot return more than remaining quantity. Remaining: ${quantityRemaining}, Requested: ${data.quantity}`,
        );
      }

      // Get user details
      const user = await this.prisma.user.findUnique({
        where: { id: context.userId },
        select: { firstName: true, lastName: true },
      });

      const userName: string =
        user?.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : "Unknown User";

      // Generate return number
      const returnNumber = await this.generateReturnNumber();

      // Create return record and update issue in transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Get the bin to return to
        const returnToBin = data.returnToBin;

        // Create return record
        const returnRecord = await tx.directIssueReturn.create({
          data: {
            directIssueId: issueId,
            returnNumber,
            quantity: data.quantity,
            returnToBin: returnToBin,
            reason: data.reason ?? null,
            condition: data.condition,
            returnedBy: context.userId,
            returnedByName: userName,
            notes: data.notes ?? null,
          },
          include: {
            directIssue: {
              include: {
                inventoryItem: true,
              },
            },
          },
        });

        // Update issue quantityReturned and status
        const newQuantityReturned = quantityReturned + data.quantity;
        const newStatus = determineStatus(quantityIssued, newQuantityReturned);

        const updatedIssue = await tx.directIssue.update({
          where: { id: issueId },
          data: {
            quantityReturned: newQuantityReturned,
            status: newStatus,
          },
          include: {
            inventoryItem: true,
            store: true,
            department: true,
            accountCode: true,
            area: true,
            budgetPeriod: true,
            returns: {
              orderBy: { returnedAt: "desc" },
            },
          },
        });

        return { returnRecord, updatedIssue };
      });

      // GAP 9 FIX: When parts are returned, decrement quantityUsed on the linked
      // WorkOrderPart so that usage tracking stays accurate.
      // A return of good-condition parts means fewer were actually consumed.
      // This is best-effort — failure must not block the return itself.
      if (canRestock(data.condition) && issue.workOrderId) {
        try {
          // Find the WorkOrderPart for this item on this WO
          const wop = await this.prisma.workOrderPart.findFirst({
            where: {
              workOrderId: issue.workOrderId,
              inventoryItemId: issue.inventoryItemId,
              status: "ISSUED",
            },
          });

          if (wop) {
            const currentUsed = Number(wop.quantityUsed ?? 0);
            const newUsed = Math.max(0, currentUsed - data.quantity);
            // If all quantity returned, revert to RESERVED or PLANNED (no reservation → PLANNED)
            const revertedStatus =
              newUsed === 0
                ? wop.reservationId
                  ? "RESERVED"
                  : "PLANNED"
                : "ISSUED";

            await this.prisma.workOrderPart.update({
              where: { id: wop.id },
              data: {
                quantityUsed: newUsed,
                status: revertedStatus,
                // Clear issued timestamps only if fully returned
                ...(newUsed === 0
                  ? {
                      issuedAt: null,
                      consumedBy: null,
                      consumedAt: null,
                      consumedFrom: null,
                    }
                  : {}),
              },
            });
          }
        } catch (_wopError) {
          // Non-fatal — WOP sync failure must not block the stock return
        }
      }

      // If condition is GOOD, receive stock back to the specified bin
      if (canRestock(data.condition)) {
        // Ensure returnBin is always a string by providing fallback
        const returnBin = data.returnToBin ?? issue.bin;

        // storeId should never be null for a valid direct issue, but handle it defensively
        if (!issue.storeId) {
          throw new BadRequestError("Direct issue has no store ID");
        }

        // Use upsert to atomically get-or-create the stock record for this bin,
        // avoiding a race condition / unique constraint violation when the record
        // already exists (e.g. from a previous return to the same bin).
        await this.prisma.inventoryStock.upsert({
          where: {
            inventoryItemId_storeId_bin: {
              inventoryItemId: issue.inventoryItemId,
              storeId: issue.storeId,
              bin: returnBin,
            },
          },
          update: {
            quantityOnHand: { increment: data.quantity },
          },
          create: {
            inventoryItemId: issue.inventoryItemId,
            storeId: issue.storeId,
            bin: returnBin,
            quantityOnHand: data.quantity,
            quantityReserved: 0,
          },
        });
      }

      // storeId should never be null for a valid direct issue, but handle it defensively
      if (!issue.storeId) {
        throw new BadRequestError("Direct issue has no store ID");
      }

      // Record transaction for audit trail
      await inventoryTransactionService.recordWorkOrderTransaction(context, {
        inventoryItemId: issue.inventoryItemId,
        storeId: issue.storeId,
        transactionType: InventoryTransactionType.DIRECT_ISSUE_RETURN,
        quantity: data.quantity,
        unitCost: Number(issue.unitCost),
        workOrderId: issueId,
        workOrderNumber: `${issue.issueNumber} → ${returnNumber}`,
        directIssueId: issueId,
        directIssueNumber: issue.issueNumber,
        userId: context.userId,
        userName: userName,
        notes: `Return from ${issue.department?.name ?? issue.project?.name ?? "Unknown"} - ${issue.accountCode?.code ?? "Unknown"} - Condition: ${data.condition}${data.reason ? ` - ${data.reason}` : ""}`,
      });

      // CRITICAL: Create GL transaction for financial tracking (only if condition is GOOD)
      if (canRestock(data.condition)) {
        try {
          // Use centralized inventory GL service to reverse the original issue
          await inventoryGLService.createReturnTransaction(context, {
            inventoryItemId: issue.inventoryItemId,
            inventoryItemSku: issue.inventoryItem.sku,
            quantity: data.quantity,
            unitCost: Number(issue.unitCost),
            totalCost: data.quantity * Number(issue.unitCost),
            referenceType: "DIRECT_ISSUE_RETURN",
            referenceId: result.returnRecord.id,
            referenceNumber: returnNumber,
            description: `Return to inventory from ${issue.department?.name ?? issue.project?.name ?? "Unknown"} - ${issue.accountCode?.code ?? "Unknown"}`,
            originalIssueId: issueId,
            accountCodeId: issue.accountCodeId ?? undefined,
            departmentId: issue.departmentId ?? undefined,
            areaId: issue.areaId ?? undefined,
            projectId: issue.projectId ?? undefined,
          });

          // GL return transaction created and posted successfully
        } catch (_error) {
          // Don't fail the return if GL transaction fails
        }
      }

      // Cancel the auto-created repair WO when the full issue is returned and
      // the WO hasn't been started yet.  Partial returns leave the WO alive
      // because the part is still out on the job.
      if (result.updatedIssue.status === "FULLY_RETURNED") {
        try {
          const repairWO = await this.prisma.workOrder.findFirst({
            where: {
              sourceDirectIssueId: issueId,
              isRepairWorkOrder: true,
              status: { notIn: ["Completed", "Closed", "Cancelled"] },
            },
            select: { id: true, repairWorkflowStatus: true, woNumber: true },
          });
          if (repairWO) {
            const cancellableStatuses: import("@prisma/client").RepairWorkflowStatus[] =
              ["AWAITING_SERIAL_ASSIGNMENT", "AWAITING_REPAIR_DECISION"];
            if (
              repairWO.repairWorkflowStatus != null &&
              cancellableStatuses.includes(repairWO.repairWorkflowStatus)
            ) {
              await this.prisma.workOrder.update({
                where: { id: repairWO.id },
                data: {
                  status: "Cancelled",
                  repairWorkflowStatus: "SCRAPPED",
                  completionNotes:
                    (issue.serialNumber
                      ? `Serial ${issue.serialNumber} returned to stock`
                      : "Parts returned to stock") +
                    ` via Direct Issue return ${returnNumber}` +
                    ` (original issue: ${issue.issueNumber}).` +
                    ` Reason: ${data.reason ?? "No reason provided"}.`,
                },
              });
            }
          }
        } catch (_error) {
          // Non-fatal — WO cancellation failure must not block the return
        }
      }

      // Transform models
      const transformedReturn: DirectIssueReturnWithRelations = {
        ...result.returnRecord,
        quantity: Number(result.returnRecord.quantity),
        returnToBin: result.returnRecord.returnToBin,
        directIssue: {
          id: result.returnRecord.directIssue.id,
          issueNumber: result.returnRecord.directIssue.issueNumber,
          inventoryItem: {
            sku: result.returnRecord.directIssue.inventoryItem.sku,
            description:
              result.returnRecord.directIssue.inventoryItem.description,
            unit: result.returnRecord.directIssue.inventoryItem.unit,
          },
        },
      };

      const transformedIssue = await this.transformModel(
        result.updatedIssue as never,
      );

      return {
        success: true,
        return: transformedReturn,
        updatedIssue: transformedIssue,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to process return",
        errorCode:
          error instanceof BadRequestError ? "INVALID_RETURN" : "RETURN_FAILED",
      };
    }
  }

  /**
   * Reverse an inventory transaction (DIRECT_ISSUE or WO_PART_ISSUED)
   *
   * Full reversal (no quantity, or quantity === full issued amount with nothing
   * previously returned): restores all issued stock, creates a reversal
   * InventoryTransaction record, marks the original as reversed, sets the
   * DirectIssue status to REVERSED, and reverses the associated GL transaction.
   *
   * Partial reversal (quantity less than the issued amount): only available for
   * transactions linked to a DirectIssue. It is processed through the proven
   * returnIssue() path so that stock is restocked, a partial GL credit is
   * posted, WorkOrderPart usage is synced, serialized items are released and
   * the DirectIssue moves to PARTIALLY_RETURNED / FULLY_RETURNED. The original
   * issue transaction is intentionally left intact (NOT flagged isReversed) so
   * inventory movement / valuation reports remain accurate.
   *
   * @param transactionId - ID of the original InventoryTransaction to reverse
   * @param input - Reversal input with reason, user info and optional quantity
   * @param context - Service context (required for partial reversals — used for
   *                  permission checks and partial GL posting)
   * @returns ReverseIssueResult with details of what was reversed
   */
  async reverseIssue(
    transactionId: string,
    input: DirectIssueReverseInput,
    context?: ServiceContext,
  ): Promise<ReverseIssueResult> {
    // Step 1: Find the original transaction
    const originalTransaction =
      await this.prisma.inventoryTransaction.findUnique({
        where: { id: transactionId },
      });

    if (!originalTransaction) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: `Transaction ${transactionId} not found`,
      };
    }

    // Step 2: Validate eligibility
    const validTypes = [
      InventoryTransactionType.DIRECT_ISSUE,
      InventoryTransactionType.WO_PART_ISSUED,
    ];
    if (
      !validTypes.includes(
        originalTransaction.transactionType as InventoryTransactionType,
      )
    ) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: `Transaction type '${originalTransaction.transactionType}' is not eligible for reversal. Only DIRECT_ISSUE and WO_PART_ISSUED can be reversed.`,
      };
    }

    if (originalTransaction.isReversed) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: "Transaction has already been reversed",
      };
    }

    if (!originalTransaction.isActive) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: "Transaction is not active",
      };
    }

    if (originalTransaction.reversalOfId) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: "Cannot reverse a reversal transaction",
      };
    }

    // Step 2.5: Determine how much to reverse (supports partial reversal).
    // The issued quantity is stored as a positive magnitude on the transaction.
    const originalQty = Number(originalTransaction.quantity);

    // Prior returns / partial reversals reduce what is still available to
    // reverse. These are tracked on the linked DirectIssue (quantityReturned).
    let alreadyReturned = 0;
    if (originalTransaction.directIssueId) {
      const linkedIssue = await this.prisma.directIssue.findUnique({
        where: { id: originalTransaction.directIssueId },
        select: { quantityReturned: true },
      });
      alreadyReturned = Number(linkedIssue?.quantityReturned ?? 0);
    }
    const remainingQty = originalQty - alreadyReturned;

    // Default to reversing everything that is still outstanding (legacy behaviour).
    const requestedQty =
      input.quantity != null ? Number(input.quantity) : remainingQty;

    if (remainingQty <= 0) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: "This issue has already been fully reversed or returned",
      };
    }

    if (requestedQty <= 0) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: "Reversal quantity must be greater than zero",
      };
    }

    if (requestedQty > remainingQty) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: `Cannot reverse more than the remaining quantity. Remaining: ${remainingQty}, Requested: ${requestedQty}`,
      };
    }

    // PARTIAL reversal — only part of the issued quantity is being put back.
    // Delegate to the proven returnIssue() path. It correctly handles stock
    // restock, partial GL credit, WorkOrderPart usage sync, serialized item
    // release, status transitions and repair-WO cleanup, and it does NOT flag
    // the original issue transaction as reversed (so reports stay correct).
    if (requestedQty < originalQty) {
      if (!originalTransaction.directIssueId) {
        return {
          success: false,
          reversalTransactionId: "",
          originalTransactionId: transactionId,
          quantityRestored: 0,
          glReversed: false,
          directIssueUpdated: false,
          message:
            "Partial reversal is only available for direct issues. Please reverse the full quantity.",
        };
      }

      if (!context) {
        return {
          success: false,
          reversalTransactionId: "",
          originalTransactionId: transactionId,
          quantityRestored: 0,
          glReversed: false,
          directIssueUpdated: false,
          message: "A user context is required to process a partial reversal.",
        };
      }

      const returnResult = await this.returnIssue(
        context,
        originalTransaction.directIssueId,
        {
          quantity: requestedQty,
          condition: ReturnCondition.GOOD,
          reason: input.reason,
          notes: `Partial reversal of issue transaction ${transactionId} by ${input.reversedByName ?? input.reversedBy}`,
        },
      );

      if (!returnResult.success) {
        return {
          success: false,
          reversalTransactionId: "",
          originalTransactionId: transactionId,
          quantityRestored: 0,
          glReversed: false,
          directIssueUpdated: false,
          message:
            returnResult.error ?? "Failed to reverse the requested quantity",
        };
      }

      return {
        success: true,
        reversalTransactionId: returnResult.return?.id ?? "",
        originalTransactionId: transactionId,
        quantityRestored: requestedQty,
        glReversed: true,
        directIssueUpdated: true,
        message: `Successfully reversed ${requestedQty} of ${originalQty} units (returned to stock)`,
      };
    }

    // Step 3: Find the inventory item and current stock
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { id: originalTransaction.inventoryItemId },
    });

    if (!inventoryItem) {
      return {
        success: false,
        reversalTransactionId: "",
        originalTransactionId: transactionId,
        quantityRestored: 0,
        glReversed: false,
        directIssueUpdated: false,
        message: `Inventory item ${originalTransaction.inventoryItemId} not found`,
      };
    }

    // Get current stock for the same store
    const currentStock = await this.prisma.inventoryStock.findFirst({
      where: {
        inventoryItemId: originalTransaction.inventoryItemId,
        storeId: originalTransaction.storeId,
      },
      orderBy: {
        quantityOnHand: "desc",
      },
    });

    const currentStockQty = currentStock
      ? Number(currentStock.quantityOnHand)
      : 0;
    // originalQty was computed above (Step 2.5). For a full reversal it equals
    // the entire issued quantity that is being restored.

    // Step 4: Execute in a Prisma transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 4a. Restore stock
      if (currentStock) {
        await tx.inventoryStock.update({
          where: { id: currentStock.id },
          data: {
            quantityOnHand: { increment: originalQty },
          },
        });
      } else {
        // Create stock record if none exists (edge case)
        await tx.inventoryStock.create({
          data: {
            inventoryItemId: originalTransaction.inventoryItemId,
            storeId: originalTransaction.storeId,
            bin: "MAIN",
            quantityOnHand: originalQty,
            quantityReserved: 0,
          },
        });
      }

      // 4b. Create reversal InventoryTransaction
      const reversalTransaction = await tx.inventoryTransaction.create({
        data: {
          transactionType: InventoryTransactionType.DIRECT_ISSUE_REVERSAL,
          quantity: -originalQty,
          unitCost: originalTransaction.unitCost,
          inventoryItemId: originalTransaction.inventoryItemId,
          storeId: originalTransaction.storeId,
          referenceType: originalTransaction.referenceType,
          referenceId: originalTransaction.referenceId,
          referenceNumber: originalTransaction.referenceNumber,
          directIssueId: originalTransaction.directIssueId,
          directIssueNumber: originalTransaction.directIssueNumber,
          equipmentId: originalTransaction.equipmentId,
          equipmentTag: originalTransaction.equipmentTag,
          reversalOfId: transactionId,
          reversalReason: input.reason,
          performedBy: input.reversedBy,
          performedByName: input.reversedByName ?? "System",
          notes: `Reversal of transaction ${originalTransaction.id}: ${input.reason}`,
          quantityBefore: currentStockQty,
          quantityAfter: currentStockQty + originalQty,
          isActive: true,
        },
      });

      // 4c. Mark original as reversed
      await tx.inventoryTransaction.update({
        where: { id: transactionId },
        data: {
          isReversed: true,
          reversedById: reversalTransaction.id,
          reversedBy: input.reversedBy,
          reversedByName: input.reversedByName,
          reversedAt: new Date(),
          reversalReason: input.reason,
        },
      });

      // 4d. Update DirectIssue status and reset RepairableItem if serialised
      let directIssueUpdated = false;
      if (originalTransaction.directIssueId) {
        const directIssue = await tx.directIssue.findUnique({
          where: { id: originalTransaction.directIssueId },
          select: { id: true, serialNumber: true, issueNumber: true },
        });

        if (directIssue) {
          await tx.directIssue.update({
            where: { id: originalTransaction.directIssueId },
            data: { status: "REVERSED" },
          });
          directIssueUpdated = true;

          // If this was a serialised issue, reset the RepairableItem back to
          // AVAILABLE so the serial is no longer counted as "In Equipment".
          // The returnIssue path already does this correctly; reverseIssue was
          // the only path missing this step, causing "In Equipment" to remain
          // inflated after a reversal.
          if (directIssue.serialNumber) {
            const repItem = await tx.repairableItem.findUnique({
              where: { serialNumber: directIssue.serialNumber },
              select: { id: true, status: true },
            });
            if (repItem && repItem.status === "IN_USE") {
              await tx.repairableItem.update({
                where: { id: repItem.id },
                data: {
                  status: "AVAILABLE",
                  currentLocation: "Main Warehouse",
                  equipmentId: null,
                  lastModifiedBy: input.reversedBy,
                },
              });
            }
          }

          // Cancel the auto-created repair WO linked to this DI if it hasn't
          // been started yet.  Only AWAITING_SERIAL_ASSIGNMENT and
          // AWAITING_REPAIR_DECISION are safe to auto-cancel — any further
          // stage means a technician or vendor path is already in motion and
          // the WO must be handled manually.
          const repairWO = await tx.workOrder.findFirst({
            where: {
              sourceDirectIssueId: directIssue.id,
              isRepairWorkOrder: true,
              status: { notIn: ["Completed", "Closed", "Cancelled"] },
            },
            select: { id: true, repairWorkflowStatus: true, woNumber: true },
          });
          if (repairWO) {
            const cancellableStatuses: import("@prisma/client").RepairWorkflowStatus[] =
              ["AWAITING_SERIAL_ASSIGNMENT", "AWAITING_REPAIR_DECISION"];
            if (
              repairWO.repairWorkflowStatus != null &&
              cancellableStatuses.includes(repairWO.repairWorkflowStatus)
            ) {
              await tx.workOrder.update({
                where: { id: repairWO.id },
                data: {
                  status: "Cancelled",
                  repairWorkflowStatus: "SCRAPPED",
                  completionNotes:
                    `Auto-cancelled: Direct Issue ${directIssue.issueNumber} was reversed` +
                    (directIssue.serialNumber
                      ? ` — serial ${directIssue.serialNumber} returned to stock`
                      : " — parts returned to stock") +
                    `. Reason: ${input.reason ?? "No reason provided"}.`,
                },
              });
            }
          }
        }
      }

      return {
        reversalTransaction,
        directIssueUpdated,
      };
    });

    // Step 5: Reverse GL transaction (outside the Prisma transaction)
    let glReversalResult: { success: boolean } = { success: false };
    try {
      // The GL transaction was created with referenceId = directIssue.id and referenceType = 'DIRECT_ISSUE'
      // Try to find the GL transaction linked to the original direct issue
      const glSearchId = originalTransaction.directIssueId ?? transactionId;
      const glTransaction = await this.prisma.gLTransaction.findFirst({
        where: {
          OR: [{ referenceId: glSearchId }, { referenceId: transactionId }],
        },
        orderBy: { createdAt: "desc" },
      });

      if (glTransaction) {
        const glResult = await glReversalService.reverseTransaction(
          glTransaction.id,
          input.reason,
          input.reversedBy,
        );
        glReversalResult = { success: !!glResult.reversalTransactionId };
      }
    } catch (_error) {
      // GL reversal failed — log but don't fail the whole operation
      // The inventory reversal is already committed
    }

    // Step 6: Return the result
    return {
      success: true,
      reversalTransactionId: result.reversalTransaction.id,
      originalTransactionId: transactionId,
      quantityRestored: originalQty,
      glReversed: glReversalResult.success,
      directIssueUpdated: result.directIssueUpdated,
      message: `Successfully reversed issue of ${originalQty} units`,
    };
  }

  /**
   * Get all direct issues for an inventory item
   */
  async getByInventoryItem(
    context: ServiceContext,
    inventoryItemId: string,
    filters?: DirectIssueFilterDTO,
  ): Promise<DirectIssueWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Build where clause
    const where: Record<string, unknown> = {
      inventoryItemId,
    };

    if (filters?.status) where.status = filters.status;
    if (filters?.departmentId) where.departmentId = filters.departmentId;
    if (filters?.accountCodeId) where.accountCodeId = filters.accountCodeId;
    if (filters?.areaId) where.areaId = filters.areaId;
    if (filters?.dateFrom || filters?.dateTo) {
      where.issuedAt = {};
      if (filters.dateFrom)
        (where.issuedAt as Record<string, unknown>).gte = filters.dateFrom;
      if (filters.dateTo)
        (where.issuedAt as Record<string, unknown>).lte = filters.dateTo;
    }

    // Get issues
    const issues = await this.prisma.directIssue.findMany({
      where,
      include: {
        inventoryItem: true,
        store: true,
        department: true,
        accountCode: true,
        area: true,
        project: { select: { id: true, code: true, name: true } },
        budgetPeriod: true,
        workOrder: {
          select: {
            id: true,
            woNumber: true,
            title: true,
            status: true,
            equipment: {
              select: {
                id: true,
                tag: true,
                description: true,
              },
            },
          },
        },
        returns: {
          orderBy: { returnedAt: "desc" },
        },
        autoGeneratedSerial: {
          select: {
            serialNumber: true,
          },
        },
      },
      orderBy: { issuedAt: "desc" },
    });

    const transformed = await Promise.all(
      issues.map((i) => this.transformModel(i as never)),
    );

    // Attach reversal metadata (who / when / reason) for fully-reversed issues.
    // These details are recorded on the original InventoryTransaction (flagged
    // isReversed) rather than on the DirectIssue row, so a separate batched
    // lookup is required.
    const reversedIds = transformed
      .filter((d) => d.status === DirectIssueStatus.REVERSED)
      .map((d) => d.id);

    if (reversedIds.length > 0) {
      const reversalTxns = await this.prisma.inventoryTransaction.findMany({
        where: { directIssueId: { in: reversedIds }, isReversed: true },
        select: {
          directIssueId: true,
          reversedByName: true,
          reversedAt: true,
          reversalReason: true,
        },
        orderBy: { reversedAt: "desc" },
      });

      const reversalByDi = new Map<string, (typeof reversalTxns)[number]>();
      for (const txn of reversalTxns) {
        if (txn.directIssueId && !reversalByDi.has(txn.directIssueId)) {
          reversalByDi.set(txn.directIssueId, txn);
        }
      }

      for (const d of transformed) {
        const txn = reversalByDi.get(d.id);
        if (txn) {
          d.reversal = {
            reversedByName: txn.reversedByName,
            reversedAt: txn.reversedAt,
            reason: txn.reversalReason,
          };
        }
      }
    }

    return transformed;
  }

  /**
   * Get all direct issues for a department
   */
  async getByDepartment(
    context: ServiceContext,
    departmentId: string,
    filters?: DirectIssueFilterDTO,
  ): Promise<DirectIssueWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Build where clause
    const where: Record<string, unknown> = {
      departmentId,
    };

    if (filters?.status) where.status = filters.status;
    if (filters?.inventoryItemId)
      where.inventoryItemId = filters.inventoryItemId;
    if (filters?.accountCodeId) where.accountCodeId = filters.accountCodeId;
    if (filters?.areaId) where.areaId = filters.areaId;
    if (filters?.dateFrom || filters?.dateTo) {
      where.issuedAt = {};
      if (filters.dateFrom)
        (where.issuedAt as Record<string, unknown>).gte = filters.dateFrom;
      if (filters.dateTo)
        (where.issuedAt as Record<string, unknown>).lte = filters.dateTo;
    }

    // Get issues
    const issues = await this.prisma.directIssue.findMany({
      where,
      include: {
        inventoryItem: true,
        store: true,
        department: true,
        accountCode: true,
        area: true,
        project: { select: { id: true, code: true, name: true } },
        budgetPeriod: true,
        workOrder: {
          select: {
            id: true,
            woNumber: true,
            title: true,
            status: true,
            equipment: {
              select: {
                id: true,
                tag: true,
                description: true,
              },
            },
          },
        },
        returns: {
          orderBy: { returnedAt: "desc" },
        },
        autoGeneratedSerial: {
          select: {
            serialNumber: true,
          },
        },
      },
      orderBy: { issuedAt: "desc" },
    });

    return Promise.all(issues.map((i) => this.transformModel(i as never)));
  }

  /**
   * Get direct issue summary
   */
  async getSummary(
    context: ServiceContext,
    filters: DirectIssueSummaryFilterDTO,
  ): Promise<DirectIssueSummary> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Build where clause
    const where: Record<string, unknown> = {};

    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.accountCodeId) where.accountCodeId = filters.accountCodeId;
    if (filters.areaId) where.areaId = filters.areaId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.dateFrom || filters.dateTo) {
      where.issuedAt = {};
      if (filters.dateFrom)
        (where.issuedAt as Record<string, unknown>).gte = filters.dateFrom;
      if (filters.dateTo)
        (where.issuedAt as Record<string, unknown>).lte = filters.dateTo;
    }

    // Get all issues
    const issues = await this.prisma.directIssue.findMany({
      where,
      include: {
        inventoryItem: true,
        department: true,
        accountCode: true,
        area: true,
        project: { select: { id: true, code: true, name: true } },
      },
    });

    // Calculate totals
    const totalIssues = issues.length;
    const totalQuantity = issues.reduce(
      (sum, i) => sum + Number(i.quantity),
      0,
    );
    const totalCost = issues.reduce((sum, i) => sum + Number(i.totalCost), 0);
    const totalReturned = issues.reduce(
      (sum, i) => sum + Number(i.quantityReturned),
      0,
    );
    const returnRate =
      totalQuantity > 0 ? (totalReturned / totalQuantity) * 100 : 0;

    // Build summary based on groupBy
    const summary: DirectIssueSummary = {
      totalIssues,
      totalQuantity,
      totalCost,
      totalReturned,
      returnRate,
    };

    if (filters.groupBy === "department") {
      const byDept = new Map<
        string,
        { name: string; count: number; qty: number; cost: number }
      >();
      issues.forEach((i) => {
        if (i.departmentId && i.department) {
          const existing = byDept.get(i.departmentId) ?? {
            name: i.department.name,
            count: 0,
            qty: 0,
            cost: 0,
          };
          existing.count++;
          existing.qty += Number(i.quantity);
          existing.cost += Number(i.totalCost);
          byDept.set(i.departmentId, existing);
        }
      });
      summary.byDepartment = Array.from(byDept.entries()).map(([id, data]) => ({
        departmentId: id,
        departmentName: data.name,
        issueCount: data.count,
        totalQuantity: data.qty,
        totalCost: data.cost,
      }));
    }

    if (filters.groupBy === "accountCode") {
      const byAcct = new Map<
        string,
        { code: string; name: string; count: number; qty: number; cost: number }
      >();
      issues.forEach((i) => {
        if (i.accountCodeId && i.accountCode) {
          const existing = byAcct.get(i.accountCodeId) ?? {
            code: i.accountCode.code,
            name: i.accountCode.name,
            count: 0,
            qty: 0,
            cost: 0,
          };
          existing.count++;
          existing.qty += Number(i.quantity);
          existing.cost += Number(i.totalCost);
          byAcct.set(i.accountCodeId, existing);
        }
      });
      summary.byAccountCode = Array.from(byAcct.entries()).map(
        ([id, data]) => ({
          accountCodeId: id,
          accountCode: data.code,
          accountName: data.name,
          issueCount: data.count,
          totalQuantity: data.qty,
          totalCost: data.cost,
        }),
      );
    }

    if (filters.groupBy === "area" && filters.areaId) {
      const byArea = new Map<
        string,
        { name: string; count: number; qty: number; cost: number }
      >();
      issues.forEach((i) => {
        if (i.area) {
          const areaId = i.areaId ?? "";
          const existing = byArea.get(areaId) ?? {
            name: i.area.name,
            count: 0,
            qty: 0,
            cost: 0,
          };
          existing.count++;
          existing.qty += Number(i.quantity);
          existing.cost += Number(i.totalCost);
          byArea.set(areaId, existing);
        }
      });
      summary.byArea = Array.from(byArea.entries()).map(([id, data]) => ({
        areaId: id,
        areaName: data.name,
        issueCount: data.count,
        totalQuantity: data.qty,
        totalCost: data.cost,
      }));
    }

    if (filters.groupBy === "item") {
      const byItem = new Map<
        string,
        { sku: string; desc: string; count: number; qty: number; cost: number }
      >();
      issues.forEach((i) => {
        const existing = byItem.get(i.inventoryItemId) ?? {
          sku: i.inventoryItem.sku,
          desc: i.inventoryItem.description,
          count: 0,
          qty: 0,
          cost: 0,
        };
        existing.count++;
        existing.qty += Number(i.quantity);
        existing.cost += Number(i.totalCost);
        byItem.set(i.inventoryItemId, existing);
      });
      summary.byItem = Array.from(byItem.entries()).map(([id, data]) => ({
        inventoryItemId: id,
        sku: data.sku,
        description: data.desc,
        issueCount: data.count,
        totalQuantity: data.qty,
        totalCost: data.cost,
      }));
    }

    if (filters.groupBy === "project") {
      const byProject = new Map<
        string,
        { code: string; name: string; count: number; qty: number; cost: number }
      >();
      issues.forEach((i) => {
        if (i.projectId && i.project) {
          const existing = byProject.get(i.projectId) ?? {
            code: i.project.code,
            name: i.project.name,
            count: 0,
            qty: 0,
            cost: 0,
          };
          existing.count++;
          existing.qty += Number(i.quantity);
          existing.cost += Number(i.totalCost);
          byProject.set(i.projectId, existing);
        }
      });
      summary.byProject = Array.from(byProject.entries()).map(([id, data]) => ({
        projectId: id,
        projectCode: data.code,
        projectName: data.name,
        issueCount: data.count,
        totalQuantity: data.qty,
        totalCost: data.cost,
      }));
    }

    return summary;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Generate unique issue number (DI-YYYY-#####)
   * Supports up to 99,999 issues per year
   * Uses retry logic to handle concurrent requests
   */
  private async generateIssueNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const counter = await this.prisma.documentCounter.upsert({
      where: { name: `DI-${year}` },
      create: {
        name: `DI-${year}`,
        nextValue: 1,
        description: `Direct Issues ${year}`,
      },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    return `DI-${year}-${String(counter.nextValue).padStart(5, "0")}`;
  }

  /**
   * Generate unique return number (DR-YYYY-#####)
   */
  private async generateReturnNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const counter = await this.prisma.documentCounter.upsert({
      where: { name: `DR-${year}` },
      create: {
        name: `DR-${year}`,
        nextValue: 1,
        description: `Direct Returns ${year}`,
      },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    return `DR-${year}-${String(counter.nextValue).padStart(5, "0")}`;
  }

  /**
   * Generate unique tracking ID for auto-serialized repairable items
   * Format: REP-SKU-Number (continuous incrementing, never resets)
   * Uses optimistic locking with retry to ensure sequential numbering
   *
   * @param inventoryItemId - The inventory item ID to get SKU from
   */
  private async generateTrackingId(inventoryItemId: string): Promise<string> {
    // Get the inventory item SKU
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { sku: true },
    });

    if (!inventoryItem) {
      throw new NotFoundError("Inventory Item", inventoryItemId);
    }

    const prefix = `REP-${inventoryItem.sku}-`;
    const maxRetries = 10; // Increased retries for better reliability

    // Retry with exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Get ALL tracking IDs for this SKU to find the highest SEQUENTIAL number
        const allItems = await this.prisma.repairableItem.findMany({
          where: {
            serialNumber: {
              startsWith: prefix,
            },
          },
          select: {
            serialNumber: true,
          },
        });

        let nextNumber = 1;
        if (allItems.length > 0) {
          // Extract all numbers and find the maximum SEQUENTIAL number
          // Ignore numbers > 999 as they are likely timestamp-based from old buggy code
          const numbers = allItems
            .map((item) => {
              const parts = item.serialNumber.split("-");
              const num = parts[2] ? parseInt(parts[2]) : 0;
              return isNaN(num) ? 0 : num;
            })
            .filter((num) => num > 0 && num < 1000); // Only consider sequential numbers < 1000

          if (numbers.length > 0) {
            const maxNumber = Math.max(...numbers);
            nextNumber = maxNumber + 1;
          }
        }

        const trackingId = `${prefix}${nextNumber}`;

        // Check if this tracking ID already exists
        const existing = await this.prisma.repairableItem.findUnique({
          where: { serialNumber: trackingId },
        });

        if (!existing) {
          return trackingId;
        }

        // If we got here, another request created this tracking ID
        // Exponential backoff: wait longer on each retry
        const backoffMs = Math.min(1000, 50 * Math.pow(2, attempt));
        await new Promise<void>((resolve) => {
          setTimeout(resolve, backoffMs);
        });
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw error; // Re-throw on last attempt
        }

        // Wait before retrying
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100 * (attempt + 1));
        });
      }
    }

    // If we exhausted all retries, throw an error instead of using fallback
    // This ensures we never create gaps in the sequence
    throw new Error(
      `Failed to generate unique tracking ID after ${maxRetries} attempts. Please try again.`,
    );
  }

  // ===========================================================================
  // ASSEMBLY TRACKING
  // ===========================================================================

  /**
   * Auto-update the assembly BOM and sub-serial parent link when a Direct Issue
   * is made to a Work Order that is tracking the repair of an assembly serial.
   *
   * Fires for BOTH serialized and non-serialized items:
   *   - Serialized repairable  → BOM entry + parentAssemblyId set on sub-serial
   *   - Everything else        → BOM entry only (type-level learning)
   *
   * All failures are non-fatal: each sub-operation is individually guarded and
   * only logged, never thrown.  The DI itself is already committed by the time
   * this method runs.
   *
   * Gates:
   *   1. DI is to a work order
   *   2. InventorySettings.assemblyTrackingEnabled = true
   *   3. The WO is repairing an assembly — resolved from EITHER:
   *        a. WO.repairableItemId  → a specific assembly serial (instance known), OR
   *        b. WO.repairInventoryItemId → the assembly TYPE (serial not yet assigned).
   *
   * BOM learning (type-level) fires in BOTH cases, so it works the moment a part
   * is issued — even before the removed assembly serial has been formally assigned
   * to the auto-created repair WO. The sub-serial parent link (instance-level)
   * only fires when the specific assembly serial is known (case a); when only the
   * type is known (case b), the link is deferred and filled in by
   * assemblyTrackingService.reconcileWorkOrderAssembly() at serial-assignment time.
   */
  private async _tryUpdateAssemblyTracking(
    context: ServiceContext,
    result: DirectIssueWithRelations,
  ): Promise<void> {
    // Gate 1 — must be issued to a work order
    if (!result.workOrderId) return;

    // Gate 2 — global assembly tracking must be on
    const settings = await inventorySettingsService.getSettingsInternal();
    if (!settings.assemblyTrackingEnabled) return;

    // Gate 3 — the WO must be repairing an assembly (by serial OR by type)
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: result.workOrderId },
      select: {
        woNumber: true,
        repairableItemId: true,
        repairInventoryItemId: true,
      },
    });
    if (!wo) return;

    // Resolve the assembly. Prefer the specific assigned serial (instance + type);
    // fall back to the WO's repair target TYPE so BOM learning still fires before a
    // serial is assigned.
    let assemblyItemId: string | null = null;
    let assemblySerial: { id: string; serialNumber: string } | null = null;

    if (wo.repairableItemId) {
      const serial = await this.prisma.repairableItem.findUnique({
        where: { id: wo.repairableItemId },
        select: {
          id: true,
          serialNumber: true,
          inventoryItem: { select: { id: true, isAssembly: true } },
        },
      });
      if (serial?.inventoryItem.isAssembly) {
        assemblyItemId = serial.inventoryItem.id;
        assemblySerial = { id: serial.id, serialNumber: serial.serialNumber };
      }
    }

    if (!assemblyItemId && wo.repairInventoryItemId) {
      const typeItem = await this.prisma.inventoryItem.findUnique({
        where: { id: wo.repairInventoryItemId },
        select: { id: true, isAssembly: true },
      });
      if (typeItem?.isAssembly) {
        assemblyItemId = typeItem.id;
        // assemblySerial stays null — the instance link is deferred.
      }
    }

    if (!assemblyItemId) return;

    // Never record the assembly itself as one of its own components.
    if (result.inventoryItemId === assemblyItemId) return;

    // ── BOM upsert (type-level) ─────────────────────────────────────────────────────
    // Key: (assemblyInventoryItemId, componentInventoryItemId).
    // First occurrence creates the row and sets typicalQuantity from the DI qty.
    // Subsequent occurrences only increment occurrenceCount and update lastSeenAt.
    // typicalQuantity is intentionally never auto-updated after the first write —
    // managers edit it manually (isManualOverride prevents any future auto-write).
    try {
      await this.prisma.repairableAssemblyBOM.upsert({
        where: {
          assemblyItemId_componentItemId: {
            assemblyItemId,
            componentItemId: result.inventoryItemId,
          },
        },
        create: {
          assemblyItemId,
          componentItemId: result.inventoryItemId,
          typicalQuantity: result.quantity,
          occurrenceCount: 1,
          lastSeenAt: new Date(),
        },
        update: {
          occurrenceCount: { increment: 1 },
          lastSeenAt: new Date(),
          // typicalQuantity is NOT updated here — set once at first occurrence,
          // then only via manual edit from the UI.
        },
      });
    } catch (bomError) {
      console.error(
        `[DirectIssueService] Assembly BOM upsert failed for DI ${result.issueNumber} ` +
          `(assembly=${assemblyItemId}, component=${result.inventoryItemId}):`,
        bomError instanceof Error ? bomError.message : String(bomError),
      );
    }

    // ── Sub-serial parent link (instance-level) ─────────────────────────────────────
    // Requires (a) a known assembly SERIAL (not just the type) and (b) the issued
    // item being a tracked serialized repairable. When only the type is known, the
    // link is filled in later by reconcileWorkOrderAssembly() on serial assignment.
    if (!assemblySerial || !result.serialNumber) return;

    try {
      const subSerial = await this.prisma.repairableItem.findUnique({
        where: { serialNumber: result.serialNumber },
        select: { id: true, parentAssemblyId: true },
      });
      if (!subSerial) return;
      // Already inside an assembly: if it's this one there's nothing to do; if it's
      // a different one, never silently re-home it. Either way, skip — this also
      // avoids writing a duplicate ADDED_TO_ASSEMBLY event.
      if (subSerial.parentAssemblyId) return;

      await this.prisma.repairableItem.update({
        where: { id: subSerial.id },
        data: { parentAssemblyId: assemblySerial.id },
      });

      await repairableItemHistoryService.logAddedToAssembly(context, {
        repairableItemId: subSerial.id,
        eventType: "ADDED_TO_ASSEMBLY" as const,
        assemblyId: assemblySerial.id,
        assemblySerial: assemblySerial.serialNumber,
        workOrderId: result.workOrderId,
        workOrderNumber: wo.woNumber,
        notes:
          `Installed inside assembly ${assemblySerial.serialNumber} ` +
          `via DI ${result.issueNumber} on WO ${wo.woNumber}`,
      });
    } catch (serialError) {
      console.error(
        `[DirectIssueService] Assembly sub-serial link failed: ` +
          `serial ${result.serialNumber} → assembly ${assemblySerial.serialNumber}:`,
        serialError instanceof Error
          ? serialError.message
          : String(serialError),
      );
    }
  }

  /**
   * After a direct issue decrements stock, create the covering replenishment
   * requisition if the item dropped below its reorder point.
   *
   * Thin wrapper over the CANONICAL reorder entry point
   * (inventoryReorderService.createReorderForItem) so the pipeline-aware
   * quantity formula, dedup, supplier resolution, budget classification and
   * auto-submit all live in ONE place. A direct issue to a work order routes
   * the reorder to that work order (account + department derived from the
   * equipment, project only if a project WO); otherwise it is a plain
   * ADD_TO_REORDER — never a project charge.
   */
  private async checkAndCreateRequisition(
    context: ServiceContext,
    issue: DirectIssueWithRelations,
  ): Promise<void> {
    try {
      // Dynamic import breaks the reorder.service ↔ inventory.service import
      // cycle (same pattern as inventory-auto-reorder / inventory-automation).
      const { inventoryReorderService } =
        await import("@/services/inventory/reorder.service");
      const result = (await inventoryReorderService.createReorderForItem(
        context,
        {
          inventoryItemId: issue.inventoryItemId,
          workOrderId: issue.workOrderId ?? undefined,
          equipmentId: issue.workOrder?.equipment?.id ?? undefined,
          source: "DIRECT_ISSUE",
          sourceNote: `Triggered by direct issue ${issue.issueNumber}.`,
        },
      )) as { requisitionId: string; reqNumber: string } | null;

      if (result) {
        // Store in context so the API response can notify the user.
        const contextWithReq = context as unknown as {
          autoCreatedRequisition?: { reqNumber: string; id: string };
        };
        contextWithReq.autoCreatedRequisition = {
          reqNumber: result.reqNumber,
          id: result.requisitionId,
        };
      }
    } catch (_error) {
      // Never fail the direct issue if REQ creation errors out.
    }
  }

  /**
   * Handle FIFO override notifications.
   *
   * When a direct issue draws from stock that was reserved in the FIFO queue,
   * identify which reservation(s) at the back of the queue are now underfunded
   * (reserved qty > remaining on-hand), annotate them with details of what
   * happened, and send an in-app notification to each reservation holder so
   * they can take corrective action.
   *
   * This method is best-effort — any failure is caught and logged without
   * blocking the direct issue that already committed.
   */
  private async _notifyFifoOverrideDisplacements(
    context: ServiceContext,
    issue: DirectIssueWithRelations,
    stockId: string,
  ): Promise<void> {
    try {
      // Resolve issuing user's display name for notes and notifications.
      const issuingUser = await this.prisma.user.findUnique({
        where: { id: context.userId },
        select: { firstName: true, lastName: true },
      });
      const issuerName = issuingUser
        ? `${issuingUser.firstName} ${issuingUser.lastName}`.trim()
        : "an inventory manager";

      // Re-read the stock record AFTER the decrement has been applied so we
      // can accurately calculate how many reserved units are now underfunded.
      const freshStock = await this.prisma.inventoryStock.findUnique({
        where: { id: stockId },
        select: { quantityOnHand: true, quantityReserved: true },
      });
      if (!freshStock) return;

      const currentOnHand = Number(freshStock.quantityOnHand);
      const currentReserved = Number(freshStock.quantityReserved);

      // Units that are reserved but no longer backed by physical stock.
      const underfundedQty = Math.max(0, currentReserved - currentOnHand);
      if (underfundedQty <= 0) return; // Free stock absorbed the entire issue — no displacement.

      // Fetch ALL ACTIVE reservations for this inventory item, ordered by FIFO
      // priority (lowest fifoPriorityOrder first = first-in-line gets stock).
      // We join through WorkOrderPart to read fifoPriorityOrder; fall back to
      // createdAt ordering for non-WO reservations.
      const activeReservations =
        await this.prisma.inventoryReservation.findMany({
          where: {
            inventoryItemId: issue.inventoryItemId,
            status: "ACTIVE",
          },
          include: {
            reservedByUser: {
              select: { id: true, firstName: true, lastName: true },
            },
            workOrderPart: {
              select: { id: true, fifoPriorityOrder: true, workOrderId: true },
            },
          },
          orderBy: { createdAt: "asc" }, // FIFO order: earliest reservation first
        });

      if (activeReservations.length === 0) return;

      // Walk from the END of the queue (last-in = first displaced) and collect
      // those whose reserved quantity now exceeds the remaining on-hand.
      let remainingUnderfunded = underfundedQty;
      const displacedReservations: typeof activeReservations = [];

      for (const res of [...activeReservations].reverse()) {
        if (remainingUnderfunded <= 0) break;
        displacedReservations.unshift(res);
        remainingUnderfunded -= Number(res.quantity);
      }

      if (displacedReservations.length === 0) return;

      // Describe where the stock was issued to.
      const issuedToDesc = issue.workOrderId
        ? `Work Order #${issue.workOrderId}`
        : `${issue.department?.name ?? "department"} / ${issue.accountCode?.code ?? "account"}`;

      const overrideTimestamp = new Date().toISOString();

      for (const res of displacedReservations) {
        // ── 1. Annotate the InventoryReservation ──────────────────────────────
        const overrideNote = [
          `\n\n⚠️ FIFO OVERRIDE — Direct Issue ${issue.issueNumber}`,
          `${issue.quantity} unit(s) were direct-issued by ${issuerName}`,
          `to ${issuedToDesc} on ${overrideTimestamp}.`,
          `This reservation may now have insufficient backing stock.`,
          `Please review your work order's parts and reorder if needed.`,
        ].join("\n");

        await this.prisma.inventoryReservation.update({
          where: { id: res.id },
          data: { notes: `${res.notes ?? ""}${overrideNote}`.trim() },
        });

        // ── 2. Annotate the linked WorkOrderPart (if any) ─────────────────────
        if (res.workOrderPart) {
          const wopOverrideNote = [
            `\n\n⚠️ Stock Warning — Direct Issue Override (${issue.issueNumber}):`,
            `${issue.quantity} unit(s) of this item were direct-issued by ${issuerName}`,
            `on ${overrideTimestamp}. Reserved stock may be insufficient.`,
            `Contact the inventory manager or raise a purchase requisition.`,
          ].join("\n");

          // Read current notes then write the appended version (Prisma has no
          // native string-concat in update for nullable fields).
          try {
            const existingWop = await this.prisma.workOrderPart.findUnique({
              where: { id: res.workOrderPart.id },
              select: { notes: true },
            });
            if (existingWop) {
              await this.prisma.workOrderPart.update({
                where: { id: res.workOrderPart.id },
                data: {
                  notes: `${existingWop.notes ?? ""}${wopOverrideNote}`.trim(),
                },
              });
            }
          } catch (_wopErr) {
            // Non-fatal — WOP annotation failure must not block the committed issue.
          }
        }

        // ── 3. Send in-app notification to the reservation holder ─────────────
        try {
          const { INVENTORY_NOTIFICATIONS } =
            await import("@/services/notifications/notification-types-registry");
          await notificationService.sendNotification(context, {
            userId: res.reservedByUser.id,
            type: INVENTORY_NOTIFICATIONS.RESERVATION_STOCK_OVERRIDE.type,
            category: NotificationCategory.INVENTORY,
            title: `Reserved stock taken — ${issue.inventoryItem?.sku ?? "item"} (${issue.issueNumber})`,
            message: [
              `${issuerName} performed direct issue ${issue.issueNumber}`,
              `and issued ${issue.quantity} unit(s) of`,
              `${issue.inventoryItem?.description ?? "this item"} to ${issuedToDesc}.`,
              `Your reservation (qty ${Number(res.quantity)}) may now have`,
              `insufficient backing stock. Please review and reorder if needed.`,
            ].join(" "),
            priority: NotificationPriority.HIGH,
            actionUrl: `/inventory/${issue.inventoryItemId}`,
            actionLabel: "View Inventory Item",
            data: {
              reservationId: res.id,
              inventoryItemId: issue.inventoryItemId,
              itemSku: issue.inventoryItem?.sku ?? "",
              itemDescription: issue.inventoryItem?.description ?? "",
              directIssueId: issue.id,
              directIssueNumber: issue.issueNumber,
              issuerName,
              quantityIssued: issue.quantity,
              workOrderId: res.workOrderPart?.workOrderId ?? null,
            },
          });
        } catch (_notifErr) {
          // Non-fatal — notification failure must never block the committed issue.
        }
      }
    } catch (_overrideErr) {
      // Non-fatal — FIFO override annotation failure must not unwind the issue.
    }
  }
}

// Export singleton instance
const globalForDirectIssue = globalThis as unknown as {
  directIssueService: DirectIssueService | undefined;
};
export const directIssueService =
  globalForDirectIssue.directIssueService ??
  (globalForDirectIssue.directIssueService = new DirectIssueService(prisma));
