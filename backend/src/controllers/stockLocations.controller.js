const prisma = require("../config/database");

// Stock locations = the internal warehouse(s) + trucks (each tied to a Vehicle).
const list = async (req, res) => {
  try {
    const { type, active } = req.query;
    const where = {};
    if (type) where.type = type;
    if (active === "true") where.isActive = true;

    const locations = await prisma.stockLocation.findMany({
      where,
      include: {
        vehicle: { select: { id: true, name: true, licensePlate: true } },
        _count: { select: { stock: true } },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return res.json({ success: true, data: locations });
  } catch (err) {
    console.error("stockLocations.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const location = await prisma.stockLocation.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: true,
        stock: {
          include: {
            inventoryItem: { select: { id: true, sku: true, name: true, unit: true } },
          },
          orderBy: { inventoryItem: { name: "asc" } },
        },
      },
    });
    if (!location)
      return res.status(404).json({ success: false, error: "Location not found" });
    return res.json({ success: true, data: location });
  } catch (err) {
    console.error("stockLocations.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const location = await prisma.stockLocation.create({ data: req.body });
    return res.status(201).json({ success: true, data: location });
  } catch (err) {
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "A location with that name or code already exists" });
    console.error("stockLocations.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...data } = req.body;
    const location = await prisma.stockLocation.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: location });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Location not found" });
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "A location with that name or code already exists" });
    console.error("stockLocations.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Soft-delete: deactivate rather than remove, to preserve stock/transaction history.
const remove = async (req, res) => {
  try {
    await prisma.stockLocation.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: "Location deactivated" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Location not found" });
    console.error("stockLocations.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, remove };
