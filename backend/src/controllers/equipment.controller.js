const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");

const customerSelect = {
  select: { id: true, firstName: true, lastName: true, companyName: true },
};
const locationSelect = {
  select: { id: true, name: true, address: true, city: true, state: true },
};

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, customerId, condition, warranty } =
      req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (customerId) where.customerId = customerId;
    if (condition) where.condition = condition;

    // Warranty filter: active (expires in the future), expired (in the past),
    // or expiring (within the next 90 days).
    const now = new Date();
    if (warranty === "active") {
      where.warrantyExpiry = { gte: now };
    } else if (warranty === "expired") {
      where.warrantyExpiry = { lt: now };
    } else if (warranty === "expiring") {
      const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      where.warrantyExpiry = { gte: now, lte: in90 };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
      ];
    }

    const [equipment, total] = await Promise.all([
      prisma.equipment.findMany({
        where,
        skip,
        take,
        include: { customer: customerSelect, location: locationSelect },
        orderBy: { createdAt: "desc" },
      }),
      prisma.equipment.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(equipment, total, page, limit),
    });
  } catch (err) {
    console.error("equipment.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const equipment = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      include: {
        customer: customerSelect,
        location: locationSelect,
        job: {
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

    if (!equipment) {
      return res
        .status(404)
        .json({ success: false, error: "Equipment not found" });
    }

    // Per-unit service history: jobs at this unit's location (or the customer's
    // jobs if no location is recorded), newest first.
    const historyWhere = equipment.locationId
      ? { locationId: equipment.locationId }
      : { customerId: equipment.customerId ?? undefined };

    const serviceHistory = equipment.customerId
      ? await prisma.job.findMany({
          where: historyWhere,
          select: {
            id: true,
            jobNumber: true,
            summary: true,
            type: true,
            status: true,
            scheduledStart: true,
            completedAt: true,
            totalAmount: true,
          },
          orderBy: { scheduledStart: "desc" },
          take: 25,
        })
      : [];

    return res.json({ success: true, data: { ...equipment, serviceHistory } });
  } catch (err) {
    console.error("equipment.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const equipment = await prisma.equipment.create({
      data: req.body,
      include: { customer: customerSelect, location: locationSelect },
    });
    return res.status(201).json({ success: true, data: equipment });
  } catch (err) {
    console.error("equipment.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, updatedAt: _ua, serviceHistory: _sh, ...data } =
      req.body;
    const equipment = await prisma.equipment.update({
      where: { id: req.params.id },
      data,
      include: { customer: customerSelect, location: locationSelect },
    });
    return res.json({ success: true, data: equipment });
  } catch (err) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "Equipment not found" });
    }
    console.error("equipment.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.equipment.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Equipment deleted" });
  } catch (err) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "Equipment not found" });
    }
    console.error("equipment.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, delete: remove };
