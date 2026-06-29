const prisma = require('../config/database');
const { paginate, paginatedResponse } = require('../utils/helpers');

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, customerId, method, status } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (customerId) where.customerId = customerId;
    if (method) where.method = method;
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, total: true, status: true } },
          customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(payments, total, page, limit) });
  } catch (err) {
    console.error('payments.list error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { list };
