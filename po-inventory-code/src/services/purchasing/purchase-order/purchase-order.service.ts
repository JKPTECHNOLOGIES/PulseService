/**
 * Purchase Order Service - Core CRUD Operations
 *
 * Responsibilities:
 * - List purchase orders with pagination
 * - Get single purchase order by ID
 * - Create new purchase orders
 * - Update existing purchase orders
 * - Delete draft purchase orders
 *
 * Does NOT handle:
 * - Workflow operations (see purchase-order-workflow.service.ts)
 * - Receiving operations (see purchase-order-receiving.service.ts)
 * - Statistics (see purchase-order-statistics.service.ts)
 */

import { PrismaClient, Prisma, LineItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ServiceContext } from "@/types/service-types";
import { reconcileLines } from "@/utils/reconcile-lines";
import { PaginatedResponse } from "@/types/api";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";
import {
  checkAnyPermission,
  checkPermission,
} from "@/services/shared/permissions";
import { validateRequired } from "@/services/shared/validation";
import { calculatePagination, buildOrderBy } from "@/lib/query-helpers";
import { NotFoundError, BadRequestError } from "@/lib/api-errors";
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";

import {
  PurchaseOrderCreateDTO,
  PurchaseOrderUpdateDTO,
  PurchaseOrderItemDTO,
  PurchaseOrderWithRelations,
  PurchaseOrderStatus,
} from "./purchase-order.types";

import { supplierAddressService } from "@/services/purchasing/supplier-address.service";

import {
  validatePOCreate,
  validatePOUpdate,
} from "./purchase-order-validation";

import {
  generatePONumber,
  calculateItemTotal,
  calculatePOTotal,
  transformPurchaseOrder,
  buildPOInclude,
  buildPOListInclude,
  fetchWorkOrdersForRequisitions,
  fetchRequisitionsWithBudget,
} from "./purchase-order-utils";

import { detectPOChanges, POData } from "./purchase-order-change-detection";
import { financeSettingsService } from "@/services/finance/finance-settings.service";

/**
 * Map a line item DTO to Prisma create input
 * Handles all three line types: INVENTORY, SERVICE, CONSUMABLE
 */
function mapLineItemToPrisma(
  item: PurchaseOrderCreateDTO["items"][0],
  requisitionLineId?: string | null,
): Prisma.POLineCreateWithoutPurchaseOrderInput {
  const inventoryItemId =
    "inventoryItemId" in item ? item.inventoryItemId : null;

  // Set invoice matching flags based on line type
  // SERVICE lines require invoice match and cannot be received until approved
  // INVENTORY and CONSUMABLE lines can be received immediately
  const requiresInvoiceMatch = item.lineType === "SERVICE";
  const canReceive = item.lineType !== "SERVICE";

  // ──────────────────────────────────────────────────────────────────────
  // SERVICE-line invariant (M-021 / PO-1640 fix):
  //   For SERVICE lines we enforce the documented convention
  //     quantity  = total dollar amount (rounded to 2 dp)
  //     unitPrice = 1
  //     totalPrice = quantity × unitPrice = total dollars
  //
  //   This guarantees `quantity × unitPrice === totalPrice` at every read,
  //   which the receive UI relies on to render "Ordered" and "Line Total"
  //   consistent with the PO header and the invoice. Without normalization,
  //   any upstream rounding (req conversion, supplier import, manual entry
  //   with fractional unit price) can leave the trio inconsistent and
  //   produce the famous "$0.08 off" display.
  //
  //   For non-SERVICE lines we keep the caller's qty/unit verbatim because
  //   inventory/consumable purchases legitimately have unit-of-measure
  //   semantics (e.g. 50 EA × $1.234567).
  // ──────────────────────────────────────────────────────────────────────
  const rawTotal = calculateItemTotal(item.quantity, item.unitPrice);
  const isService = item.lineType === "SERVICE";
  // Round dollar amount to 2 dp at the storage boundary
  const serviceDollars = Math.round(rawTotal * 100) / 100;
  const normalizedQuantity = isService ? serviceDollars : item.quantity;
  const normalizedUnitPrice = isService ? 1 : item.unitPrice;
  const normalizedTotalPrice = isService ? serviceDollars : rawTotal;

  const baseFields = {
    // item.lineType is Zod-validated to be one of the LineItemType string values
    lineType: item.lineType as LineItemType,
    inventoryItemId: inventoryItemId ?? null,
    description: item.description,
    quantity: normalizedQuantity,
    unitPrice: normalizedUnitPrice,
    unitOfMeasure: item.unitOfMeasure ?? null,
    totalPrice: normalizedTotalPrice,
    notes: item.notes ?? null,
    // PO-specific copy of material long text. null = fall back to inventoryItem.longText on print.
    longTextOverride: item.longTextOverride ?? null,
    deliveryDate: item.deliveryDate ? new Date(item.deliveryDate) : null,
    requiresInvoiceMatch,
    invoiceMatched: false,
    canReceive,
    // Link POLine back to the req line so GL + budget resolution can find it by ID
    requisitionLineId: requisitionLineId ?? null,
  };

  // Type-specific fields
  if (item.lineType === "SERVICE") {
    return {
      ...baseFields,
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
      serviceWorkOrderId: item.serviceWorkOrderId ?? null,
      hourlyRate: item.hourlyRate ?? null,
      estimatedHours: item.estimatedHours ?? null,
      contractNumber: item.contractNumber ?? null,
      slaDetails: item.slaDetails ?? null,
      deliverables: item.deliverables ?? null,
      consumableCategory: null,
      manufacturer: null,
      modelNumber: null,
      packageSize: null,
      monthlyUsageRate: null,
      storageRequirements: null,
      sdsRequired: false,
      expirationTracking: false,
    };
  } else if (item.lineType === "CONSUMABLE") {
    return {
      ...baseFields,
      serviceType: null,
      serviceProvider: null,
      serviceStartDate: null,
      serviceEndDate: null,
      serviceLocation: null,
      serviceEquipmentId: null,
      serviceWorkOrderId: null,
      hourlyRate: null,
      estimatedHours: null,
      contractNumber: null,
      slaDetails: null,
      deliverables: null,
      consumableCategory: item.consumableCategory ?? null,
      manufacturer: item.manufacturer ?? null,
      modelNumber: item.modelNumber ?? null,
      packageSize: item.packageSize ?? null,
      monthlyUsageRate: item.monthlyUsageRate ?? null,
      storageRequirements: item.storageRequirements ?? null,
      sdsRequired: item.sdsRequired ?? false,
      expirationTracking: item.expirationTracking ?? false,
    };
  } else if (item.lineType === "REPAIRABLE_RETURN") {
    // REPAIRABLE_RETURN: physical part returning from vendor repair.
    // canReceive = true, requiresInvoiceMatch = false (already set in baseFields above).
    // Quantity is the repair cost amount (treated as 1 unit), no SERVICE dollar-mode normalization.
    // repairableItemId is backfilled after PO creation by convertToPO — not in the DTO here.
    return {
      ...baseFields,
      serviceType: null,
      serviceProvider: null,
      serviceStartDate: null,
      serviceEndDate: null,
      serviceLocation: null,
      serviceEquipmentId: null,
      serviceWorkOrderId: null,
      hourlyRate: null,
      estimatedHours: null,
      contractNumber: null,
      slaDetails: null,
      deliverables: null,
      consumableCategory: null,
      manufacturer: null,
      modelNumber: null,
      packageSize: null,
      monthlyUsageRate: null,
      storageRequirements: null,
      sdsRequired: false,
      expirationTracking: false,
    };
  } else {
    // INVENTORY / NON_STOCK
    return {
      ...baseFields,
      serviceType: null,
      serviceProvider: null,
      serviceStartDate: null,
      serviceEndDate: null,
      serviceLocation: null,
      serviceEquipmentId: null,
      serviceWorkOrderId: null,
      hourlyRate: null,
      estimatedHours: null,
      contractNumber: null,
      slaDetails: null,
      deliverables: null,
      consumableCategory: null,
      manufacturer: null,
      modelNumber: null,
      packageSize: null,
      monthlyUsageRate: null,
      storageRequirements: null,
      sdsRequired: false,
      expirationTracking: false,
    };
  }
}

