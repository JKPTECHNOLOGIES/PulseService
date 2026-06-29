const prisma = require('../config/database');
const { paginate, paginatedResponse } = require('../utils/helpers');

const list = async (req, res) => {
  try {
    const { warehouseId, lowStock } = req.query;

    const where = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true } },
        pricebookItem: { select: { id: true, name: true, sku: true, unitPrice: true } },
      },
      orderBy: { name: 'asc' },
    });

    const result = items.map((item) => ({
      ...item,
      isLowStock: item.quantity <= item.reorderPoint,
    }));

    const filtered = lowStock === 'true' ? result.filter((i) => i.isLowStock) : result;

    return res.json({ success: true, data: filtered });
  } catch (err) {
    console.error('inventory.list error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const get = async (req, res) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: {
        warehouse: true,
        pricebookItem: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    return res.json({
      success: true,
      data: { ...item, isLowStock: item.quantity <= item.reorderPoint },
    });
  } catch (err) {
    console.error('inventory.get error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const adjust = async (req, res) => {
  try {
    const { quantity, notes, reference } = req.body;
    if (quantity === undefined) {
      return res.status(400).json({ success: false, error: 'quantity is required' });
    }

    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    const newQty = item.quantity + parseFloat(quantity);
    if (newQty < 0) {
      return res.status(400).json({ success: false, error: 'Adjustment would result in negative quantity' });
    }

    const [transaction, updatedItem] = await prisma.$transaction([
      prisma.inventoryTransaction.create({
        data: {
          itemId: req.params.id,
          type: 'adjust',
          quantity: parseFloat(quantity),
          notes,
          reference,
        },
      }),
      prisma.inventoryItem.update({
        where: { id: req.params.id },
        data: { quantity: { increment: parseFloat(quantity) } },
      }),
    ]);

    return res.json({ success: true, data: { transaction, item: updatedItem } });
  } catch (err) {
    console.error('inventory.adjust error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const receive = async (req, res) => {
  try {
    const { quantity, unitCost, reference, notes } = req.body;
    if (!quantity) {
      return res.status(400).json({ success: false, error: 'quantity is required' });
    }

    const qty = parseFloat(quantity);

    const [transaction, updatedItem] = await prisma.$transaction([
      prisma.inventoryTransaction.create({
        data: {
          itemId: req.params.id,
          type: 'receive',
          quantity: qty,
          unitCost: unitCost ? parseFloat(unitCost) : undefined,
          notes,
          reference,
        },
      }),
      prisma.inventoryItem.update({
        where: { id: req.params.id },
        data: {
          quantity: { increment: qty },
          ...(unitCost && { unitCost: parseFloat(unitCost) }),
        },
      }),
    ]);

    return res.json({ success: true, data: { transaction, item: updatedItem } });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Item not found' });
    console.error('inventory.receive error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip, take } = paginate(page, limit);

    const [transactions, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where: { itemId: req.params.id },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryTransaction.count({ where: { itemId: req.params.id } }),
    ]);

    return res.json({ success: true, ...paginatedResponse(transactions, total, page, limit) });
  } catch (err) {
    console.error('inventory.getTransactions error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { list, get, adjust, receive, getTransactions };
