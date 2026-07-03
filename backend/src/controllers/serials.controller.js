const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");
const { money } = require("../services/inventory.service");

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip, take } = paginate(page, limit);
    const { itemId, status, stockLocationId, customerId, jobId, search } =
      req.query;

    const where = {};
    if (itemId) where.inventoryItemId = itemId;
    if (status) where.status = status;
    if (stockLocationId) where.stockLocationId = stockLocationId;
    if (customerId) where.installedCustomerId = customerId;
    if (jobId) where.installedJobId = jobId;
    if (search) where.serialNumber = { contains: search, mode: "insensitive" };

    const [units, total] = await Promise.all([
      prisma.serializedUnit.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          inventoryItem: { select: { id: true, sku: true, name: true } },
          stockLocation: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.serializedUnit.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(units, total, page, limit),
    });
  } catch (err) {
    console.error("serials.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const unit = await prisma.serializedUnit.findUnique({
      where: { id: req.params.id },
      include: {
        inventoryItem: { select: { id: true, sku: true, name: true } },
        stockLocation: { select: { id: true, name: true, code: true } },
        sourceReceipt: {
          select: { id: true, receiptNumber: true, receivedAt: true },
        },
        installedCustomer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        installedLocation: {
          select: { id: true, address: true, city: true, state: true },
        },
        installedJob: { select: { id: true, jobNumber: true } },
        equipment: { select: { id: true, name: true } },
      },
    });
    if (!unit)
      return res
        .status(404)
        .json({ success: false, error: "Serialized unit not found" });
    return res.json({ success: true, data: unit });
  } catch (err) {
    console.error("serials.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Manually register a serialized unit (e.g. migrating existing serials).
const create = async (req, res) => {
  try {
    const {
      serialNumber,
      inventoryItemId,
      status = "in_stock",
      stockLocationId,
      purchaseCost,
      warrantyMonths,
      notes,
    } = req.body;
    if (!serialNumber || !inventoryItemId)
      return res.status(400).json({
        success: false,
        error: "serialNumber and inventoryItemId are required",
      });

    const unit = await prisma.serializedUnit.create({
      data: {
        serialNumber,
        inventoryItemId,
        status,
        stockLocationId: stockLocationId || null,
        purchaseCost:
          purchaseCost !== null && purchaseCost !== undefined
            ? money(purchaseCost)
            : null,
        warrantyMonths: warrantyMonths ?? null,
        notes: notes || null,
      },
    });
    return res.status(201).json({ success: true, data: unit });
  } catch (err) {
    if (err.code === "P2002")
      return res.status(409).json({
        success: false,
        error: "That serial number already exists for this item",
      });
    console.error("serials.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// General update: status, location move, warranty, notes.
const update = async (req, res) => {
  try {
    const {
      id: _id,
      inventoryItemId: _ii,
      serialNumber: _sn,
      createdAt: _ca,
      updatedAt: _ua,
      ...data
    } = req.body;
    const unit = await prisma.serializedUnit.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: unit });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Serialized unit not found" });
    console.error("serials.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Mark a unit installed at a customer/location/job (optionally linking Equipment).
const install = async (req, res) => {
  try {
    const {
      installedCustomerId,
      installedLocationId,
      installedJobId,
      equipmentId,
      warrantyExpiresAt,
    } = req.body;

    const unit = await prisma.serializedUnit.update({
      where: { id: req.params.id },
      data: {
        status: "installed",
        stockLocationId: null,
        installedCustomerId: installedCustomerId || null,
        installedLocationId: installedLocationId || null,
        installedJobId: installedJobId || null,
        equipmentId: equipmentId || null,
        installedAt: new Date(),
        ...(warrantyExpiresAt && {
          warrantyExpiresAt: new Date(warrantyExpiresAt),
        }),
      },
    });
    return res.json({ success: true, data: unit });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Serialized unit not found" });
    if (err.code === "P2002")
      return res.status(409).json({
        success: false,
        error: "That equipment is already linked to another unit",
      });
    console.error("serials.install error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, install };