/**
 * Purchase Order Service - Core CRUD Operations
 */
class PurchaseOrderService {
  private prisma: PrismaClient;
  /** Legacy umbrella resource — kept for special actions (approve, send, etc.) */
  private readonly resource = PermissionResource.PURCHASING;
  /** Specific resource used in the permission matrix UI */
  private readonly specificResource = PermissionResource.PURCHASE_ORDERS;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Check a CRUD permission, accepting EITHER the specific purchase_orders resource
   * OR the legacy umbrella purchasing resource.
   * This ensures the permission matrix (which shows purchase_orders:* separately)
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
   * List purchase orders with pagination, filtering, and sorting
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
  ): Promise<PaginatedResponse<PurchaseOrderWithRelations>> {
    await this.checkCrudPermission(context, PermissionAction.READ);

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const { skip, take } = calculatePagination(page, limit);

    const where: Prisma.PurchaseOrderWhereInput = {};

    // Apply basic filters
    const filters = options?.filters;
    if (filters?.status) {
      const statusStr = filters.status as string;
      if (statusStr.includes(",")) {
        where.status = { in: statusStr.split(",").map((s) => s.trim()) };
      } else {
        where.status = statusStr;
      }
    }
    if (filters?.supplierId) where.supplierId = filters.supplierId as string;
    if (filters?.requisitionId) {
      where.requisitionIds = {
        has: filters.requisitionId as string,
      };
    }

    // Date range filters
    if (filters?.dateFrom || filters?.dateTo) {
      where.orderDate = {};
      if (filters.dateFrom) {
        where.orderDate.gte = new Date(filters.dateFrom as string);
      }
      if (filters.dateTo) {
        where.orderDate.lte = new Date(filters.dateTo as string);
      }
    }

    // Amount range filters
    if (filters?.minAmount || filters?.maxAmount) {
      where.totalAmount = {};
      if (filters.minAmount) {
        where.totalAmount.gte = parseFloat(filters.minAmount as string);
      }
      if (filters.maxAmount) {
        where.totalAmount.lte = parseFloat(filters.maxAmount as string);
      }
    }

    // Purchasing Manager (buyer) filter — only active when buyerAssignmentEnabled flag is on.
    // Maps to PurchaseOrder.buyerId. When flag is off this filter is never sent from the
    // UI, so existing clients are completely unaffected.
    if (filters?.buyerId) {
      where.buyerId = filters.buyerId as string;
    }

    // Outstanding orders filter — open POs where the expected delivery date has passed.
    // Activated by the Outstanding preset in the filter panel (outstanding="true").
    // When NOT selected the filter object doesn't include this key, so existing behavior
    // is preserved for all clients that don't use this filter.
    if (filters?.outstanding === "true") {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      // Override any status filter — outstanding means open statuses only
      where.status = { in: ["Approved", "Ordered", "PartiallyReceived"] };
      // Only POs where the expected delivery date has passed
      where.expectedDate = { lt: today };
    }

    // Enhanced search across multiple fields
    if (options?.search) {
      const searchTerm = options.search;
      where.OR = [
        { poNumber: { contains: searchTerm, mode: "insensitive" } },
        { notes: { contains: searchTerm, mode: "insensitive" } },
        { vendorName: { contains: searchTerm, mode: "insensitive" } },
        { supplier: { name: { contains: searchTerm, mode: "insensitive" } } },
        { supplier: { code: { contains: searchTerm, mode: "insensitive" } } },
        {
          lines: {
            some: {
              description: { contains: searchTerm, mode: "insensitive" },
            },
          },
        },
      ];
    }

    const orderBy = options?.sort
      ? buildOrderBy(options.sort, options.order ?? "asc")
      : { orderDate: "desc" as const };

    // PERFORMANCE: Use the lightweight list include — omits chargeAllocations,
    // inventoryItem.stock, and supplier.addresses which are only needed on the
    // detail view.  For a page of 20 POs with 10 lines each this eliminates
    // ~1 100 unnecessary JOIN operations vs buildPOInclude().
    const include = buildPOListInclude();

    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include,
        skip,
        take,
        orderBy,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    const transformedItems = items.map((item) => transformPurchaseOrder(item));
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
   * Get a single purchase order by ID
   */
  async getById(
    context: ServiceContext,
    id: string,
  ): Promise<PurchaseOrderWithRelations> {
    await this.checkCrudPermission(context, PermissionAction.READ);

    validateRequired(id, "id");

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: buildPOInclude(),
    });

    if (!po) {
      throw new NotFoundError("PurchaseOrder", id);
    }

    const transformed = transformPurchaseOrder(po);

    // Fetch work order and budget information if this PO was created from requisitions
    if (transformed.requisitionIds.length > 0) {
      const [workOrders, requisitions] = await Promise.all([
        fetchWorkOrdersForRequisitions(this.prisma, transformed.requisitionIds),
        fetchRequisitionsWithBudget(this.prisma, transformed.requisitionIds),
      ]);

      transformed.workOrders = workOrders;
      transformed.requisitions = requisitions;
    }

    return transformed;
  }

  /**
   * Create a new purchase order
   */
  async create(
    context: ServiceContext,
    data: PurchaseOrderCreateDTO,
  ): Promise<PurchaseOrderWithRelations> {
    // PO creation is intentionally restricted to dedicated PO-creator roles
    // (Admin, Finance Manager, Plant Manager, Purchasing Manager). Unlike the
    // other CRUD actions on this service, CREATE must require the specific
    // `purchase_orders:create` permission and must NOT accept the broad
    // `purchasing:create` (which the wider procurement workforce holds for
    // requisitions). This mirrors the route-layer gate so the restriction is
    // enforced even if `create()` is reached via another service (e.g.
    // convertToPO) rather than only the POST route.
    await checkPermission(
      context,
      buildPermissionString(this.specificResource, PermissionAction.CREATE),
    );

    // Validate data using extracted validation
    await validatePOCreate(data, this.prisma);

    // Generate PO number using utility
    const poNumber = await generatePONumber(this.prisma);

    // Map line items using extracted function, assigning sequential lineNumber
    const lines = data.items.map((item, index) => ({
      ...mapLineItemToPrisma(item),
      lineNumber: index + 1,
    }));

    // Calculate total - cast to expected type for utility function
    const totalAmount = calculatePOTotal(
      lines as unknown as { totalPrice: number }[],
      data.shippingCost,
      data.tax,
    );

    // "On behalf of" substitution: if onBehalfOfId is provided, that person becomes
    // the record owner (createdBy). The actual session user is captured for audit only.
    const actualCreatorId = context.userId;
    const ownerUserId = data.onBehalfOfId ?? context.userId;

    const createData = {
      poNumber,
      supplierId: data.supplierId,
      status: PurchaseOrderStatus.DRAFT,
      orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
      expectedDate: data.expectedDeliveryDate
        ? new Date(data.expectedDeliveryDate)
        : null,
      totalAmount,
      notes: data.notes ?? null,
      deliveryTerms: data.deliveryTerms ?? null,
      createdBy: ownerUserId,
      invoiceApproverId: data.invoiceApproverId ?? null,
      // Ship-To override snapshot (null = printed PO falls back to company address)
      shipToName: data.shipToName ?? null,
      shipToAttention: data.shipToAttention ?? null,
      shipToAddress1: data.shipToAddress1 ?? null,
      shipToAddress2: data.shipToAddress2 ?? null,
      shipToCity: data.shipToCity ?? null,
      shipToState: data.shipToState ?? null,
      shipToZip: data.shipToZip ?? null,
      shipToCountry: data.shipToCountry ?? null,
      lines: {
        create: lines,
      },
    };

    const po = await this.prisma.purchaseOrder.create({
      data: createData,
      include: buildPOInclude(),
    });

    await auditLogService.logCrudOperation(
      context,
      AuditAction.CREATE,
      "PurchaseOrder",
      po.id,
      po.poNumber,
      {},
      {
        status: po.status,
        supplierId: po.supplierId,
        totalAmount: Number(po.totalAmount),
        itemCount: po.lines.length,
      },
      {
        action: "po_created",
        poNumber: po.poNumber,
        ...(data.onBehalfOfId
          ? {
              proxyCreatedBy: actualCreatorId,
              onBehalfOfId: data.onBehalfOfId,
              note: `Created by proxy user on behalf of record owner`,
            }
          : {}),
      },
    );

    return transformPurchaseOrder(po);
  }

  /**
   * Update an existing purchase order
   *
   * IMPORTANT: This method now enforces financial change detection.
   * If financial changes are detected (supplier, prices, quantities, line items),
   * the update will be REJECTED with a clear error message directing the user
   * to use the cancel-for-edit workflow instead.
   */
  async update(
    context: ServiceContext,
    id: string,
    data: PurchaseOrderUpdateDTO,
  ): Promise<PurchaseOrderWithRelations> {
    await this.checkCrudPermission(context, PermissionAction.UPDATE);

    validateRequired(id, "id");

    // Validate update using extracted validation
    await validatePOUpdate(id, data, this.prisma);

    const existingPO = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            chargeAllocations: true,
          },
          // Stable ordering matches the in-transaction fetch (line 875) so that
          // any positional fallback in the change-detection loop stays consistent.
          orderBy: { createdAt: "asc" },
        },
        supplier: true,
        buyer: true,
      },
    });

    if (!existingPO) {
      throw new NotFoundError("PurchaseOrder", id);
    }

    // CRITICAL: Detect financial changes before allowing update
    // Build POData objects for comparison
    const originalPOData: POData = {
      supplierId: existingPO.supplierId,
      totalAmount: Number(existingPO.totalAmount), // Convert Decimal to number
      shippingCost: data.shippingCost ?? 0, // Schema doesn't have this field, use from update data
      taxAmount: data.tax ?? 0, // Schema doesn't have this field, use from update data
      notes: existingPO.notes,
      orderDate: existingPO.orderDate,
      expectedDate: existingPO.expectedDate,
      lines: existingPO.lines.map((line) => ({
        id: line.id,
        inventoryItemId: line.inventoryItemId,
        description: line.description,
        quantity: Number(line.quantity), // Convert Decimal to number
        unitPrice: Number(line.unitPrice), // Convert Decimal to number
        totalPrice: Number(line.totalPrice), // Convert Decimal to number
        notes: line.notes,
        deliveryDate: line.deliveryDate,
      })),
    };

    // Calculate updated total if items are provided
    let updatedTotalAmount = Number(existingPO.totalAmount);
    if (data.items) {
      const lines = data.items.map((item) => ({
        totalPrice: calculateItemTotal(item.quantity, item.unitPrice),
      }));
      updatedTotalAmount = calculatePOTotal(lines, data.shippingCost, data.tax);
    }

    const updatedPOData: POData = {
      supplierId: data.supplierId ?? existingPO.supplierId,
      totalAmount: updatedTotalAmount,
      shippingCost: data.shippingCost ?? 0,
      taxAmount: data.tax ?? 0,
      notes: data.notes ?? existingPO.notes,
      orderDate: data.orderDate ?? existingPO.orderDate,
      expectedDate: data.expectedDeliveryDate ?? existingPO.expectedDate,
      lines: data.items
        ? data.items.map((item) => ({
            id: item.id,
            inventoryItemId:
              "inventoryItemId" in item ? item.inventoryItemId : null,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: calculateItemTotal(item.quantity, item.unitPrice),
            notes: item.notes ?? null,
            deliveryDate: item.deliveryDate ?? null,
          }))
        : originalPOData.lines,
    };

    // Fetch auto-approval threshold AND the configured variance percentage from
    // FinanceSettings. Re-approval is only required when BOTH the percentage
    // increase exceeds the variance threshold AND the new total exceeds the
    // auto-approval threshold. Both values must come from settings — never
    // hard-coded — so admins can tune the policy without a code change.
    const [autoApprovalThreshold, thresholdPercent] = await Promise.all([
      financeSettingsService.getAutoApprovalThreshold(),
      financeSettingsService.getPoVarianceThreshold(),
    ]);

    // Detect changes
    const changeDetection = detectPOChanges(
      originalPOData,
      updatedPOData,
      autoApprovalThreshold,
      thresholdPercent,
    );

    // REJECT update if financial changes are detected AND PO is not in DRAFT status
    // Allow financial changes for DRAFT POs, but block them for APPROVED/ORDERED/etc
    if (
      changeDetection.requiresCancellation &&
      existingPO.status !== PurchaseOrderStatus.DRAFT
    ) {
      throw new BadRequestError(
        `Cannot directly update PO ${existingPO.poNumber} - Financial changes detected.\n\n` +
          `${changeDetection.changesSummary}\n\n` +
          `Financial changes:\n${changeDetection.financialChanges.map((c) => `  • ${c}`).join("\n")}\n\n` +
          `To make these changes:\n` +
          `1. Use the "Cancel for Edit" action to cancel this PO\n` +
          `2. The linked requisitions will be reset to DRAFT status\n` +
          `3. Re-approve the requisitions with the new requirements\n` +
          `4. A new PO will be created with the updated information\n\n` +
          `This workflow ensures proper approval for all financial changes.`,
      );
    }

    // If we reach here, only non-financial changes were detected - proceed with update

    // Track detailed changes for audit log
    const changes: Array<{
      field: string;
      from: unknown;
      to: unknown;
      description: string;
    }> = [];

    const updateData: Prisma.PurchaseOrderUncheckedUpdateInput = {};

    if (
      data.supplierId !== undefined &&
      data.supplierId !== existingPO.supplierId
    ) {
      const newSupplier = await this.prisma.supplier.findUnique({
        where: { id: data.supplierId },
        select: {
          name: true,
          billingAddress: true,
          billingAddress2: true,
          billingCity: true,
          billingState: true,
          billingZip: true,
          billingCountry: true,
        },
      });
      changes.push({
        field: "supplierId",
        from: existingPO.supplierId,
        to: data.supplierId,
        description: `Changed supplier from "${existingPO.supplier.name}" to "${newSupplier?.name ?? "Unknown"}"`,
      });
      updateData.supplierId = data.supplierId;
      // When the supplier changes, update the vendorName snapshot so the PDF reflects
      // the new supplier. Only set vendorName here; the full address snapshot is handled
      // separately when supplierAddressId also changes.
      if (newSupplier) {
        updateData.vendorName = newSupplier.name;
        // If there is no supplierAddressId being changed, also refresh address from
        // the new supplier's billing address so the PDF isn't showing a stale address.
        if (data.supplierAddressId === undefined) {
          updateData.vendorAddress1 = newSupplier.billingAddress ?? null;
          updateData.vendorAddress2 = newSupplier.billingAddress2 ?? null;
          updateData.vendorCity = newSupplier.billingCity ?? null;
          updateData.vendorState = newSupplier.billingState ?? null;
          updateData.vendorZip = newSupplier.billingZip ?? null;
          updateData.vendorCountry = newSupplier.billingCountry ?? null;
        }
      }
    }

    if (data.orderDate !== undefined) {
      const newDate = new Date(data.orderDate);
      if (newDate.getTime() !== existingPO.orderDate.getTime()) {
        changes.push({
          field: "orderDate",
          from: existingPO.orderDate.toISOString(),
          to: newDate.toISOString(),
          description: `Changed order date from "${existingPO.orderDate.toLocaleDateString()}" to "${newDate.toLocaleDateString()}"`,
        });
        updateData.orderDate = newDate;
      }
    }

    if (data.expectedDeliveryDate !== undefined) {
      const newExpectedDate = data.expectedDeliveryDate
        ? new Date(data.expectedDeliveryDate)
        : null;
      const oldExpectedDate = existingPO.expectedDate;
      if (
        (newExpectedDate?.getTime() ?? null) !==
        (oldExpectedDate?.getTime() ?? null)
      ) {
        changes.push({
          field: "expectedDate",
          from: oldExpectedDate?.toISOString() ?? null,
          to: newExpectedDate?.toISOString() ?? null,
          description: `Changed expected delivery from "${oldExpectedDate?.toLocaleDateString() ?? "Not set"}" to "${newExpectedDate?.toLocaleDateString() ?? "Not set"}"`,
        });
        updateData.expectedDate = newExpectedDate;
      }
    }

    if (data.notes !== undefined && data.notes !== existingPO.notes) {
      changes.push({
        field: "notes",
        from: existingPO.notes,
        to: data.notes,
        description: `Changed notes`,
      });
      updateData.notes = data.notes;
    }

    if (
      data.deliveryTerms !== undefined &&
      data.deliveryTerms !== existingPO.deliveryTerms
    ) {
      changes.push({
        field: "deliveryTerms",
        from: existingPO.deliveryTerms,
        to: data.deliveryTerms,
        description: `Changed delivery terms`,
      });
      updateData.deliveryTerms = data.deliveryTerms;
    }

    if (data.paymentTermsOverride !== undefined) {
      const newOverride = data.paymentTermsOverride ?? null;
      const oldOverride =
        ((existingPO as unknown as Record<string, unknown>)
          .paymentTermsOverride as string | null) ?? null;
      if (newOverride !== oldOverride) {
        changes.push({
          field: "paymentTermsOverride",
          from: oldOverride,
          to: newOverride,
          description: newOverride
            ? `Set payment terms override: "${newOverride}"`
            : `Cleared payment terms override (reverted to vendor default)`,
        });
        updateData.paymentTermsOverride = newOverride;
      }
    }

    if (data.buyerId !== undefined) {
      const newBuyerId = data.buyerId ?? null;
      const oldBuyerId = existingPO.buyerId ?? null;
      if (newBuyerId !== oldBuyerId) {
        changes.push({
          field: "buyerId",
          from: oldBuyerId,
          to: newBuyerId,
          description: `Changed buyer`,
        });
        // Use scalar FK directly for reliable update (UncheckedUpdateInput)
        updateData.buyerId = newBuyerId;
      }
    }

    if (data.invoiceApproverId !== undefined) {
      const newInvoiceApproverId = data.invoiceApproverId ?? null;
      const oldInvoiceApproverId = existingPO.invoiceApproverId ?? null;
      if (newInvoiceApproverId !== oldInvoiceApproverId) {
        changes.push({
          field: "invoiceApproverId",
          from: oldInvoiceApproverId,
          to: newInvoiceApproverId,
          description: `Changed invoice approver`,
        });
        updateData.invoiceApproverId = newInvoiceApproverId;
      }
    }

    // Handle supplierAddressId: snapshot the address fields onto the PO
    if (data.supplierAddressId !== undefined) {
      const newAddressId = data.supplierAddressId ?? null;
      const oldAddressId = existingPO.supplierAddressId ?? null;
      if (newAddressId !== oldAddressId) {
        changes.push({
          field: "supplierAddressId",
          from: oldAddressId,
          to: newAddressId,
          description: `Changed supplier address for PDF`,
        });
        if (newAddressId) {
          // Snapshot the chosen address fields onto the PO
          const snapshot =
            await supplierAddressService.snapshotForPO(newAddressId);
          updateData.supplierAddressId = newAddressId;
          updateData.vendorName = snapshot.vendorName;
          updateData.vendorAddress1 = snapshot.vendorAddress1;
          updateData.vendorAddress2 = snapshot.vendorAddress2;
          updateData.vendorCity = snapshot.vendorCity;
          updateData.vendorState = snapshot.vendorState;
          updateData.vendorZip = snapshot.vendorZip;
          updateData.vendorCountry = snapshot.vendorCountry;
        } else {
          // Clear the snapshot fields when address is cleared
          updateData.supplierAddressId = null;
          updateData.vendorName = null;
          updateData.vendorAddress1 = null;
          updateData.vendorAddress2 = null;
          updateData.vendorCity = null;
          updateData.vendorState = null;
          updateData.vendorZip = null;
          updateData.vendorCountry = null;
        }
      }
    }

    // ─── Ship-To override snapshot ─────────────────────────────────────────
    // Persist any provided ship-to field. When the resulting snapshot is all
    // null/blank the printed PO reverts to the default company address.
    {
      const shipToKeys = [
        "shipToName",
        "shipToAttention",
        "shipToAddress1",
        "shipToAddress2",
        "shipToCity",
        "shipToState",
        "shipToZip",
        "shipToCountry",
      ] as const;

      const incoming = data as unknown as Record<
        string,
        string | null | undefined
      >;
      const existing = existingPO as unknown as Record<string, string | null>;
      let shipToChanged = false;

      for (const key of shipToKeys) {
        if (incoming[key] === undefined) continue;
        const next = incoming[key] ?? null;
        const prev = existing[key] ?? null;
        if (next !== prev) {
          shipToChanged = true;
          (updateData as Record<string, string | null>)[key] = next;
        }
      }

      if (shipToChanged) {
        const describe = (
          name: string | null | undefined,
          addr1: string | null | undefined,
          city: string | null | undefined,
          state: string | null | undefined,
        ): string => {
          const locality = [city, state].filter(Boolean).join(", ");
          const parts = [name, addr1, locality].filter(Boolean);
          return parts.length ? parts.join(" — ") : "Default (company address)";
        };
        const merged = (key: string): string | null => {
          const inc = incoming[key];
          if (inc !== undefined) return inc ?? null;
          return existing[key] ?? null;
        };
        const fromDesc = describe(
          existing.shipToName,
          existing.shipToAddress1,
          existing.shipToCity,
          existing.shipToState,
        );
        const toDesc = describe(
          merged("shipToName"),
          merged("shipToAddress1"),
          merged("shipToCity"),
          merged("shipToState"),
        );
        changes.push({
          field: "shipTo",
          from: fromDesc,
          to: toDesc,
          description: `Changed Ship To address from "${fromDesc}" to "${toDesc}"`,
        });
      }
    }

    if (data.items) {
      // Track line item changes for audit log
      const oldLineCount = existingPO.lines.length;
      const newLineCount = data.items.length;

      if (oldLineCount !== newLineCount) {
        changes.push({
          field: "lineCount",
          from: oldLineCount,
          to: newLineCount,
          description: `Changed line item count from ${oldLineCount} to ${newLineCount}`,
        });
      }

      // Track individual line changes using ID-based matching.
      // The existingPO fetch may return lines in heap order (Postgres makes
      // no ordering guarantee without an ORDER BY). Comparing by array index
      // produces false diffs whenever lines come back in a different order
      // than the edit form sends them (e.g. after a supplier change).
      // Build a lookup map so each incoming line is compared against its
      // actual existing counterpart regardless of array position.
      const existingLinesById = new Map(existingPO.lines.map((l) => [l.id, l]));
      const matchedExistingIds = new Set<string>();

      data.items.forEach((newItem, index) => {
        // Existing lines always carry their DB UUID via mapLineItemToAPIFormat.
        // Truly new lines (not yet persisted) have no id and go to the "added" branch.
        const oldItem = newItem.id
          ? existingLinesById.get(newItem.id)
          : undefined;
        const lineLabel = `Line ${index + 1}`;

        if (oldItem) {
          matchedExistingIds.add(oldItem.id);
          if (Number(newItem.quantity) !== Number(oldItem.quantity)) {
            changes.push({
              field: `line${index + 1}.quantity`,
              from: Number(oldItem.quantity),
              to: Number(newItem.quantity),
              description: `${lineLabel}: Changed quantity from ${oldItem.quantity} to ${newItem.quantity}`,
            });
          }
          if (Number(newItem.unitPrice) !== Number(oldItem.unitPrice)) {
            changes.push({
              field: `line${index + 1}.unitPrice`,
              from: Number(oldItem.unitPrice),
              to: Number(newItem.unitPrice),
              description: `${lineLabel}: Changed unit price from $${Number(oldItem.unitPrice).toFixed(2)} to $${Number(newItem.unitPrice).toFixed(2)}`,
            });
          }
          if (newItem.description !== oldItem.description) {
            changes.push({
              field: `line${index + 1}.description`,
              from: oldItem.description,
              to: newItem.description,
              description: `${lineLabel}: Changed description`,
            });
          }
        } else {
          // No matching existing line by ID → new line being added
          changes.push({
            field: `line${index + 1}`,
            from: null,
            to: newItem.description,
            description: `Added new line item: ${newItem.description}`,
          });
        }
      });

      // Track removed lines: existing lines not matched by any incoming item
      for (const existingLine of existingPO.lines) {
        if (!matchedExistingIds.has(existingLine.id)) {
          changes.push({
            field: `line`,
            from: existingLine.description,
            to: null,
            description: `Removed line item: ${existingLine.description}`,
          });
        }
      }
      // Calculate total amount for header update
      const lineTotals = data.items.map((item) => ({
        totalPrice: calculateItemTotal(item.quantity, item.unitPrice),
      }));
      updateData.totalAmount = calculatePOTotal(
        lineTotals,
        data.shippingCost,
        data.tax,
      );
    }

    // ====================================================================
    // Execute update inside a transaction to handle line reconciliation
    //
    // Instead of deleteMany + create (which destroys UUIDs, severs
    // requisition cross-links, and cascade-deletes receipts/returns/
    // invoice matches), we reconcile existing vs incoming lines using a
    // 3-way merge: UPDATE matched lines, CREATE new lines, DELETE removed
    // lines (only when guards allow).
    //
    // @see docs/destructive-update-fix-architecture.md — Section 2 & 3.2
    // ====================================================================
    const po = await this.prisma.$transaction(async (tx) => {
      if (data.items) {
        // 1. Fetch existing PO lines with all dependencies for guard checks
        const existingPOLines = await tx.pOLine.findMany({
          where: { purchaseOrderId: id },
          include: {
            chargeAllocations: true,
            receipts: { select: { id: true } },
            returns: { select: { id: true } },
            invoiceLineItems: { select: { id: true } },
          },
          orderBy: { createdAt: "asc" },
        });

        type ExistingPOLine = (typeof existingPOLines)[number];

        // 2. Compute the reconciliation plan
        const reconciliation = reconcileLines<
          ExistingPOLine,
          PurchaseOrderItemDTO
        >(existingPOLines, data.items, {
          getIncomingId: (item) => item.id,

          protectedFields: [
            "requisitionLineId",
            "requisitionId",
            "requisitionNumber",
            "workOrderId",
            "workOrderNumber",
            "receivedQuantity",
            "receivedAmount",
            "approvedUnitPrice",
            "approvedTotalPrice",
            "approvedInvoiceAmount",
            "requiresInvoiceMatch",
            "invoiceMatched",
            "canReceive",
            "createdAt",
          ] as Array<keyof ExistingPOLine>,

          canDelete: (line) => {
            if (Number(line.receivedQuantity) > 0) {
              return {
                allowed: false,
                reason: `Cannot delete line "${line.description}" — ${line.receivedQuantity} units already received`,
              };
            }
            if (line.receipts.length > 0) {
              return {
                allowed: false,
                reason: `Cannot delete line "${line.description}" — has ${line.receipts.length} receipt record(s)`,
              };
            }
            if (line.returns.length > 0) {
              return {
                allowed: false,
                reason: `Cannot delete line "${line.description}" — has ${line.returns.length} return(s)`,
              };
            }
            if (line.invoiceLineItems.length > 0) {
              return {
                allowed: false,
                reason: `Cannot delete line "${line.description}" — matched to ${line.invoiceLineItems.length} invoice line(s)`,
              };
            }
            return { allowed: true };
          },

          toCreateInput: (item) =>
            mapLineItemToPrisma(item) as unknown as Record<string, unknown>,

          toUpdateInput: (item) =>
            mapLineItemToPrisma(item) as unknown as Record<string, unknown>,
        });

        // Log warnings for preserved lines (e.g. lines with receipts/returns)
        if (reconciliation.warnings.length > 0) {
          logger.warn(
            `[PO Update] Line reconciliation warnings for ${id}: ` +
              reconciliation.warnings.join("; "),
          );
        }

        logger.info(
          `[PO Update] Reconciled lines for PO ${existingPO.poNumber} (${id}): ` +
            `${reconciliation.updates.length} updated, ` +
            `${reconciliation.creates.length} created, ` +
            `${reconciliation.deletes.length} deleted, ` +
            `${reconciliation.preserved.length} preserved`,
        );

        // 3. Execute DELETEs — clear req line cross-refs, delete allocations, then lines
        if (reconciliation.deletes.length > 0) {
          const deleteIds = reconciliation.deletes.map((d) => d.id);

          // Clear requisition line cross-references so they can be re-converted
          await tx.requisitionLine.updateMany({
            where: { poLineId: { in: deleteIds } },
            data: {
              poLineId: null,
              purchaseOrderId: null,
              purchaseOrderNumber: null,
              lineStatus: "PENDING",
              convertedToPOAt: null,
              convertedToPOBy: null,
            },
          });

          // Delete charge allocations (belt + suspenders — cascade should handle this)
          await tx.pOLineChargeAllocation.deleteMany({
            where: { poLineId: { in: deleteIds } },
          });

          // Delete the PO lines
          await tx.pOLine.deleteMany({
            where: { id: { in: deleteIds } },
          });
        }

        // 4. Execute UPDATEs — in-place, preserving UUIDs and protected fields
        for (const update of reconciliation.updates) {
          await tx.pOLine.update({
            where: { id: update.id },
            data: update.data,
          });
        }

        // 5. Execute CREATEs — new PO lines
        // Determine the highest existing lineNumber so new lines continue sequentially
        const maxLineNumber = existingPOLines.reduce(
          (max, l) =>
            Math.max(max, (l as unknown as { lineNumber: number }).lineNumber),
          0,
        );
        for (let ci = 0; ci < reconciliation.creates.length; ci++) {
          const createInput = reconciliation.creates[ci];
          await tx.pOLine.create({
            data: {
              ...createInput,
              purchaseOrderId: id,
              lineNumber: maxLineNumber + ci + 1,
            } as Prisma.POLineUncheckedCreateInput,
          });
        }

        // 6. Recalculate charge allocation amounts for updated lines whose totals changed.
        //    Updated lines keep their existing allocations in the DB (not cascade-deleted).
        //    We only need to adjust amounts when the line total changes.
        const existingById = new Map(existingPOLines.map((l) => [l.id, l]));

        // Build a mapping from line ID → incoming item (ID-based only — no positional fallback — M-027)
        const lineIdToIncoming = new Map<string, PurchaseOrderItemDTO>();
        for (const item of data.items) {
          if (item.id && existingById.has(item.id)) {
            lineIdToIncoming.set(item.id, item);
          }
        }

        for (const update of reconciliation.updates) {
          const existingLine = existingById.get(update.id);
          if (!existingLine?.chargeAllocations.length) continue;

          const incomingItem = lineIdToIncoming.get(update.id);
          if (!incomingItem) continue;

          const newLineTotal = calculateItemTotal(
            incomingItem.quantity,
            incomingItem.unitPrice,
          );
          const oldLineTotal = Number(existingLine.totalPrice);

          if (Math.abs(newLineTotal - oldLineTotal) > 0.001) {
            // Recalculate allocation amounts based on new line total
            for (const alloc of existingLine.chargeAllocations) {
              const percentage =
                typeof alloc.percentage === "object"
                  ? (
                      alloc.percentage as unknown as { toNumber(): number }
                    ).toNumber()
                  : Number(alloc.percentage);
              await tx.pOLineChargeAllocation.update({
                where: { id: alloc.id },
                data: {
                  amount: newLineTotal * (percentage / 100),
                },
              });
            }
          }
        }
      }

      // Update the PO header (and fetch the result with all includes)
      return await tx.purchaseOrder.update({
        where: { id },
        data: updateData,
        include: buildPOInclude(),
      });
    });

    await auditLogService.logCrudOperation(
      context,
      AuditAction.UPDATE,
      "PurchaseOrder",
      id,
      po.poNumber,
      {
        status: existingPO.status,
        totalAmount: Number(existingPO.totalAmount),
        itemCount: existingPO.lines.length,
      },
      {
        status: po.status,
        totalAmount: Number(po.totalAmount),
        itemCount: po.lines.length,
      },
      {
        action: "po_updated",
        changes: Object.keys(data),
        detailedChanges: changes.length > 0 ? changes : undefined,
      },
    );

    return transformPurchaseOrder(po);
  }

  /**
   * Delete a purchase order (only if in Draft status)
   */
  async delete(context: ServiceContext, id: string): Promise<void> {
    await this.checkCrudPermission(context, PermissionAction.DELETE);

    validateRequired(id, "id");

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po) {
      throw new NotFoundError("PurchaseOrder", id);
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestError("Only draft purchase orders can be deleted");
    }

    await this.prisma.purchaseOrder.delete({
      where: { id },
    });

    await auditLogService.logCrudOperation(
      context,
      AuditAction.DELETE,
      "PurchaseOrder",
      id,
      po.poNumber,
      {
        status: po.status,
        totalAmount: Number(po.totalAmount),
      },
      {},
      {
        action: "po_deleted",
        poNumber: po.poNumber,
      },
    );
  }
}

const globalForPurchaseOrder = globalThis as unknown as {
  purchaseOrderService: PurchaseOrderService | undefined;
};
export const purchaseOrderService =
  globalForPurchaseOrder.purchaseOrderService ??
  (globalForPurchaseOrder.purchaseOrderService = new PurchaseOrderService(
    prisma,
  ));
