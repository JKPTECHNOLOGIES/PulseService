/**
 * Invoice Service
 *
 * Service layer for invoice management operations.
 * Extends the base CrudService to provide invoice-specific functionality.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { generateInvoiceInternalNumber } from "./invoice-utils";
import { reconcileLines } from "@/utils/reconcile-lines";
import { CrudService } from "@/services/base/crud.service";
import {
  ServiceContext,
  ValidationResult,
  ServiceConfig,
  UpdateOptions,
} from "@/services/base/types";
import { invoiceGLService } from "./invoice-gl.service";
import {
  InvoiceCreateDTO,
  InvoiceUpdateDTO,
  InvoiceWithRelations,
  InvoiceApproveDTO,
  InvoicePayDTO,
  InvoiceDisputeDTO,
  Invoice3WayMatchDTO,
  ThreeWayMatchResult,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  canApprove,
  canPay,
  canDispute,
  calculateInvoiceTotals,
  calculateLineTotal,
} from "@/services/purchasing/invoice.types";
import { InvoiceDisplayStatus } from "@/services/purchasing/invoice-approval.types";
import { prisma } from "@/lib/prisma";
import { PermissionResource, PermissionString } from "@/types/permissions";
import { checkAnyPermission } from "@/services/shared/permissions";
import { parseInvoiceDate } from "@/lib/validation";
import {
  NotFoundError,
  BadRequestError,
  ValidationError,
} from "@/lib/api-errors";

/**
 * Invoice Service Class
 *
 * Provides CRUD operations and business logic for invoice management.
 * Implements validation, permission checking, and 3-way matching.
 */
class InvoiceService extends CrudService<
  InvoiceWithRelations,
  InvoiceCreateDTO,
  InvoiceUpdateDTO
