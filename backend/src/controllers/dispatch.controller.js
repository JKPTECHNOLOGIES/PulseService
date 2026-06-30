const prisma = require("../config/database");
const { csvToArray } = require("../utils/helpers");

const getBoard = async (req, res) => {
  try {
    // Single-day (date) or a range (from/to) for week/month views.
    const fromStr =
      req.query.from ||
      req.query.date ||
      new Date().toISOString().split("T")[0];
    const toStr = req.query.to || req.query.date || fromStr;
    const startOfDay = new Date(`${fromStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${toStr}T23:59:59.999Z`);

    const [jobs, technicians, undated] = await Promise.all([
      prisma.job.findMany({
        where: {
          scheduledStart: { gte: startOfDay, lte: endOfDay },
          status: { notIn: ["cancelled"] },
        },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              companyName: true,
            },
          },
          location: {
            select: {
              id: true,
              address: true,
              city: true,
              state: true,
              zip: true,
              lat: true,
              lng: true,
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
        orderBy: { scheduledStart: "asc" },
      }),
      prisma.technician.findMany({
        where: { user: { isActive: true } },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              isActive: true,
            },
          },
          vehicle: { select: { id: true, name: true, color: true } },
        },
        orderBy: { employeeId: "asc" },
      }),
      // Jobs with no scheduled date are day-independent, so they're returned
      // alongside every board day for the "Undated" backlog panel.
      prisma.job.findMany({
        where: {
          scheduledStart: null,
          status: { notIn: ["cancelled", "completed"] },
        },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              companyName: true,
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
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const unassigned = jobs.filter((j) => j.technicians.length === 0);

    const techBoards = technicians.map((tech) => ({
      id: tech.id,
      userId: tech.userId,
      employeeId: tech.employeeId,
      user: tech.user,
      name: `${tech.user.firstName} ${tech.user.lastName}`,
      avatar: tech.user.avatar,
      skills: csvToArray(tech.skills),
      isAvailable: tech.isAvailable,
      currentLat: tech.currentLat,
      currentLng: tech.currentLng,
      vehicle: tech.vehicle,
      jobs: jobs.filter((j) =>
        j.technicians.some((t) => t.technicianId === tech.id),
      ),
    }));

    return res.json({
      success: true,
      data: {
        date: fromStr,
        from: fromStr,
        to: toStr,
        technicians: techBoards,
        unassigned,
        undated,
      },
    });
  } catch (err) {
    console.error("dispatch.getBoard error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const reassign = async (req, res) => {
  try {
    const { jobId, toTechnicianId } = req.body;
    if (!jobId) {
      return res
        .status(400)
        .json({ success: false, error: "jobId is required" });
    }

    // The dispatch board treats a job as assigned to exactly ONE technician.
    // Clear every existing assignment first so a move never leaves the job
    // duplicated across rows (and any pre-existing duplicates self-heal on the
    // next drag). If toTechnicianId is omitted/null the job becomes unassigned.
    await prisma.jobTechnician.deleteMany({ where: { jobId } });

    if (toTechnicianId) {
      await prisma.jobTechnician.create({
        data: { jobId, technicianId: toTechnicianId, isLead: true },
      });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        location: true,
        technicians: {
          include: {
            technician: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    const io = req.app.get("io");
    if (io && job?.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split("T")[0];
      io.to(`dispatch:${date}`).emit("dispatch:reassigned", { job });
    }

    return res.json({ success: true, data: job });
  } catch (err) {
    console.error("dispatch.reassign error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { getBoard, reassign };
