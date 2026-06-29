const prisma = require('../config/database');
const { paginate, paginatedResponse, generateNumber, calculateTotals } = require('../utils/helpers');

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, customerId } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
          job: { select: { id: true, jobNumber: true, summary: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invoice.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(invoices, total, page, limit) });
  } catch (err) {
    console.error('invoices.list error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const get = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        job: { select: { id: true, jobNumber: true, summary: true, status: true } },
        estimate: { select: { id: true, estimateNumber: true } },
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { createdAt: 'desc' } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    return res.json({ success: true, data: invoice });
  } catch (err) {
    console.error('invoices.get error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const create = async (req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (!settings) return res.status(500).json({ success: false, error: 'Company settings not found' });

    const invoiceNumber = generateNumber(settings.invoicePrefix, settings.nextInvoiceNumber);
    await prisma.companySettings.updateMany({ data: { nextInvoiceNumber: { increment: 1 } } });

    const { lineItems = [], discountType, discountValue = 0, taxRate = 0, ...invoiceData } = req.body;
    const totals = calculateTotals(lineItems, discountType, discountValue, taxRate);

    const invoice = await prisma.invoice.create({
      data: {
        ...invoiceData,
        invoiceNumber,
        createdById: req.user.id,
        discountType,
        discountValue,
        taxRate,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        balance: totals.total,
        lineItems: {
          create: lineItems.map((item, i) => ({
            type: item.type || 'service',
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
            sortOrder: i,
            pricebookItemId: item.pricebookItemId,
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } }, customer: true },
    });

    return res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    console.error('invoices.create error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const update = async (req, res) => {
  try {
    const {
      lineItems,
      discountType,
      discountValue = 0,
      taxRate = 0,
      id: _id,
      invoiceNumber: _in,
      createdAt: _ca,
      updatedAt: _ua,
      ...invoiceData
    } = req.body;

    let updateData = { ...invoiceData, discountType, discountValue, taxRate };

    if (lineItems) {
      const totals = calculateTotals(lineItems, discountType, discountValue, taxRate);
      const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });

      updateData.subtotal = totals.subtotal;
      updateData.taxAmount = totals.taxAmount;
      updateData.total = totals.total;
      updateData.balance = Math.max(0, totals.total - (existing?.amountPaid || 0));

      await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: req.params.id } });
      updateData.lineItems = {
        create: lineItems.map((item, i) => ({
          type: item.type || 'service',
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
          sortOrder: i,
          pricebookItemId: item.pricebookItemId,
        })),
      };
    }

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: updateData,
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });

    return res.json({ success: true, data: invoice });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Invoice not found' });
    console.error('invoices.update error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const send = async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    return res.json({ success: true, data: invoice });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Invoice not found' });
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const recordPayment = async (req, res) => {
  try {
    const { amount, method, referenceNumber, notes, paidAt } = req.body;
    if (!amount || !method) {
      return res.status(400).json({ success: false, error: 'amount and method are required' });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (invoice.status === 'void') {
      return res.status(400).json({ success: false, error: 'Cannot record payment on a voided invoice' });
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: parseFloat(amount),
        method,
        referenceNumber,
        notes,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        status: 'completed',
      },
    });

    const newAmountPaid = invoice.amountPaid + parseFloat(amount);
    const newBalance = Math.max(0, invoice.total - newAmountPaid);
    const newStatus = newBalance === 0 ? 'paid' : invoice.status === 'draft' ? 'sent' : invoice.status;

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: newAmountPaid,
        balance: newBalance,
        status: newStatus,
        ...(newBalance === 0 && { paidAt: new Date() }),
      },
    });

    return res.json({ success: true, data: { payment, invoice: updatedInvoice } });
  } catch (err) {
    console.error('invoices.recordPayment error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const voidInvoice = async (req, res) => {
  try {
    const { voidReason } = req.body;
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: 'void', voidedAt: new Date(), voidReason },
    });
    return res.json({ success: true, data: invoice });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Invoice not found' });
    console.error('invoices.void error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { list, get, create, update, send, recordPayment, void: voidInvoice };
