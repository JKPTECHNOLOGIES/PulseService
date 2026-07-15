const prisma = require("../config/database");
const { generateNumber } = require("../utils/helpers");

const list = async (req, res) => {
  try {
    const { search, active } = req.query;
    const where = {};
    if (active === "true") where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { vendorNumber: { contains: search, mode: "insensitive" } },
        { contactName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const vendors = await prisma.vendor.findMany({
      where,
      include: { _count: { select: { items: true, purchaseOrders: true } } },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: vendors });
  } catch (err) {
    console.error("vendors.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            inventoryItem: { select: { id: true, sku: true, name: true } },
          },
        },
        purchaseOrders: {
          orderBy: { orderDate: "desc" },
          take: 10,
          select: {
            id: true,
            poNumber: true,
            status: true,
            orderDate: true,
            totalAmount: true,
          },
        },
      },
    });
    if (!vendor)
      return res
        .status(404)
        .json({ success: false, error: "Vendor not found" });
    return res.json({ success: true, data: vendor });
  } catch (err) {
    console.error("vendors.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (!settings)
      return res
        .status(500)
        .json({ success: false, error: "Company settings not found" });

    const vendorNumber = generateNumber(
      settings.vendorPrefix,
      settings.nextVendorNumber,
    );
    const { id: _id, ...data } = req.body;

    const vendor = await prisma.$transaction(async (tx) => {
      const created = await tx.vendor.create({
        data: { ...data, vendorNumber },
      });
      await tx.companySettings.update({
        where: { id: settings.id },
        data: { nextVendorNumber: { increment: 1 } },
      });
      return created;
    });

    return res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    console.error("vendors.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const {
      id: _id,
      vendorNumber: _vn,
      createdAt: _ca,
      updatedAt: _ua,
      ...data
    } = req.body;
    const vendor = await prisma.vendor.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: vendor });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Vendor not found" });
    console.error("vendors.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.vendor.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: "Vendor deactivated" });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Vendor not found" });
    console.error("vendors.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, remove };
