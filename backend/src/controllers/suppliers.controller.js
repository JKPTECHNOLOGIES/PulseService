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
        { supplierNumber: { contains: search, mode: "insensitive" } },
        { contactName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      include: { _count: { select: { items: true, purchaseOrders: true } } },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: suppliers });
  } catch (err) {
    console.error("suppliers.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
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
    if (!supplier)
      return res
        .status(404)
        .json({ success: false, error: "Supplier not found" });
    return res.json({ success: true, data: supplier });
  } catch (err) {
    console.error("suppliers.get error:", err);
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

    const supplierNumber = generateNumber(
      settings.supplierPrefix,
      settings.nextSupplierNumber,
    );
    const { id: _id, ...data } = req.body;

    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: { ...data, supplierNumber },
      });
      await tx.companySettings.update({
        where: { id: settings.id },
        data: { nextSupplierNumber: { increment: 1 } },
      });
      return created;
    });

    return res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    console.error("suppliers.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const {
      id: _id,
      supplierNumber: _sn,
      createdAt: _ca,
      updatedAt: _ua,
      ...data
    } = req.body;
    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: supplier });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Supplier not found" });
    console.error("suppliers.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.supplier.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: "Supplier deactivated" });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Supplier not found" });
    console.error("suppliers.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, remove };
