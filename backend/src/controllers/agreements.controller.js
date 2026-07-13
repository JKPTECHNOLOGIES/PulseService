const prisma = require('../config/database');
const { paginate, paginatedResponse } = require('../utils/helpers');
const { generateAgreementPdf } = require('../services/pdf.service');
const { sendMail } = require('../services/email.service');

const money = (n) => '$' + Number(n || 0).toFixed(2);

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
    const companyName = settings?.name || 'PulseService';
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

module.exports = {
  list,
  get,
  getPdf,
  create,
  update,
  send,
  scheduleVisit,
  completeVisit,
};
