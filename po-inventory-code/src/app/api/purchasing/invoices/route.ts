/**
 * Invoices API Routes
 *
 * CRUD endpoints for invoice management.
 *
 * Migrated: 2025-11-18
 * Part of: Phase 3.4 - Purchasing Routes Migration
 * Enhanced: 2026-03-16 - Added date range, sort/order, expanded search
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds


import { z } from "zod";
import { paginated, created } from "@/lib/api-response";
import { createApiHandler } from "@/lib/api-middleware-v2";
import { invoiceService } from "@/services/purchasing";
import { invoiceCreateSchema } from "@/services/purchasing/invoice.types";
import { paginationSchema } from "@/lib/validation";
import { InternalServerError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
/**
 * Query parameters schema for listing invoices
 */
const listQuerySchema = paginationSchema.merge(
  z.object({
    // Override limit from paginationSchema (.max(1000)) to allow up to 5000 for Excel export
    limit: z
      .string()
      .optional()
      .default("10")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().positive().max(5000)),
    search: z.string().optional(),
    supplierId: z.string().min(1).optional(),
    purchaseOrderId: z.string().min(1).optional(),
    status: z.string().optional(),
    approvalStatus: z.string().optional(),
    overdue: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    // knownTotal: when the caller already has the total from a prior request
    // (e.g. navigating pages without changing filters), the COUNT query is
    // skipped entirely to avoid expensive full-table scans on large databases.
    knownTotal: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : undefined))
      .pipe(z.number().int().positive().optional()),
    // hasProject=true → only invoices whose PO lines are coded to a project (CAPEX)
    hasProject: z
      .string()
      .optional()
      .transform((val) => val === "true"),
  })
);

/**
 * GET /api/purchasing/invoices
 * List all invoices with pagination and filtering
 */
export const GET = createApiHandler({}, async (req, context) => {
    try {
  // Parse query parameters
  const searchParams = req.nextUrl.searchParams;
  const rawParams = {
    page: searchParams.get("page") ?? "1",
    limit: searchParams.get("limit") ?? "10",
    sort: searchParams.get("sort") ?? undefined,
    order: searchParams.get("order") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    supplierId: searchParams.get("supplierId") ?? undefined,
    purchaseOrderId: searchParams.get("purchaseOrderId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    approvalStatus: searchParams.get("approvalStatus") ?? undefined,
    overdue: searchParams.get("overdue") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    knownTotal: searchParams.get("knownTotal") ?? undefined,
    hasProject: searchParams.get("hasProject") ?? undefined,
  };

  // Validate with schema
  const queryParams = listQuerySchema.parse(rawParams);
  const { page, limit, sort, order, search, supplierId, purchaseOrderId, status, approvalStatus, overdue, dateFrom, dateTo, knownTotal, hasProject } =
    queryParams;

  // Build filters
  // Note: buildWhereClause converts plain strings to ILIKE contains queries,
  // which causes "Approved" to match "Pending Approval". Force exact match for
  // both status and approvalStatus using Prisma { equals } objects.
  // B8-1: For "Pending" we use startsWith to match "Pending", "Pending Approval",
  // and "Pending Review" — all three are Pending-family display statuses.
  const filters: Record<string, unknown> = {};
  if (supplierId) filters.supplierId = supplierId;
  if (purchaseOrderId) filters.purchaseOrderId = purchaseOrderId;
  if (status) {
    if (status === 'Pending') {
      filters.status = { startsWith: 'Pending' };
    } else {
      filters.status = { equals: status };
    }
  }
  if (approvalStatus) filters.approvalStatus = { equals: approvalStatus };

  // Overdue: filter by dueDate < now AND status not in terminal states.
  // We handle this as an explicit date filter rather than passing a non-existent
  // "overdue" column to Prisma (which would cause a runtime error).
  if (overdue) {
    const now = new Date();
    filters.dueDate = { lt: now };
    // Only show non-terminal invoices as overdue
    if (!status) {
      filters.status = { notIn: ['Paid', 'Voided', 'Cancelled', 'Rejected'] };
    }
  }

  // Date range filter on invoiceDate
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      // Set end of day for dateTo
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      dateFilter.lte = endDate;
    }
    filters.invoiceDate = dateFilter;
  }

  // CAPEX / Project filter — only invoices whose PO has at least one line
  // coded to a project via POLineChargeAllocation.projectId.
  // PurchaseOrder.lines is the correct relation name (not poLines).
  if (hasProject) {
    filters.purchaseOrder = {
      lines: {
        some: {
          chargeAllocations: {
            some: { projectId: { not: null } },
          },
        },
      },
    };
  }

  // Call service — omit lines from the list-view include to avoid loading
  // potentially large line-item data for every invoice on the page.
  // The transformModel fast-path will default lines to [] when not included.
  // Pass knownTotal when the caller already has it (page navigation without
  // filter changes) to skip the expensive COUNT(*) query on large tables.
  const result = await invoiceService.findAll(context.serviceContext, {
    pagination: { page, limit },
    filters,
    search,
    searchFields: ["invoiceNumber", "internalNumber"],
    sort: { field: sort ?? "invoiceDate", order },
    include: {
      supplier: true,
      purchaseOrder: {
        include: {
          creator: { select: { id: true, firstName: true, lastName: true } },
          buyer: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      // lines intentionally excluded from list view — not displayed and adds
      // significant query overhead on large datasets.
    },
    knownTotal,
  });

  // Batch-enrich each invoice with its CAPEX project codes.
  // Path: Invoice → PurchaseOrder → POLine → POLineChargeAllocation → Project
  // A single query covers all POs in the page — no N+1.
  const poIds = result.data
    .map((inv) => inv.purchaseOrderId)
    .filter((id): id is string => !!id);

  const projectsByPoId = new Map<string, Array<{ id: string; code: string; name: string }>>();

  if (poIds.length > 0) {
    const allocations = await prisma.pOLineChargeAllocation.findMany({
      where: {
        poLine: { purchaseOrderId: { in: poIds } },
        projectId: { not: null },
      },
      select: {
        projectId: true,
        project: { select: { id: true, code: true, name: true } },
        poLine: { select: { purchaseOrderId: true } },
      },
    });

    for (const alloc of allocations) {
      const poId = alloc.poLine.purchaseOrderId;
      if (!poId || !alloc.project) continue;
      if (!projectsByPoId.has(poId)) projectsByPoId.set(poId, []);
      const list = projectsByPoId.get(poId)!;
      // De-duplicate by project ID within this PO
      if (!list.some((p) => p.id === alloc.project!.id)) {
        list.push(alloc.project);
      }
    }
  }

  const enriched = result.data.map((inv) => ({
    ...inv,
    projects: inv.purchaseOrderId
      ? (projectsByPoId.get(inv.purchaseOrderId) ?? [])
      : [],
  }));

  return paginated(
    enriched,
    result.pagination,
    "Invoices retrieved successfully"
  );

    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/purchasing/invoices
 * Create a new invoice
 */
export const POST = createApiHandler(
  { bodySchema: invoiceCreateSchema },
  async (_req, context) => {
    try {
    // Call service with validated data
    const invoice = await invoiceService.create(
      context.serviceContext,
      context.data
    );

    return created(invoice, "Invoice created successfully");
  
    } catch (error) {
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
