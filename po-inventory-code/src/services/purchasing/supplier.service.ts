/**
 * Supplier Service - Refactored
 *
 * Complete rewrite using new patterns:
 * - No base class inheritance
 * - Direct Prisma usage with proper typing
 * - Utility functions for common operations
 * - Zero type safety violations
 * - Proper Decimal handling
 * - Auto-generates internal vendor codes
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateNextVendorCode } from "@/lib/vendor-code-generator";

// Audit logging
import { auditLogService } from "@/services/audit/audit.service";
import { AuditAction } from "@/services/audit/audit.types";

// New type system
import { ServiceContext } from "@/types/service-types";
import { PaginatedResponse } from "@/types/api";
import {
  PermissionResource,
  buildPermissionString,
  PermissionAction,
} from "@/types/permissions";

// New utility functions
import { checkAnyPermission } from "@/services/shared/permissions";
import {
  validateRequired,
  validateOrThrow,
} from "@/services/shared/validation";
import {
  calculatePagination,
  buildOrderBy,
  buildSearchWhere,
} from "@/lib/query-helpers";
import { toNumber } from "@/lib/decimal-helpers";

// Type definitions
import {
  SupplierCreateDTO,
  SupplierUpdateDTO,
  SupplierWithRelations,
  SupplierStats,
  SupplierRatingUpdateDTO,
  SupplierDeactivateDTO,
  supplierCreateSchema,
  supplierUpdateSchema,
} from "./supplier.types";

// Error types
import {
  ValidationError,
  NotFoundError,
  BadRequestError,
} from "@/lib/api-errors";
import { notifySupplierCreated } from "./supplier-notifications.service";

/**
 * Supplier Service Class
 *
 * Refactored service with:
 * - No inheritance from base class
 * - Direct Prisma operations
 * - Proper type safety throughout
 * - Utility function composition
 */
class SupplierServiceV2 {
  private prisma: PrismaClient;
  /** Legacy umbrella resource — kept for special actions */
  private readonly resource = PermissionResource.PURCHASING;
  /** Specific resource used in the permission matrix UI */
  private readonly specificResource = PermissionResource.SUPPLIERS;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Accept EITHER suppliers:* (the specific resource shown in the matrix) OR
   * the legacy purchasing:* umbrella.
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

  // ============================================================================
  // CORE CRUD OPERATIONS
  // ============================================================================

