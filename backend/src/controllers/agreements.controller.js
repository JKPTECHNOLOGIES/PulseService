const prisma = require('../config/database');
const {
  paginate,
  paginatedResponse,
  generateNumber,
  calculateTotals,
} = require('../utils/helpers');
const { generateAgreementPdf } = require('../services/pdf.service');
const { sendMail } = require('../services/email.service');

const money = (n) => '$' + Number(n || 0).toFixed(2);

// Advance a billing date by one cycle. Distinct from RecurringJob's schedule
// advance (different frequency vocabulary: monthly/quarterly/semi_annual/annual).
function advanceBilling(date, frequency) {
  const d = new Date(date);
  switch (frequency) {
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'semi_annual':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'annual':
      d.setFullYear(d.getFullYear() + 1);
      break;
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

// Creates one Invoice for an agreement's billing cycle (the monetary side of a
// service agreement -- separate from RecurringJob, which generates the labor
// side / work orders). Advances nextBillingDate. Shared by the manual
// "Generate Invoice" action and the "run due billing" sweep.
async function generateInvoiceForAgreement(agreement, userId) {
  const settings = await prisma.companySettings.findFirst();
  if (!settings) throw new Error('Company settings not found');

  const invoiceNumber = generateNumber(
    settings.invoicePrefix,
    settings.nextInvoiceNumber,
  );
  const amount = Number(agreement.amount || 0);
  const lineItems = [
    {
      type: 'service',
      name: `Service Agreement \u2014 ${agreement.name}`,
      description: `${agreement.agreementNumber} billing cycle`,
      quantity: 1,
      unitPrice: amount,
    },
  ];
  const totals = calculateTotals(lineItems, undefined, 0);

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: agreement.customerId,
        serviceAgreementId: agreement.id,
        status: 'draft',
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        balance: totals.total,
        createdById: userId,
        lineItems: {
          create: lineItems.map((item, i) => ({
            type: item.type,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
            sortOrder: i,
          })),
        },
      },
      include: { lineItems: true },
    });
    await tx.companySettings.update({
      where: { id: settings.id },
      data: { nextInvoiceNumber: { increment: 1 } },
    });
    await tx.serviceAgreement.update({
      where: { id: agreement.id },
      data: {
        nextBillingDate: advanceBilling(
          agreement.nextBillingDate || new Date(),
          agreement.billingFrequency,
        ),
      },
    });
    return created;
  });

  return invoice;
}

// Loads an agreement with the relations the PDF needs (customer + ordered
// visits). Shared by getPdf and send.
function findAgreementForPdf(id) {
  return prisma.serviceAgreement.findUnique({
    where: { id },
    include: {
      customer: true,
      visits: { orderBy: { scheduledDate: 'asc' } },
    },
  });
}

// Columns with a real matching DB column -- these stay a normal, efficient
// paginated query with a Prisma `orderBy`. Sorting has to happen server-side
// across the whole filtered set (not just the current page), same as
// invoices.controller.js.
const AGREEMENT_ORDER_BY = {
  agreement: (dir) => ({ agreementNumber: dir }),
  name: (dir) => ({ name: dir }),
  term: (dir) => ({ startDate: dir }),
  amount: (dir) => ({ amount: dir }),
  status: (dir) => ({ status: dir }),
  nextBilling: (dir) => ({ nextBillingDate: dir }),
  lastSent: (dir) => ({ lastSentAt: dir }),
};

const AGREEMENT_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
  _count: { select: { visits: true, invoices: true } },
};

