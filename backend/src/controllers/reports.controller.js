const prisma = require('../config/database');

const revenue = async (req, res) => {
  try {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const payments = await prisma.payment.findMany({
      where: {
        createdAt: { gte: twelveMonthsAgo },
        status: 'completed',
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
      .map((g) => ({
        year: g.year,
        month: g.month,
        revenue: Math.round(g.revenue * 100) / 100,
        invoiceCount: g.invoices.size,
      }))
      .sort((a, b) => a.year - b.year || a.month - b.month);

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('reports.revenue error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const jobs = async (req, res) => {
  try {
    const [byStatus, byType, allJobs] = await Promise.all([
      prisma.job.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.job.groupBy({ by: ['type'], _count: { id: true } }),
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

    // Average duration for completed jobs
    const completed = allJobs.filter(
      (j) => j.status === 'completed' && j.actualStart && j.actualEnd
    );
    const durations = completed.map(
      (j) => (new Date(j.actualEnd) - new Date(j.actualStart)) / 60000
    );
    const avgDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    // Count by business unit
    const buMap = {};
    allJobs.forEach((j) => {
      const bu = j.businessUnit || 'Unassigned';
      buMap[bu] = (buMap[bu] || 0) + 1;
    });

    return res.json({
      success: true,
      data: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })),
        byType: byType.map((t) => ({ type: t.type, count: t._count.id })),
        byBusinessUnit: Object.entries(buMap).map(([businessUnit, count]) => ({
          businessUnit,
          count,
        })),
        averageDurationMinutes: avgDuration,
        totalJobs: allJobs.length,
        completedJobs: completed.length,
      },
    });
  } catch (err) {
    console.error('reports.jobs error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const technicians = async (req, res) => {
  try {
    const techs = await prisma.technician.findMany({
      include: {
        user: { select: { firstName: true, lastName: true, isActive: true } },
        jobs: {
          where: { job: { status: 'completed' } },
          include: {
            job: {
              include: {
                invoices: {
                  where: { status: { in: ['paid', 'sent'] } },
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
        id: tech.id,
        employeeId: tech.employeeId,
        name: `${tech.user.firstName} ${tech.user.lastName}`,
        isActive: tech.user.isActive,
        completedJobs,
        revenue: Math.round(revenue * 100) / 100,
      };
    });

    data.sort((a, b) => b.completedJobs - a.completedJobs);

    return res.json({ success: true, data });
  } catch (err) {
    console.error('reports.technicians error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const customers = async (req, res) => {
  try {
    const allCustomers = await prisma.customer.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { jobs: true } },
        invoices: {
          where: { status: 'paid' },
          select: { total: true },
        },
      },
    });

    const withRevenue = allCustomers.map((c) => ({
      id: c.id,
      customerNumber: c.customerNumber,
      name: c.companyName || `${c.firstName} ${c.lastName}`,
      type: c.type,
      totalRevenue: Math.round(c.invoices.reduce((s, i) => s + i.total, 0) * 100) / 100,
      jobCount: c._count.jobs,
      isReturning: c._count.jobs >= 2,
    }));

    const top10 = [...withRevenue]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    const newCustomers = withRevenue.filter((c) => c.jobCount === 1).length;
    const returningCustomers = withRevenue.filter((c) => c.jobCount >= 2).length;
    const noJobCustomers = withRevenue.filter((c) => c.jobCount === 0).length;

    return res.json({
      success: true,
      data: {
        top10,
        newCustomers,
        returningCustomers,
        noJobCustomers,
        totalCustomers: allCustomers.length,
      },
    });
  } catch (err) {
    console.error('reports.customers error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { revenue, jobs, technicians, customers };
