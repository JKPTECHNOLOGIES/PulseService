const prisma = require("../config/database");
const { generateNumber } = require("../utils/helpers");

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"];

// Advance a date by one recurrence step (frequency × interval).
function advance(date, frequency, interval) {
  const d = new Date(date);
  const n = Math.max(1, interval || 1);
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7 * n);
      break;
    case "biweekly":
      d.setDate(d.getDate() + 14 * n);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3 * n);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + n);
      break;
    case "monthly":
    default:
      d.setMonth(d.getMonth() + n);
      break;
  }
  return d;
}

// Attach customer names to a list of templates (no Prisma relation, so we join
// in JS from a single batched lookup).
async function withCustomers(templates) {
  const ids = [...new Set(templates.map((t) => t.customerId))];
  const customers = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, companyName: true },
  });
  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  return templates.map((t) => ({ ...t, customer: byId[t.customerId] ?? null }));
}

const list = async (req, res) => {
  try {
    const templates = await prisma.recurringJob.findMany({
      orderBy: [{ isActive: "desc" }, { nextRunDate: "asc" }],
    });
    return res.json({ success: true, data: await withCustomers(templates) });
  } catch (err) {
    console.error("recurring.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const { customerId, summary, nextRunDate, frequency = "monthly" } = req.body;
    if (!customerId || !summary || !nextRunDate) {
      return res.status(400).json({
        success: false,
        error: "customerId, summary, and nextRunDate are required",
      });
    }
    if (!FREQUENCIES.includes(frequency)) {
      return res
        .status(400)
        .json({ success: false, error: `Invalid frequency: ${frequency}` });
    }
    const {
      description,
      type = "service",
      priority = "normal",
      interval = 1,
      locationId,
    } = req.body;

    const template = await prisma.recurringJob.create({
      data: {
        customerId,
        locationId: locationId || null,
        summary,
        description: description || null,
        type,
        priority,
        frequency,
        interval: Math.max(1, parseInt(interval) || 1),
        nextRunDate: new Date(nextRunDate),
      },
    });
    return res.status(201).json({ success: true, data: template });
  } catch (err) {
    console.error("recurring.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const { id: _id, createdAt: _c, updatedAt: _u, customer: _cust, ...data } =
      req.body;
    if (data.nextRunDate) data.nextRunDate = new Date(data.nextRunDate);
    if (data.interval !== undefined) {
      data.interval = Math.max(1, parseInt(data.interval) || 1);
    }
    const template = await prisma.recurringJob.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: template });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Recurring job not found" });
    console.error("recurring.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.recurringJob.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Recurring job not found" });
    console.error("recurring.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Create one Job from a template and advance its schedule. Shared by the manual
// "generate now" endpoint and the "run all due" sweep.
async function generateOne(template, userId) {
  const customer = await prisma.customer.findUnique({
    where: { id: template.customerId },
    select: { id: true },
  });
  if (!customer) return null; // customer was deleted; skip

  const settings = await prisma.companySettings.findFirst();
  const jobNumber = generateNumber(settings.jobPrefix, settings.nextJobNumber);
  await prisma.companySettings.update({
    where: { id: settings.id },
    data: { nextJobNumber: { increment: 1 } },
  });

  const job = await prisma.job.create({
    data: {
      jobNumber,
      customerId: template.customerId,
      locationId: template.locationId,
      type: template.type,
      priority: template.priority,
      status: "scheduled",
      summary: template.summary,
      description: template.description,
      scheduledStart: template.nextRunDate,
      createdById: userId,
    },
  });

  await prisma.recurringJob.update({
    where: { id: template.id },
    data: {
      lastRunAt: new Date(),
      nextRunDate: advance(
        template.nextRunDate,
        template.frequency,
        template.interval,
      ),
    },
  });

  return job;
}

const generate = async (req, res) => {
  try {
    const template = await prisma.recurringJob.findUnique({
      where: { id: req.params.id },
    });
    if (!template)
      return res
        .status(404)
        .json({ success: false, error: "Recurring job not found" });

    const job = await generateOne(template, req.user.id);
    if (!job) {
      return res
        .status(400)
        .json({ success: false, error: "Customer no longer exists" });
    }
    return res.status(201).json({ success: true, data: job });
  } catch (err) {
    console.error("recurring.generate error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Generate jobs for every active template whose next run date has arrived.
const runDue = async (req, res) => {
  try {
    const due = await prisma.recurringJob.findMany({
      where: { isActive: true, nextRunDate: { lte: new Date() } },
    });
    let created = 0;
    for (const template of due) {
      const job = await generateOne(template, req.user.id);
      if (job) created += 1;
    }
    return res.json({ success: true, data: { created } });
  } catch (err) {
    console.error("recurring.runDue error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, create, update, remove, generate, runDue };
