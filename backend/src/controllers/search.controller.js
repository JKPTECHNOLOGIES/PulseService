const prisma = require("../config/database");

// Global "jump to anything" search used by the hidden command palette.
// Searches the key record types and returns a flat, uniform result list.
const globalSearch = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) {
      return res.json({ success: true, data: { results: [] } });
    }

    const like = { contains: q, mode: "insensitive" };
    const take = 5;

    const [customers, jobs, invoices, estimates, technicians, equipment, items] =
      await Promise.all([
        prisma.customer.findMany({
          where: {
            OR: [
              { firstName: like },
              { lastName: like },
              { companyName: like },
              { email: like },
              { phone: like },
              { customerNumber: like },
            ],
          },
          take,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            customerNumber: true,
          },
        }),
        prisma.job.findMany({
          where: {
            OR: [
              { jobNumber: like },
              { summary: like },
              { customer: { firstName: like } },
              { customer: { lastName: like } },
              { customer: { companyName: like } },
            ],
          },
          take,
          select: { id: true, jobNumber: true, summary: true },
        }),
        prisma.invoice.findMany({
          where: {
            OR: [
              { invoiceNumber: like },
              { customer: { firstName: like } },
              { customer: { lastName: like } },
              { customer: { companyName: like } },
            ],
          },
          take,
          select: {
            id: true,
            invoiceNumber: true,
            customer: {
              select: { firstName: true, lastName: true, companyName: true },
            },
          },
        }),
        prisma.estimate.findMany({
          where: {
            OR: [
              { estimateNumber: like },
              { title: like },
              { customer: { firstName: like } },
              { customer: { lastName: like } },
              { customer: { companyName: like } },
            ],
          },
          take,
          select: { id: true, estimateNumber: true, title: true },
        }),
        prisma.technician.findMany({
          where: {
            OR: [
              { employeeId: like },
              { user: { firstName: like } },
              { user: { lastName: like } },
              { user: { email: like } },
            ],
          },
          take,
          select: {
            id: true,
            employeeId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        }),
        prisma.equipment.findMany({
          where: {
            OR: [
              { name: like },
              { serialNumber: like },
              { manufacturer: like },
              { model: like },
            ],
          },
          take,
          select: { id: true, name: true, serialNumber: true },
        }),
        prisma.pricebookItem.findMany({
          where: {
            isActive: true,
            OR: [{ name: like }, { sku: like }, { description: like }],
          },
          take,
          select: { id: true, name: true, sku: true },
        }),
      ]);

    const custName = (c) =>
      c.companyName || `${c.firstName} ${c.lastName}`.trim();

    const results = [
      ...customers.map((c) => ({
        type: "Customer",
        id: c.id,
        label: custName(c),
        sublabel: c.customerNumber,
        url: `/customers/${c.id}`,
      })),
      ...jobs.map((j) => ({
        type: "Job",
        id: j.id,
        label: `#${j.jobNumber}`,
        sublabel: j.summary,
        url: `/jobs/${j.id}`,
      })),
      ...invoices.map((i) => ({
        type: "Invoice",
        id: i.id,
        label: `#${i.invoiceNumber}`,
        sublabel: i.customer ? custName(i.customer) : "",
        url: `/invoices/${i.id}`,
      })),
      ...estimates.map((e) => ({
        type: "Estimate",
        id: e.id,
        label: `#${e.estimateNumber}`,
        sublabel: e.title || "",
        url: `/estimates/${e.id}`,
      })),
      ...technicians.map((t) => ({
        type: "Technician",
        id: t.id,
        label: `${t.user.firstName} ${t.user.lastName}`,
        sublabel: t.employeeId,
        url: "/technicians",
      })),
      ...equipment.map((eq) => ({
        type: "Equipment",
        id: eq.id,
        label: eq.name,
        sublabel: eq.serialNumber || "",
        url: "/equipment",
      })),
      ...items.map((p) => ({
        type: "Pricebook",
        id: p.id,
        label: p.name,
        sublabel: p.sku || "",
        url: "/pricebook",
      })),
    ];

    return res.json({ success: true, data: { results } });
  } catch (err) {
    console.error("search.globalSearch error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { globalSearch };
