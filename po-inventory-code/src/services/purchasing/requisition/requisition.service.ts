/**
 * Requisition Service - Core CRUD Operations
 *
 * Responsibilities:
 * - List requisitions with pagination
 * - Get single requisition by ID
 * - Create new requisitions
 * - Update existing requisitions
 * - Delete draft requisitions
 *
 * Does NOT handle:
 * - Workflow operations (submit, approve, reject, cancel)
 * - Conversion to PO
 * - Statistics and reporting
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { PaginatedResponse } from "@/types/api";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
  RoleName,
} from "@/types/permissions";
import { checkAnyPermission } from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import { calculatePagination, buildOrderBy } from "@/lib/query-helpers";
import {
  NotFoundError,
  BadRequestError,
  AuthorizationError,
} from "@/lib/api-errors";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";
import { budgetResolutionService } from "@/services/budget";
import { glReversalService } from "@/services/gl/gl-reversal.service";
import {
  calculatePOVariance,
  requiresReApproval,
} from "@/services/purchasing/purchase-order/purchase-order-change-detection";
import { financeSettingsService } from "@/services/finance/finance-settings.service";
import { reconcileLines } from "@/utils/reconcile-lines";
import {
  getTaxConfig,
  enforceTaxAmount,
  calculateTaxAmount,
} from "@/services/tax/tax-config.service";
import {
  calculateTotalValue,
  RequisitionCreateDTO,
  RequisitionItemDTO,
  RequisitionUpdateDTO,
  RequisitionWithRelations,
  RequisitionStatus,
} from "./requisition.types";

import { validateCreate, validateUpdate } from "./requisition-validation";

import {
  generateRequisitionNumber,
  transformRequisition,
  buildRequisitionInclude,
} from "./requisition-utils";

/**
 * Requisition Service - Core CRUD Operations
 */
export class RequisitionService {
  private prisma: PrismaClient;
  /** Legacy umbrella resource — kept for special actions (submit, approve, cancel, etc.) */
  private readonly resource = PermissionResource.PURCHASING;
  /** Specific resource used in the permission matrix UI */
  private readonly specificResource = PermissionResource.REQUISITIONS;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Check a CRUD permission, accepting EITHER the specific requisitions resource
   * OR the legacy umbrella purchasing resource.
   * This ensures the permission matrix (which shows requisitions:* separately)
   * and legacy roles (which use purchasing:*) both work correctly.
   */
  private async checkCrudPermission(
    context: ServiceContext,
    action: PermissionAction,
  ): Promise<void> {
    await checkAnyPermission(context, [
      buildPermissionString(this.specificResource, action),
      buildPermissionString(this.resource, action),
    ]);
  }

