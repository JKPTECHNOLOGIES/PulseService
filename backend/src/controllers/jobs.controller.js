const prisma = require("../config/database");
const { respondError } = require("../utils/apiError");
const {
  paginate,
  paginatedResponse,
  generateNumber,
} = require("../utils/helpers");
const notify = require("../services/notification.service");

// Status rules:
//  - scheduled / dispatched / in_progress / on_hold interchange freely.
//  - No status can move back to "new" (it is only an initial state).
//  - "completed" can only be reached from "in_progress".
//  - "cancelled" can be entered from anywhere and reactivated to a working
//    status.
const STATUS_TRANSITIONS = {
  new: ["scheduled", "dispatched", "in_progress", "on_hold", "cancelled"],
  scheduled: ["dispatched", "in_progress", "on_hold", "cancelled"],
  dispatched: ["scheduled", "in_progress", "on_hold", "cancelled"],
  in_progress: ["scheduled", "dispatched", "on_hold", "completed", "cancelled"],
  on_hold: ["scheduled", "dispatched", "in_progress", "cancelled"],
  completed: ["scheduled", "dispatched", "in_progress", "on_hold", "cancelled"],
  cancelled: ["scheduled", "dispatched", "in_progress", "on_hold"],
};

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
      archived,
    } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
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

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take,
        include: {
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
        },
        orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
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
        timeEntries: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { startTime: "desc" },
        },
        call: { select: { id: true, fromNumber: true, reason: true } },
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

    // technicianIds isn't a Job column -- it maps to JobTechnician join rows.
    // Replace the assignments here (and keep it out of the scalar update data,
    // which otherwise breaks Prisma's input typing and 500s the whole save).
    let newlyAssigned = [];
    if (Array.isArray(technicianIds)) {
      const existingAssignments = await prisma.jobTechnician.findMany({
        where: { jobId: req.params.id },
        select: { technicianId: true },
      });
      const existingIds = new Set(
        existingAssignments.map((a) => a.technicianId),
      );
      newlyAssigned = technicianIds.filter((tid) => !existingIds.has(tid));
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

    const job = await prisma.job.update({
      where: { id: req.params.id },
      data,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
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
    }

    // Notify only technicians newly added by this edit (not existing ones).
    await notify.notifyJobAssigned(newlyAssigned, job);

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

    const data = { status };
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

    const assignment = await prisma.jobTechnician.upsert({
      where: { jobId_technicianId: { jobId: req.params.id, technicianId } },
      create: { jobId: req.params.id, technicianId, isLead },
      update: { isLead },
    });

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

    return res.json({ success: true, data: assignment });
  } catch (err) {
    console.error("jobs.assignTechnician error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const removeTechnician = async (req, res) => {
  try {
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

    return res.json({ success: true, data: job });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    console.error("jobs.unarchive error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
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
