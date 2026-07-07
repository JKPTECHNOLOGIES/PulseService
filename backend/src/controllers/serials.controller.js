const prisma = require("../config/database");
const permissionsService = require("../services/permissions.service");
const { paginate, paginatedResponse } = require("../utils/helpers");
const { money } = require("../services/inventory.service");

// The list/detail stay open to any authenticated user (a technician needs
// the list to pick a unit to install), but purchase cost isn't something
// everyone who can browse units should see.
async function canSeeCost(req) {
  const granted = await permissionsService.getForRole(req.user.role);
  return granted.includes("inventory.manage");
}
function omitCost(unit) {
  const { purchaseCost: _purchaseCost, ...rest } = unit;
  return rest;
}

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

    const canSeeCostValue = await canSeeCost(req);
    const shaped = canSeeCostValue ? units : units.map(omitCost);

    return res.json({
      success: true,
      ...paginatedResponse(shaped, total, page, limit),
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
    const canSeeCostValue = await canSeeCost(req);
    return res.json({
      success: true,
      data: canSeeCostValue ? unit : omitCost(unit),
    });
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

// General update: status, location move, warranty, notes. Setting status to
// "installed" here (rather than through the dedicated /install action) would
// otherwise let a unit read "Installed" everywhere while linked to no
// customer/job -- invisible on that customer's equipment/asset history, e.g.
// during a warranty claim. Require the link to already exist (via /install)
// or be supplied in the same request before allowing that transition.
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

    if (data.status === "installed") {
      const existing = await prisma.serializedUnit.findUnique({
        where: { id: req.params.id },
        select: { installedCustomerId: true },
      });
      if (!existing) {
        return res
          .status(404)
          .json({ success: false, error: "Serialized unit not found" });
      }
      const willHaveCustomer =
        data.installedCustomerId ?? existing.installedCustomerId;
      if (!willHaveCustomer) {
        return res.status(400).json({
          success: false,
          error:
            "Use the Install action to mark a unit installed -- it needs a customer/job link that this form doesn't collect.",
        });
      }
    }

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

// Reverse an install: return the unit to stock and clear its job/customer
// links. Non-destructive (the physical asset record is kept).
const uninstall = async (req, res) => {
  try {
    const unit = await prisma.serializedUnit.update({
      where: { id: req.params.id },
      data: {
        status: "in_stock",
        installedCustomerId: null,
        installedLocationId: null,
        installedJobId: null,
        equipmentId: null,
        installedAt: null,
      },
    });
    return res.json({ success: true, data: unit });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Serialized unit not found" });
    console.error("serials.uninstall error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Permanently remove a manually-tracked serial record. Installed units must
// be uninstalled first so we don't silently orphan a job/customer/equipment
// link with no trace of what used to be there.
const remove = async (req, res) => {
  try {
    const existing = await prisma.serializedUnit.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    });
    if (!existing)
      return res
        .status(404)
        .json({ success: false, error: "Serialized unit not found" });
    if (existing.status === "installed")
      return res.status(409).json({
        success: false,
        error: "Uninstall this unit before deleting it",
      });

    await prisma.serializedUnit.delete({ where: { id: req.params.id } });
    return res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Serialized unit not found" });
    console.error("serials.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, install, uninstall, remove };
