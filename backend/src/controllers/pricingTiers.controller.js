const prisma = require("../config/database");

const list = async (req, res) => {
  try {
    const tiers = await prisma.pricingTier.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { customers: true, overrides: true } },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return res.json({ success: true, data: tiers });
  } catch (err) {
    console.error("pricingTiers.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const tier = await prisma.pricingTier.findUnique({
      where: { id: req.params.id },
      include: {
        overrides: {
          include: { pricebookItem: { select: { id: true, name: true, sku: true, unitPrice: true } } },
        },
        _count: { select: { customers: true } },
      },
    });
    if (!tier) return res.status(404).json({ success: false, error: "Pricing tier not found" });
    return res.json({ success: true, data: tier });
  } catch (err) {
    console.error("pricingTiers.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const { name, description, discountType, discountValue, isDefault } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "name is required" });

    const tier = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.pricingTier.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.pricingTier.create({
        data: {
          name,
          description: description || null,
          discountType: discountType || "percentage",
          discountValue: discountValue ?? 0,
          isDefault: !!isDefault,
        },
      });
    });
    return res.status(201).json({ success: true, data: tier });
  } catch (err) {
    if (err.code === "P2002")
      return res.status(409).json({ success: false, error: "A tier with that name already exists" });
    console.error("pricingTiers.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...data } = req.body;

    const tier = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.pricingTier.updateMany({
          where: { isDefault: true, id: { not: req.params.id } },
          data: { isDefault: false },
        });
      }
      return tx.pricingTier.update({ where: { id: req.params.id }, data });
    });
    return res.json({ success: true, data: tier });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Pricing tier not found" });
    if (err.code === "P2002")
      return res.status(409).json({ success: false, error: "A tier with that name already exists" });
    console.error("pricingTiers.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.pricingTier.update({ where: { id: req.params.id }, data: { isActive: false } });
    return res.json({ success: true, message: "Pricing tier deactivated" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Pricing tier not found" });
    console.error("pricingTiers.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Per-item overrides ──────────────────────────────────────────────────────

const addOverride = async (req, res) => {
  try {
    const { pricebookItemId, overrideType, overrideValue } = req.body;
    if (!pricebookItemId || !overrideType || overrideValue === undefined) {
      return res.status(400).json({
        success: false,
        error: "pricebookItemId, overrideType and overrideValue are required",
      });
    }
    const override = await prisma.pricingTierOverride.create({
      data: { pricingTierId: req.params.id, pricebookItemId, overrideType, overrideValue },
      include: { pricebookItem: { select: { id: true, name: true, sku: true, unitPrice: true } } },
    });
    return res.status(201).json({ success: true, data: override });
  } catch (err) {
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "That item already has an override on this tier" });
    console.error("pricingTiers.addOverride error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const removeOverride = async (req, res) => {
  try {
    await prisma.pricingTierOverride.delete({ where: { id: req.params.overrideId } });
    return res.json({ success: true, message: "Override removed" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Override not found" });
    console.error("pricingTiers.removeOverride error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, remove, addOverride, removeOverride };
