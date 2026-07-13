import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { financeSettingsService } from "@/services/finance/finance-settings.service";

/**
 * GET /api/purchasing/receipts/unmatched
 * 
 * Get all PO receipts that don't have associated invoices
 * This is critical for finance teams to track what needs to be invoiced
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const page      = parseInt(searchParams.get("page")  ?? "1");
    const limit     = parseInt(searchParams.get("limit") ?? "50");
    const supplierId = searchParams.get("supplierId");
    const startDate  = searchParams.get("startDate");
    const endDate    = searchParams.get("endDate");
    const minAmount  = searchParams.get("minAmount");
    const maxAmount  = searchParams.get("maxAmount");
    const search     = searchParams.get("search");
    // Sort — validated against an allowlist; relations use nested orderBy syntax
    const SORTABLE_FIELDS = ["receivedAt", "totalCost", "receiptNumber", "poNumber"] as const;
    type SortField = (typeof SORTABLE_FIELDS)[number];
    const rawSortBy  = searchParams.get("sortBy") ?? "receivedAt";
    const sortBy: SortField = (SORTABLE_FIELDS as readonly string[]).includes(rawSortBy)
      ? (rawSortBy as SortField)
      : "receivedAt";
    const sortOrder: "asc" | "desc" = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

    const orderBy: Parameters<typeof prisma.pOLineReceipt.findMany>[0]["orderBy"] = (() => {
      switch (sortBy) {
        case "totalCost":     return { totalCost:    sortOrder };
        case "receiptNumber": return { receiptNumber: sortOrder };
        case "poNumber":      return { poLine: { purchaseOrder: { poNumber: sortOrder } } };
        default:              return { receivedAt:   sortOrder };
      }
    })();

    const skip = (page - 1) * limit;

    // Go-live floor — same pattern as received-not-invoiced.service.ts.
    // Pre-cutover receipts were settled in the prior system and must not
    // appear in the Finance team's active work queue. If goLiveDate is
    // null (fresh-start deployment), no floor is applied.
    const { goLiveDate, priorSystemName } = await financeSettingsService.getGoLiveConfig();

    // Build the base `receivedAt` filter as an AND array so the go-live floor
    // is never overwritten by subsequent date-range filters.  Using Prisma
    // `AND` allows us to combine any number of `receivedAt` constraints without
    // spreading (which would silently discard the earlier constraint).
    //
    // Example: goLiveDate = 2026-03-01, startDate = 2026-04-01
    // → AND: [{ receivedAt: { gte: 2026-03-01 } }, { receivedAt: { gte: 2026-04-01 } }]
    // Prisma ANDs both; effective filter = receivedAt >= 2026-04-01. ✓
    const dateConstraints: Prisma.POLineReceiptWhereInput[] = [];
    if (goLiveDate) {
      dateConstraints.push({ receivedAt: { gte: goLiveDate } });
    }
    if (startDate) {
      dateConstraints.push({ receivedAt: { gte: new Date(startDate) } });
    }
    if (endDate) {
      dateConstraints.push({ receivedAt: { lte: new Date(endDate) } });
    }

    // Build where clause
    const where: Prisma.POLineReceiptWhereInput = {
      invoiceId: null, // Key filter: no invoice linked
      isReturn: false, // Exclude returns
      ...(dateConstraints.length > 0 ? { AND: dateConstraints } : {}),
    };

    // Add optional filters
    if (supplierId) {
      where.poLine = {
        purchaseOrder: {
          supplierId,
        },
      };
    }

    if (minAmount || maxAmount) {
      where.totalCost = {};
      if (minAmount) {
        where.totalCost.gte = parseFloat(minAmount);
      }
      if (maxAmount) {
        where.totalCost.lte = parseFloat(maxAmount);
      }
    }

    if (search) {
      where.OR = [
        { receiptNumber: { contains: search, mode: "insensitive" } },
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { poLine: { description: { contains: search, mode: "insensitive" } } },
        { poLine: { purchaseOrder: { poNumber: { contains: search, mode: "insensitive" } } } },
      ];
    }

    // Get receipts with related data
    const [receipts, total] = await Promise.all([
      prisma.pOLineReceipt.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          poLine: {
            include: {
              purchaseOrder: {
                select: {
                  id: true,
                  poNumber: true,
                  supplier: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                },
              },
              inventoryItem: {
                select: {
                  id: true,
                  sku: true,
                  description: true,
                },
              },
            },
          },
          receiver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      prisma.pOLineReceipt.count({ where }),
    ]);

    // Calculate summary statistics
    const summaryData = await prisma.pOLineReceipt.aggregate({
      where,
      _sum: {
        totalCost: true,
      },
      _count: true,
    });

    // Get aging analysis (receipts by age).
    // Each aging bucket adds its own receivedAt constraint via AND so the
    // go-live floor already in `where.AND` is preserved and not overwritten.
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const agingBase = (extraConstraint: Prisma.POLineReceiptWhereInput): Prisma.POLineReceiptWhereInput => ({
      ...where,
      AND: [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        extraConstraint,
      ],
    });

    const [current, thirtyDays, sixtyDays, overNinety] = await Promise.all([
      prisma.pOLineReceipt.aggregate({
        where: agingBase({ receivedAt: { gte: thirtyDaysAgo } }),
        _sum: { totalCost: true },
        _count: true,
      }),
      prisma.pOLineReceipt.aggregate({
        where: agingBase({ receivedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }),
        _sum: { totalCost: true },
        _count: true,
      }),
      prisma.pOLineReceipt.aggregate({
        where: agingBase({ receivedAt: { gte: ninetyDaysAgo, lt: sixtyDaysAgo } }),
        _sum: { totalCost: true },
        _count: true,
      }),
      prisma.pOLineReceipt.aggregate({
        // overNinety: older than 90 days AND still on or after go-live floor
        where: agingBase({ receivedAt: { lt: ninetyDaysAgo } }),
        _sum: { totalCost: true },
        _count: true,
      }),
    ]);

    // Get supplier breakdown using Prisma aggregation
    const receiptsWithSupplier = await prisma.pOLineReceipt.findMany({
      where,
      select: {
        totalCost: true,
        poLine: {
          select: {
            purchaseOrder: {
              select: {
                supplier: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Aggregate by supplier
    const supplierMap = new Map<string, { name: string; count: number; totalAmount: number }>();
    receiptsWithSupplier.forEach((receipt) => {
      const supplier = receipt.poLine.purchaseOrder.supplier;
      const existing = supplierMap.get(supplier.id) ?? { name: supplier.name, count: 0, totalAmount: 0 };
      existing.count++;
      existing.totalAmount += Number(receipt.totalCost);
      supplierMap.set(supplier.id, existing);
    });

    const supplierBreakdown = Array.from(supplierMap.entries())
      .map(([supplierId, data]) => ({
        supplierId,
        supplierName: data.name,
        count: data.count,
        totalAmount: data.totalAmount,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);

    // Convert Prisma Decimal fields to numbers to prevent string concatenation in the client
    const serializedReceipts = receipts.map((r) => ({
      ...r,
      totalCost: Number(r.totalCost) || 0,
      unitCost: Number(r.unitCost) || 0,
      quantityReceived: Number(r.quantityReceived) || 0,
      poLine: {
        ...r.poLine,
        unitPrice: Number(r.poLine.unitPrice) || 0,
        quantity: Number(r.poLine.quantity) || 0,
        totalPrice: Number(r.poLine.totalPrice) || 0,
      },
    }));

    // Count pre-cutover receipts that were excluded (for the banner)
    let preCutoverExcluded = 0;
    let preCutoverExcludedAmount = 0;
    if (goLiveDate) {
      const preCutoverBase: Prisma.POLineReceiptWhereInput = {
        invoiceId: null,
        isReturn: false,
        receivedAt: { lt: goLiveDate },
      };
      const preCutover = await prisma.pOLineReceipt.aggregate({
        where: preCutoverBase,
        _count: { id: true },
        _sum: { totalCost: true },
      });
      preCutoverExcluded = preCutover._count.id;
      preCutoverExcludedAmount = Number(preCutover._sum.totalCost ?? 0);
    }

    return NextResponse.json({
      goLiveDate: goLiveDate ? goLiveDate.toISOString().slice(0, 10) : null,
      priorSystemName: priorSystemName ?? null,
      preCutoverExcluded,
      preCutoverExcludedAmount,
      receipts: serializedReceipts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalReceipts: summaryData._count,
        totalValue: Number(summaryData._sum.totalCost) || 0,
      },
      aging: {
        current: {
          count: current._count,
          value: Number(current._sum.totalCost) || 0,
          label: "0-30 days",
        },
        thirtyDays: {
          count: thirtyDays._count,
          value: Number(thirtyDays._sum.totalCost) || 0,
          label: "31-60 days",
        },
        sixtyDays: {
          count: sixtyDays._count,
          value: Number(sixtyDays._sum.totalCost) || 0,
          label: "61-90 days",
        },
        overNinety: {
          count: overNinety._count,
          value: Number(overNinety._sum.totalCost) || 0,
          label: "90+ days",
        },
      },
      supplierBreakdown,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch unmatched receipts" },
      { status: 500 }
    );
  }
}
