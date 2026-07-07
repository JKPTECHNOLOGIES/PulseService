const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, direction, status, customerId } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        skip,
        take,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
          handledBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.call.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(calls, total, page, limit),
    });
  } catch (err) {
    console.error("calls.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const call = await prisma.call.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        handledBy: { select: { id: true, firstName: true, lastName: true } },
        jobs: {
          select: {
            id: true,
            jobNumber: true,
            summary: true,
            status: true,
            scheduledStart: true,
          },
        },
      },
    });

    if (!call)
      return res.status(404).json({ success: false, error: "Call not found" });
    return res.json({ success: true, data: call });
  } catch (err) {
    console.error("calls.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const call = await prisma.call.create({
      data: {
        ...req.body,
        handledById: req.body.handledById || req.user.id,
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        handledBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return res.status(201).json({ success: true, data: call });
  } catch (err) {
    console.error("calls.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, ...data } = req.body;
    const call = await prisma.call.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: call });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Call not found" });
    console.error("calls.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.call.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Call deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Call not found" });
    console.error("calls.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, remove };
