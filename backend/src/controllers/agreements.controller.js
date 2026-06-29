const prisma = require('../config/database');
const { paginate, paginatedResponse } = require('../utils/helpers');

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, customerId } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [agreements, total] = await Promise.all([
      prisma.serviceAgreement.findMany({
        where,
        skip,
        take,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
          _count: { select: { visits: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.serviceAgreement.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(agreements, total, page, limit) });
  } catch (err) {
    console.error('agreements.list error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const get = async (req, res) => {
  try {
    const agreement = await prisma.serviceAgreement.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        visits: { orderBy: { scheduledDate: 'asc' } },
      },
    });

    if (!agreement) return res.status(404).json({ success: false, error: 'Agreement not found' });
    return res.json({ success: true, data: agreement });
  } catch (err) {
    console.error('agreements.get error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const create = async (req, res) => {
  try {
    // Generate agreement number based on count
    const count = await prisma.serviceAgreement.count();
    const agreementNumber = `AGR-${String(count + 1001).padStart(4, '0')}`;

    const { visits, ...agreementData } = req.body;

    const agreement = await prisma.serviceAgreement.create({
      data: {
        ...agreementData,
        agreementNumber,
        ...(visits && { visits: { create: visits } }),
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        visits: true,
      },
    });

    return res.status(201).json({ success: true, data: agreement });
  } catch (err) {
    console.error('agreements.create error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const update = async (req, res) => {
  try {
    const {
      id: _id,
      agreementNumber: _an,
      createdAt: _ca,
      updatedAt: _ua,
      visits: _v,
      ...data
    } = req.body;

    const agreement = await prisma.serviceAgreement.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: agreement });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Agreement not found' });
    console.error('agreements.update error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const scheduleVisit = async (req, res) => {
  try {
    const visit = await prisma.agreementVisit.create({
      data: { ...req.body, agreementId: req.params.id },
    });
    return res.status(201).json({ success: true, data: visit });
  } catch (err) {
    console.error('agreements.scheduleVisit error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const completeVisit = async (req, res) => {
  try {
    const { notes, jobId } = req.body;
    const visit = await prisma.agreementVisit.update({
      where: { id: req.params.visitId },
      data: {
        status: 'completed',
        completedDate: new Date(),
        ...(notes && { notes }),
        ...(jobId && { jobId }),
      },
    });
    return res.json({ success: true, data: visit });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Visit not found' });
    console.error('agreements.completeVisit error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { list, get, create, update, scheduleVisit, completeVisit };
