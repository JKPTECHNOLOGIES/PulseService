const prisma = require("../config/database");
const { csvToArray } = require("../utils/helpers");

const list = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const technicians = await prisma.technician.findMany({
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            avatar: true,
            isActive: true,
            role: true,
          },
        },
        vehicle: true,
        jobs: {
          where: {
            job: {
              scheduledStart: { gte: today, lt: tomorrow },
              status: { notIn: ["cancelled"] },
            },
          },
          select: { id: true },
        },
      },
      orderBy: { employeeId: "asc" },
    });

    const result = technicians.map((t) => ({
      ...t,
      skills: csvToArray(t.skills),
      zones: csvToArray(t.zones),
      jobCountToday: t.jobs.length,
    }));

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("technicians.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const technician = await prisma.technician.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            avatar: true,
            role: true,
            lastLogin: true,
          },
        },
        vehicle: true,
        jobs: {
          where: {
            job: {
              scheduledStart: { gte: today, lt: tomorrow },
              status: { notIn: ["cancelled"] },
            },
          },
          include: {
            job: {
              include: {
                customer: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  },
                },
                location: true,
              },
            },
          },
          orderBy: { job: { scheduledStart: "asc" } },
        },
        timeEntries: {
          orderBy: { startTime: "desc" },
          take: 10,
          include: { job: { select: { id: true, jobNumber: true } } },
        },
      },
    });

    if (!technician)
      return res
        .status(404)
        .json({ success: false, error: "Technician not found" });
    return res.json({
      success: true,
      data: {
        ...technician,
        skills: csvToArray(technician.skills),
        zones: csvToArray(technician.zones),
      },
    });
  } catch (err) {
    console.error("technicians.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
      return res
        .status(400)
        .json({ success: false, error: "lat and lng are required" });
    }

    const technician = await prisma.technician.update({
      where: { id: req.params.id },
      data: {
        currentLat: parseFloat(lat),
        currentLng: parseFloat(lng),
        lastLocationAt: new Date(),
      },
    });

    const io = req.app.get("io");
    if (io) {
      io.emit("technician:location", {
        technicianId: technician.id,
        lat: technician.currentLat,
        lng: technician.currentLng,
        updatedAt: technician.lastLocationAt,
      });
    }

    return res.json({ success: true, data: technician });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Technician not found" });
    console.error("technicians.updateLocation error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const getAvailability = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const start = dateFrom ? new Date(dateFrom) : new Date();
    const end = dateTo
      ? new Date(dateTo)
      : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    const technician = await prisma.technician.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        jobs: {
          where: {
            job: {
              scheduledStart: { gte: start, lte: end },
              status: { notIn: ["cancelled"] },
            },
          },
          include: {
            job: {
              select: {
                id: true,
                jobNumber: true,
                summary: true,
                status: true,
                priority: true,
                scheduledStart: true,
                scheduledEnd: true,
                customer: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { job: { scheduledStart: "asc" } },
        },
      },
    });

    if (!technician)
      return res
        .status(404)
        .json({ success: false, error: "Technician not found" });
    return res.json({ success: true, data: technician });
  } catch (err) {
    console.error("technicians.getAvailability error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, updateLocation, getAvailability };
