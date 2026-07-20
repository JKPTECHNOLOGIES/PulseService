const prisma = require("../config/database");

// Link a time entry to the logged-in user's technician profile when they have
// one (so it shows up in technician reports), in addition to the user id.
async function techIdForUser(userId) {
  const tech = await prisma.technician.findUnique({
    where: { userId },
    select: { id: true },
  });
  return tech?.id ?? null;
}

// The user's currently-open time entry (clocked in, not yet out), or null.
const current = async (req, res) => {
  try {
    const entry = await prisma.timeEntry.findFirst({
      where: { userId: req.user.id, endTime: null },
      orderBy: { startTime: "desc" },
      include: {
        job: { select: { id: true, jobNumber: true, summary: true } },
      },
    });
    return res.json({ success: true, data: entry });
  } catch (err) {
    console.error("time.current error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const clockIn = async (req, res) => {
  try {
    const { jobId, type = "work", notes } = req.body;

    const open = await prisma.timeEntry.findFirst({
      where: { userId: req.user.id, endTime: null },
    });
    if (open) {
      return res.status(400).json({
        success: false,
        error: "You are already clocked in. Clock out first.",
      });
    }

    const technicianId = await techIdForUser(req.user.id);
    const entry = await prisma.timeEntry.create({
      data: {
        userId: req.user.id,
        technicianId,
        jobId: jobId || null,
        type,
        startTime: new Date(),
        notes: notes || null,
      },
      include: {
        job: { select: { id: true, jobNumber: true, summary: true } },
      },
    });
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error("time.clockIn error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const clockOut = async (req, res) => {
  try {
    const open = await prisma.timeEntry.findFirst({
      where: { userId: req.user.id, endTime: null },
      orderBy: { startTime: "desc" },
    });
    if (!open) {
      return res
        .status(400)
        .json({ success: false, error: "You are not clocked in." });
    }

    const endTime = new Date();
    const duration = Math.max(
      0,
      Math.round((endTime.getTime() - new Date(open.startTime).getTime()) / 60000),
    );
    const entry = await prisma.timeEntry.update({
      where: { id: open.id },
      data: { endTime, duration },
      include: {
        job: { select: { id: true, jobNumber: true, summary: true } },
      },
    });
    return res.json({ success: true, data: entry });
  } catch (err) {
    console.error("time.clockOut error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Time entries logged against a specific job (powers the job's Time card).
const listForJob = async (req, res) => {
  try {
    const entries = await prisma.timeEntry.findMany({
      where: { jobId: req.params.jobId },
      orderBy: { startTime: "desc" },
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
    });
    return res.json({ success: true, data: entries });
  } catch (err) {
    console.error("time.listForJob error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Admin-only (time.manage): manually log a completed (or still-open, if no
// endTime) entry for a technician — e.g. hours forgotten in the field, or
// backfilled from a paper timesheet. Duration is derived from start/end
// exactly like clock-out.
const create = async (req, res) => {
  try {
    const { technicianId, jobId, type = "work", startTime, endTime, notes } =
      req.body;

    if (!technicianId || !startTime) {
      return res.status(400).json({
        success: false,
        error: "technicianId and startTime are required",
      });
    }

    const tech = await prisma.technician.findUnique({
      where: { id: technicianId },
      select: { userId: true },
    });
    if (!tech) {
      return res
        .status(400)
        .json({ success: false, error: "Technician not found" });
    }

    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : null;
    if (end && end <= start) {
      return res
        .status(400)
        .json({ success: false, error: "End time must be after start time" });
    }
    const duration = end
      ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
      : null;

    const entry = await prisma.timeEntry.create({
      data: {
        userId: tech.userId,
        technicianId,
        jobId: jobId || null,
        type,
        startTime: start,
        endTime: end,
        duration,
        notes: notes || null,
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
        job: { select: { id: true, jobNumber: true, summary: true } },
      },
    });
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error("time.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Admin-only (time.manage): edit any field of an existing entry (correct
// hours, reassign to a different technician, tweak notes). Duration is
// recomputed whenever start and/or end change.
const update = async (req, res) => {
  try {
    const existing = await prisma.timeEntry.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "Time entry not found" });
    }

    const data = {};

    if (req.body.technicianId) {
      const tech = await prisma.technician.findUnique({
        where: { id: req.body.technicianId },
        select: { userId: true },
      });
      if (!tech) {
        return res
          .status(400)
          .json({ success: false, error: "Technician not found" });
      }
      data.technicianId = req.body.technicianId;
      data.userId = tech.userId;
    }
    if (req.body.jobId !== undefined) data.jobId = req.body.jobId || null;
    if (req.body.type !== undefined) data.type = req.body.type;
    if (req.body.notes !== undefined) data.notes = req.body.notes || null;

    const startProvided = req.body.startTime !== undefined;
    const endProvided = req.body.endTime !== undefined;
    const start = startProvided ? new Date(req.body.startTime) : existing.startTime;
    const end = endProvided
      ? req.body.endTime
        ? new Date(req.body.endTime)
        : null
      : existing.endTime;

    if (end && end <= start) {
      return res
        .status(400)
        .json({ success: false, error: "End time must be after start time" });
    }

    if (startProvided) data.startTime = start;
    if (endProvided) data.endTime = end;
    if (startProvided || endProvided) {
      data.duration = end
        ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
        : null;
    }

    const entry = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data,
      include: {
        user: { select: { firstName: true, lastName: true } },
        job: { select: { id: true, jobNumber: true, summary: true } },
      },
    });
    return res.json({ success: true, data: entry });
  } catch (err) {
    console.error("time.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Admin-only (time.manage): remove an incorrect or duplicate entry.
const remove = async (req, res) => {
  try {
    await prisma.timeEntry.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("time.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  current,
  clockIn,
  clockOut,
  listForJob,
  create,
  update,
  remove,
};
