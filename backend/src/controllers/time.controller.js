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

module.exports = { current, clockIn, clockOut, listForJob };
