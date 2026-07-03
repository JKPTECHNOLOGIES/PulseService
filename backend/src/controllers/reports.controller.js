const prisma = require("../config/database");

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const revenue = async (req, res) => {
  try {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const payments = await prisma.payment.findMany({
      where: {
        createdAt: { gte: twelveMonthsAgo },
        status: "completed",
      },
      select: { amount: true, createdAt: true, invoiceId: true },
    });

    // Group by year-month in JavaScript (SQLite doesn't support date_trunc)
    const grouped = {};
    payments.forEach((p) => {
      const d = new Date(p.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      if (!grouped[key]) {
        grouped[key] = {
          year: d.getFullYear(),
          month: d.getMonth() + 1,
          revenue: 0,
          invoices: new Set(),
        };
      }
      grouped[key].revenue += p.amount;
      grouped[key].invoices.add(p.invoiceId);
    });

    const result = Object.values(grouped)
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map((g) => ({
        year: g.year,
        month: MONTH_LABELS[g.month - 1],
        revenue: Math.round(g.revenue * 100) / 100,
        invoiceCount: g.invoices.size,
      }));

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("reports.revenue error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const jobs = async (req, res) => {
  try {
    const [byStatus, byType, allJobs] = await Promise.all([
      prisma.job.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.job.groupBy({ by: ["type"], _count: { id: true } }),
      prisma.job.findMany({
        select: {
          status: true,
          type: true,
          businessUnit: true,
          actualStart: true,
          actualEnd: true,
        },
      }),
    ]);

    // Average duration (in hours) for completed jobs
    const completed = allJobs.filter(
      (j) => j.status === "completed" && j.actualStart && j.actualEnd,
    );
    const cancelled = allJobs.filter((j) => j.status === "cancelled").length;
    const durations = completed.map(
      (j) => (new Date(j.actualEnd) - new Date(j.actualStart)) / 60000,
    );
    const avgDurationHours =
      durations.length > 0
        ? Math.round(
            (durations.reduce((a, b) => a + b, 0) / durations.length / 60) * 10,
          ) / 10
        : 0;

    // Count by business unit
    const buMap = {};
    allJobs.forEach((j) => {
      const bu = j.businessUnit || "Unassigned";
      buMap[bu] = (buMap[bu] || 0) + 1;
    });

    return res.json({
      success: true,
      data: {
        total: allJobs.length,
        completed: completed.length,
        cancelled,
        byStatus: byStatus.map((s) => ({
          status: s.status,
          count: s._count.id,
        })),
        byType: byType.map((t) => ({ type: t.type, count: t._count.id })),
        byBusinessUnit: Object.entries(buMap).map(([businessUnit, count]) => ({
          businessUnit,
          count,
        })),
        avgDuration: avgDurationHours,
      },
    });
  } catch (err) {
    console.error("reports.jobs error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const technicians = async (req, res) => {
  try {
    const techs = await prisma.technician.findMany({
      include: {
        user: { select: { firstName: true, lastName: true, isActive: true } },
        jobs: {
          where: { job: { status: "completed" } },
          include: {
            job: {
              include: {
                invoices: {
                  where: { status: { in: ["paid", "sent"] } },
                  select: { total: true },
                },
              },
            },
          },
        },
      },
    });

    const data = techs.map((tech) => {
      const completedJobs = tech.jobs.length;
      const revenue = tech.jobs.reduce((sum, jt) => {
        return sum + jt.job.invoices.reduce((iSum, inv) => iSum + inv.total, 0);
      }, 0);

      return {
        technicianId: tech.id,
        employeeId: tech.employeeId,
        name: `${tech.user.firstName} ${tech.user.lastName}`,
        isActive: tech.user.isActive,
        jobsCompleted: completedJobs,
        revenue: Math.round(revenue * 100) / 100,
      };
    });

    data.sort((a, b) => b.jobsCompleted - a.jobsCompleted);

    return res.json({ success: true, data });
  } catch (err) {
    console.error("reports.technicians error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const customers = async (req, res) => {
  try {
    const allCustomers = await prisma.customer.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { jobs: true } },
        invoices: {
          where: { status: "paid" },
          select: { total: true },
        },
      },
    });

    const withRevenue = allCustomers.map((c) => ({
      id: c.id,
      customerNumber: c.customerNumber,
      name: c.companyName || `${c.firstName} ${c.lastName}`,
      type: c.type,
      totalRevenue:
        Math.round(c.invoices.reduce((s, i) => s + i.total, 0) * 100) / 100,
      jobCount: c._count.jobs,
      isReturning: c._count.jobs >= 2,
    }));

    const topCustomers = [...withRevenue]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        name: c.name,
        jobs: c.jobCount,
        revenue: c.totalRevenue,
      }));

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const newThisMonth = allCustomers.filter(
      (c) => new Date(c.createdAt) >= startOfMonth,
    ).length;
    const totalRevenue = withRevenue.reduce((s, c) => s + c.totalRevenue, 0);
    const avgRevenue =
      allCustomers.length > 0
        ? Math.round((totalRevenue / allCustomers.length) * 100) / 100
        : 0;

    return res.json({
      success: true,
      data: {
        total: allCustomers.length,
        newThisMonth,
        avgRevenue,
        topCustomers,
      },
    });
  } catch (err) {
    console.error("reports.customers error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Accounts-receivable aging: outstanding invoice balances bucketed by how far
// past due they are. Standard buckets: current (not yet due), 1-30, 31-60,
// 61-90, and 90+ days overdue.
const arAging = async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { notIn: ["void", "paid"] },
        balance: { gt: 0 },
      },
      select: {
        id: true,
        invoiceNumber: true,
        balance: true,
        dueDate: true,
        createdAt: true,
        customer: {
          select: { firstName: true, lastName: true, companyName: true },
        },
      },
    });

    const BUCKETS = [
      { key: "current", label: "Current", min: -Infinity, max: 0 },
      { key: "1-30", label: "1\u201330 days", min: 1, max: 30 },
      { key: "31-60", label: "31\u201360 days", min: 31, max: 60 },
      { key: "61-90", label: "61\u201390 days", min: 61, max: 90 },
      { key: "90+", label: "90+ days", min: 91, max: Infinity },
    ];
    const totals = Object.fromEntries(
      BUCKETS.map((b) => [b.key, { count: 0, amount: 0 }]),
    );

    const now = Date.now();
    const DAY = 86400000;

    const rows = invoices.map((inv) => {
      const due = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.createdAt);
      const daysOverdue = Math.floor((now - due.getTime()) / DAY);
      const bucket =
        BUCKETS.find((b) => daysOverdue >= b.min && daysOverdue <= b.max) ??
        BUCKETS[0];
      totals[bucket.key].count += 1;
      totals[bucket.key].amount += inv.balance;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName:
          inv.customer?.companyName ||
          `${inv.customer?.firstName ?? ""} ${inv.customer?.lastName ?? ""}`.trim() ||
          "Unknown",
        dueDate: inv.dueDate,
        balance: Math.round(inv.balance * 100) / 100,
        daysOverdue,
        bucket: bucket.key,
      };
    });

    rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
    const totalOutstanding =
      Math.round(rows.reduce((s, r) => s + r.balance, 0) * 100) / 100;

    return res.json({
      success: true,
      data: {
        totalOutstanding,
        buckets: BUCKETS.map((b) => ({
          key: b.key,
          label: b.label,
          count: totals[b.key].count,
          amount: Math.round(totals[b.key].amount * 100) / 100,
        })),
        invoices: rows,
      },
    });
  } catch (err) {
    console.error("reports.arAging error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// Revenue attributed to how the customer was acquired (Customer.source), over an
// optional custom date range. Answers "which marketing channels pay off?".
const salesBySource = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = { status: { not: "void" } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(`${from}T00:00:00.000Z`);
      if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999Z`);
    }

    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        total: true,
        amountPaid: true,
        customer: { select: { source: true } },
      },
    });

    const map = {};
    invoices.forEach((inv) => {
      const src = inv.customer?.source || "Unknown";
      map[src] ??= { source: src, invoiceCount: 0, invoiced: 0, collected: 0 };
      map[src].invoiceCount += 1;
      map[src].invoiced += inv.total;
      map[src].collected += inv.amountPaid;
    });

    const sources = Object.values(map)
      .map((r) => ({
        source: r.source,
        invoiceCount: r.invoiceCount,
        invoiced: round2(r.invoiced),
        collected: round2(r.collected),
      }))
      .sort((a, b) => b.invoiced - a.invoiced);

    return res.json({
      success: true,
      data: {
        totalInvoiced: round2(sources.reduce((s, r) => s + r.invoiced, 0)),
        totalCollected: round2(sources.reduce((s, r) => s + r.collected, 0)),
        sources,
      },
    });
  } catch (err) {
    console.error("reports.salesBySource error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Estimate pipeline + win rate.
const estimatePipeline = async (req, res) => {
  try {
    const grouped = await prisma.estimate.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { total: true },
    });

    const byStatus = grouped.map((g) => ({
      status: g.status,
      count: g._count.id,
      value: round2(g._sum.total || 0),
    }));
    const stat = (s) =>
      byStatus.find((b) => b.status === s) ?? { count: 0, value: 0 };

    const approved = stat("approved");
    const rejected = stat("rejected");
    const decided = approved.count + rejected.count;
    const openValue =
      stat("draft").value + stat("sent").value + stat("viewed").value;

    return res.json({
      success: true,
      data: {
        byStatus,
        winRate: decided > 0 ? Math.round((approved.count / decided) * 100) : 0,
        approvedValue: approved.value,
        approvedCount: approved.count,
        openValue: round2(openValue),
      },
    });
  } catch (err) {
    console.error("reports.estimatePipeline error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Inventory & purchasing overview: valuation by location, low stock, top items
// by value, recent weighted-average cost changes, and PO/receiving activity.
const inventory = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [items, locations, costChanges, poByStatus, recentReceipts] =
      await Promise.all([
        prisma.inventoryItem.findMany({
          where: { isArchived: false },
          include: {
            stock: {
              include: {
                stockLocation: { select: { id: true, name: true, code: true } },
              },
            },
          },
        }),
        prisma.stockLocation.findMany({ where: { isActive: true } }),
        prisma.inventoryItemCostHistory.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            inventoryItem: { select: { sku: true, name: true } },
          },
        }),
        prisma.purchaseOrder.groupBy({
          by: ["status"],
          _count: { id: true },
          _sum: { totalAmount: true },
        }),
        prisma.pOLineReceipt.findMany({
          where: { status: "active", receivedAt: { gte: thirtyDaysAgo } },
          select: { totalCost: true },
        }),
      ]);

    const valueByLocationMap = new Map(
      locations.map((l) => [
        l.id,
        {
          id: l.id,
          name: l.name,
          code: l.code,
          type: l.type,
          value: 0,
          items: 0,
        },
      ]),
    );

    let totalValue = 0;
    let lowStockCount = 0;
    const itemValues = [];

    for (const item of items) {
      const cost = Number(item.unitCost);
      let onHand = 0;
      for (const s of item.stock) {
        const q = Number(s.quantityOnHand);
        onHand += q;
        const bucket = valueByLocationMap.get(s.stockLocationId);
        if (bucket && q > 0) {
          bucket.value = round2(bucket.value + q * cost);
          bucket.items += 1;
        }
      }
      const value = round2(onHand * cost);
      totalValue = round2(totalValue + value);
      if (Number(item.reorderPoint) > 0 && onHand <= Number(item.reorderPoint))
        lowStockCount += 1;
      itemValues.push({
        id: item.id,
        sku: item.sku,
        name: item.name,
        onHand,
        unitCost: cost,
        value,
      });
    }

    const received30d = round2(
      recentReceipts.reduce((sum, r) => sum + Number(r.totalCost), 0),
    );

    return res.json({
      success: true,
      data: {
        totals: {
          totalItems: items.length,
          totalValue,
          lowStockCount,
          received30d,
        },
        valueByLocation: Array.from(valueByLocationMap.values()),
        topItemsByValue: itemValues
          .sort((a, b) => b.value - a.value)
          .slice(0, 10),
        recentCostChanges: costChanges.map((c) => ({
          id: c.id,
          sku: c.inventoryItem.sku,
          name: c.inventoryItem.name,
          oldUnitCost: Number(c.oldUnitCost),
          newUnitCost: Number(c.newUnitCost),
          changeSource: c.changeSource,
          createdAt: c.createdAt,
        })),
        poByStatus: poByStatus.map((g) => ({
          status: g.status,
          count: g._count.id,
          total: round2(Number(g._sum.totalAmount ?? 0)),
        })),
      },
    });
  } catch (err) {
    console.error("reports.inventory error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  revenue,
  jobs,
  technicians,
  customers,
  arAging,
  salesBySource,
  estimatePipeline,
  inventory,
};
