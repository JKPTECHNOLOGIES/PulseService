const prisma = require("../config/database");
const { respondError } = require("../utils/apiError");
const {
  paginate,
  paginatedResponse,
  generateNumber,
} = require("../utils/helpers");
const notify = require("../services/notification.service");
const { LOOKUPS } = require("../constants/lookups");
const {
  recordTimelineEvent,
  describeFieldEdits,
} = require("../utils/timeline");

// Which Job fields get narrated as "edited X" on the customer timeline, and
// what to call each one -- matches the labels already used on the Job Detail
// page/PDF ("Work Order Description", "Work Summary", "Office Notes", "Tech
// Notes") so the wording is consistent everywhere a user sees it.
const JOB_NARRATED_FIELDS = [
  { field: "description", label: "Work Order Description" },
  { field: "summary", label: "Work Summary" },
  { field: "notes", label: "Office Notes" },
  { field: "techNotes", label: "Tech Notes" },
  { field: "type", label: "Work Order Type" },
  { field: "priority", label: "Priority" },
  { field: "source", label: "Source" },
  { field: "scheduledStart", label: "Scheduled Start" },
  { field: "scheduledEnd", label: "Scheduled End" },
];

function technicianName(jobTechnician) {
  const user = jobTechnician?.technician?.user;
  return user ? `${user.firstName} ${user.lastName}`.trim() : "a technician";
}

// Columns with a real matching DB column -- these stay a normal, efficient
// paginated query with a Prisma `orderBy`. "customer" is handled separately
// below since the visible name isn't a single DB column (see
// invoices.controller.js for the same pattern).
const JOB_ORDER_BY = {
  job: (dir) => ({ jobNumber: dir }),
  type: (dir) => ({ type: dir }),
  status: (dir) => ({ status: dir }),
  priority: (dir) => ({ priority: dir }),
  scheduled: (dir) => ({ scheduledStart: dir }),
  amount: (dir) => ({ totalAmount: dir }),
};

const JOB_INCLUDE = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      companyName: true,
      type: true,
    },
  },
  location: {
    select: {
      id: true,
      address: true,
      city: true,
      state: true,
      zip: true,
    },
  },
  technicians: {
    include: {
      technician: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
      },
    },
  },
};

function jobCustomerName(job) {
  const c = job.customer;
  if (!c) return "";
  if (c.companyName && c.companyName.trim()) return c.companyName;
  return `${c.firstName || ""} ${c.lastName || ""}`.trim();
}

// Status rules:
//  - scheduled / parts_on_hold / in_progress / on_hold interchange freely.
//  - No status can move back to "new" (it is only an initial state).
//  - "completed" can only be reached from "in_progress".
//  - "cancelled" can be entered from anywhere and reactivated to a working
//    status.
const STATUS_TRANSITIONS = {
  new: ["scheduled", "parts_on_hold", "in_progress", "on_hold", "cancelled"],
  scheduled: ["parts_on_hold", "in_progress", "on_hold", "cancelled"],
  parts_on_hold: ["scheduled", "in_progress", "on_hold", "cancelled"],
  in_progress: ["scheduled", "parts_on_hold", "on_hold", "completed", "cancelled"],
  on_hold: ["scheduled", "parts_on_hold", "in_progress", "cancelled"],
  completed: ["scheduled", "parts_on_hold", "in_progress", "on_hold", "cancelled"],
  cancelled: ["scheduled", "parts_on_hold", "in_progress", "on_hold"],
};

// Derived bookkeeping fields that go along with a status change (used by both
// the dedicated Update Status action and a full job edit that happens to
// change status, so the two paths stay consistent no matter which one is
// used) -- e.g. stamping completedAt/actualStart/cancelledAt.
function statusSideEffects(job, status, { cancelReason, completionNotes } = {}) {
  const data = {};
  if (status === "completed") {
    data.completedAt = new Date();
    if (!job.actualStart) data.actualStart = new Date();
    data.actualEnd = new Date();
    if (completionNotes) data.completionNotes = completionNotes;
  }
  if (status === "cancelled") {
    data.cancelledAt = new Date();
    if (cancelReason) data.cancelReason = cancelReason;
  }
  if (status === "in_progress" && !job.actualStart) {
    data.actualStart = new Date();
  }
  return data;
}