  /**
   * List suppliers with pagination, filtering, and sorting
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
  ): Promise<PaginatedResponse<SupplierWithRelations>> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.READ);

    // Build pagination
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const { skip, take } = calculatePagination(page, limit);

    // Build where clause
    const where: Prisma.SupplierWhereInput = {
      ...options?.filters,
    };

    // Add search filter if provided
    if (options?.search) {
      const searchWhere = buildSearchWhere(options.search, [
        "name",
        "code",
        "internalVendorCode",
        "contactPerson",
        "email",
      ]);
      Object.assign(where, searchWhere);
    }

    // Build order by
    const orderBy = options?.sort
      ? buildOrderBy(options.sort, options.order ?? "asc")
      : { name: "asc" as const };

    // Build include clause
    const include: Prisma.SupplierInclude = {
      purchaseOrders: options?.include?.includes("purchaseOrders") ?? false,
      inventoryItems: options?.include?.includes("inventoryItems") ?? false,
    };

    // Execute query
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include,
        skip,
        take,
        orderBy,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    // Transform items
    const transformedItems = items.map((item) => this.transformSupplier(item));

    // Calculate pagination
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
   * Get a single supplier by ID
   */
  async getById(
    context: ServiceContext,
    id: string,
    include?: string[],
  ): Promise<SupplierWithRelations> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.READ);

    // Validate ID
    validateRequired(id, "id");

    // Build include clause
    const includeClause: Prisma.SupplierInclude = {
      purchaseOrders: include?.includes("purchaseOrders") ?? false,
      inventoryItems: include?.includes("inventoryItems") ?? false,
    };

    // Fetch supplier
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: includeClause,
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", id);
    }

    return this.transformSupplier(supplier);
  }

  /**
   * Create a new supplier
   */
  async create(
    context: ServiceContext,
    data: SupplierCreateDTO,
  ): Promise<SupplierWithRelations> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.CREATE);

    // Validate data
    await this.validateCreate(data);

    // Generate internal vendor code
    const internalVendorCode = await generateNextVendorCode(this.prisma);

    // Prepare create data
    const createData: Prisma.SupplierCreateInput = {
      // Basic Information
      name: data.name,
      code: data.code?.trim() ? data.code.trim() : null,
      internalVendorCode, // Auto-generated, immutable
      contactPerson: data.contactPerson ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      fax: data.fax ?? null,
      website: data.website ?? null,

      // Billing Address
      billingAddress: data.billingAddress ?? null,
      billingAddress2: data.billingAddress2 ?? null,
      billingCity: data.billingCity ?? null,
      billingState: data.billingState ?? null,
      billingZip: data.billingZip ?? null,
      billingCountry: data.billingCountry ?? "USA",

      // Shipping Address
      shippingAddress: data.shippingAddress ?? null,
      shippingAddress2: data.shippingAddress2 ?? null,
      shippingCity: data.shippingCity ?? null,
      shippingState: data.shippingState ?? null,
      shippingZip: data.shippingZip ?? null,
      shippingCountry: data.shippingCountry ?? "USA",

      // Financial Information
      taxId: data.taxId ?? null,
      ein: data.ein ?? null,
      paymentTerms: data.paymentTerms ?? null,
      paymentMethod: data.paymentMethod ?? null,
      creditLimit: data.creditLimit ?? null,
      creditTermsDays: data.creditTermsDays ?? null,
      discountPercent: data.discountPercent ?? null,

      // Performance & Ratings
      rating: data.rating ?? null,
      onTimeDeliveryRate: data.onTimeDeliveryRate ?? null,
      qualityRating: data.qualityRating ?? null,

      // Operational
      leadTimeDays: data.leadTimeDays ?? null,
      minimumOrderAmount: data.minimumOrderAmount ?? null,
      shippingMethod: data.shippingMethod ?? null,
      accountNumber: data.accountNumber ?? null,
      notes: data.notes ?? null,
      isSupplier: data.isSupplier,
      isContractor: data.isContractor,
      defaultRate: data.defaultRate ?? null,
      rateUnit: data.rateUnit ?? null,
      isActive: true,
      ...(data.parentSupplierId && {
        parentSupplier: {
          connect: { id: data.parentSupplierId },
        },
      }),
    };

    // Create supplier
    const supplier = await this.prisma.supplier.create({
      data: createData,
      include: {
        purchaseOrders: true,
        inventoryItems: true,
      },
    });

    // Log audit
    await auditLogService.logCrudOperation(
      context,
      AuditAction.CREATE,
      "Supplier",
      supplier.id,
      supplier.name,
      undefined,
      {
        name: supplier.name,
        code: supplier.code,
        isActive: supplier.isActive,
      },
    );

    // Notify Finance Manager + Purchasing Manager + Admin that a new vendor was added
    void notifySupplierCreated(context, {
      id: supplier.id,
      name: supplier.name,
      internalVendorCode: supplier.internalVendorCode,
      isSupplier: supplier.isSupplier,
      isContractor: supplier.isContractor,
    });

    return this.transformSupplier(supplier);
  }

  /**
   * Update an existing supplier
   */
  async update(
    context: ServiceContext,
    id: string,
    data: SupplierUpdateDTO,
  ): Promise<SupplierWithRelations> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.UPDATE);

    // Validate ID
    validateRequired(id, "id");

    // Validate update data
    await this.validateUpdate(id, data);

    // Prepare update data - build the object dynamically
    const updateData: Record<string, unknown> = {};

    // Basic Information
    if (data.name !== undefined) updateData.name = data.name;
    if (data.code !== undefined)
      updateData.code = data.code?.trim() ? data.code.trim() : null;
    if (data.contactPerson !== undefined)
      updateData.contactPerson = data.contactPerson;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.fax !== undefined) updateData.fax = data.fax;
    if (data.website !== undefined) updateData.website = data.website;

    // Billing Address
    if (data.billingAddress !== undefined)
      updateData.billingAddress = data.billingAddress;
    if (data.billingAddress2 !== undefined)
      updateData.billingAddress2 = data.billingAddress2;
    if (data.billingCity !== undefined)
      updateData.billingCity = data.billingCity;
    if (data.billingState !== undefined)
      updateData.billingState = data.billingState;
    if (data.billingZip !== undefined) updateData.billingZip = data.billingZip;
    if (data.billingCountry !== undefined)
      updateData.billingCountry = data.billingCountry;

    // Shipping Address
    if (data.shippingAddress !== undefined)
      updateData.shippingAddress = data.shippingAddress;
    if (data.shippingAddress2 !== undefined)
      updateData.shippingAddress2 = data.shippingAddress2;
    if (data.shippingCity !== undefined)
      updateData.shippingCity = data.shippingCity;
    if (data.shippingState !== undefined)
      updateData.shippingState = data.shippingState;
    if (data.shippingZip !== undefined)
      updateData.shippingZip = data.shippingZip;
    if (data.shippingCountry !== undefined)
      updateData.shippingCountry = data.shippingCountry;

    // Financial Information
    if (data.taxId !== undefined) updateData.taxId = data.taxId;
    if (data.ein !== undefined) updateData.ein = data.ein;
    if (data.paymentTerms !== undefined)
      updateData.paymentTerms = data.paymentTerms;
    if (data.paymentMethod !== undefined)
      updateData.paymentMethod = data.paymentMethod;
    if (data.creditLimit !== undefined)
      updateData.creditLimit = data.creditLimit;
    if (data.creditTermsDays !== undefined)
      updateData.creditTermsDays = data.creditTermsDays;
    if (data.discountPercent !== undefined)
      updateData.discountPercent = data.discountPercent;

    // Performance & Ratings
    if (data.rating !== undefined) updateData.rating = data.rating;
    if (data.onTimeDeliveryRate !== undefined)
      updateData.onTimeDeliveryRate = data.onTimeDeliveryRate;
    if (data.qualityRating !== undefined)
      updateData.qualityRating = data.qualityRating;

    // Operational
    if (data.leadTimeDays !== undefined)
      updateData.leadTimeDays = data.leadTimeDays;
    if (data.minimumOrderAmount !== undefined)
      updateData.minimumOrderAmount = data.minimumOrderAmount;
    if (data.shippingMethod !== undefined)
      updateData.shippingMethod = data.shippingMethod;
    if (data.accountNumber !== undefined)
      updateData.accountNumber = data.accountNumber;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.isSupplier !== undefined) updateData.isSupplier = data.isSupplier;
    if (data.isContractor !== undefined)
      updateData.isContractor = data.isContractor;
    if (data.defaultRate !== undefined)
      updateData.defaultRate = data.defaultRate;
    if (data.rateUnit !== undefined) updateData.rateUnit = data.rateUnit;
    if (data.parentSupplierId !== undefined)
      updateData.parentSupplierId = data.parentSupplierId;

    // Sanitize: ensure code is null (not empty string) to avoid unique constraint violations
    if (
      "code" in updateData &&
      typeof updateData.code === "string" &&
      updateData.code.trim() === ""
    ) {
      updateData.code = null;
    }

    // Get existing supplier for audit
    const existingSupplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    // Update supplier
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: updateData as Prisma.SupplierUpdateInput,
      include: {
        purchaseOrders: true,
        inventoryItems: true,
      },
    });

    // Log audit
    if (existingSupplier) {
      await auditLogService.logCrudOperation(
        context,
        AuditAction.UPDATE,
        "Supplier",
        id,
        supplier.name,
        {
          name: existingSupplier.name,
          isActive: existingSupplier.isActive,
          rating: existingSupplier.rating,
        },
        {
          name: supplier.name,
          isActive: supplier.isActive,
          rating: supplier.rating,
        },
      );
    }

    return this.transformSupplier(supplier);
  }

  /**
   * Delete a supplier (only if no open purchase orders)
   */
  async delete(context: ServiceContext, id: string): Promise<void> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.DELETE);

    // Validate ID
    validateRequired(id, "id");

    // Get supplier
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", id);
    }

    // Check for open purchase orders
    const openPOs = await this.prisma.purchaseOrder.count({
      where: {
        supplierId: id,
        status: {
          in: [
            "Draft",
            "Submitted",
            "Approved",
            "Ordered",
            "PartiallyReceived",
          ],
        },
      },
    });

    if (openPOs > 0) {
      throw new BadRequestError(
        `Cannot delete supplier with ${openPOs} open purchase order(s). Please close or cancel purchase orders first.`,
      );
    }

    // Delete supplier
    await this.prisma.supplier.delete({
      where: { id },
    });

    // Log audit
    await auditLogService.logCrudOperation(
      context,
      AuditAction.DELETE,
      "Supplier",
      id,
      supplier.name,
      {
        name: supplier.name,
        code: supplier.code,
        isActive: supplier.isActive,
      },
      undefined,
    );
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate supplier creation data
   */
  private async validateCreate(data: SupplierCreateDTO): Promise<void> {
    // Validate with Zod schema
    validateOrThrow(supplierCreateSchema, data);

    // Check name uniqueness
    const existingByName = await this.prisma.supplier.findUnique({
      where: { name: data.name },
    });

    if (existingByName) {
      throw new ValidationError("Validation failed", [
        {
          field: "name",
          message: `Supplier with name "${data.name}" already exists`,
          code: "DUPLICATE_NAME",
        },
      ]);
    }

    // Check code uniqueness if provided
    if (data.code) {
      const existingByCode = await this.prisma.supplier.findUnique({
        where: { code: data.code },
      });

      if (existingByCode) {
        throw new ValidationError("Validation failed", [
          {
            field: "code",
            message: `Supplier with code "${data.code}" already exists`,
            code: "DUPLICATE_CODE",
          },
        ]);
      }
    }
  }

  /**
   * Validate supplier update data
   */
  private async validateUpdate(
    id: string,
    data: SupplierUpdateDTO,
  ): Promise<void> {
    // Validate with Zod schema
    validateOrThrow(supplierUpdateSchema, data);

    // Get existing supplier
    const existingSupplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!existingSupplier) {
      throw new NotFoundError("Supplier", id);
    }

    // Prevent changes to internalVendorCode (immutable once assigned)
    if ("internalVendorCode" in data) {
      if (
        existingSupplier.internalVendorCode &&
        data.internalVendorCode !== existingSupplier.internalVendorCode
      ) {
        throw new ValidationError("Validation failed", [
          {
            field: "internalVendorCode",
            message: "Internal vendor code cannot be changed once assigned",
            code: "IMMUTABLE_FIELD",
          },
        ]);
      }
    }

    // Check name uniqueness if being changed
    if (data.name) {
      const existingByName = await this.prisma.supplier.findUnique({
        where: { name: data.name },
      });

      if (existingByName && existingByName.id !== id) {
        throw new ValidationError("Validation failed", [
          {
            field: "name",
            message: `Supplier with name "${data.name}" already exists`,
            code: "DUPLICATE_NAME",
          },
        ]);
      }
    }

    // Check code uniqueness if being changed
    if (data.code) {
      const existingByCode = await this.prisma.supplier.findUnique({
        where: { code: data.code },
      });

      if (existingByCode && existingByCode.id !== id) {
        throw new ValidationError("Validation failed", [
          {
            field: "code",
            message: `Supplier with code "${data.code}" already exists`,
            code: "DUPLICATE_CODE",
          },
        ]);
      }
    }
  }

  // ============================================================================
  // TRANSFORMATION METHODS
  // ============================================================================

  /**
   * Transform Prisma supplier to API response format
   * Converts Decimal types to numbers for JSON serialization
   */
  private transformSupplier(supplier: unknown): SupplierWithRelations {
    const s = supplier as Record<string, unknown>;

    return {
      ...s,
      // Convert Decimal fields to numbers
      defaultRate: s.defaultRate ? toNumber(s.defaultRate as number) : null,
      creditLimit: s.creditLimit ? toNumber(s.creditLimit as number) : null,
      discountPercent: s.discountPercent
        ? toNumber(s.discountPercent as number)
        : null,
      onTimeDeliveryRate: s.onTimeDeliveryRate
        ? toNumber(s.onTimeDeliveryRate as number)
        : null,
      qualityRating: s.qualityRating
        ? toNumber(s.qualityRating as number)
        : null,
      minimumOrderAmount: s.minimumOrderAmount
        ? toNumber(s.minimumOrderAmount as number)
        : null,

      // Transform related entities
      purchaseOrders: s.purchaseOrders
        ? (s.purchaseOrders as Array<Record<string, unknown>>).map((po) => ({
            ...po,
            totalAmount: toNumber(po.totalAmount as number),
          }))
        : [],
      inventoryItems: s.inventoryItems
        ? (s.inventoryItems as Array<Record<string, unknown>>).map((item) => ({
            ...item,
            unitCost: toNumber(item.unitCost as number),
            minQuantity: toNumber(item.minQuantity as number) ?? 0,
            maxQuantity: toNumber(item.maxQuantity as number) ?? 0,
          }))
        : [],
    } as unknown as SupplierWithRelations;
  }

  // ============================================================================
  // BUSINESS LOGIC METHODS
  // ============================================================================

  /**
   * Activate supplier
   */
  async activate(
    context: ServiceContext,
    id: string,
  ): Promise<SupplierWithRelations> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.UPDATE);

    // Validate ID
    validateRequired(id, "id");

    // Get supplier
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", id);
    }

    if (supplier.isActive) {
      throw new BadRequestError("Supplier is already active");
    }

    // Update status
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { isActive: true },
      include: {
        purchaseOrders: true,
        inventoryItems: true,
      },
    });

    return this.transformSupplier(updated);
  }

  /**
   * Deactivate supplier
   */
  async deactivate(
    context: ServiceContext,
    id: string,
    data: SupplierDeactivateDTO,
  ): Promise<SupplierWithRelations> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.UPDATE);

    // Validate ID
    validateRequired(id, "id");

    // Get supplier
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", id);
    }

    if (!supplier.isActive) {
      throw new BadRequestError("Supplier is already inactive");
    }

    // Check for open purchase orders
    const openPOs = await this.prisma.purchaseOrder.count({
      where: {
        supplierId: id,
        status: {
          in: [
            "Draft",
            "Submitted",
            "Approved",
            "Ordered",
            "PartiallyReceived",
          ],
        },
      },
    });

    if (openPOs > 0) {
      throw new BadRequestError(
        `Cannot deactivate supplier with ${openPOs} open purchase order(s)`,
      );
    }

    // Record the deactivation reason in notes WITHOUT destroying any existing
    // notes (append a dated entry instead of overwriting).
    const deactivationEntry = `[Deactivated ${new Date().toISOString().slice(0, 10)}] ${data.reason}`;
    const combinedNotes = supplier.notes
      ? `${supplier.notes}\n\n${deactivationEntry}`
      : deactivationEntry;

    // Update status
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        isActive: false,
        notes: combinedNotes,
      },
      include: {
        purchaseOrders: true,
        inventoryItems: true,
      },
    });

    return this.transformSupplier(updated);
  }

  /**
   * Update supplier rating
   */
  async updateRating(
    context: ServiceContext,
    id: string,
    data: SupplierRatingUpdateDTO,
  ): Promise<SupplierWithRelations> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.UPDATE);

    // Validate ID
    validateRequired(id, "id");

    // Get supplier
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", id);
    }

    // Update rating
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        rating: data.rating,
        notes: data.notes ?? supplier.notes,
      },
      include: {
        purchaseOrders: true,
        inventoryItems: true,
      },
    });

    return this.transformSupplier(updated);
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get supplier statistics
   */
  async getStats(context: ServiceContext, id: string): Promise<SupplierStats> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.READ);

    // Validate ID
    validateRequired(id, "id");

    // Verify supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundError("Supplier", id);
    }

    // Get purchase order statistics
    const results = await Promise.allSettled([
      this.prisma.purchaseOrder.count({
        where: { supplierId: id },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          supplierId: id,
          status: {
            in: ["Ordered", "PartiallyReceived"],
          },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          supplierId: id,
          status: { in: ["Received", "Closed"] },
        },
      }),
    ]);

    // Extract results with fallbacks
    const totalOrders =
      results[0].status === "fulfilled" ? results[0].value : 0;
    const openOrders = results[1].status === "fulfilled" ? results[1].value : 0;
    const completedOrders =
      results[2].status === "fulfilled" ? results[2].value : 0;

    // Get order value statistics
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { supplierId: id },
      select: {
        totalAmount: true,
        orderDate: true,
        expectedDate: true,
        receivedDate: true,
      },
    });

    let totalOrderValue = 0;
    let onTimeDeliveries = 0;
    let lateDeliveries = 0;
    let totalLeadTime = 0;
    let leadTimeCount = 0;

    orders.forEach((order) => {
      // Convert Decimal to number
      totalOrderValue += toNumber(order.totalAmount) ?? 0;

      // Calculate on-time delivery
      if (order.receivedDate && order.expectedDate) {
        const received = new Date(order.receivedDate);
        const expected = new Date(order.expectedDate);
        if (received <= expected) {
          onTimeDeliveries++;
        } else {
          lateDeliveries++;
        }
      }

      // Calculate lead time
      if (order.receivedDate) {
        const received = new Date(order.receivedDate);
        const ordered = new Date(order.orderDate);
        const leadTime =
          (received.getTime() - ordered.getTime()) / (1000 * 60 * 60 * 24);
        totalLeadTime += leadTime;
        leadTimeCount++;
      }
    });

    const averageOrderValue =
      totalOrders > 0 ? totalOrderValue / totalOrders : 0;
    const onTimeDeliveryRate =
      onTimeDeliveries + lateDeliveries > 0
        ? (onTimeDeliveries / (onTimeDeliveries + lateDeliveries)) * 100
        : 0;
    const averageLeadTime =
      leadTimeCount > 0 ? totalLeadTime / leadTimeCount : 0;

    // Get last order date
    const lastOrder = await this.prisma.purchaseOrder.findFirst({
      where: { supplierId: id },
      orderBy: { orderDate: "desc" },
      select: { orderDate: true },
    });

    // Get items supplied count
    const itemsSupplied = await this.prisma.inventoryItem.count({
      where: { defaultSupplierId: id },
    });

    return {
      totalOrders,
      openOrders,
      completedOrders,
      totalOrderValue,
      averageOrderValue,
      onTimeDeliveryRate,
      averageLeadTime,
      lastOrderDate: lastOrder?.orderDate ?? null,
      itemsSupplied,
      defectRate: 0, // TODO: Implement defect tracking
    };
  }

  /**
   * Get preferred suppliers (high ratings)
   */
  async getPreferredSuppliers(
    context: ServiceContext,
  ): Promise<SupplierWithRelations[]> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.READ);

    const suppliers = await this.prisma.supplier.findMany({
      where: {
        isActive: true,
        rating: {
          gte: 4,
        },
      },
      include: {
        purchaseOrders: true,
        inventoryItems: true,
      },
      orderBy: { rating: "desc" },
    });

    return suppliers.map((supplier) => this.transformSupplier(supplier));
  }

  /**
   * Get suppliers by active status
   */
  async getByActiveStatus(
    context: ServiceContext,
    active: boolean,
  ): Promise<SupplierWithRelations[]> {
    // Check permission
    await this.checkCrudPermission(context, PermissionAction.READ);

    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: active },
      include: {
        purchaseOrders: true,
        inventoryItems: true,
      },
      orderBy: { name: "asc" },
    });

    return suppliers.map((supplier) => this.transformSupplier(supplier));
  }
}

// Export singleton instance
const globalForSupplier = globalThis as unknown as {
  supplierService: SupplierServiceV2 | undefined;
};
export const supplierService =
  globalForSupplier.supplierService ??
  (globalForSupplier.supplierService = new SupplierServiceV2(prisma));
