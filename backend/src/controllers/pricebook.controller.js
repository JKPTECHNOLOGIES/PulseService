const prisma = require('../config/database');

const listCategories = async (req, res) => {
  try {
    const categories = await prisma.pricebookCategory.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { items: true } },
        children: { where: { isActive: true }, select: { id: true, name: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    return res.json({ success: true, data: categories });
  } catch (err) {
    console.error('pricebook.listCategories error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const createCategory = async (req, res) => {
  try {
    const category = await prisma.pricebookCategory.create({ data: req.body });
    return res.status(201).json({ success: true, data: category });
  } catch (err) {
    console.error('pricebook.createCategory error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
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
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Category not found' });
    console.error('pricebook.updateCategory error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const deleteCategory = async (req, res) => {
  try {
    await prisma.pricebookCategory.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: 'Category deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Category not found' });
    console.error('pricebook.deleteCategory error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const listItems = async (req, res) => {
  try {
    const { categoryId, search, type } = req.query;

    const where = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const items = await prisma.pricebookItem.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });

    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('pricebook.listItems error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
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
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'SKU already exists' });
    }
    console.error('pricebook.createItem error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
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
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Item not found' });
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'SKU already exists' });
    console.error('pricebook.updateItem error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const deleteItem = async (req, res) => {
  try {
    await prisma.pricebookItem.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: 'Item deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Item not found' });
    console.error('pricebook.deleteItem error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
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
};
