const prisma = require('../config/database');

const get = async (req, res) => {
  try {
    let settings = await prisma.companySettings.findFirst();
    if (!settings) {
      settings = await prisma.companySettings.create({ data: {} });
    }
    return res.json({ success: true, data: settings });
  } catch (err) {
    console.error('settings.get error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const update = async (req, res) => {
  try {
    // Strip fields that must not be overwritten
    const {
      id: _id,
      updatedAt: _ua,
      nextJobNumber: _njn,
      nextInvoiceNumber: _nin,
      nextEstimateNumber: _nen,
      nextCustomerNumber: _ncn,
      ...data
    } = req.body;

    const existing = await prisma.companySettings.findFirst();
    let settings;

    if (existing) {
      settings = await prisma.companySettings.update({ where: { id: existing.id }, data });
    } else {
      settings = await prisma.companySettings.create({ data });
    }

    return res.json({ success: true, data: settings });
  } catch (err) {
    console.error('settings.update error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const getBusinessUnits = async (req, res) => {
  try {
    const units = await prisma.businessUnit.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return res.json({ success: true, data: units });
  } catch (err) {
    console.error('settings.getBusinessUnits error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const createBusinessUnit = async (req, res) => {
  try {
    const unit = await prisma.businessUnit.create({ data: req.body });
    return res.status(201).json({ success: true, data: unit });
  } catch (err) {
    console.error('settings.createBusinessUnit error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const updateBusinessUnit = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, ...data } = req.body;
    const unit = await prisma.businessUnit.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: unit });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Business unit not found' });
    console.error('settings.updateBusinessUnit error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const deleteBusinessUnit = async (req, res) => {
  try {
    await prisma.businessUnit.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: 'Business unit deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Business unit not found' });
    console.error('settings.deleteBusinessUnit error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { get, update, getBusinessUnits, createBusinessUnit, updateBusinessUnit, deleteBusinessUnit };