function agreementCustomerName(ag) {
  const c = ag.customer;
  if (!c) return '';
  if (c.companyName && c.companyName.trim()) return c.companyName;
  return `${c.firstName || ''} ${c.lastName || ''}`.trim();
}

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, customerId, sortKey, sortDir } = req.query;
    const { skip, take } = paginate(page, limit);
    const dir = sortDir === 'asc' ? 'asc' : 'desc';

    const where = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    // Sorting by customer has to look at every matching row (not just the
    // current page) since the effective name isn't a single DB column --
    // fetch the whole filtered set, sort/paginate in memory (same pattern as
    // invoices.controller.js).
    if (sortKey === 'customer') {
      const all = await prisma.serviceAgreement.findMany({
        where,
        include: AGREEMENT_INCLUDE,
      });

      const factor = dir === 'asc' ? 1 : -1;
      all.sort(
        (a, b) =>
          agreementCustomerName(a)
            .toLowerCase()
            .localeCompare(agreementCustomerName(b).toLowerCase()) * factor,
      );

      const total = all.length;
      const pageRows = all.slice(skip, skip + take);

      return res.json({
        success: true,
        ...paginatedResponse(pageRows, total, page, limit),
      });
    }

    const orderBy = AGREEMENT_ORDER_BY[sortKey]?.(dir) ?? { createdAt: 'desc' };

    const [agreements, total] = await Promise.all([
      prisma.serviceAgreement.findMany({
        where,
        skip,
        take,
        include: AGREEMENT_INCLUDE,
        orderBy,
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
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            balance: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        recurringJobs: {
          select: {
            id: true,
            summary: true,
            frequency: true,
            interval: true,
            nextRunDate: true,
            isActive: true,
            lastRunAt: true,
            _count: { select: { jobs: true } },
          },
          orderBy: { nextRunDate: 'asc' },
        },
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

// Streams the agreement as a PDF (opens/downloads in the browser).
const getPdf = async (req, res) => {
  try {
    const agreement = await findAgreementForPdf(req.params.id);
    if (!agreement)
      return res.status(404).json({ success: false, error: 'Agreement not found' });

    const settings = await prisma.companySettings.findFirst();
    const pdf = await generateAgreementPdf(agreement, settings);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Agreement-${agreement.agreementNumber}.pdf"`,
    );
    return res.send(pdf);
  } catch (err) {
    console.error('agreements.getPdf error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

// Generates the PDF and emails it to the customer. Unlike invoices, an agreement
// has no "sent" status to flip, so this only delivers the document.
const send = async (req, res) => {
  try {
    const agreement = await findAgreementForPdf(req.params.id);
    if (!agreement)
      return res.status(404).json({ success: false, error: 'Agreement not found' });
    if (!agreement.customer?.email) {
      return res.status(400).json({
        success: false,
        error: 'Customer has no email address on file',
      });
    }

    const settings = await prisma.companySettings.findFirst();
    const companyName = settings?.name || 'Prime Comfort Solutions';
    const pdf = await generateAgreementPdf(agreement, settings);

    let emailPreviewUrl = null;
    let emailWarning = null;
    try {
      const result = await sendMail({
        to: agreement.customer.email,
        subject: `${companyName} \u2014 Service Agreement ${agreement.agreementNumber}`,
        text: `Hi ${agreement.customer.firstName},\n\nPlease find attached your service agreement ${agreement.agreementNumber} (${agreement.name}) for ${money(agreement.amount)} per ${agreement.billingFrequency}.\n\nThank you,\n${companyName}`,
        html: `<p>Hi ${agreement.customer.firstName},</p><p>Please find attached your service agreement <strong>${agreement.agreementNumber}</strong> (${agreement.name}) for <strong>${money(agreement.amount)}</strong> per ${agreement.billingFrequency}.</p><p>Thank you,<br/>${companyName}</p>`,
        attachments: [
          {
            filename: `Agreement-${agreement.agreementNumber}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
      emailPreviewUrl = result.previewUrl;
    } catch (mailErr) {
      console.error('agreements.send email failed:', mailErr);
      emailWarning =
        'The agreement PDF was generated, but the email could not be delivered (mail server unavailable).';
    }

    const updated = await prisma.serviceAgreement.update({
      where: { id: agreement.id },
      data: { lastSentAt: new Date() },
    });

    return res.json({
      success: true,
      data: updated,
      emailPreviewUrl,
      emailWarning,
    });
  } catch (err) {
    console.error('agreements.send error:', err);
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

// Manual "Generate Invoice" action -- bills this agreement's cycle now,
// regardless of nextBillingDate, and advances the schedule.
const generateInvoice = async (req, res) => {
  try {
    const agreement = await prisma.serviceAgreement.findUnique({
      where: { id: req.params.id },
    });
    if (!agreement) {
      return res.status(404).json({ success: false, error: 'Agreement not found' });
    }
    const invoice = await generateInvoiceForAgreement(agreement, req.user.id);
    return res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    console.error('agreements.generateInvoice error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

// Bills every active agreement whose nextBillingDate has arrived. Mirrors
// RecurringJob's "run due" sweep, kept entirely separate so a business can
// run job generation and invoice billing on independent schedules.
const runDueBilling = async (req, res) => {
  try {
    const due = await prisma.serviceAgreement.findMany({
      where: {
        status: 'active',
        nextBillingDate: { lte: new Date() },
      },
    });
    let created = 0;
    for (const agreement of due) {
      await generateInvoiceForAgreement(agreement, req.user.id);
      created += 1;
    }
    return res.json({ success: true, data: { created } });
  } catch (err) {
    console.error('agreements.runDueBilling error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = {
  list,
  get,
  getPdf,
  create,
  update,
  send,
  scheduleVisit,
  completeVisit,
  generateInvoice,
  runDueBilling,
};