> {
  constructor(prismaClient: PrismaClient) {
    const config: ServiceConfig = {
      resourceName: "Invoice",
      permissions: {
        read: `${PermissionResource.INVOICES}:read`,
        create: `${PermissionResource.INVOICES}:create`,
        update: `${PermissionResource.INVOICES}:update`,
        delete: `${PermissionResource.INVOICES}:delete`,
      },
      softDelete: false,
      trackAudit: false,
      defaultLimit: 20,
      maxLimit: 5000,
    };

    super(prismaClient, prismaClient.invoice, config);
  }

  /**
   * Accept EITHER invoices:* (the specific resource shown in the matrix) OR
   * the legacy purchasing:* umbrella. Roles configured with only purchasing:*
   * (e.g. Supervisor) continue to work; roles with only invoices:* (e.g. Viewer)
   * now also work correctly.
   */
  protected override checkPermission(
    context: ServiceContext,
    permission: PermissionString,
    resourceOwnerId?: string,
  ): Promise<void> {
    const legacyPerm = permission.replace(
      "invoices:",
      "purchasing:",
    ) as PermissionString;
    if (legacyPerm !== permission) {
      // It's an invoices:* check — accept invoices:* OR purchasing:* legacy
      checkAnyPermission(context, [permission, legacyPerm]);
      return Promise.resolve();
    }
    return super.checkPermission(context, permission, resourceOwnerId);
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  /**
   * Validate invoice creation data
   * Checks:
   * - Supplier exists
   * - Invoice number is unique
   * - Purchase order exists if provided
   */
  protected override async validateCreate(
    data: InvoiceCreateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation = invoiceCreateSchema.safeParse(data);
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

    // Check invoice number uniqueness per supplier
    // Excludes voided, cancelled, and rejected invoices — rejected invoices free up
    // their number so the user can re-enter the invoice against the correct PO.
    const existingInvoice = await this.prisma.invoice.findFirst({
      where: {
        invoiceNumber: data.invoiceNumber,
        supplierId: data.supplierId,
        status: {
          notIn: ["VOIDED", "CANCELLED", "Voided", "Cancelled", "Rejected"],
        },
      },
    });

    if (existingInvoice) {
      errors.push({
        field: "invoiceNumber",
        message: `Invoice number "${data.invoiceNumber}" already exists for this supplier`,
        code: "DUPLICATE_INVOICE_NUMBER",
      });
    }

    // Validate supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: data.supplierId },
    });

    if (!supplier) {
      errors.push({
        field: "supplierId",
        message: "Supplier not found",
        code: "SUPPLIER_NOT_FOUND",
      });
    }

    // Validate purchase order if provided
    if (data.purchaseOrderId) {
      const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
        where: { id: data.purchaseOrderId },
      });

      if (!purchaseOrder) {
        errors.push({
          field: "purchaseOrderId",
          message: "Purchase order not found",
          code: "PO_NOT_FOUND",
        });
      } else if (purchaseOrder.supplierId !== data.supplierId) {
        errors.push({
          field: "purchaseOrderId",
          message: "Purchase order supplier does not match invoice supplier",
          code: "SUPPLIER_MISMATCH",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Validate invoice update data
   * Checks:
   * - Invoice can be edited (status is Pending)
   * - Invoice number is unique if changed
   */
  protected override async validateUpdate(
    id: string,
    data: InvoiceUpdateDTO,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate with Zod schema
    const schemaValidation = invoiceUpdateSchema.safeParse(data);
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

    // Get existing invoice
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      errors.push({
        field: "id",
        message: "Invoice not found",
        code: "INVOICE_NOT_FOUND",
      });
      return { valid: false, errors };
    }

    // Check if invoice can be edited
    if (invoice.status !== InvoiceDisplayStatus.PENDING) {
      errors.push({
        field: "status",
        message: "Only pending invoices can be edited",
        code: "INVALID_STATUS",
      });
    }

    // Check invoice number uniqueness per supplier if changed
    if (data.invoiceNumber && data.invoiceNumber !== invoice.invoiceNumber) {
      const supplierId = data.supplierId ?? invoice.supplierId;
      const existingInvoice = await this.prisma.invoice.findUnique({
        where: {
          invoiceNumber_supplierId: {
            invoiceNumber: data.invoiceNumber,
            supplierId,
          },
        },
      });

      if (existingInvoice && existingInvoice.id !== id) {
        errors.push({
          field: "invoiceNumber",
          message: `Invoice number "${data.invoiceNumber}" already exists for this supplier`,
          code: "DUPLICATE_INVOICE_NUMBER",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Before creating an invoice, free up the invoice number if a prior rejected
   * invoice exists with the same number + supplier.  A rejected invoice should
   * not permanently block the number — rename it (like voiding does) so the
   * new invoice can be created without hitting the DB unique constraint.
   */
  protected override async beforeCreate(
    data: InvoiceCreateDTO,
    _context: ServiceContext,
  ): Promise<void> {
    const rejectedInvoice = await this.prisma.invoice.findFirst({
      where: {
        invoiceNumber: data.invoiceNumber,
        supplierId: data.supplierId,
        status: "Rejected",
      },
      select: { id: true, invoiceNumber: true },
    });

    if (rejectedInvoice) {
      // Rename the rejected invoice's number so the DB unique constraint is freed.
      // Pattern mirrors the void flow: <original>-REJECTED-<timestamp>
      await this.prisma.invoice.update({
        where: { id: rejectedInvoice.id },
        data: {
          invoiceNumber: `${rejectedInvoice.invoiceNumber}-REJECTED-${Date.now()}`,
        },
      });

      logger.info(
        `[Invoice Create] Freed invoice number "${data.invoiceNumber}" from rejected invoice ${rejectedInvoice.id} before creating new invoice for same supplier`,
      );
    }
  }

  /**
   * Override the base delete() to avoid a `createdBy` select that doesn't
   * exist on the Invoice model.  We do our own permission check, run the
   * full pre-delete cleanup (GL reversal + PO line reset), then delete.
   */
  override async delete(context: ServiceContext, id: string): Promise<void> {
    // Permission check
    await this.checkPermission(context, this.config.permissions.delete);

    // Run all pre-delete logic (status guard, GL reversal, PO line reset)
    await this.beforeDelete(id, context);

    // Hard delete — softDelete is false for Invoice
    await this.prisma.invoice.delete({ where: { id } });
  }

  /**
   * Validate invoice deletion and perform pre-delete cleanup.
   *
   * Allowed statuses to delete: PENDING only.
   * Before deleting, reverses any GL transactions posted for this invoice
   * (e.g., INVOICE_MATCH entries that were created on upload) and resets
   * PO service-line invoice match flags so the PO is clean for re-use.
   */
  protected override async beforeDelete(
    id: string,
    context: ServiceContext,
  ): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        purchaseOrder: {
          include: { lines: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError("Invoice", id);
    }

    if (invoice.status !== InvoiceDisplayStatus.PENDING) {
      throw new BadRequestError(
        "Only pending invoices can be deleted. Use Void for Approved or Paid invoices.",
      );
    }

    // --- Reverse any GL transactions posted for this invoice ---
    try {
      const { glReversalService } =
        await import("@/services/gl/gl-reversal.service");

      const invoiceGLTransactions = await this.prisma.gLTransaction.findMany({
        where: {
          referenceType: "Invoice",
          referenceId: id,
          status: "POSTED",
        },
      });

      for (const glTxn of invoiceGLTransactions) {
        await glReversalService.reverseTransaction(
          glTxn.id,
          `Invoice ${invoice.invoiceNumber} deleted (wrong PO / data correction)`,
          context.userId,
        );
      }

      if (invoiceGLTransactions.length > 0) {
        logger.info(
          `[Invoice Delete] Reversed ${invoiceGLTransactions.length} GL transaction(s) for invoice ${id} before deletion`,
        );
      }
    } catch (glError) {
      logger.error(
        `[Invoice Delete] GL reversal failed for invoice ${id}: ${glError instanceof Error ? glError.message : String(glError)}`,
      );
      // Non-fatal — still allow deletion but log the issue
    }

    // --- Decrement PO service-line approvedInvoiceAmount ---
    if (invoice.purchaseOrderId) {
      try {
        const { decrementApprovedInvoiceAmountForInvoice } =
          await import("./invoice-po-line-utils");
        await decrementApprovedInvoiceAmountForInvoice(
          this.prisma,
          id,
          invoice.purchaseOrderId,
          Number(invoice.totalAmount),
          invoice.approvalStatus,
        );
      } catch (poError) {
        logger.error(
          `[Invoice Delete] PO line decrement failed for invoice ${id}: ${poError instanceof Error ? poError.message : String(poError)}`,
        );
        // Non-fatal
      }
    }
  }

  // ============================================================================
  // UPDATE OVERRIDE — Safe Line Reconciliation
  // ============================================================================

  /**
   * Override the base update() to replace the destructive deleteMany + create
   * line pattern with a safe reconcileLines merge that preserves line UUIDs
   * for audit trail consistency.
   *
   * When the DTO contains `lines`, we:
   * 1. Update the invoice header fields normally
   * 2. Reconcile lines using a 3-way merge (update/create/delete)
   * 3. Execute everything in a single transaction
   *
   * When no `lines` are present, we delegate to the base class.
   *
   * @see docs/destructive-update-fix-architecture.md
   */
  override async update(
    context: ServiceContext,
    id: string,
    data: InvoiceUpdateDTO,
    options?: UpdateOptions,
  ): Promise<InvoiceWithRelations> {
    // If no lines in the update, delegate entirely to base class
    if (!data.lines) {
      return super.update(context, id, data, options);
    }

    // ---- Lines present — handle header + lines atomically ----

    // 1. Permission check
    if (!options?.skipPermissionCheck) {
      await this.checkPermission(context, this.config.permissions.update);
    }

    // 2. Validation
    if (!options?.skipValidation) {
      const validation = await this.validateUpdate(id, data);
      if (!validation.valid) {
        throw new ValidationError("Validation failed", validation.errors ?? []);
      }
    }

    // 3. Before-update hook
    await this.beforeUpdate(id, data, context);

    // 4. Compute line totals and header amounts
    const incomingLines = data.lines;
    const computedLines = incomingLines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: calculateLineTotal(line.quantity, line.unitPrice),
      notes: line.notes ?? null,
    }));

    const { subtotal, total } = calculateInvoiceTotals(
      computedLines as never,
      data.tax ?? 0,
      data.shippingCost ?? 0,
    );

    // 5. Build header-only update payload (no lines)
    const headerData: Record<string, unknown> = {};
    if (data.invoiceNumber !== undefined)
      headerData.invoiceNumber = data.invoiceNumber;
    if (data.supplierId !== undefined) headerData.supplierId = data.supplierId;
    if (data.purchaseOrderId !== undefined)
      headerData.purchaseOrderId = data.purchaseOrderId;
    if (data.invoiceDate !== undefined)
      headerData.invoiceDate = parseInvoiceDate(
        data.invoiceDate,
        "invoiceDate",
      );
    if (data.dueDate !== undefined)
      headerData.dueDate = data.dueDate
        ? parseInvoiceDate(data.dueDate, "dueDate")
        : null;
    if (data.notes !== undefined) headerData.notes = data.notes;
    if (data.tax !== undefined) headerData.tax = data.tax;
    if (data.shippingCost !== undefined)
      headerData.shippingCost = data.shippingCost;
    headerData.subtotal = subtotal;
    headerData.totalAmount = total;

    // 6. Fetch existing lines for reconciliation
    const existingLines = await this.prisma.invoiceLine.findMany({
      where: { invoiceId: id },
      orderBy: { createdAt: "asc" },
    });

    // 7. Reconcile: 3-way merge preserving line UUIDs
    type ExistingInvoiceLine = (typeof existingLines)[number];
    type IncomingLineDTO = (typeof incomingLines)[number];

    const reconciliation = reconcileLines<ExistingInvoiceLine, IncomingLineDTO>(
      existingLines,
      incomingLines,
      {
        // Line id is passed through from the edit form — enables ID-based reconciliation.
        // If no lines carry ids (e.g. old client), reconcileLines will throw (M-027 fix).
        getIncomingId: (line) => line.id,

        // No protected fields on InvoiceLine
        protectedFields: [],

        // Invoice lines have no downstream dependencies — always deletable
        canDelete: () => ({ allowed: true }),

        toCreateInput: (line) => ({
          invoiceId: id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: calculateLineTotal(line.quantity, line.unitPrice),
          notes: line.notes ?? null,
        }),

        toUpdateInput: (line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: calculateLineTotal(line.quantity, line.unitPrice),
          notes: line.notes ?? null,
        }),
      },
    );

    if (reconciliation.warnings.length > 0) {
      logger.warn(
        `[Invoice Update] Line reconciliation warnings for ${id}: ${reconciliation.warnings.join("; ")}`,
      );
    }

    // 8. Execute atomically
    const updated = await this.prisma.$transaction(async (tx) => {
      // Delete removed lines
      if (reconciliation.deletes.length > 0) {
        await tx.invoiceLine.deleteMany({
          where: { id: { in: reconciliation.deletes.map((d) => d.id) } },
        });
      }

      // Update matched lines in place (preserves UUIDs)
      for (const upd of reconciliation.updates) {
        await tx.invoiceLine.update({
          where: { id: upd.id },
          data: upd.data,
        });
      }

      // Create new lines
      if (reconciliation.creates.length > 0) {
        await tx.invoiceLine.createMany({
          data: reconciliation.creates.map(
            (c) => c as Prisma.InvoiceLineCreateManyInput,
          ),
        });
      }

      // Update invoice header
      return tx.invoice.update({
        where: { id },
        data: headerData,
        include: { lines: true, supplier: true, purchaseOrder: true },
      });
    });

    // 9. Transform and return
    return this.transformModel(updated as unknown);
  }

  // ============================================================================
  // DATA TRANSFORMATION
  // ============================================================================

  /**
   * Transform create DTO to Prisma data
   */
  protected override async transformCreateDTO(
    data: InvoiceCreateDTO,
    _context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    // Calculate line totals
    const lines = data.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: calculateLineTotal(line.quantity, line.unitPrice),
      notes: line.notes ?? null,
    }));

    // Calculate invoice totals (lines already have totalPrice as number)
    const { subtotal, total } = calculateInvoiceTotals(
      lines as never,
      data.tax,
      data.shippingCost,
    );

    // Generate internal tracking number
    const internalNumber = await generateInvoiceInternalNumber(this.prisma);

    return {
      internalNumber,
      invoiceNumber: data.invoiceNumber,
      supplierId: data.supplierId,
      purchaseOrderId: data.purchaseOrderId ?? null,
      invoiceDate: parseInvoiceDate(data.invoiceDate, "invoiceDate"),
      dueDate: data.dueDate ? parseInvoiceDate(data.dueDate, "dueDate") : null,
      subtotal,
      tax: data.tax,
      shippingCost: data.shippingCost,
      totalAmount: total,
      paidAmount: 0,
      status: InvoiceDisplayStatus.PENDING,
      notes: data.notes ?? null,
      lines: {
        create: lines,
      },
    };
  }

  /**
   * Transform update DTO to Prisma data
   */
  protected override transformUpdateDTO(
    data: InvoiceUpdateDTO,
    _context: ServiceContext,
  ): Promise<Record<string, unknown>> {
    const transformed: Record<string, unknown> = {};

    if (data.invoiceNumber !== undefined)
      transformed.invoiceNumber = data.invoiceNumber;
    if (data.supplierId !== undefined) transformed.supplierId = data.supplierId;
    if (data.purchaseOrderId !== undefined)
      transformed.purchaseOrderId = data.purchaseOrderId;
    if (data.invoiceDate !== undefined) {
      transformed.invoiceDate = parseInvoiceDate(
        data.invoiceDate,
        "invoiceDate",
      );
    }
    if (data.dueDate !== undefined) {
      transformed.dueDate = data.dueDate
        ? parseInvoiceDate(data.dueDate, "dueDate")
        : null;
    }
    if (data.notes !== undefined) transformed.notes = data.notes;

    // Handle lines — compute totals only.
    // Actual line reconciliation is handled by update() override above.
    // No destructive deleteMany/create pattern here.
    if (data.lines) {
      const lines = data.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: calculateLineTotal(line.quantity, line.unitPrice),
        notes: line.notes ?? null,
      }));

      const { subtotal, total } = calculateInvoiceTotals(
        lines as never,
        data.tax ?? 0,
        data.shippingCost ?? 0,
      );

      transformed.subtotal = subtotal;
      transformed.totalAmount = total;
    }

    if (data.tax !== undefined) transformed.tax = data.tax;
    if (data.shippingCost !== undefined)
      transformed.shippingCost = data.shippingCost;

    return Promise.resolve(transformed);
  }

  /**
   * Transform model to include relations
   */
  protected override async transformModel(
    model: unknown,
  ): Promise<InvoiceWithRelations> {
    const record = model as Record<string, unknown>;

    // Fast path: supplier is present means relations were eager-loaded.
    // lines may or may not have been requested — default to empty array when
    // not included (list-view queries omit lines for performance).
    if (record.supplier !== undefined) {
      const lines =
        (record.lines as Array<Record<string, unknown>> | undefined) ?? [];
      return {
        ...record,
        subtotal: Number(record.subtotal),
        tax: Number(record.tax),
        shippingCost: Number(record.shippingCost),
        totalAmount: Number(record.totalAmount),
        paidAmount: Number(record.paidAmount),
        lines: lines.map((line) => ({
          ...line,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          totalPrice: Number(line.totalPrice),
        })),
      } as InvoiceWithRelations;
    }

    // Fallback: fetch all relations (used only when supplier was not included).
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: record.id as string },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
    });

    if (!invoice) {
      throw new NotFoundError("Invoice", record.id as string);
    }

    return {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    } as InvoiceWithRelations;
  }

  // ============================================================================
  // CUSTOM METHODS
  // ============================================================================

  /**
   * Approve invoice
   *
   * @param context - Service context
   * @param id - Invoice ID
   * @param data - Approval data
   * @returns Updated invoice
   */
  async approve(
    context: ServiceContext,
    id: string,
    data?: InvoiceApproveDTO,
  ): Promise<InvoiceWithRelations> {
    // Check approval permission
    await this.checkPermission(
      context,
      `${PermissionResource.INVOICES}:approve` as PermissionString,
    );

    // Get invoice
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundError("Invoice", id);
    }

    // Validate can approve (only checks status field, but needs number types)
    const invoiceForValidation = {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
    };

    if (!canApprove(invoiceForValidation)) {
      throw new BadRequestError(
        `Invoice cannot be approved in ${invoice.status} status`,
      );
    }

    // Update status
    // Note: GL transactions are created when invoice is PAID, not when approved
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceDisplayStatus.APPROVED,
        notes: data?.notes ?? invoice.notes,
      },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
    });

    return {
      ...updated,
      subtotal: Number(updated.subtotal),
      tax: Number(updated.tax),
      shippingCost: Number(updated.shippingCost),
      totalAmount: Number(updated.totalAmount),
      paidAmount: Number(updated.paidAmount),
      lines: updated.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    } as InvoiceWithRelations;
  }

  /**
   * Pay invoice
   *
   * @param context - Service context
   * @param id - Invoice ID
   * @param data - Payment data
   * @returns Updated invoice
   */
  async pay(
    context: ServiceContext,
    id: string,
    data: InvoicePayDTO,
  ): Promise<InvoiceWithRelations> {
    // Check update permission
    await this.checkPermission(context, this.config.permissions.update);

    // Get invoice with related data
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        purchaseOrder: {
          include: {
            lines: {
              include: {
                chargeAllocations: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError("Invoice", id);
    }

    // Validate can pay (only checks status field, but needs number types)
    const invoiceForValidation = {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
    };

    if (!canPay(invoiceForValidation)) {
      throw new BadRequestError(
        `Invoice cannot be paid in ${invoice.status} status`,
      );
    }

    // Validate payment amount
    const totalAmount = Number(invoice.totalAmount);
    const currentPaid = Number(invoice.paidAmount);
    const newPaidAmount = currentPaid + data.amount;

    if (newPaidAmount > totalAmount) {
      throw new BadRequestError(
        `Payment amount exceeds invoice total. Remaining: ${totalAmount - currentPaid}`,
      );
    }

    // Determine new status
    const newStatus =
      newPaidAmount >= totalAmount ? InvoiceDisplayStatus.PAID : invoice.status;

    // Get account code from PO (use first allocation as default)
    let accountCodeId: string | undefined;
    let departmentId: string | undefined;
    let projectId: string | undefined;
    let areaId: string | undefined;

    if (
      invoice.purchaseOrder?.lines &&
      invoice.purchaseOrder.lines.length > 0
    ) {
      const firstLine = invoice.purchaseOrder.lines[0];
      if (firstLine && firstLine.chargeAllocations.length > 0) {
        const firstAllocation = firstLine.chargeAllocations[0];
        if (firstAllocation) {
          accountCodeId = firstAllocation.accountCodeId ?? undefined;
          departmentId = firstAllocation.departmentId ?? undefined;
          projectId = firstAllocation.projectId ?? undefined;
          areaId = firstAllocation.areaId ?? undefined;
        }
      }
    }

    // Create GL transaction for payment if account code is available
    if (accountCodeId) {
      try {
        // Calculate price variance (invoice total vs PO total)
        const poTotal = invoice.purchaseOrder
          ? Number(invoice.purchaseOrder.totalAmount)
          : 0;
        const priceVariance = poTotal > 0 ? totalAmount - poTotal : 0;

        await invoiceGLService.createInvoicePaymentTransaction(context, {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          supplierId: invoice.supplierId,
          supplierName: invoice.supplier.name,
          paymentAmount: data.amount,
          paymentDate: new Date(),
          paymentMethod: data.notes ? "Manual" : undefined,
          paymentReference: data.notes ?? undefined,
          purchaseOrderId: invoice.purchaseOrderId ?? undefined,
          poNumber: invoice.purchaseOrder?.poNumber ?? undefined,
          accountCodeId,
          departmentId,
          projectId,
          areaId,
          priceVariance:
            Math.abs(priceVariance) > 0.01 ? priceVariance : undefined,
        });
      } catch (_error) {
        // Don't fail the payment if GL transaction fails - log and continue
      }
    }

    // Update invoice
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        paidAmount: newPaidAmount,
        status: newStatus,
        notes: data.notes ?? invoice.notes,
      },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
    });

    // Auto-close is handled exclusively by the 90-day inactivity cron job (po-auto-close.ts).
    // Event-driven auto-close was removed here.

    return {
      ...updated,
      subtotal: Number(updated.subtotal),
      tax: Number(updated.tax),
      shippingCost: Number(updated.shippingCost),
      totalAmount: Number(updated.totalAmount),
      paidAmount: Number(updated.paidAmount),
      lines: updated.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    } as InvoiceWithRelations;
  }

  /**
   * Dispute invoice
   *
   * @param context - Service context
   * @param id - Invoice ID
   * @param data - Dispute data
   * @returns Updated invoice
   */
  async dispute(
    context: ServiceContext,
    id: string,
    data: InvoiceDisputeDTO,
  ): Promise<InvoiceWithRelations> {
    // Check update permission
    await this.checkPermission(context, this.config.permissions.update);

    // Get invoice
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundError("Invoice", id);
    }

    // Validate can dispute (only checks status field, but needs number types)
    const invoiceForValidation = {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
    };

    if (!canDispute(invoiceForValidation)) {
      throw new BadRequestError(
        `Invoice cannot be disputed in ${invoice.status} status`,
      );
    }

    // Update status
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceDisplayStatus.DISPUTED,
        notes: data.reason,
      },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
    });

    // Reverse any posted GL entries (INVOICE_MATCH, INVOICE_PAY) for disputed invoice
    try {
      const { glReversalService } =
        await import("@/services/gl/gl-reversal.service");

      const invoiceGLTransactions = await this.prisma.gLTransaction.findMany({
        where: {
          referenceType: "Invoice",
          referenceId: invoice.id,
          status: "POSTED",
        },
      });

      for (const glTxn of invoiceGLTransactions) {
        await glReversalService.reverseTransaction(
          glTxn.id,
          `Invoice ${invoice.invoiceNumber} disputed: ${data.reason || "No reason provided"}`,
          context.userId,
        );
      }

      if (invoiceGLTransactions.length > 0) {
        logger.info(
          `[Invoice Dispute] Reversed ${invoiceGLTransactions.length} GL transaction(s) for invoice ${invoice.id}`,
        );
      }
    } catch (glError) {
      logger.error(
        `[Invoice Dispute] GL reversal failed for invoice ${invoice.id}: ${glError instanceof Error ? glError.message : String(glError)}`,
      );
      // Non-fatal — don't fail the dispute
    }

    return {
      ...updated,
      subtotal: Number(updated.subtotal),
      tax: Number(updated.tax),
      shippingCost: Number(updated.shippingCost),
      totalAmount: Number(updated.totalAmount),
      paidAmount: Number(updated.paidAmount),
      lines: updated.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    } as InvoiceWithRelations;
  }

  /**
   * Void an invoice, reversing all GL entries and resetting PO line invoice match status.
   * Can void invoices in Approved, Paid, or Disputed status.
   *
   * @param context - Service context
   * @param invoiceId - The invoice ID to void
   * @param reason - Reason for voiding
   * @returns The voided invoice
   */
  async voidInvoice(
    context: ServiceContext,
    invoiceId: string,
    reason: string,
  ): Promise<InvoiceWithRelations> {
    // 1. Permission check
    await this.checkPermission(context, this.config.permissions.update);

    // 2. Load invoice with PO and PO lines
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        supplier: true,
        purchaseOrder: {
          include: {
            lines: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    // 3. Validate status — Finance can void invoices in any non-terminal state so
    //    the workflow can be restarted (e.g. approver placed invoice On Hold,
    //    Finance rejected an invoice, or invoice was uploaded to wrong PO).
    //    - APPROVED / PAID / DISPUTED       → void reverses GL, clears PO line allocation
    //    - PENDING_APPROVAL / PENDING_REVIEW → void before any GL exists
    //    - ON_HOLD / REJECTED               → approver/finance stopped the workflow,
    //                                         void frees the invoice number so a
    //                                         corrected invoice can be uploaded
    const voidableStatuses = [
      InvoiceDisplayStatus.APPROVED,
      InvoiceDisplayStatus.PAID,
      InvoiceDisplayStatus.DISPUTED,
      InvoiceDisplayStatus.PENDING_APPROVAL,
      InvoiceDisplayStatus.PENDING_REVIEW,
      InvoiceDisplayStatus.ON_HOLD,
      InvoiceDisplayStatus.REJECTED,
    ];

    if (invoice.status === InvoiceDisplayStatus.VOIDED) {
      throw new BadRequestError("Invoice is already voided");
    }

    if (invoice.status === InvoiceDisplayStatus.CANCELLED) {
      throw new BadRequestError("Cannot void a cancelled invoice");
    }

    if (invoice.status === InvoiceDisplayStatus.PENDING) {
      throw new BadRequestError(
        "Pending invoices should be deleted instead of voided",
      );
    }

    if (!voidableStatuses.includes(invoice.status as InvoiceDisplayStatus)) {
      throw new BadRequestError(
        `Invoice cannot be voided in ${invoice.status} status`,
      );
    }

    // 4. Prisma transaction: update invoice and reset PO lines
    const updated = await this.prisma.$transaction(async (tx) => {
      // 4a. Update invoice status to Voided, clear paid amount, set void metadata,
      //     and clear all approval-related fields so it no longer appears in
      //     pending approval lists / email reminders / digest emails.
      const voidedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          invoiceNumber: `${invoice.invoiceNumber}-VOID-${Date.now()}`,
          status: InvoiceDisplayStatus.VOIDED,
          voidedAt: new Date(),
          voidReason: reason,
          paidAmount: 0,
          // Clear approval workflow fields.
          // NOTE: approvalStatus is intentionally NOT changed here.
          // The status field ('Voided') and voidedAt timestamp are the
          // authoritative void indicators used by all queries.  Setting
          // approvalStatus to FULLY_APPROVED (the old behaviour) caused
          // voided invoices to be picked up by approval/receiving queries
          // that filter approvalStatus IN ('REQUESTOR_APPROVED','FULLY_APPROVED').
          requestorApprovedBy: null,
          requestorApprovedByName: null,
          requestorApprovedAt: null,
          requestorRejectedAt: null,
          requestorRejectionReason: null,
          managerApprovedBy: null,
          managerApprovedByName: null,
          managerApprovedAt: null,
          managerRejectedAt: null,
          managerRejectionReason: null,
          matchStatus: "UNMATCHED",
          matchedAt: null,
          matchedBy: null,
          matchedByName: null,
        },
        include: {
          lines: true,
          supplier: true,
          purchaseOrder: true,
        },
      });

      // 4a-ii. Record approval history entry for the void action.
      // approvalStatus is preserved (not changed), so newStatus records the
      // voided state by convention using the 'VOIDED' action label.
      await tx.invoiceApprovalHistory.create({
        data: {
          invoiceId,
          approverType: "SYSTEM",
          approvedBy: context.userId,
          approvedByName: context.userName,
          action: "VOIDED",
          comments: `Invoice voided: ${reason}`,
          previousStatus: invoice.approvalStatus,
          newStatus: invoice.approvalStatus, // Status unchanged; void is tracked via status/voidedAt fields
        },
      });

      // 4b-pre. Clear POLineReceipt.invoiceId for every receipt that was matched
      //         to this invoice. This is required so that:
      //           1. Receipts can be re-matched to a replacement invoice via the
      //              receipt-matching flow (the matchInvoiceToReceipts guard only
      //              processes receipts where invoiceId IS NULL).
      //           2. The GR/NI accrual report correctly shows these goods as
      //              outstanding (level-A check relies on invoiceId being null
      //              for items without a live approved invoice).
      await tx.pOLineReceipt.updateMany({
        where: { invoiceId: invoiceId },
        data: { invoiceId: null },
      });

      // 4b. Decrement PO line approvedInvoiceAmount for this invoice only
      if (invoice.purchaseOrderId) {
        const { decrementApprovedInvoiceAmountForInvoice } =
          await import("./invoice-po-line-utils");
        await decrementApprovedInvoiceAmountForInvoice(
          tx,
          invoiceId,
          invoice.purchaseOrderId,
          Number(invoice.totalAmount),
          invoice.approvalStatus,
        );
      }

      return voidedInvoice;
    });

    // 5. Outside transaction: Reverse ALL GL entries for this invoice
    try {
      const { glReversalService } =
        await import("@/services/gl/gl-reversal.service");

      const invoiceGLTransactions = await this.prisma.gLTransaction.findMany({
        where: {
          referenceType: "Invoice",
          referenceId: invoice.id,
          status: "POSTED",
        },
      });

      for (const glTxn of invoiceGLTransactions) {
        await glReversalService.reverseTransaction(
          glTxn.id,
          `Invoice ${invoice.invoiceNumber} voided: ${reason}`,
          context.userId,
        );
      }

      if (invoiceGLTransactions.length > 0) {
        logger.info(
          `[Invoice Void] Reversed ${invoiceGLTransactions.length} GL transaction(s) for invoice ${invoice.id}`,
        );
      }
    } catch (glError) {
      logger.error(
        `[Invoice Void] GL reversal failed for invoice ${invoice.id}: ${glError instanceof Error ? glError.message : String(glError)}`,
      );
      // Non-fatal — don't fail the void operation
    }

    // 6. Audit trail
    try {
      const { auditLogService } =
        await import("@/services/audit/audit.service");
      const { AuditAction } = await import("@/services/audit/audit.types");

      await auditLogService.logCrudOperation(
        context,
        AuditAction.VOID,
        "Invoice",
        invoice.id,
        invoice.invoiceNumber,
        { status: invoice.status, paidAmount: Number(invoice.paidAmount) },
        {
          status: InvoiceDisplayStatus.VOIDED,
          voidReason: reason,
          paidAmount: 0,
        },
        {
          reason,
          previousStatus: invoice.status,
          purchaseOrderId: invoice.purchaseOrderId,
          totalAmount: Number(invoice.totalAmount),
        },
      );
    } catch (_auditError) {
      // Non-fatal — don't fail the void operation
    }

    // 7. Return the voided invoice
    return {
      ...updated,
      subtotal: Number(updated.subtotal),
      tax: Number(updated.tax),
      shippingCost: Number(updated.shippingCost),
      totalAmount: Number(updated.totalAmount),
      paidAmount: Number(updated.paidAmount),
      lines: updated.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    } as InvoiceWithRelations;
  }

  /**
   * Perform 3-way matching between invoice, PO, and receipt
   *
   * @param context - Service context
   * @param data - Match data
   * @returns Match result
   */
  async perform3WayMatch(
    context: ServiceContext,
    data: Invoice3WayMatchDTO,
  ): Promise<ThreeWayMatchResult> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    // Get invoice with lines
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: data.invoiceId },
      include: { lines: true },
    });

    if (!invoice) {
      throw new NotFoundError("Invoice", data.invoiceId);
    }

    // Get purchase order with lines
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
      where: { id: data.purchaseOrderId },
      include: { lines: true },
    });

    if (!purchaseOrder) {
      throw new NotFoundError("PurchaseOrder", data.purchaseOrderId);
    }

    // Verify supplier match
    if (invoice.supplierId !== purchaseOrder.supplierId) {
      throw new BadRequestError(
        "Invoice and purchase order have different suppliers",
      );
    }

    // Compare totals
    const discrepancies: ThreeWayMatchResult["discrepancies"] = [];
    const invoiceTotal = Number(invoice.totalAmount);
    const poTotal = Number(purchaseOrder.totalAmount);
    const difference = Math.abs(invoiceTotal - poTotal);
    const percentDifference = poTotal > 0 ? (difference / poTotal) * 100 : 0;

    if (difference > 0) {
      discrepancies.push({
        field: "totalAmount",
        invoiceValue: invoiceTotal,
        poValue: poTotal,
        difference,
        percentDifference,
      });
    }

    // Check if within tolerance
    const withinTolerance = percentDifference <= data.tolerance;
    const matched = discrepancies.length === 0 || withinTolerance;

    return {
      matched,
      discrepancies,
      totalDiscrepancy: difference,
      withinTolerance,
    };
  }

  /**
   * Get overdue invoices
   *
   * @param context - Service context
   * @returns Array of overdue invoices
   */
  async getOverdue(context: ServiceContext): Promise<InvoiceWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: {
          in: [InvoiceDisplayStatus.PENDING, InvoiceDisplayStatus.APPROVED],
        },
        dueDate: {
          lt: new Date(),
        },
      },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
      orderBy: { dueDate: "asc" },
    });

    return invoices.map((invoice) => ({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    })) as InvoiceWithRelations[];
  }

  /**
   * Get invoices by supplier
   *
   * @param context - Service context
   * @param supplierId - Supplier ID
   * @returns Array of invoices
   */
  async getBySupplier(
    context: ServiceContext,
    supplierId: string,
  ): Promise<InvoiceWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    const invoices = await this.prisma.invoice.findMany({
      where: { supplierId },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
      orderBy: { invoiceDate: "desc" },
    });

    return invoices.map((invoice) => ({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    })) as InvoiceWithRelations[];
  }

  /**
   * Get invoices by purchase order
   *
   * @param context - Service context
   * @param purchaseOrderId - Purchase order ID
   * @returns Array of invoices
   */
  async getByPurchaseOrder(
    context: ServiceContext,
    purchaseOrderId: string,
  ): Promise<InvoiceWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    const invoices = await this.prisma.invoice.findMany({
      where: { purchaseOrderId },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
      orderBy: { invoiceDate: "desc" },
    });

    return invoices.map((invoice) => ({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    })) as InvoiceWithRelations[];
  }

  /**
   * Get invoices by status
   *
   * @param context - Service context
   * @param status - Invoice status
   * @returns Array of invoices
   */
  async getByStatus(
    context: ServiceContext,
    status: InvoiceDisplayStatus,
  ): Promise<InvoiceWithRelations[]> {
    // Check read permission
    await this.checkPermission(context, this.config.permissions.read);

    const invoices = await this.prisma.invoice.findMany({
      where: { status },
      include: {
        lines: true,
        supplier: true,
        purchaseOrder: true,
      },
      orderBy: { invoiceDate: "desc" },
    });

    return invoices.map((invoice) => ({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      shippingCost: Number(invoice.shippingCost),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
      })),
    })) as InvoiceWithRelations[];
  }
}

// Export singleton instance
const globalForInvoiceService = globalThis as unknown as {
  invoiceService: InvoiceService | undefined;
};
export const invoiceService =
  globalForInvoiceService.invoiceService ??
  (globalForInvoiceService.invoiceService = new InvoiceService(prisma));
