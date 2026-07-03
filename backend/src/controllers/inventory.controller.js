const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");
const {
  applyStockDelta,
  qty,
  money,
} = require("../services/inventory.service");

// Sum on-hand across every location for a loaded item (item.stock included).
function totalFromStock(stock = []) {
  return qty(stock.reduce((sum, s) => sum + Number(s.quantityOnHand), 0));
}

// ─── Items (catalog) ─────────────────────────────────────────────────────────

const list = async (req, res) => {
  try {
    const { search, categoryId, supplierId, locationId, lowStock } = req.query;

    const where = { isArchived: false };
    if (categoryId) where.categoryId = categoryId;
    if (supplierId) where.defaultSupplierId = supplierId;
    if (locationId) where.stock = { some: { stockLocationId: locationId } };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        stock: {
          include: {
            stockLocation: {
              select: { id: true, name: true, code: true, type: true },
            },
          },
        },
        defaultSupplier: { select: { id: true, name: true } },
        pricebookItem: { select: { id: true, name: true, unitPrice: true } },
      },
      orderBy: { name: "asc" },
    });

    const result = items.map((item) => {
      const totalOnHand = totalFromStock(item.stock);
      return {
        ...item,
        totalOnHand,
        isLowStock: totalOnHand <= Number(item.reorderPoint),
      };
    });

    const filtered =
      lowStock === "true" ? result.filter((i) => i.isLowStock) : result;

    return res.json({ success: true, data: filtered });
  } catch (err) {
    console.error("inventory.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: {
        stock: {
          include: {
            stockLocation: {
              select: { id: true, name: true, code: true, type: true },
            },
          },
        },
        defaultSupplier: { select: { id: true, name: true } },
        pricebookItem: true,
        suppliers: {
          include: { supplier: { select: { id: true, name: true } } },
        },
        transactions: {
          orderBy: { transactionDate: "desc" },
          take: 20,
          include: {
            stockLocation: { select: { id: true, name: true, code: true } },
          },
        },
        costHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const totalOnHand = totalFromStock(item.stock);
    return res.json({
      success: true,
      data: {
        ...item,
        totalOnHand,
        isLowStock: totalOnHand <= Number(item.reorderPoint),
      },
    });
  } catch (err) {
    console.error("inventory.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    // Optional initial stock: { stockLocationId, quantityOnHand }
    const { initialStock, ...data } = req.body;

    const item = await prisma.inventoryItem.create({
      data: {
        ...data,
        ...(initialStock?.stockLocationId
          ? {
              stock: {
                create: {
                  stockLocationId: initialStock.stockLocationId,
                  quantityOnHand: qty(initialStock.quantityOnHand ?? 0),
                },
              },
            }
          : {}),
      },
      include: { stock: true },
    });
    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "SKU already exists" });
    console.error("inventory.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    // unitCost is WAC-managed; never accept it from a plain item edit.
    const {
      id: _id,
      unitCost: _uc,
      stock: _s,
      totalOnHand: _t,
      isLowStock: _l,
      createdAt: _ca,
      updatedAt: _ua,
      ...data
    } = req.body;
    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: item });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Item not found" });
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "SKU already exists" });
    console.error("inventory.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: { isArchived: true, archivedAt: new Date(), isActive: false },
    });
    return res.json({ success: true, message: "Item archived" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Item not found" });
    console.error("inventory.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Stock movements ─────────────────────────────────────────────────────────

/**
 * Adjust stock at a single location.
 *   type "add"    → increase by |quantity|
 *   type "remove" → decrease by |quantity|
 *   type "set"    → set on-hand to exactly `quantity` (records the delta)
 */
const adjust = async (req, res) => {
  try {
    const { stockLocationId, quantity, type = "add", notes } = req.body;
    if (!stockLocationId)
      return res
        .status(400)
        .json({ success: false, error: "stockLocationId is required" });
    if (quantity === undefined || Number.isNaN(Number(quantity)))
      return res
        .status(400)
        .json({ success: false, error: "quantity must be a number" });

    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
    });
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const value = Math.abs(Number(quantity));
    let delta;
    let txnType = "adjustment";
    if (type === "remove") {
      delta = -value;
      txnType = "issue";
    } else if (type === "set") {
      const current = await prisma.inventoryStock.findUnique({
        where: {
          inventoryItemId_stockLocationId: {
            inventoryItemId: req.params.id,
            stockLocationId,
          },
        },
      });
      delta = Number(quantity) - Number(current?.quantityOnHand ?? 0);
      txnType = "count";
    } else {
      delta = value;
      txnType = "adjustment";
    }

    const stock = await prisma.$transaction((tx) =>
      applyStockDelta(tx, {
        itemId: req.params.id,
        locationId: stockLocationId,
        delta,
        type: txnType,
        notes,
        performedBy: req.user?.id,
      }),
    );

    return res.json({ success: true, data: stock });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("inventory.adjust error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/** Move stock from one location to another (e.g. warehouse → truck). */
const transfer = async (req, res) => {
  try {
    const { fromLocationId, toLocationId, quantity, notes } = req.body;
    const amount = Number(quantity);
    if (!fromLocationId || !toLocationId)
      return res
        .status(400)
        .json({
          success: false,
          error: "fromLocationId and toLocationId are required",
        });
    if (fromLocationId === toLocationId)
      return res
        .status(400)
        .json({ success: false, error: "Source and destination must differ" });
    if (!(amount > 0))
      return res
        .status(400)
        .json({ success: false, error: "quantity must be greater than 0" });

    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
    });
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const result = await prisma.$transaction(async (tx) => {
      const out = await applyStockDelta(tx, {
        itemId: req.params.id,
        locationId: fromLocationId,
        delta: -amount,
        type: "transfer_out",
        referenceType: "transfer",
        referenceId: toLocationId,
        notes,
        performedBy: req.user?.id,
      });
      const into = await applyStockDelta(tx, {
        itemId: req.params.id,
        locationId: toLocationId,
        delta: amount,
        type: "transfer_in",
        referenceType: "transfer",
        referenceId: fromLocationId,
        notes,
        performedBy: req.user?.id,
      });
      return { from: out, to: into };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("inventory.transfer error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip, take } = paginate(page, limit);
    const where = { inventoryItemId: req.params.id };

    const [transactions, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        skip,
        take,
        orderBy: { transactionDate: "desc" },
        include: {
          stockLocation: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(transactions, total, page, limit),
    });
  } catch (err) {
    console.error("inventory.getTransactions error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Per-supplier catalog pricing ────────────────────────────────────────────

const addSupplier = async (req, res) => {
  try {
    const {
      supplierId,
      unitCost,
      supplierSku,
      leadTimeDays,
      minimumOrderQty,
      isPrimary,
    } = req.body;
    if (!supplierId || unitCost === undefined)
      return res
        .status(400)
        .json({
          success: false,
          error: "supplierId and unitCost are required",
        });

    const link = await prisma.inventoryItemSupplier.create({
      data: {
        inventoryItemId: req.params.id,
        supplierId,
        unitCost: money(unitCost),
        supplierSku: supplierSku || null,
        leadTimeDays: leadTimeDays ?? null,
        minimumOrderQty: minimumOrderQty ?? null,
        isPrimary: !!isPrimary,
      },
      include: { supplier: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ success: true, data: link });
  } catch (err) {
    if (err.code === "P2002")
      return res
        .status(409)
        .json({
          success: false,
          error: "That supplier is already linked to this item",
        });
    console.error("inventory.addSupplier error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const removeSupplier = async (req, res) => {
  try {
    await prisma.inventoryItemSupplier.delete({
      where: { id: req.params.linkId },
    });
    return res.json({ success: true, message: "Supplier link removed" });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Supplier link not found" });
    console.error("inventory.removeSupplier error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  adjust,
  transfer,
  getTransactions,
  addSupplier,
  removeSupplier,
};
