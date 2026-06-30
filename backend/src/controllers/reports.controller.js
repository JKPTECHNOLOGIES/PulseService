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

module.exports = { revenue, jobs, technicians, customers };
