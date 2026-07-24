const prisma = require("../config/database");
const { withEffectivePrices } = require("../services/pricing.service");
const { paginate, paginatedResponse } = require("../utils/helpers");

const listCategories = async (req, res) => {
  try {
    const categories = await prisma.pricebookCategory.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { items: true } },
        children: {
          where: { isActive: true },
          select: { id: true, name: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });
    return res.json({ success: true, data: categories });
  } catch (err) {
    console.error("pricebook.listCategories error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const createCategory = async (req, res) => {
  try {
    const category = await prisma.pricebookCategory.create({ data: req.body });
    return res.status(201).json({ success: true, data: category });
  } catch (err) {
    console.error("pricebook.createCategory error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...data } = req.body;
    const category = await prisma.pricebookCategory.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: category });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Category not found" });
    console.error("pricebook.updateCategory error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const deleteCategory = async (req, res) => {
  try {
    await prisma.pricebookCategory.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: "Category deactivated" });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Category not found" });
    console.error("pricebook.deleteCategory error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Columns with a real matching DB column -- these stay a normal, efficient
// paginated query with a Prisma `orderBy`, same pattern as the other list
// endpoints (see invoices.controller.js).
const PRICEBOOK_ITEM_ORDER_BY = {
  sku: (dir) => ({ sku: dir }),
  name: (dir) => ({ name: dir }),
  type: (dir) => ({ type: dir }),
  cost: (dir) => ({ unitCost: dir }),
  price: (dir) => ({ unitPrice: dir }),
  taxable: (dir) => ({ taxable: dir }),
  active: (dir) => ({ isActive: dir }),
};

const listItems = async (req, res) => {
  try {
    const {
      categoryId,
      search,
      type,
      customerId,
      page,
      limit,
      sortKey,
      sortDir,
    } = req.query;

    const where = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // The Items admin page pages through the (potentially thousands-strong)
    // catalog, but a few other callers -- the quick-add line item search, the
    // QuickBooks item-mapping picker, the pricing-tier override picker --
    // still need the FULL matching set in one shot (they populate a dropdown
    // or a narrow search result, not a browsable table). Only paginate when
    // the caller explicitly asks for a page, so those callers are unaffected.
    const isPaginated = page !== undefined || limit !== undefined;

    if (isPaginated) {
      const { skip, take } = paginate(page, limit);
      const dir = sortDir === "asc" ? "asc" : "desc";
      const orderBy = PRICEBOOK_ITEM_ORDER_BY[sortKey]?.(dir) ?? [
        { category: { sortOrder: "asc" } },
        { name: "asc" },
      ];

      const [items, total] = await Promise.all([
        prisma.pricebookItem.findMany({
          where,
          skip,
          take,
          include: { category: { select: { id: true, name: true } } },
          orderBy,
        }),
        prisma.pricebookItem.count({ where }),
      ]);

      const withPricing = await withEffectivePrices(items, customerId);
      return res.json({
        success: true,
        ...paginatedResponse(withPricing, total, page, limit),
      });
    }

    const items = await prisma.pricebookItem.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
    });

    // Adds `effectivePrice` per item, reflecting the customer's pricing tier
    // (falls back to the catalog unitPrice when no customerId is given).
    const withPricing = await withEffectivePrices(items, customerId);

    return res.json({ success: true, data: withPricing });
  } catch (err) {
    console.error("pricebook.listItems error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const createItem = async (req, res) => {
  try {
    const item = await prisma.pricebookItem.create({
      data: req.body,
      include: { category: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (err.code === "P2002") {
      return res
        .status(409)
        .json({ success: false, error: "SKU already exists" });
    }
    console.error("pricebook.createItem error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const updateItem = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...data } = req.body;
    const item = await prisma.pricebookItem.update({
      where: { id: req.params.id },
      data,
      include: { category: { select: { id: true, name: true } } },
    });
    return res.json({ success: true, data: item });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Item not found" });
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "SKU already exists" });
    console.error("pricebook.updateItem error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const deleteItem = async (req, res) => {
  try {
    await prisma.pricebookItem.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: "Item deactivated" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Item not found" });
    console.error("pricebook.deleteItem error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Bulk-create pricebook items from parsed CSV rows. Each row needs a name;
// numeric fields default to 0. Returns per-row results.
const importItems = async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No rows to import" });
    }
    if (rows.length > 1000) {
      return res
        .status(400)
        .json({ success: false, error: "Import is limited to 1000 rows" });
    }

    const num = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };

    let created = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name || "").trim();
      if (!name) {
        errors.push({ row: i + 1, error: "Missing name" });
        continue;
      }
      try {
        await prisma.pricebookItem.create({
          data: {
            name,
            sku: r.sku?.trim() || null,
            type: r.type?.trim() || "service",
            unitCost: num(r.unitCost),
            unitPrice: num(r.unitPrice),
            unit: r.unit?.trim() || null,
          },
        });
        created += 1;
      } catch (e) {
        errors.push({
          row: i + 1,
          error: e.code === "P2002" ? "Duplicate SKU" : e.message || "Failed",
        });
      }
    }

    return res.json({
      success: true,
      data: { created, failed: errors.length, errors },
    });
  } catch (err) {
    console.error("pricebook.importItems error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listItems,
  createItem,
  updateItem,
  deleteItem,
  importItems,
};