const list = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      type,
      dateFrom,
      dateTo,
      technicianId,
      customerId,
      archived,
      recurringJobId,
      sortKey,
      sortDir,
    } = req.query;
    const { skip, take } = paginate(page, limit);
    const dir = sortDir === "asc" ? "asc" : "desc";

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (customerId) where.customerId = customerId;
    if (recurringJobId) where.recurringJobId = recurringJobId;
    // Archived jobs are hidden by default so they stop cluttering active
    // lists/boards without ever being destroyed; ?archived=true shows only
    // archived ones, ?archived=all shows everything.
    if (archived === "true") where.isArchived = true;
    else if (archived !== "all") where.isArchived = false;
    if (technicianId) {
      where.technicians = { some: { technicianId } };
    }
    if (dateFrom || dateTo) {
      where.scheduledStart = {};
      if (dateFrom) where.scheduledStart.gte = new Date(dateFrom);
      if (dateTo) where.scheduledStart.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { jobNumber: { contains: search, mode: "insensitive" } },
        { summary: { contains: search, mode: "insensitive" } },
        { customer: { firstName: { contains: search, mode: "insensitive" } } },
        { customer: { lastName: { contains: search, mode: "insensitive" } } },
        {
          customer: { companyName: { contains: search, mode: "insensitive" } },
        },
      ];
    }

    // Sorting by customer has to look at every matching row (not just the
    // current page) since the effective name isn't a single DB column --
    // fetch the whole filtered set, sort/paginate in memory (same pattern as
    // invoices.controller.js).
    if (sortKey === "customer") {
      const all = await prisma.job.findMany({ where, include: JOB_INCLUDE });

      const factor = dir === "asc" ? 1 : -1;
      all.sort(
        (a, b) =>
          jobCustomerName(a)
            .toLowerCase()
            .localeCompare(jobCustomerName(b).toLowerCase()) * factor,
      );

      const total = all.length;
      const pageRows = all.slice(skip, skip + take);

      return res.json({
        success: true,
        ...paginatedResponse(pageRows, total, page, limit),
      });
    }

    const orderBy = JOB_ORDER_BY[sortKey]?.(dir) ?? [
      { scheduledStart: "asc" },
      { createdAt: "desc" },
    ];

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take,
        include: JOB_INCLUDE,
        orderBy,
      }),
      prisma.job.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(jobs, total, page, limit),
    });
  } catch (err) {
    console.error("jobs.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        location: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        technicians: {
          include: {
            technician: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    avatar: true,
                  },
                },
                vehicle: true,
              },
            },
          },
        },
        estimates: {
          select: { id: true, estimateNumber: true, status: true, total: true },
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            balance: true,
          },
        },
        equipment: true,
        forms: true,
        scheduleBlocks: { orderBy: { start: "asc" } },
        timeEntries: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { startTime: "desc" },
        },
        call: { select: { id: true, fromNumber: true, reason: true } },
        recurringJob: {
          select: { id: true, summary: true, frequency: true },
        },
      },
    });

    if (!job)
      return res.status(404).json({ success: false, error: "Job not found" });
    return res.json({ success: true, data: job });
  } catch (err) {
    console.error("jobs.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (!settings) {
      return res
        .status(500)
        .json({ success: false, error: "Company settings not found" });
    }

    const jobNumber = generateNumber(
      settings.jobPrefix,
      settings.nextJobNumber,
    );
    await prisma.companySettings.updateMany({
      data: { nextJobNumber: { increment: 1 } },
    });

    const { technicianIds, ...jobData } = req.body;

    const job = await prisma.job.create({
      data: {
        ...jobData,
        jobNumber,
        createdById: req.user.id,
        ...(technicianIds &&
          technicianIds.length > 0 && {
            technicians: {
              create: technicianIds.map((tid, i) => ({
                technicianId: tid,
                isLead: i === 0,
              })),
            },
          }),
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        location: true,
        technicians: {
          include: {
            technician: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    const io = req.app.get("io");
    if (io && job.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:created", job);
    }

    // Notify any technicians assigned at creation time.
    await notify.notifyJobAssigned(technicianIds, job);

    await recordTimelineEvent({
      customerId: job.customerId,
      entityType: "job",
      entityId: job.id,
      entityLabel: job.jobNumber,
      action: "created",
      description: "created Work Order",
      userId: req.user?.id,
    });

    return res.status(201).json({ success: true, data: job });
  } catch (err) {
    return respondError(res, err, "job");
  }
};

const update = async (req, res) => {
  try {
    const {
      id: _id,
      jobNumber: _jn,
      createdAt: _ca,
      updatedAt: _ua,
      technicians: _t,
      technicianIds,
      scheduleBlocks,
      expectedUpdatedAt,
      ...data
    } = req.body;

    // Optimistic concurrency: rather than locking a job while a tech has it
    // open (the FieldEdge behavior this is meant to beat), we let anyone edit
    // at any time but detect when someone else's save landed first, so
    // changes are never silently overwritten.
    if (expectedUpdatedAt) {
      const current = await prisma.job.findUnique({
        where: { id: req.params.id },
        select: { updatedAt: true },
      });
      if (!current) {
        return res.status(404).json({ success: false, error: "Job not found" });
      }
      if (
        new Date(current.updatedAt).getTime() !==
        new Date(expectedUpdatedAt).getTime()
      ) {
        return res.status(409).json({
          success: false,
          error:
            "This job was updated by someone else since you opened it. Refresh to see the latest changes before saving.",
          code: "STALE_JOB",
        });
      }
    }

    // Snapshot the narrated fields before applying the update, so we can
    // describe exactly what changed on the customer timeline afterward.
    const before = await prisma.job.findUnique({
      where: { id: req.params.id },
      select: {
        customerId: true,
        jobNumber: true,
        description: true,
        summary: true,
        notes: true,
        techNotes: true,
        type: true,
        priority: true,
        source: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        actualStart: true,
      },
    });
    if (!before) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }

    // technicianIds isn't a Job column -- it maps to JobTechnician join rows.
    // Replace the assignments here (and keep it out of the scalar update data,
    // which otherwise breaks Prisma's input typing and 500s the whole save).
    let newlyAssigned = [];
    let removedTechnicianIds = [];
    if (Array.isArray(technicianIds)) {
      const existingAssignments = await prisma.jobTechnician.findMany({
        where: { jobId: req.params.id },
        select: { technicianId: true },
      });
      const existingIds = new Set(
        existingAssignments.map((a) => a.technicianId),
      );
      newlyAssigned = technicianIds.filter((tid) => !existingIds.has(tid));
      removedTechnicianIds = [...existingIds].filter(
        (tid) => !technicianIds.includes(tid),
      );
      await prisma.jobTechnician.deleteMany({
        where: { jobId: req.params.id },
      });
      if (technicianIds.length > 0) {
        await prisma.jobTechnician.createMany({
          data: technicianIds.map((tid, i) => ({
            jobId: req.params.id,
            technicianId: tid,
            isLead: i === 0,
          })),
        });
      }
    }

    // scheduleBlocks are additional scheduled windows stored in their own table
    // (not Job columns). Like technicianIds, replace the whole set when the
    // client sends an array, so the dispatch editor is the source of truth.
    if (Array.isArray(scheduleBlocks)) {
      const clean = scheduleBlocks
        .map((b) => ({
          start: b.start ? new Date(b.start) : null,
          end: b.end ? new Date(b.end) : null,
          note: b.note ?? null,
        }))
        .filter(
          (b) =>
            b.start &&
            b.end &&
            !Number.isNaN(b.start.getTime()) &&
            !Number.isNaN(b.end.getTime()) &&
            b.end > b.start,
        );
      await prisma.jobScheduleBlock.deleteMany({
        where: { jobId: req.params.id },
      });
      if (clean.length > 0) {
        await prisma.jobScheduleBlock.createMany({
          data: clean.map((b) => ({ jobId: req.params.id, ...b })),
        });
      }
    }

    // A full edit can change status too now (the job form offers every
    // status once a job is past New/Scheduled -- see JobFormPage). Apply the
    // same derived bookkeeping (completedAt/actualStart/cancelledAt) as the
    // dedicated Update Status action so the two paths stay consistent, and
    // narrate it the same way. Deliberately skips STATUS_TRANSITIONS here --
    // a full edit is also how an office user corrects a mistaken status, so
    // it isn't restricted to the same forward-moving transitions.
    const statusChanged = data.status && data.status !== before.status;
    if (statusChanged) {
      Object.assign(
        data,
        statusSideEffects(before, data.status, {
          cancelReason: data.cancelReason,
          completionNotes: data.completionNotes,
        }),
      );
    }

    const job = await prisma.job.update({
      where: { id: req.params.id },
      data,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        scheduleBlocks: { orderBy: { start: "asc" } },
        technicians: {
          include: {
            technician: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    const io = req.app.get("io");
    if (io && job.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:updated", job);
      if (statusChanged) {
        io.to(`dispatch:${date}`).emit("job:statusChanged", {
          id: job.id,
          status: job.status,
        });
      }
    }

    // Notify only technicians newly added by this edit (not existing ones).
    await notify.notifyJobAssigned(newlyAssigned, job);

    if (statusChanged) {
      const statusLabel =
        LOOKUPS.jobStatus.find((o) => o.value === job.status)?.label ??
        job.status;
      await recordTimelineEvent({
        customerId: before.customerId,
        entityType: "job",
        entityId: job.id,
        entityLabel: before.jobNumber,
        action: "status_change",
        description: `marked Work Order as "${statusLabel}"`,
        userId: req.user?.id,
      });
    }

    const fieldEdits = describeFieldEdits(before, job, JOB_NARRATED_FIELDS);
    for (const description of fieldEdits) {
      await recordTimelineEvent({
        customerId: before.customerId,
        entityType: "job",
        entityId: job.id,
        entityLabel: before.jobNumber,
        action: "edited",
        description,
        userId: req.user?.id,
      });
    }

    if (newlyAssigned.length > 0 || removedTechnicianIds.length > 0) {
      const changedTechs = await prisma.technician.findMany({
        where: { id: { in: [...newlyAssigned, ...removedTechnicianIds] } },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      const nameById = new Map(
        changedTechs.map((t) => [
          t.id,
          t.user ? `${t.user.firstName} ${t.user.lastName}`.trim() : "a technician",
        ]),
      );
      for (const tid of newlyAssigned) {
        await recordTimelineEvent({
          customerId: before.customerId,
          entityType: "job",
          entityId: job.id,
          entityLabel: before.jobNumber,
          action: "assigned",
          description: `assigned ${nameById.get(tid) ?? "a technician"} to Work Order`,
          userId: req.user?.id,
        });
      }
      for (const tid of removedTechnicianIds) {
        await recordTimelineEvent({
          customerId: before.customerId,
          entityType: "job",
          entityId: job.id,
          entityLabel: before.jobNumber,
          action: "unassigned",
          description: `removed ${nameById.get(tid) ?? "a technician"} from Work Order`,
          userId: req.user?.id,
        });
      }
    }

    return res.json({ success: true, data: job });
  } catch (err) {
    return respondError(res, err, "job");
  }
};

const updateStatus = async (req, res) => {
  try {
    const { status, cancelReason, completionNotes } = req.body;

    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job)
      return res.status(404).json({ success: false, error: "Job not found" });

    const allowed = STATUS_TRANSITIONS[job.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot transition from "${job.status}" to "${status}". Allowed: ${allowed.join(", ") || "none"}`,
      });
    }

    const data = { status, ...statusSideEffects(job, status, { cancelReason, completionNotes }) };

    const updated = await prisma.job.update({
      where: { id: req.params.id },
      data,
    });

    const io = req.app.get("io");
    if (io && (updated.scheduledStart || job.scheduledStart)) {
      const src = updated.scheduledStart || job.scheduledStart;
      const date = new Date(src).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:statusChanged", {
        id: updated.id,
        status: updated.status,
      });
    }

    const statusLabel =
      LOOKUPS.jobStatus.find((o) => o.value === status)?.label ?? status;
    await recordTimelineEvent({
      customerId: job.customerId,
      entityType: "job",
      entityId: job.id,
      entityLabel: job.jobNumber,
      action: "status_change",
      description: `marked Work Order as "${statusLabel}"`,
      userId: req.user?.id,
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("jobs.updateStatus error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const assignTechnician = async (req, res) => {
  try {
    const { technicianId, isLead = false } = req.body;
    if (!technicianId) {
      return res
        .status(400)
        .json({ success: false, error: "technicianId is required" });
    }

    // Was this tech already on the job? (Avoid re-notifying on a lead toggle.)
    const existing = await prisma.jobTechnician.findUnique({
      where: { jobId_technicianId: { jobId: req.params.id, technicianId } },
    });

    // Only one lead per job -- promoting this tech demotes whoever held it.
    const txResults = await prisma.$transaction([
      ...(isLead
        ? [
            prisma.jobTechnician.updateMany({
              where: { jobId: req.params.id, technicianId: { not: technicianId } },
              data: { isLead: false },
            }),
          ]
        : []),
      prisma.jobTechnician.upsert({
        where: { jobId_technicianId: { jobId: req.params.id, technicianId } },
        create: { jobId: req.params.id, technicianId, isLead },
        update: { isLead },
      }),
    ]);
    const assignment = txResults[txResults.length - 1];

    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    const io = req.app.get("io");
    if (io && job?.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:technicianAssigned", {
        jobId: req.params.id,
        technicianId,
      });
    }

    // Notify the newly-assigned technician (in-app + web push). Skip if they
    // were already on the job (e.g. a lead toggle).
    if (!existing && job) {
      await notify.notifyJobAssigned([technicianId], job);
    }

    if (job) {
      const tech = await prisma.technician.findUnique({
        where: { id: technicianId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!existing) {
        await recordTimelineEvent({
          customerId: job.customerId,
          entityType: "job",
          entityId: job.id,
          entityLabel: job.jobNumber,
          action: "assigned",
          description: `assigned ${technicianName({ technician: tech })} to Work Order`,
          userId: req.user?.id,
        });
      } else if (isLead && !existing.isLead) {
        // Promoting an already-assigned tech to lead -- worth its own note,
        // distinct from the initial assignment above.
        await recordTimelineEvent({
          customerId: job.customerId,
          entityType: "job",
          entityId: job.id,
          entityLabel: job.jobNumber,
          action: "assigned",
          description: `made ${technicianName({ technician: tech })} the lead technician on Work Order`,
          userId: req.user?.id,
        });
      }
    }

    return res.json({ success: true, data: assignment });
  } catch (err) {
    console.error("jobs.assignTechnician error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const removeTechnician = async (req, res) => {
  try {
    const tech = await prisma.technician.findUnique({
      where: { id: req.params.techId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    await prisma.jobTechnician.delete({
      where: {
        jobId_technicianId: {
          jobId: req.params.id,
          technicianId: req.params.techId,
        },
      },
    });

    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    const io = req.app.get("io");
    if (io && job?.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:technicianRemoved", {
        jobId: req.params.id,
        technicianId: req.params.techId,
      });
    }

    if (job) {
      await recordTimelineEvent({
        customerId: job.customerId,
        entityType: "job",
        entityId: job.id,
        entityLabel: job.jobNumber,
        action: "unassigned",
        description: `removed ${technicianName({ technician: tech })} from Work Order`,
        userId: req.user?.id,
      });
    }

    return res.json({ success: true, message: "Technician removed from job" });
  } catch (err) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "Assignment not found" });
    }
    console.error("jobs.removeTechnician error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const deleteJob = async (req, res) => {
  const { id } = req.params;
  try {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }

    // Clear dependents first so foreign keys never block the delete:
    // assignments/forms are removed; estimates/invoices/equipment/time entries
    // are detached (jobId set to null) to preserve their financial records.
    await prisma.$transaction([
      prisma.jobTechnician.deleteMany({ where: { jobId: id } }),
      prisma.jobForm.deleteMany({ where: { jobId: id } }),
      prisma.timeEntry.updateMany({
        where: { jobId: id },
        data: { jobId: null },
      }),
      prisma.equipment.updateMany({
        where: { jobId: id },
        data: { jobId: null },
      }),
      prisma.estimate.updateMany({
        where: { jobId: id },
        data: { jobId: null },
      }),
      prisma.invoice.updateMany({
        where: { jobId: id },
        data: { jobId: null },
      }),
      prisma.job.delete({ where: { id } }),
    ]);

    const io = req.app.get("io");
    if (io && job.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:deleted", { id });
    }

    return res.json({ success: true, message: "Job deleted" });
  } catch (err) {
    console.error("jobs.delete error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Archiving is the safe, reversible alternative to deleteJob above: it just
// hides the job from the default lists/board instead of destroying it and
// detaching its records.
const archiveJob = async (req, res) => {
  try {
    const job = await prisma.job.update({
      where: { id: req.params.id },
      data: { isArchived: true, archivedAt: new Date() },
    });

    const io = req.app.get("io");
    if (io && job.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:archived", { id: job.id });
    }

    await recordTimelineEvent({
      customerId: job.customerId,
      entityType: "job",
      entityId: job.id,
      entityLabel: job.jobNumber,
      action: "archived",
      description: "archived Work Order",
      userId: req.user?.id,
    });

    return res.json({ success: true, data: job });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    console.error("jobs.archive error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const unarchiveJob = async (req, res) => {
  try {
    const job = await prisma.job.update({
      where: { id: req.params.id },
      data: { isArchived: false, archivedAt: null },
    });

    const io = req.app.get("io");
    if (io && job.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("job:updated", job);
    }

    await recordTimelineEvent({
      customerId: job.customerId,
      entityType: "job",
      entityId: job.id,
      entityLabel: job.jobNumber,
      action: "unarchived",
      description: "restored Work Order from archive",
      userId: req.user?.id,
    });

    return res.json({ success: true, data: job });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    console.error("jobs.unarchive error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Distinct job types in use, merged with the built-in suggestions -- powers
// the type-ahead on the job form so a custom type typed once is offered as a
// pick for every job after that (type is free text; see jobs.routes.js).
const types = async (req, res) => {
  try {
    const used = await prisma.job.findMany({
      distinct: ["type"],
      select: { type: true },
    });
    const defaults = LOOKUPS.jobType.map((o) => o.label);
    const merged = [...new Set([...defaults, ...used.map((j) => j.type)])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return res.json({ success: true, data: merged });
  } catch (err) {
    console.error("jobs.types error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  types,
  get,
  create,
  update,
  updateStatus,
  assignTechnician,
  removeTechnician,
  delete: deleteJob,
  archive: archiveJob,
  unarchive: unarchiveJob,
};
