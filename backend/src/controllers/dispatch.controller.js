const prisma = require('../config/database');

const getBoard = async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const [jobs, technicians] = await Promise.all([
      prisma.job.findMany({
        where: {
          scheduledStart: { gte: startOfDay, lte: endOfDay },
          status: { notIn: ['cancelled'] },
        },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, phone: true, companyName: true },
          },
          location: {
            select: { id: true, address: true, city: true, state: true, zip: true, lat: true, lng: true },
          },
          technicians: {
            include: {
              technician: {
                include: {
                  user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
                },
              },
            },
          },
        },
        orderBy: { scheduledStart: 'asc' },
      }),
      prisma.technician.findMany({
        where: { user: { isActive: true } },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, avatar: true, isActive: true },
          },
          vehicle: { select: { id: true, name: true, color: true } },
        },
        orderBy: { employeeId: 'asc' },
      }),
    ]);

    const unassigned = jobs.filter((j) => j.technicians.length === 0);

    const techBoards = technicians.map((tech) => ({
      id: tech.id,
      userId: tech.userId,
      employeeId: tech.employeeId,
      name: `${tech.user.firstName} ${tech.user.lastName}`,
      avatar: tech.user.avatar,
      isAvailable: tech.isAvailable,
      currentLat: tech.currentLat,
      currentLng: tech.currentLng,
      vehicle: tech.vehicle,
      jobs: jobs.filter((j) => j.technicians.some((t) => t.technicianId === tech.id)),
    }));

    return res.json({
      success: true,
      data: { date: dateStr, technicians: techBoards, unassigned },
    });
  } catch (err) {
    console.error('dispatch.getBoard error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const reassign = async (req, res) => {
  try {
    const { jobId, fromTechnicianId, toTechnicianId } = req.body;
    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }

    // Remove from current technician if provided
    if (fromTechnicianId) {
      await prisma.jobTechnician.deleteMany({
        where: { jobId, technicianId: fromTechnicianId },
      });
    }

    // Assign to new technician if provided
    if (toTechnicianId) {
      await prisma.jobTechnician.upsert({
        where: { jobId_technicianId: { jobId, technicianId: toTechnicianId } },
        create: { jobId, technicianId: toTechnicianId, isLead: true },
        update: {},
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
              include: { user: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
        },
      },
    });

    const io = req.app.get('io');
    if (io && job?.scheduledStart) {
      const date = new Date(job.scheduledStart).toISOString().split('T')[0];
      io.to(`dispatch:${date}`).emit('dispatch:reassigned', { job });
    }

    return res.json({ success: true, data: job });
  } catch (err) {
    console.error('dispatch.reassign error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { getBoard, reassign };