  /**
   * List requisitions with pagination, filtering, and sorting
   */
  async list(
    context: ServiceContext,
    options?: {
      page?: number;
      limit?: number;
      sort?: string;
      order?: "asc" | "desc";
      filters?: Record<string, unknown>;
      search?: string;
      include?: string[];
    },
  ): Promise<PaginatedResponse<RequisitionWithRelations>> {
    await this.checkCrudPermission(context, PermissionAction.READ);

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const { skip, take } = calculatePagination(page, limit);

    const where: Prisma.RequisitionWhereInput = {};

    // Apply basic filters
    const filters = options?.filters;

    // Supplier filter - filter by requisitions that have lines with this supplier
    // AND ALWAYS limit to Draft or Approved status only (for PO creation workflow)
    if (filters?.supplierId) {
      where.lines = {
        some: {
          supplierId: filters.supplierId as string,
        },
      };
      // ALWAYS limit to Draft and Approved when filtering by supplier
      // This overrides any status filter to ensure only convertible requisitions are shown
      where.status = {
        in: ["Draft", "Approved"],
      };
    } else {
      // Only apply status filter if NOT filtering by supplier
      if (filters?.status) {
        // Filter by requisition header status.
        // For "Approved" specifically, also include records where approvalStatus=APPROVED
        // but status may have drifted (e.g. still shows "Submitted") due to a historical
        // bug where some approval paths wrote approvalStatus but not the status string.
        // This makes the "Approved" quick filter resilient to that kind of drift.
        if (filters.status === "Approved") {
          where.OR = [
            { status: "Approved" },
            { approvalStatus: "APPROVED", status: "Submitted" },
          ];
        } else {
          where.status = filters.status as RequisitionStatus;
        }
      } else if (
        filters?.activeOnly === true ||
        filters?.activeOnly === "true"
      ) {
        // Show only active requisitions (pre-ordering statuses)
        // Hides: Ordered, PartiallyFulfilled, Fulfilled, Cancelled, Rejected
        where.status = {
          in: [
            RequisitionStatus.DRAFT,
            RequisitionStatus.SUBMITTED,
            RequisitionStatus.APPROVED,
          ],
        };
      } else if (
        filters?.excludeCancelled === true ||
        filters?.excludeCancelled === "true"
      ) {
        // Explicitly exclude cancelled requisitions when excludeCancelled is true
        where.status = {
          not: RequisitionStatus.CANCELLED,
        };
      } else {
        // Default behavior: show all requisitions including cancelled
        // No status filter - show all statuses including cancelled
      }
    }

    if (filters?.requestedById)
      where.requestedById = filters.requestedById as string;
    // Buyer assignment filter — only active when buyerAssignmentEnabled flag is on.
    // Filters by the Purchasing Manager assigned to the requisition.
    if (filters?.assignedBuyerId)
      where.assignedBuyerId = filters.assignedBuyerId as string;
    if (filters?.priority) {
      const priorityStr = filters.priority as string;
      // Support comma-separated values for multi-select (e.g., "HIGH,URGENT")
      if (priorityStr.includes(",")) {
        const priorities = priorityStr.split(",").map((p) => p.trim()) as Array<
          "LOW" | "NORMAL" | "HIGH" | "URGENT"
        >;
        where.priority = { in: priorities };
      } else {
        where.priority = priorityStr as "LOW" | "NORMAL" | "HIGH" | "URGENT";
      }
    }

    // Enhanced search across multiple fields
    if (options?.search) {
      const searchTerm = options.search;
      where.OR = [
        { reqNumber: { contains: searchTerm, mode: "insensitive" } },
        { description: { contains: searchTerm, mode: "insensitive" } },
        { justification: { contains: searchTerm, mode: "insensitive" } },
        {
          lines: {
            some: {
              description: { contains: searchTerm, mode: "insensitive" },
            },
          },
        },
      ];
    }

    // Add budget header filters
    if (
      filters?.budgetType ||
      filters?.accountCodeId ||
      filters?.workOrderId ||
      filters?.projectId ||
      filters?.budgetNotes
    ) {
      where.budgetHeader = {};

      if (filters.budgetType) {
        where.budgetHeader.budgetType = filters.budgetType as
          | "CHARGE_TO_ACCOUNT"
          | "CHARGE_TO_WORK_ORDER"
          | "CHARGE_TO_PROJECT"
          | "ADD_TO_REORDER";
      }

      if (filters.accountCodeId) {
        where.budgetHeader.accountCodeId = filters.accountCodeId as string;
      }

      if (filters.workOrderId) {
        where.budgetHeader.workOrderId = filters.workOrderId as string;
      }

      if (filters.projectId) {
        where.budgetHeader.projectId = filters.projectId as string;
      }

      if (filters.budgetNotes) {
        where.budgetHeader.notes = {
          contains: filters.budgetNotes as string,
          mode: "insensitive" as const,
        };
      }
    }

    const orderBy = options?.sort
      ? buildOrderBy(options.sort, options.order ?? "asc")
      : { createdAt: "desc" as const };

    const include = buildRequisitionInclude(options?.include);

    const [items, total] = await Promise.all([
      this.prisma.requisition.findMany({
        where,
        include,
        skip,
        take,
        orderBy,
      }),
      this.prisma.requisition.count({ where }),
    ]);

    const transformedItems = items.map((item) => transformRequisition(item));
    const totalPages = Math.ceil(total / take);

    return {
      success: true,
      data: transformedItems,
      pagination: {
        page,
        limit: take,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get a single requisition by ID
   */
  async getById(
    context: ServiceContext,
    id: string,
  ): Promise<RequisitionWithRelations> {
    await this.checkCrudPermission(context, PermissionAction.READ);

    validateRequired(id, "id");

    const requisition = await this.prisma.requisition.findUnique({
      where: { id },
      include: buildRequisitionInclude(),
    });

    if (!requisition) {
      throw new NotFoundError("Requisition", id);
    }

    return transformRequisition(requisition);
  }

  /**
   * Create a new requisition
   */
  async create(
    context: ServiceContext,
    data: RequisitionCreateDTO & {
      equipmentId?: string;
      workOrderId?: string;
      accountCodeId?: string;
      projectId?: string | null;
      budgetType?:
        | "CHARGE_TO_ACCOUNT"
        | "CHARGE_TO_WORK_ORDER"
        | "CHARGE_TO_PROJECT"
        | "ADD_TO_REORDER";
      supplierId?: string;
    },
  ): Promise<RequisitionWithRelations> {
    await this.checkCrudPermission(context, PermissionAction.CREATE);

    // Validate data using extracted validation
    await validateCreate(data, this.prisma);

    // Generate requisition number using utility
    const reqNumber = await generateRequisitionNumber(this.prisma);

    // "On behalf of" substitution: if onBehalfOfId is provided, that person becomes
    // the record owner (requestedById). The actual session user is captured for audit only.
    const actualCreatorId = context.userId;
    const ownerUserId = data.onBehalfOfId ?? data.requestedById;

    // Fetch tax config outside the transaction (cached, safe to call here)
    const taxConfig = await getTaxConfig();

    // Use transaction to create requisition and budget header together
    const requisition = await this.prisma.$transaction(async (tx) => {
      // Prepare create data
      const createData = {
        reqNumber,
        status: RequisitionStatus.DRAFT,
        requestedBy: {
          connect: { id: ownerUserId },
        },
        supplier: data.supplierId
          ? {
              connect: { id: data.supplierId },
            }
          : undefined,
        neededByDate: data.neededByDate ? new Date(data.neededByDate) : null,
        description: data.description ?? null,
        justification: data.justification ?? null,
        // Buyer assignment — only populated when buyerAssignmentEnabled flag is on
        assignedBuyerId: data.assignedBuyerId ?? null,
        lines: {
          create: data.items.map((item) => ({
            lineType: item.lineType,
            inventoryItem: item.inventoryItemId
              ? {
                  connect: { id: item.inventoryItemId },
                }
              : undefined,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            estimatedPrice: item.estimatedPrice,
            supplier: item.supplierId
              ? {
                  connect: { id: item.supplierId },
                }
              : undefined,
            notes: item.notes ?? null,
            // SERVICE fields
            serviceType: item.serviceType ?? null,
            serviceProvider: item.serviceProvider ?? null,
            serviceStartDate: item.serviceStartDate
              ? new Date(item.serviceStartDate)
              : null,
            serviceEndDate: item.serviceEndDate
              ? new Date(item.serviceEndDate)
              : null,
            serviceLocation: item.serviceLocation ?? null,
            serviceEquipmentId: item.serviceEquipmentId ?? null,
            serviceWorkOrderId:
              item.serviceWorkOrderId ?? item.workOrderId ?? null,
            hourlyRate: item.hourlyRate ?? null,
            estimatedHours: item.estimatedHours ?? null,
            contractNumber: item.contractNumber ?? null,
            slaDetails: item.slaDetails ?? null,
            deliverables: item.deliverables ?? null,
            // CONSUMABLE fields
            consumableCategory: item.consumableCategory ?? null,
            manufacturer: item.manufacturer ?? null,
            modelNumber: item.modelNumber ?? null,
            packageSize: item.packageSize ?? null,
            monthlyUsageRate: item.monthlyUsageRate ?? null,
            storageRequirements: item.storageRequirements ?? null,
            sdsRequired: item.sdsRequired ?? false,
            expirationTracking: item.expirationTracking ?? false,
          })),
        },
      };

      const newRequisition = await tx.requisition.create({
        data: createData,
        include: buildRequisitionInclude(),
      });

      // Create line allocations for items with accountCodeId (per-line account codes)
      // IMPORTANT: newRequisition.lines is ordered by DB insertion order which matches
      // data.items order (Prisma creates nested records in the order provided).
      // We iterate data.items by index to ensure correct line-to-item mapping.
      const itemsWithAccountCodes = data.items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.accountCodeId);
      if (itemsWithAccountCodes.length > 0) {
        // Map items to their created line IDs using the original index in data.items
        const lineAllocations = itemsWithAccountCodes
          .map(({ item, idx }) => {
            const lineId = newRequisition.lines[idx]?.id;
            if (!lineId || !item.accountCodeId) return null;

            const lineAmount = item.quantity * item.estimatedPrice;
            return {
              requisitionId: newRequisition.id,
              requisitionLineId: lineId,
              accountCodeId: item.accountCodeId,
              departmentId: item.departmentId ?? null,
              areaId: item.areaId ?? null,
              projectId: item.projectId ?? null,
              percentage: 100,
              amount: lineAmount,
              notes: null,
            };
          })
          .filter(Boolean);

        if (lineAllocations.length > 0) {
          await tx.requisitionLineAllocation.createMany({
            data: lineAllocations as Array<{
              requisitionId: string;
              requisitionLineId: string;
              accountCodeId: string;
              departmentId: string | null;
              areaId: string | null;
              projectId: string | null;
              percentage: number;
              amount: number;
              notes: string | null;
            }>,
            skipDuplicates: true,
          });
        }
      }

      // Track line IDs that already received an explicit per-item allocation above.
      // G5 fallback must skip these lines to avoid creating a duplicate allocation with
      // a different accountCodeId (e.g. the project CIP code vs the user-provided code).
      // skipDuplicates alone cannot prevent this because the accountCodeIds differ.
      const lineIdsWithExplicitAllocation = new Set<string>(
        itemsWithAccountCodes
          .map(({ idx }) => newRequisition.lines[idx]?.id)
          .filter((lineId): lineId is string => !!lineId),
      );

      // Calculate total amount from lines
      const totalAmount = calculateTotalValue(
        newRequisition.lines.map((line) => ({
          id: line.id,
          requisitionId: line.requisitionId,
          lineType: (line as unknown as { lineType: string }).lineType as
            | "INVENTORY"
            | "SERVICE"
            | "CONSUMABLE",
          inventoryItemId: line.inventoryItemId,
          description: line.description,
          quantity: Number(line.quantity),
          unit: (line as unknown as { unit: string }).unit,
          estimatedPrice: Number(line.estimatedPrice),
          supplierId:
            (line as unknown as { supplierId: string | null }).supplierId ??
            null,
          workOrderId: null,
          notes: line.notes,
          createdAt: line.createdAt,
          updatedAt: line.updatedAt,
        })),
      );

      // Compute and persist tax amount.
      // - If tax module is disabled, taxAmount is always 0.
      // - If an explicit taxAmount was provided in the payload, enforce it (clamp to 0 if disabled).
      // - Otherwise, calculate from the subtotal and configured rate.
      const rawTaxAmountFromInput = (
        data as RequisitionCreateDTO & { taxAmount?: number }
      ).taxAmount;
      const taxAmount =
        rawTaxAmountFromInput !== undefined
          ? enforceTaxAmount(rawTaxAmountFromInput, taxConfig)
          : calculateTaxAmount(totalAmount, taxConfig);

      // Persist taxAmount using typed Prisma call (post-migration, taxAmount column is generated)
      await tx.requisition.update({
        where: { id: newRequisition.id },
        data: { taxAmount },
      });

      // Determine budget type and resolve account code if needed
      const budgetType:
        | "CHARGE_TO_ACCOUNT"
        | "CHARGE_TO_WORK_ORDER"
        | "CHARGE_TO_PROJECT"
        | "ADD_TO_REORDER" = data.budgetType;
      let accountCodeId: string | null = data.accountCodeId ?? null;
      let workOrderId: string | null = data.workOrderId ?? null;
      let projectId: string | null = data.projectId ?? null;

      // Use budget resolution service if equipmentId or workOrderId provided
      // BUT only if budgetType was not explicitly provided by the user.
      // When the user explicitly sends budgetType, their intent must be respected —
      // do NOT auto-resolve and overwrite it.
      let resolvedProjectId: string | null = null;
      if (data.budgetType === "CHARGE_TO_WORK_ORDER" && data.workOrderId) {
        // If budgetType is explicitly set to CHARGE_TO_WORK_ORDER, ensure workOrderId is set
        workOrderId = data.workOrderId;
        // G3: Populate accountCodeId from the work order for downstream chain
        if (!accountCodeId) {
          const woResolution =
            await budgetResolutionService.resolveFromWorkOrder(
              data.workOrderId,
            );
          accountCodeId = woResolution.accountCodeId;
        }
        // Propagate the work order's projectId onto the budget header so the project
        // linkage is preserved when charging to a work order that belongs to a project.
        const woRecord = await tx.workOrder.findUnique({
          where: { id: data.workOrderId },
          select: { projectId: true },
        });
        resolvedProjectId = woRecord?.projectId ?? null;
      } else if (data.budgetType === "CHARGE_TO_PROJECT" && data.projectId) {
        // If budgetType is explicitly set to CHARGE_TO_PROJECT, ensure projectId is set
        projectId = data.projectId;
      }

      // For CHARGE_TO_PROJECT: resolve the project's accountCodeId for line allocations
      let projectAccountCodeId: string | null = null;
      if (budgetType === "CHARGE_TO_PROJECT" && projectId) {
        const project = await tx.project.findUnique({
          where: { id: projectId },
          select: { accountCodeId: true },
        });
        projectAccountCodeId = project?.accountCodeId ?? null;
      }

      // Create budget header
      await tx.requisitionBudgetHeader.create({
        data: {
          requisitionId: newRequisition.id,
          budgetType,
          accountCodeId:
            budgetType === "CHARGE_TO_PROJECT" ? null : accountCodeId,
          workOrderId: budgetType === "CHARGE_TO_PROJECT" ? null : workOrderId,
          // For CHARGE_TO_PROJECT: use the explicit projectId.
          // For CHARGE_TO_WORK_ORDER: propagate the work order's projectId (if any) so
          //   the project linkage is preserved on the budget header.
          // For all other types: null.
          projectId:
            budgetType === "CHARGE_TO_PROJECT"
              ? projectId
              : budgetType === "CHARGE_TO_WORK_ORDER"
                ? resolvedProjectId
                : null,
          totalAmount,
          notes: null,
        },
      });

      // For CHARGE_TO_PROJECT: create line allocations using the project's accountCodeId
      if (budgetType === "CHARGE_TO_PROJECT" && projectAccountCodeId) {
        const projectLineAllocations = newRequisition.lines
          .filter(
            (line) =>
              (line as unknown as { lineType: string }).lineType !==
              "INVENTORY",
          )
          .map((line) => {
            const lineAmount =
              Number(line.quantity) * Number(line.estimatedPrice);
            return {
              requisitionId: newRequisition.id,
              requisitionLineId: line.id,
              accountCodeId: projectAccountCodeId,
              departmentId: null as string | null,
              areaId: null as string | null,
              projectId: projectId,
              percentage: 100,
              amount: lineAmount,
              notes: null as string | null,
            };
          });

        if (projectLineAllocations.length > 0) {
          await tx.requisitionLineAllocation.createMany({
            data: projectLineAllocations,
            skipDuplicates: true,
          });
        }
      }

      // G5: For CHARGE_TO_ACCOUNT and CHARGE_TO_WORK_ORDER with a resolved accountCodeId,
      // create line allocations for SERVICE, CONSUMABLE, and NON_STOCK lines so the
      // downstream PO conversion and GL posting can find an account code.
      // This is a safety-net fallback — per-line allocations (block above) take priority.
      // IMPORTANT: Skip lines that already have an explicit per-item allocation above.
      // skipDuplicates alone cannot prevent duplicates when the accountCodeIds differ
      // (e.g. user provides 6511 and WO project resolves to 1580 — both would be written).
      // For WO reqs, also stamp the configured default dept.
      if (
        accountCodeId &&
        (budgetType === "CHARGE_TO_ACCOUNT" ||
          budgetType === "CHARGE_TO_WORK_ORDER")
      ) {
        // Resolve fallback dept for WO reqs from FinanceSettings
        let g5DepartmentId: string | null = null;
        if (budgetType === "CHARGE_TO_WORK_ORDER") {
          const woDefaults =
            await financeSettingsService.getWorkOrderDefaults();
          g5DepartmentId = woDefaults.defaultWorkOrderDepartmentId ?? null;
        }

        const woAccountLineAllocations = newRequisition.lines
          .filter((line) => {
            const lt = (line as unknown as { lineType: string }).lineType;
            // Cover all non-inventory expensed line types.
            // Skip lines that already have an explicit per-item allocation (see Set above).
            return (
              (lt === "SERVICE" || lt === "CONSUMABLE" || lt === "NON_STOCK") &&
              !lineIdsWithExplicitAllocation.has(line.id)
            );
          })
          .map((line) => {
            const lineAmount =
              Number(line.quantity) * Number(line.estimatedPrice);
            return {
              requisitionId: newRequisition.id,
              requisitionLineId: line.id,
              accountCodeId: accountCodeId,
              departmentId: g5DepartmentId,
              areaId: null as string | null,
              projectId: null as string | null,
              percentage: 100,
              amount: lineAmount,
              notes: null as string | null,
            };
          });

        if (woAccountLineAllocations.length > 0) {
          await tx.requisitionLineAllocation.createMany({
            data: woAccountLineAllocations,
            skipDuplicates: true,
          });
        }
      }

      // For CHARGE_TO_WORK_ORDER on a project WO: ALL line allocations must use
      // the project's CIP account code (e.g. 1580) and carry the project dimension.
      // The user may have selected a maintenance expense code (6511, 6512, etc.) in the
      // form, but project WO costs are capitalized to CIP regardless — the per-item code
      // is overridden here unconditionally.
      // The projectId is also stamped so the GL engine fires the project override rule
      // (GLR-0029) at receipt time.
      if (
        budgetType === "CHARGE_TO_WORK_ORDER" &&
        resolvedProjectId &&
        accountCodeId
      ) {
        await tx.requisitionLineAllocation.updateMany({
          where: { requisitionId: newRequisition.id },
          data: {
            accountCodeId: accountCodeId, // Force project's CIP account code (e.g. 1580)
            projectId: resolvedProjectId,
            departmentId: null, // Projects supersede departments — clear dept
          },
        });
      }

      // Fetch complete requisition with budget header
      const completeRequisition = await tx.requisition.findUnique({
        where: { id: newRequisition.id },
        include: buildRequisitionInclude(),
      });

      if (!completeRequisition) {
        throw new Error("Failed to create requisition with budget header");
      }

      return completeRequisition;
    });

    await auditLogService.logCrudOperation(
      context,
      AuditAction.CREATE,
      "Requisition",
      requisition.id,
      requisition.reqNumber,
      {},
      {
        status: requisition.status,
        requestedById: requisition.requestedById,
        itemCount: requisition.lines.length,
      },
      {
        action: "requisition_created",
        reqNumber: requisition.reqNumber,
        ...(data.onBehalfOfId
          ? {
              proxyCreatedBy: actualCreatorId,
              onBehalfOfId: data.onBehalfOfId,
              note: `Created by proxy user on behalf of record owner`,
            }
          : {}),
      },
    );

    return transformRequisition(requisition);
  }

  /**
   * Update an existing requisition
   */
  async update(
    context: ServiceContext,
    id: string,
    data: RequisitionUpdateDTO & {
      equipmentId?: string;
      workOrderId?: string;
      accountCodeId?: string;
      projectId?: string | null;
      budgetType?:
        | "CHARGE_TO_ACCOUNT"
        | "CHARGE_TO_WORK_ORDER"
        | "CHARGE_TO_PROJECT"
        | "ADD_TO_REORDER";
      supplierId?: string;
    },
  ): Promise<RequisitionWithRelations> {
    await this.checkCrudPermission(context, PermissionAction.UPDATE);

    validateRequired(id, "id");

    // Validate update using extracted validation
    await validateUpdate(id, data, this.prisma);

    const existingRequisition = await this.prisma.requisition.findUnique({
      where: { id },
      include: {
        lines: {
          // Stable order for both the diff loop and the reconcileLines fallback.
          // RequisitionLine has no lineNumber field (that is a POLine field).
          orderBy: [{ createdAt: "asc" }],
        },
        budgetHeader: true,
      },
    });

    if (!existingRequisition) {
      throw new NotFoundError("Requisition", id);
    }

    // CRITICAL: Reverse GL entries BEFORE the Prisma transaction to avoid
    // interactive transaction timeout and ensure GL reversal completes independently.
    // GL operations use their own Prisma client and don't need to be atomic
    // with the requisition update.
    const wasApprovedBeforeEdit =
      existingRequisition.approvalStatus === "APPROVED";

    // 10% RULE: Only reset approval status to DRAFT when the total value of the
    // requisition increases by more than 10% compared to the approved amount,
    // AND the new total exceeds the auto-approval threshold (i.e. a human approver
    // would actually be required for this amount).
    // Non-financial changes (supplier, description, priority, dates, justification,
    // notes, etc.) do NOT require re-approval.
    //
    // Uses the same compound check as the PO workflow:
    //   requiresReApproval(variancePercent, newTotal, thresholdPercent, autoApprovalThreshold)
    // where autoApprovalThreshold is the lowest RequisitionApprovalLevel.minAmount.
    const [thresholdPercent, autoApprovalThreshold, taxConfig] =
      await Promise.all([
        financeSettingsService.getPoVarianceThreshold(),
        financeSettingsService.getAutoApprovalThreshold(),
        getTaxConfig(),
      ]);
    let needsReApproval = false;
    if (wasApprovedBeforeEdit && data.items) {
      const originalTotal = existingRequisition.lines.reduce(
        (sum, line) =>
          sum + Number(line.quantity) * Number(line.estimatedPrice),
        0,
      );
      const newTotal = data.items.reduce(
        (sum, item) => sum + item.quantity * item.estimatedPrice,
        0,
      );
      const variance = calculatePOVariance(newTotal, originalTotal);
      if (variance.isIncrease) {
        needsReApproval = requiresReApproval(
          variance.variancePercent,
          newTotal,
          thresholdPercent,
          autoApprovalThreshold,
        );
      }
    }
    // If no items were provided in the update (supplier-only change, description change, etc.)
    // needsReApproval stays false — approval is preserved.

    if (wasApprovedBeforeEdit && needsReApproval) {
      try {
        // Only reverse ENCUMBRANCE transactions (not REVERSAL entries from previous cycles)
        const glTransactions = await this.prisma.gLTransaction.findMany({
          where: {
            referenceType: "Requisition",
            referenceId: id,
            transactionType: "ENCUMBRANCE",
            status: "POSTED",
          },
        });

        logger.info(
          `[Requisition Update] Found ${glTransactions.length} POSTED ENCUMBRANCE GL transaction(s) for requisition ${id} (approvalStatus=${existingRequisition.approvalStatus})`,
        );

        for (const glTxn of glTransactions) {
          logger.info(
            `[Requisition Update] Reversing GL transaction ${glTxn.id} (type=${glTxn.transactionType}, status=${glTxn.status}, amount=${glTxn.totalAmount})`,
          );
          await glReversalService.reverseTransaction(
            glTxn.id,
            `Requisition edited after approval - reset to Draft`,
            context.userId,
          );
          logger.info(
            `[Requisition Update] Successfully reversed GL transaction ${glTxn.id}`,
          );
        }

        if (glTransactions.length > 0) {
          logger.info(
            `[Requisition Update] Reversed ${glTransactions.length} GL transaction(s) for requisition ${id} due to edit after approval`,
          );
        } else {
          logger.warn(
            `[Requisition Update] No POSTED ENCUMBRANCE GL transactions found for requisition ${id} — nothing to reverse`,
          );
        }
      } catch (glError) {
        logger.error(
          `[Requisition Update] GL reversal failed for requisition ${id}: ${glError instanceof Error ? glError.message : String(glError)}`,
        );
        // Non-fatal — don't fail the update operation
      }
    }

    // Use transaction to update requisition and budget header together
    const requisition = await this.prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};

      // If requisition was APPROVED and the new total exceeds the original by >10%,
      // reset to DRAFT — this requires re-approval after the financial change.
      // Non-financial changes (supplier, description, priority, dates, etc.) preserve approval.
      if (needsReApproval) {
        updateData.approvalStatus = "DRAFT";
        updateData.status = RequisitionStatus.DRAFT;
        updateData.approvedAt = null;
        updateData.approvedBy = null;
      }

      if (data.description !== undefined)
        updateData.description = data.description;
      if (data.priority !== undefined) {
        // Priority is already a string enum value, no need to convert
        updateData.priority = data.priority;
      }
      if (data.neededByDate !== undefined) {
        updateData.neededByDate = data.neededByDate
          ? new Date(data.neededByDate)
          : null;
      }
      if (data.justification !== undefined)
        updateData.justification = data.justification;

      // Handle supplier update
      if (data.supplierId !== undefined) {
        updateData.supplier = data.supplierId
          ? { connect: { id: data.supplierId } }
          : { disconnect: true };
      }

      // Handle "on behalf of" (change requestor): if onBehalfOfId is provided,
      // update requestedById so the specified user becomes the new record owner.
      if (data.onBehalfOfId !== undefined) {
        if (data.onBehalfOfId) {
          updateData.requestedById = data.onBehalfOfId;
        }
        // If onBehalfOfId is null/empty, we don't clear the requestor —
        // leaving the existing requestor in place is the safe default.
      }

      // Buyer assignment — updateable when buyerAssignmentEnabled flag is on.
      // Explicitly passing null clears the assignment; undefined = no change.
      if (data.assignedBuyerId !== undefined) {
        updateData.assignedBuyerId = data.assignedBuyerId ?? null;
      }

      // Track which lines were preserved by reconciliation guards
      // (used to scope budget-level allocation creation later)
      const preservedLineIds = new Set<string>();

      // ====================================================================
      // Handle items update — Non-destructive line reconciliation
      //
      // Instead of deleteMany + create (which destroys UUIDs and severs
      // PO cross-links), we reconcile existing vs incoming lines using a
      // 3-way merge: UPDATE matched lines, CREATE new lines, DELETE removed
      // lines (only when guards allow).
      //
      // @see docs/destructive-update-fix-architecture.md — Section 2 & 3.1
      // ====================================================================
      if (data.items) {
        // 1. Fetch existing lines with allocations AND — for any REQ line already
        //    converted to a PO line — the linked PO + PO line's downstream
        //    dependencies (receipts / returns / invoice line items).
        //
        //    This is required for the `canDelete` guard below to correctly
        //    distinguish between:
        //      (a) a REQ line whose PO is in Draft and has no downstream activity
        //          → SAFE to delete on both sides (the cancelForEdit-kickback case)
        //      (b) a REQ line whose PO is live / has receipts / has invoice matches
        //          → REFUSE deletion with a specific reason
        //
        //    Without pulling the PO's current status and the PO line's
        //    dependencies, the guard used to reject every poLineId-linked REQ
        //    line unconditionally and silently preserve it — producing the
        //    "Adan's 3 deletes never took effect" bug (see mistake registry).
        const existingLines = await tx.requisitionLine.findMany({
          where: { requisitionId: id },
          include: {
            allocations: true,
            poLine: {
              include: {
                purchaseOrder: {
                  select: { id: true, poNumber: true, status: true },
                },
                receipts: { select: { id: true } },
                returns: { select: { id: true } },
                invoiceLineItems: { select: { id: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        });

        // Type shorthand for existing lines with allocations + linked PO context
        type ExistingLine = (typeof existingLines)[number];

        // 2. Compute the reconciliation plan
        const reconciliation = reconcileLines<ExistingLine, RequisitionItemDTO>(
          existingLines,
          data.items,
          {
            getIncomingId: (item) => item.id,

            protectedFields: [
              "lineStatus",
              "purchaseOrderId",
              "purchaseOrderNumber",
              "poLineId",
              "convertedToPOAt",
              "convertedToPOBy",
              "createdAt",
            ] as Array<keyof ExistingLine>,

            canDelete: (line) => {
              const status = String(
                (line as unknown as Record<string, unknown>).lineStatus ??
                  "PENDING",
              );
              if (status !== "PENDING" && status !== "APPROVED") {
                return {
                  allowed: false,
                  reason:
                    `Line "${line.description}" is in ${status} status and cannot be removed` +
                    ((line as unknown as Record<string, unknown>)
                      .purchaseOrderNumber
                      ? ` (linked to PO ${(line as unknown as Record<string, unknown>).purchaseOrderNumber})`
                      : ""),
                };
              }

              // REQ line is linked to a PO line. Historical behaviour: refuse
              // unconditionally. That was wrong for the cancelForEdit-kickback
              // case, where the PO is explicitly back in Draft and reuses the
              // same PO identity after REQ re-approval. In that case the REQ
              // line CAN be removed — we just have to cascade-delete the
              // matching PO line (safely) at the same time.
              //
              // Rules:
              //   - PO not loaded (data integrity issue) → refuse, surface it.
              //   - PO status not in {Draft, Submitted} → refuse (live PO).
              //   - PO line has receipts / returns / invoice matches → refuse.
              //   - Otherwise → allow. Cascade delete happens in step 3.
              if (line.poLine) {
                const poStatus = line.poLine.purchaseOrder?.status ?? null;
                const poNumber =
                  line.poLine.purchaseOrder?.poNumber ??
                  line.purchaseOrderNumber ??
                  "(unknown PO)";

                if (poStatus !== "Draft" && poStatus !== "Submitted") {
                  return {
                    allowed: false,
                    reason:
                      `Line "${line.description}" is linked to PO ${poNumber} ` +
                      `which is in ${poStatus ?? "an unknown"} status. ` +
                      `Use "Req Revision Needed" on the PO to reset it to Draft first, then retry.`,
                  };
                }
                if (Number(line.poLine.receivedQuantity) > 0) {
                  return {
                    allowed: false,
                    reason:
                      `Line "${line.description}" has ${line.poLine.receivedQuantity} unit(s) ` +
                      `already received on PO ${poNumber} and cannot be removed.`,
                  };
                }
                if (line.poLine.receipts.length > 0) {
                  return {
                    allowed: false,
                    reason:
                      `Line "${line.description}" has ${line.poLine.receipts.length} receipt record(s) ` +
                      `on PO ${poNumber} and cannot be removed.`,
                  };
                }
                if (line.poLine.returns.length > 0) {
                  return {
                    allowed: false,
                    reason:
                      `Line "${line.description}" has ${line.poLine.returns.length} return(s) ` +
                      `on PO ${poNumber} and cannot be removed.`,
                  };
                }
                if (line.poLine.invoiceLineItems.length > 0) {
                  return {
                    allowed: false,
                    reason:
                      `Line "${line.description}" is matched to ${line.poLine.invoiceLineItems.length} invoice line(s) ` +
                      `on PO ${poNumber} and cannot be removed.`,
                  };
                }
                // Safe — PO is in Draft/Submitted, no receipts/returns/invoices.
                // The delete step below will also remove the linked PO line.
              }
              return { allowed: true };
            },

            toCreateInput: (item) => ({
              lineType: item.lineType,
              inventoryItemId: item.inventoryItemId ?? null,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              estimatedPrice: item.estimatedPrice,
              supplierId: item.supplierId ?? null,
              notes: item.notes ?? null,
              // SERVICE fields
              serviceType: item.serviceType ?? null,
              serviceProvider: item.serviceProvider ?? null,
              serviceStartDate: item.serviceStartDate
                ? new Date(item.serviceStartDate)
                : null,
              serviceEndDate: item.serviceEndDate
                ? new Date(item.serviceEndDate)
                : null,
              serviceLocation: item.serviceLocation ?? null,
              serviceEquipmentId: item.serviceEquipmentId ?? null,
              serviceWorkOrderId:
                item.serviceWorkOrderId ?? item.workOrderId ?? null,
              hourlyRate: item.hourlyRate ?? null,
              estimatedHours: item.estimatedHours ?? null,
              contractNumber: item.contractNumber ?? null,
              slaDetails: item.slaDetails ?? null,
              deliverables: item.deliverables ?? null,
              // CONSUMABLE fields
              consumableCategory: item.consumableCategory ?? null,
              manufacturer: item.manufacturer ?? null,
              modelNumber: item.modelNumber ?? null,
              packageSize: item.packageSize ?? null,
              monthlyUsageRate: item.monthlyUsageRate ?? null,
              storageRequirements: item.storageRequirements ?? null,
              sdsRequired: item.sdsRequired ?? false,
              expirationTracking: item.expirationTracking ?? false,
            }),

            toUpdateInput: (item) => ({
              lineType: item.lineType,
              inventoryItemId: item.inventoryItemId ?? null,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              estimatedPrice: item.estimatedPrice,
              supplierId: item.supplierId ?? null,
              notes: item.notes ?? null,
              // SERVICE fields
              serviceType: item.serviceType ?? null,
              serviceProvider: item.serviceProvider ?? null,
              serviceStartDate: item.serviceStartDate
                ? new Date(item.serviceStartDate)
                : null,
              serviceEndDate: item.serviceEndDate
                ? new Date(item.serviceEndDate)
                : null,
              serviceLocation: item.serviceLocation ?? null,
              serviceEquipmentId: item.serviceEquipmentId ?? null,
              serviceWorkOrderId:
                item.serviceWorkOrderId ?? item.workOrderId ?? null,
              hourlyRate: item.hourlyRate ?? null,
              estimatedHours: item.estimatedHours ?? null,
              contractNumber: item.contractNumber ?? null,
              slaDetails: item.slaDetails ?? null,
              deliverables: item.deliverables ?? null,
              // CONSUMABLE fields
              consumableCategory: item.consumableCategory ?? null,
              manufacturer: item.manufacturer ?? null,
              modelNumber: item.modelNumber ?? null,
              packageSize: item.packageSize ?? null,
              monthlyUsageRate: item.monthlyUsageRate ?? null,
              storageRequirements: item.storageRequirements ?? null,
              sdsRequired: item.sdsRequired ?? false,
              expirationTracking: item.expirationTracking ?? false,
              // NOTE: protectedFields are auto-stripped by reconcileLines()
            }),
          },
        );

        // Surface reconciliation warnings as a 400 BadRequestError.
        //
        // Previously this block only emitted a WARN log and let the request
        // succeed with the lines silently preserved. That caused the
        // 2026-04-21 incident on REQ-000087 / PO-001081 where Adan saw a
        // "success" toast but his 3 line deletes were never applied. Fail
        // loudly and explicitly so the UI surfaces the blocker to the user.
        if (reconciliation.warnings.length > 0) {
          logger.warn(
            `[Requisition Update] Line reconciliation warnings for ${id}: ` +
              reconciliation.warnings.join("; "),
          );
          throw new BadRequestError(
            `Cannot remove the requested line(s) from this requisition:\n` +
              reconciliation.preserved
                .map((pp) => ` • ${pp.reason}`)
                .join("\n"),
          );
        }

        // Track preserved lines for allocation scoping (kept for forward
        // compatibility — after the throw above, preserved should always be
        // empty here, but leaving the set maintains the existing downstream
        // contract for any future non-throwing preserve cases).
        for (const p of reconciliation.preserved) {
          preservedLineIds.add(p.id);
        }

        // 3. Execute DELETEs — cascade through REQ allocations → matching
        //    PO line (+ its charge allocations) → REQ line. Order matters
        //    because of FK constraints.
        if (reconciliation.deletes.length > 0) {
          const deleteIds = reconciliation.deletes.map((d) => d.id);

          // Find matching PO lines for cascade. canDelete has already verified
          // each one is safe to remove (PO in Draft/Submitted, no receipts/
          // returns/invoice matches).
          const matchingPOLineIds: string[] = [];
          const affectedPOIds = new Set<string>();
          for (const reqLine of existingLines) {
            if (deleteIds.includes(reqLine.id) && reqLine.poLine) {
              matchingPOLineIds.push(reqLine.poLine.id);
              if (reqLine.poLine.purchaseOrder?.id) {
                affectedPOIds.add(reqLine.poLine.purchaseOrder.id);
              }
            }
          }

          // 3a. Delete REQ-line allocations
          await tx.requisitionLineAllocation.deleteMany({
            where: { requisitionLineId: { in: deleteIds } },
          });

          // 3b. If any REQ line was linked to a PO line, cascade the delete
          //     to the PO side BEFORE deleting the REQ lines so the
          //     RequisitionLine.poLineId FK doesn't pin them in place.
          if (matchingPOLineIds.length > 0) {
            // Delete PO line charge allocations first (belt & suspenders —
            // cascade would handle this, but explicit is clearer in audit).
            await tx.pOLineChargeAllocation.deleteMany({
              where: { poLineId: { in: matchingPOLineIds } },
            });
            // Delete the matching PO lines.
            await tx.pOLine.deleteMany({
              where: { id: { in: matchingPOLineIds } },
            });
          }

          // 3c. Delete the REQ lines themselves.
          await tx.requisitionLine.deleteMany({
            where: { id: { in: deleteIds } },
          });

          // 3d. Recompute each affected PO's totalAmount and approvedTotal
          //     from its surviving lines so the PO header stays consistent.
          for (const affectedPOId of affectedPOIds) {
            const remainingPOLines = await tx.pOLine.findMany({
              where: { purchaseOrderId: affectedPOId },
              select: { totalPrice: true },
            });
            const newPOTotal = remainingPOLines.reduce(
              (sum, l) => sum + Number(l.totalPrice),
              0,
            );
            await tx.purchaseOrder.update({
              where: { id: affectedPOId },
              data: {
                totalAmount: newPOTotal,
                approvedTotal: newPOTotal,
              },
            });
          }

          logger.info(
            `[Requisition Update] Cascade-deleted ${matchingPOLineIds.length} ` +
              `matching PO line(s) across ${affectedPOIds.size} PO(s) when ` +
              `removing ${deleteIds.length} REQ line(s) on ${id}`,
          );
        }

        // 4. Execute UPDATEs — in-place, preserving UUIDs and protected fields
        for (const update of reconciliation.updates) {
          await tx.requisitionLine.update({
            where: { id: update.id },
            data: update.data,
          });
        }

        // 5. Execute CREATEs — collect new line IDs for allocation mapping
        const createdLineIds: string[] = [];
        for (const createInput of reconciliation.creates) {
          const created = await tx.requisitionLine.create({
            data: {
              ...createInput,
              requisitionId: id,
            } as Prisma.RequisitionLineUncheckedCreateInput,
          });
          createdLineIds.push(created.id);
        }

        // 6. Reconcile allocations for lines that were part of reconciliation
        //    (preserved lines keep their existing allocations untouched)
        const reconciledLineIds = [
          ...reconciliation.updates.map((u) => u.id),
          ...createdLineIds,
        ];
        if (reconciledLineIds.length > 0) {
          await tx.requisitionLineAllocation.deleteMany({
            where: {
              requisitionId: id,
              requisitionLineId: { in: reconciledLineIds },
            },
          });
        }

        // Build item → lineId mapping for per-line allocation creation
        const existingById = new Map(existingLines.map((l) => [l.id, l]));
        const itemToLineId: Array<{
          item: RequisitionItemDTO;
          lineId: string;
        }> = [];
        let createIdx = 0;

        for (const item of data.items) {
          if (!item) continue;
          if (item.id && existingById.has(item.id)) {
            // Existing line — matched by id
            itemToLineId.push({ item, lineId: item.id });
          } else {
            // New line — use the id returned from the create operation
            const lineId = createdLineIds[createIdx++];
            if (lineId) {
              itemToLineId.push({ item, lineId });
            }
          }
        }

        // Create per-line allocations for items with accountCodeId
        const allocationsToCreate = itemToLineId.flatMap(({ item, lineId }) => {
          if (!item.accountCodeId) return [];
          return [
            {
              requisitionId: id,
              requisitionLineId: lineId,
              accountCodeId: item.accountCodeId,
              departmentId: item.departmentId ?? null,
              areaId: item.areaId ?? null,
              projectId: item.projectId ?? null,
              percentage: 100,
              amount: item.quantity * item.estimatedPrice,
              notes: null as string | null,
            },
          ];
        });

        if (allocationsToCreate.length > 0) {
          await tx.requisitionLineAllocation.createMany({
            data: allocationsToCreate,
            skipDuplicates: true,
          });
        }

        // 7. Update computed line counts on the requisition header
        const allLines = await tx.requisitionLine.findMany({
          where: { requisitionId: id },
          select: { lineStatus: true },
        });

        Object.assign(updateData, {
          totalLines: allLines.length,
          pendingLines: allLines.filter((l) => l.lineStatus === "PENDING")
            .length,
          approvedLines: allLines.filter((l) => l.lineStatus === "APPROVED")
            .length,
          orderedLines: allLines.filter((l) => l.lineStatus === "ORDERED")
            .length,
          fulfilledLines: allLines.filter(
            (l) =>
              l.lineStatus === "FULFILLED" ||
              l.lineStatus === "PARTIALLY_FULFILLED",
          ).length,
          cancelledLines: allLines.filter((l) => l.lineStatus === "CANCELLED")
            .length,
        });

        logger.info(
          `[Requisition Update] Reconciled lines for ${id}: ` +
            `${reconciliation.updates.length} updated, ` +
            `${reconciliation.creates.length} created, ` +
            `${reconciliation.deletes.length} deleted, ` +
            `${reconciliation.preserved.length} preserved`,
        );
      }

      // Update requisition header (and fetch updated state including reconciled lines)
      const updatedRequisition = await tx.requisition.update({
        where: { id },
        data: updateData,
        include: buildRequisitionInclude(),
      });

      // Update budget header if budget-related fields changed or lines changed

      if (
        data.items ||
        data.equipmentId !== undefined ||
        data.workOrderId !== undefined ||
        data.accountCodeId !== undefined ||
        data.projectId !== undefined ||
        data.budgetType !== undefined
      ) {
        // Recalculate total amount if lines changed
        const totalAmount = calculateTotalValue(
          updatedRequisition.lines.map((line) => ({
            id: line.id,
            requisitionId: line.requisitionId,
            lineType: (line as unknown as { lineType: string }).lineType as
              | "INVENTORY"
              | "SERVICE"
              | "CONSUMABLE",
            inventoryItemId: line.inventoryItemId,
            description: line.description,
            quantity: Number(line.quantity),
            unit: (line as unknown as { unit: string }).unit,
            estimatedPrice: Number(line.estimatedPrice),
            supplierId:
              (line as unknown as { supplierId: string | null }).supplierId ??
              null,
            workOrderId: null,
            notes: line.notes,
            createdAt: line.createdAt,
            updatedAt: line.updatedAt,
          })),
        );

        // Determine budget type and resolve account code if needed
        let budgetType:
          | "CHARGE_TO_ACCOUNT"
          | "CHARGE_TO_WORK_ORDER"
          | "CHARGE_TO_PROJECT"
          | "ADD_TO_REORDER" =
          data.budgetType ??
          updatedRequisition.budgetHeader?.budgetType ??
          "ADD_TO_REORDER";
        let accountCodeId: string | null =
          data.accountCodeId !== undefined
            ? (data.accountCodeId ?? null)
            : (updatedRequisition.budgetHeader?.accountCodeId ?? null);
        let workOrderId: string | null =
          data.workOrderId !== undefined
            ? (data.workOrderId ?? null)
            : (updatedRequisition.budgetHeader?.workOrderId ?? null);
        let projectId: string | null =
          data.projectId !== undefined
            ? (data.projectId ?? null)
            : (updatedRequisition.budgetHeader?.projectId ?? null);

        // Use budget resolution service if equipmentId or workOrderId provided
        // BUT only if budgetType was not explicitly provided by the user.
        // When the user explicitly sends budgetType, their intent must be respected —
        // do NOT auto-resolve and overwrite it.
        let resolvedProjectIdForUpdate: string | null = null;
        if ((data.equipmentId || data.workOrderId) && !data.budgetType) {
          const resolution = await budgetResolutionService.resolveBudget({
            equipmentId: data.equipmentId,
            workOrderId: data.workOrderId,
          });

          if (resolution.accountCodeId) {
            accountCodeId = resolution.accountCodeId;
            budgetType = "CHARGE_TO_ACCOUNT";
          } else if (data.workOrderId) {
            workOrderId = data.workOrderId;
            budgetType = "CHARGE_TO_WORK_ORDER";
          }
        } else if (
          data.budgetType === "CHARGE_TO_WORK_ORDER" &&
          data.workOrderId
        ) {
          // If budgetType is explicitly set to CHARGE_TO_WORK_ORDER, ensure workOrderId is set
          workOrderId = data.workOrderId;
          // Propagate the work order's projectId onto the budget header so the project
          // linkage is preserved when charging to a work order that belongs to a project.
          const woRecord = await tx.workOrder.findUnique({
            where: { id: data.workOrderId },
            select: { projectId: true },
          });
          resolvedProjectIdForUpdate = woRecord?.projectId ?? null;
        } else if (data.budgetType === "CHARGE_TO_PROJECT" && data.projectId) {
          // If budgetType is explicitly set to CHARGE_TO_PROJECT, ensure projectId is set
          projectId = data.projectId;
        }

        // For CHARGE_TO_PROJECT: resolve the project's accountCodeId for line allocations
        let projectAccountCodeId: string | null = null;
        if (budgetType === "CHARGE_TO_PROJECT" && projectId) {
          const project = await tx.project.findUnique({
            where: { id: projectId },
            select: { accountCodeId: true },
          });
          projectAccountCodeId = project?.accountCodeId ?? null;
        }

        // Compute and persist tax amount for this update.
        // Uses payload taxAmount if explicitly provided; otherwise recalculates from rate.
        const rawTaxAmountFromUpdate = (
          data as RequisitionUpdateDTO & { taxAmount?: number }
        ).taxAmount;
        const updatedTaxAmount =
          rawTaxAmountFromUpdate !== undefined
            ? enforceTaxAmount(rawTaxAmountFromUpdate, taxConfig)
            : calculateTaxAmount(totalAmount, taxConfig);

        // Always write taxAmount so it stays consistent with the new subtotal
        await tx.requisition.update({
          where: { id },
          data: { taxAmount: updatedTaxAmount },
        });

        // Update or create budget header
        if (updatedRequisition.budgetHeader) {
          await tx.requisitionBudgetHeader.update({
            where: { id: updatedRequisition.budgetHeader.id },
            data: {
              budgetType,
              accountCodeId:
                budgetType === "CHARGE_TO_PROJECT" ? null : accountCodeId,
              workOrderId:
                budgetType === "CHARGE_TO_PROJECT" ? null : workOrderId,
              // For CHARGE_TO_PROJECT: use the explicit projectId.
              // For CHARGE_TO_WORK_ORDER: propagate the work order's projectId (if any).
              // For all other types: null.
              projectId:
                budgetType === "CHARGE_TO_PROJECT"
                  ? projectId
                  : budgetType === "CHARGE_TO_WORK_ORDER"
                    ? resolvedProjectIdForUpdate
                    : null,
              totalAmount,
            },
          });
        } else {
          await tx.requisitionBudgetHeader.create({
            data: {
              requisitionId: id,
              budgetType,
              accountCodeId:
                budgetType === "CHARGE_TO_PROJECT" ? null : accountCodeId,
              workOrderId:
                budgetType === "CHARGE_TO_PROJECT" ? null : workOrderId,
              // For CHARGE_TO_PROJECT: use the explicit projectId.
              // For CHARGE_TO_WORK_ORDER: propagate the work order's projectId (if any).
              // For all other types: null.
              projectId:
                budgetType === "CHARGE_TO_PROJECT"
                  ? projectId
                  : budgetType === "CHARGE_TO_WORK_ORDER"
                    ? resolvedProjectIdForUpdate
                    : null,
              totalAmount,
              notes: null,
            },
          });
        }

        // For CHARGE_TO_PROJECT: create line allocations using the project's accountCodeId
        // (only when items were updated, since we already deleted old allocations above)
        // NOTE: Exclude preserved lines — their allocations were left untouched by reconciliation.
        if (
          data.items &&
          budgetType === "CHARGE_TO_PROJECT" &&
          projectAccountCodeId
        ) {
          const projectLineAllocations = updatedRequisition.lines
            .filter((line) => !preservedLineIds.has(line.id))
            .filter(
              (line) =>
                (line as unknown as { lineType: string }).lineType !==
                "INVENTORY",
            )
            .map((line) => {
              const lineAmount =
                Number(line.quantity) * Number(line.estimatedPrice);
              return {
                requisitionId: id,
                requisitionLineId: line.id,
                accountCodeId: projectAccountCodeId,
                departmentId: null as string | null,
                areaId: null as string | null,
                projectId: projectId,
                percentage: 100,
                amount: lineAmount,
                notes: null as string | null,
              };
            });

          if (projectLineAllocations.length > 0) {
            await tx.requisitionLineAllocation.createMany({
              data: projectLineAllocations,
              skipDuplicates: true,
            });
          }
        }

        // For CHARGE_TO_WORK_ORDER on a project WO: ALL line allocations must use
        // the project's CIP account code (e.g. 1580) and carry the project dimension.
        // Override any user-provided expense code — project costs are capitalized to CIP.
        // NOTE: This MUST stay inside the budget block above — it reads budgetType,
        // resolvedProjectIdForUpdate, and accountCodeId which are scoped to that block.
        if (
          budgetType === "CHARGE_TO_WORK_ORDER" &&
          resolvedProjectIdForUpdate &&
          accountCodeId
        ) {
          await tx.requisitionLineAllocation.updateMany({
            where: { requisitionId: id },
            data: {
              accountCodeId: accountCodeId, // Force project's CIP account code (e.g. 1580)
              projectId: resolvedProjectIdForUpdate,
              departmentId: null, // Projects supersede departments — clear dept
            },
          });
        }
      }

      // Fetch complete requisition with budget header
      const completeRequisition = await tx.requisition.findUnique({
        where: { id },
        include: buildRequisitionInclude(),
      });

      if (!completeRequisition) {
        throw new Error("Failed to update requisition with budget header");
      }

      return completeRequisition;
    });

    // Log the update with special note if requisition was reset from APPROVED to DRAFT
    // (only happens when the 10% price increase threshold is exceeded)
    const isNowDraft = requisition.approvalStatus === "DRAFT";

    // Build detailed change log with before/after values
    const changes: Array<{
      field: string;
      from: unknown;
      to: unknown;
      description: string;
    }> = [];

    if (
      data.description !== undefined &&
      data.description !== existingRequisition.description
    ) {
      changes.push({
        field: "description",
        from: existingRequisition.description,
        to: data.description,
        description: `Changed description from "${existingRequisition.description}" to "${data.description}"`,
      });
    }

    if (
      data.priority !== undefined &&
      data.priority !== existingRequisition.priority
    ) {
      changes.push({
        field: "priority",
        from: existingRequisition.priority,
        to: data.priority,
        description: `Changed priority from ${existingRequisition.priority} to ${data.priority}`,
      });
    }

    if (data.neededByDate !== undefined) {
      const existingDate = existingRequisition.neededByDate
        ?.toISOString()
        .split("T")[0];
      const newDate = data.neededByDate
        ? new Date(data.neededByDate).toISOString().split("T")[0]
        : null;
      if (existingDate !== newDate) {
        changes.push({
          field: "neededByDate",
          from: existingDate,
          to: newDate,
          description: `Changed needed by date from ${existingDate ?? "none"} to ${newDate ?? "none"}`,
        });
      }
    }

    if (
      data.justification !== undefined &&
      data.justification !== existingRequisition.justification
    ) {
      changes.push({
        field: "justification",
        from: existingRequisition.justification,
        to: data.justification,
        description: `Updated justification`,
      });
    }

    // Detailed line item changes
    if (data.items !== undefined) {
      const lineChanges: string[] = [];

      // Check for added/removed lines
      if (data.items.length > existingRequisition.lines.length) {
        const added = data.items.length - existingRequisition.lines.length;
        lineChanges.push(`Added ${added} line item${added > 1 ? "s" : ""}`);
      } else if (data.items.length < existingRequisition.lines.length) {
        const removed = existingRequisition.lines.length - data.items.length;
        lineChanges.push(
          `Removed ${removed} line item${removed > 1 ? "s" : ""}`,
        );
      }

      // Check for modified lines — match by ID to avoid false diffs when
      // Postgres returns lines in a different order than the form sends them.
      const existingLinesById = new Map(
        existingRequisition.lines.map((l) => [l.id, l]),
      );

      data.items.forEach((item, idx) => {
        // Existing lines carry their DB UUID; new lines (no id) are additions handled above.
        const existingLine = item.id
          ? existingLinesById.get(item.id)
          : undefined;
        if (!existingLine) return;

        const lineNum = idx + 1;

        if (item.description !== existingLine.description) {
          lineChanges.push(
            `Line ${lineNum}: Changed description from "${existingLine.description}" to "${item.description}"`,
          );
        }

        if (item.quantity !== Number(existingLine.quantity)) {
          lineChanges.push(
            `Line ${lineNum}: Changed quantity from ${existingLine.quantity} to ${item.quantity}`,
          );
        }

        if (item.estimatedPrice !== Number(existingLine.estimatedPrice)) {
          lineChanges.push(
            `Line ${lineNum}: Changed price from $${Number(existingLine.estimatedPrice).toFixed(2)} to $${item.estimatedPrice.toFixed(2)}`,
          );
        }

        if (item.unit && item.unit !== existingLine.unit) {
          lineChanges.push(
            `Line ${lineNum}: Changed unit from ${existingLine.unit} to ${item.unit}`,
          );
        }
      });

      if (lineChanges.length > 0) {
        changes.push({
          field: "items",
          from: existingRequisition.lines.length,
          to: data.items.length,
          description: lineChanges.join("; "),
        });
      }
    }

    // Extract just field names for backward compatibility
    const changedFields = changes.map((c) => c.field);

    await auditLogService.logCrudOperation(
      context,
      AuditAction.UPDATE,
      "Requisition",
      id,
      requisition.reqNumber,
      {
        status: existingRequisition.status,
        approvalStatus: existingRequisition.approvalStatus,
        itemCount: existingRequisition.lines.length,
      },
      {
        status: requisition.status,
        approvalStatus: requisition.approvalStatus,
        itemCount: requisition.lines.length,
      },
      {
        action:
          needsReApproval && isNowDraft
            ? "requisition_reset_to_draft"
            : "requisition_updated",
        changes: changedFields,
        detailedChanges: changes,
        resetFromApproved: needsReApproval && isNowDraft,
        tenPercentRuleApplied: needsReApproval,
      },
    );

    return transformRequisition(requisition);
  }

  /**
   * Get requisitions pending approval
   */
  async getPendingApproval(
    context: ServiceContext,
  ): Promise<RequisitionWithRelations[]> {
    await this.checkCrudPermission(context, PermissionAction.READ);

    const requisitions = await this.prisma.requisition.findMany({
      where: { status: RequisitionStatus.SUBMITTED },
      include: buildRequisitionInclude(),
      orderBy: { createdAt: "asc" },
    });

    return requisitions.map((req) => transformRequisition(req));
  }

  /**
   * Delete a requisition (only if in Draft status and user is ADMIN)
   */
  async delete(context: ServiceContext, id: string): Promise<void> {
    await this.checkCrudPermission(context, PermissionAction.DELETE);

    // Only ADMIN users can delete requisitions
    if (context.userRole !== RoleName.ADMIN) {
      throw new AuthorizationError(
        "Only administrators can delete requisitions",
      );
    }

    validateRequired(id, "id");

    const requisition = await this.prisma.requisition.findUnique({
      where: { id },
    });

    if (!requisition) {
      throw new NotFoundError("Requisition", id);
    }

    // B6-3: Only allow deletion of Draft or Cancelled requisitions
    if (requisition.status !== "Draft" && requisition.status !== "Cancelled") {
      throw new BadRequestError(
        `Cannot delete requisition in "${requisition.status}" status. Only Draft or Cancelled requisitions can be deleted.`,
      );
    }

    await this.prisma.requisition.delete({
      where: { id },
    });

    await auditLogService.logCrudOperation(
      context,
      AuditAction.DELETE,
      "Requisition",
      id,
      requisition.reqNumber,
      {
        status: requisition.status,
      },
      {},
      {
        action: "requisition_deleted",
        reqNumber: requisition.reqNumber,
      },
    );
  }

  // ============================================================================
  // TRANSPARENCY METHODS - For Work Order Part Reservation
  // ============================================================================

  /**
   * Find all open requisitions containing a specific inventory item
   * Open = Draft, Pending (Submitted), Approved (not yet ordered)
   */
  async findOpenRequisitionsByItem(
    context: ServiceContext,
    inventoryItemId: string,
  ): Promise<RequisitionWithRelations[]> {
    await this.checkCrudPermission(context, PermissionAction.READ);

    validateRequired(inventoryItemId, "inventoryItemId");

    const requisitions = await this.prisma.requisition.findMany({
      where: {
        status: {
          in: ["Draft", "Submitted", "Approved"],
        },
        lines: {
          some: {
            inventoryItemId,
          },
        },
      },
      include: buildRequisitionInclude(),
      orderBy: { createdAt: "desc" },
    });

    return requisitions.map((req) => transformRequisition(req));
  }

  /**
   * Get summary of open requisitions for an inventory item
   * Returns total quantity on order, total cost, and affected work orders
   */
  async getRequisitionSummary(
    context: ServiceContext,
    inventoryItemId: string,
  ): Promise<{
    totalQuantityOnOrder: number;
    totalEstimatedCost: number;
    requisitionCount: number;
    affectedWorkOrders: Array<{ id: string; woNumber: string }>;
  }> {
    await this.checkCrudPermission(context, PermissionAction.READ);

    validateRequired(inventoryItemId, "inventoryItemId");

    const requisitions = await this.findOpenRequisitionsByItem(
      context,
      inventoryItemId,
    );

    let totalQuantityOnOrder = 0;
    let totalEstimatedCost = 0;
    const workOrderSet = new Set<string>();
    const workOrderMap = new Map<string, string>();

    for (const req of requisitions) {
      for (const line of req.lines) {
        if (line.inventoryItemId === inventoryItemId) {
          const quantity = Number(line.quantity) || 0;
          const price = Number(line.estimatedPrice) || 0;
          totalQuantityOnOrder += quantity;
          totalEstimatedCost += quantity * price;
        }
      }

      // Track work orders from budget headers
      if (req.budgetHeader?.workOrderId && req.budgetHeader.workOrder) {
        workOrderSet.add(req.budgetHeader.workOrderId);
        workOrderMap.set(
          req.budgetHeader.workOrderId,
          req.budgetHeader.workOrder.woNumber,
        );
      }
    }

    const affectedWorkOrders = Array.from(workOrderSet).map((id) => ({
      id,
      woNumber: workOrderMap.get(id) ?? "Unknown",
    }));

    return {
      totalQuantityOnOrder,
      totalEstimatedCost,
      requisitionCount: requisitions.length,
      affectedWorkOrders,
    };
  }

  /**
   * Cancel requisitions for a specific work order + item combination
   * Used when creating a new requisition to replace old ones
   */
  async cancelRequisitionsForWorkOrderItem(
    context: ServiceContext,
    workOrderId: string,
    inventoryItemId: string,
    reason: string,
  ): Promise<{
    cancelledCount: number;
    cancelledRequisitionIds: string[];
  }> {
    await this.checkCrudPermission(context, PermissionAction.UPDATE);

    validateRequired(workOrderId, "workOrderId");
    validateRequired(inventoryItemId, "inventoryItemId");
    validateRequired(reason, "reason");

    // Find requisitions to cancel
    const requisitionsToCancel = await this.prisma.requisition.findMany({
      where: {
        status: {
          in: ["Draft", "Submitted", "Approved"],
        },
        budgetHeader: {
          workOrderId,
        },
        lines: {
          some: {
            inventoryItemId,
          },
        },
      },
      include: {
        lines: true,
      },
    });

    if (requisitionsToCancel.length === 0) {
      return {
        cancelledCount: 0,
        cancelledRequisitionIds: [],
      };
    }

    // Cancel each requisition
    const cancelledIds: string[] = [];
    for (const req of requisitionsToCancel) {
      // CRITICAL: Reverse GL entries if requisition was approved
      // This prevents phantom encumbrances from permanently reserving budget
      if (req.approvalStatus === "APPROVED") {
        try {
          const glTransactions = await this.prisma.gLTransaction.findMany({
            where: {
              referenceType: "Requisition",
              referenceId: req.id,
              status: "POSTED",
            },
          });

          for (const glTxn of glTransactions) {
            await glReversalService.reverseTransaction(
              glTxn.id,
              `Requisition cancelled via work order item cancellation`,
              context.userId,
            );
          }

          if (glTransactions.length > 0) {
            logger.info(
              `[Requisition Cancel] Reversed ${glTransactions.length} GL transaction(s) for requisition ${req.id} due to work order item cancellation`,
            );
          }
        } catch (glError) {
          logger.error(
            `[Requisition Cancel] GL reversal failed for requisition ${req.id}: ${glError instanceof Error ? glError.message : String(glError)}`,
          );
          // Non-fatal — don't fail the cancellation
        }
      }

      await this.prisma.requisition.update({
        where: { id: req.id },
        data: {
          status: RequisitionStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: context.userId,
          rejectionReason: reason,
        },
      });

      cancelledIds.push(req.id);

      // Log cancellation
      await auditLogService.logCrudOperation(
        context,
        AuditAction.UPDATE,
        "Requisition",
        req.id,
        req.reqNumber,
        { status: req.status },
        { status: RequisitionStatus.CANCELLED },
        {
          action: "requisition_cancelled_for_replacement",
          reason,
          workOrderId,
          inventoryItemId,
        },
      );
    }

    return {
      cancelledCount: cancelledIds.length,
      cancelledRequisitionIds: cancelledIds,
    };
  }

  /**
   * Create a new requisition and cancel old ones for the same work order + item
   * Transactional operation to ensure data consistency
   */
  async createWithCancellation(
    context: ServiceContext,
    data: RequisitionCreateDTO & {
      equipmentId?: string;
      workOrderId?: string;
      accountCodeId?: string;
      projectId?: string | null;
      budgetType?:
        | "CHARGE_TO_ACCOUNT"
        | "CHARGE_TO_WORK_ORDER"
        | "CHARGE_TO_PROJECT"
        | "ADD_TO_REORDER";
      supplierId?: string;
    },
    cancellationReason: string,
  ): Promise<{
    requisition: RequisitionWithRelations;
    cancelledCount: number;
    cancelledRequisitionIds: string[];
  }> {
    await this.checkCrudPermission(context, PermissionAction.CREATE);

    // Use transaction to ensure atomicity
    return await this.prisma.$transaction(async (tx) => {
      // Find and cancel old requisitions if workOrderId is provided
      let cancelledCount = 0;
      const cancelledRequisitionIds: string[] = [];

      if (data.workOrderId) {
        // Find all inventory items in the new requisition
        const inventoryItemIds = data.items
          .filter((item) => item.inventoryItemId)
          .map((item) => item.inventoryItemId as string);

        if (inventoryItemIds.length > 0) {
          // Find requisitions to cancel
          const requisitionsToCancel = await tx.requisition.findMany({
            where: {
              status: {
                in: ["Draft", "Submitted", "Approved"],
              },
              budgetHeader: {
                workOrderId: data.workOrderId,
              },
              lines: {
                some: {
                  inventoryItemId: {
                    in: inventoryItemIds,
                  },
                },
              },
            },
          });

          // Cancel each requisition
          for (const req of requisitionsToCancel) {
            // CRITICAL: Reverse GL entries if requisition was approved
            // This prevents phantom encumbrances from permanently reserving budget
            if (req.approvalStatus === "APPROVED") {
              try {
                const glTransactions = await this.prisma.gLTransaction.findMany(
                  {
                    where: {
                      referenceType: "Requisition",
                      referenceId: req.id,
                      status: "POSTED",
                    },
                  },
                );

                for (const glTxn of glTransactions) {
                  await glReversalService.reverseTransaction(
                    glTxn.id,
                    `Requisition cancelled for replacement via createWithCancellation`,
                    context.userId,
                  );
                }

                if (glTransactions.length > 0) {
                  logger.info(
                    `[Requisition Cancel] Reversed ${glTransactions.length} GL transaction(s) for requisition ${req.id} due to replacement cancellation`,
                  );
                }
              } catch (glError) {
                logger.error(
                  `[Requisition Cancel] GL reversal failed for requisition ${req.id}: ${glError instanceof Error ? glError.message : String(glError)}`,
                );
                // Non-fatal — don't fail the cancellation
              }
            }

            await tx.requisition.update({
              where: { id: req.id },
              data: {
                status: RequisitionStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledBy: context.userId,
                rejectionReason: cancellationReason,
              },
            });

            cancelledRequisitionIds.push(req.id);

            // Log cancellation
            await auditLogService.logCrudOperation(
              context,
              AuditAction.UPDATE,
              "Requisition",
              req.id,
              req.reqNumber,
              { status: req.status },
              { status: RequisitionStatus.CANCELLED },
              {
                action: "requisition_cancelled_for_replacement",
                reason: cancellationReason,
                workOrderId: data.workOrderId,
                inventoryItemIds,
              },
            );
          }

          cancelledCount = requisitionsToCancel.length;
        }
      }

      // Create new requisition within the outer transaction.
      // IMPORTANT: Do NOT swap this.prisma on the singleton — that pattern is
      // NOT thread-safe and can corrupt concurrent requests.
      // Instead, create a dedicated service instance scoped to this transaction.
      const txService = new RequisitionService(tx as PrismaClient);
      const requisition = await txService.create(context, data);

      return {
        requisition,
        cancelledCount,
        cancelledRequisitionIds,
      };
    });
  }
}

const globalForRequisition = globalThis as unknown as {
  requisitionService: RequisitionService | undefined;
};
export const requisitionService =
  globalForRequisition.requisitionService ??
  (globalForRequisition.requisitionService = new RequisitionService(prisma));
