const prisma = require("../config/database");
const {
  paginate,
  paginatedResponse,
  generateNumber,
  calculateTotals,
} = require("../utils/helpers");
const { generateEstimatePdf } = require("../services/pdf.service");
const { sendMail } = require("../services/email.service");
const { publicToken } = require("../utils/publicToken");

const money = (n) => "$" + Number(n || 0).toFixed(2);

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, customerId, search } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { estimateNumber: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { customer: { firstName: { contains: search, mode: "insensitive" } } },
        { customer: { lastName: { contains: search, mode: "insensitive" } } },
        {
          customer: { companyName: { contains: search, mode: "insensitive" } },
        },
      ];
    }

    const [estimates, total] = await Promise.all([
      prisma.estimate.findMany({
        where,
        skip,
        take,
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          _count: { select: { lineItems: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.estimate.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(estimates, total, page, limit),
    });
  } catch (err) {
    console.error("estimates.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        job: {
          select: { id: true, jobNumber: true, summary: true, status: true },
        },
        lineItems: { orderBy: { sortOrder: "asc" } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        invoice: {
          select: { id: true, invoiceNumber: true, status: true, total: true },
        },
      },
    });

    if (!estimate)
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    return res.json({ success: true, data: estimate });
  } catch (err) {
    console.error("estimates.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (!settings)
      return res
        .status(500)
        .json({ success: false, error: "Company settings not found" });

    const estimateNumber = generateNumber(
      settings.estimatePrefix,
      settings.nextEstimateNumber,
    );
    await prisma.companySettings.updateMany({
      data: { nextEstimateNumber: { increment: 1 } },
    });

    const {
      lineItems = [],
      discountType,
      discountValue = 0,
      taxRate = 0,
      ...estimateData
    } = req.body;
    const totals = calculateTotals(
      lineItems,
      discountType,
      discountValue,
      taxRate,
    );

    const estimate = await prisma.estimate.create({
      data: {
        ...estimateData,
        estimateNumber,
        createdById: req.user.id,
        discountType,
        discountValue,
        taxRate,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        lineItems: {
          create: lineItems.map((item, i) => ({
            type: item.type || "service",
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
      include: { lineItems: { orderBy: { sortOrder: "asc" } }, customer: true },
    });

    return res.status(201).json({ success: true, data: estimate });
  } catch (err) {
    console.error("estimates.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
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
      estimateNumber: _en,
      createdAt: _ca,
      updatedAt: _ua,
      ...estimateData
    } = req.body;

    const updateData = {
      ...estimateData,
      discountType,
      discountValue,
      taxRate,
    };

    if (lineItems) {
      const totals = calculateTotals(
        lineItems,
        discountType,
        discountValue,
        taxRate,
      );
      updateData.subtotal = totals.subtotal;
      updateData.taxAmount = totals.taxAmount;
      updateData.total = totals.total;

      await prisma.estimateLineItem.deleteMany({
        where: { estimateId: req.params.id },
      });
      updateData.lineItems = {
        create: lineItems.map((item, i) => ({
          type: item.type || "service",
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

    const estimate = await prisma.estimate.update({
      where: { id: req.params.id },
      data: updateData,
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    });

    return res.json({ success: true, data: estimate });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    console.error("estimates.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Streams the estimate as a PDF (opens/downloads in the browser).
const getPdf = async (req, res) => {
  try {
    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        lineItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!estimate)
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });

    const settings = await prisma.companySettings.findFirst();
    const pdf = await generateEstimatePdf(estimate, settings);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="Estimate-${estimate.estimateNumber}.pdf"`,
    );
    return res.send(pdf);
  } catch (err) {
    console.error("estimates.getPdf error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Generates the PDF, emails it to the customer, and marks the estimate sent.
const send = async (req, res) => {
  try {
    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        lineItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!estimate)
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    if (!estimate.customer?.email) {
      return res.status(400).json({
        success: false,
        error: "Customer has no email address on file",
      });
    }

    const settings = await prisma.companySettings.findFirst();
    const companyName = settings?.name || "PulseService";
    const pdf = await generateEstimatePdf(estimate, settings);

    // Public, token-gated link the customer can open to review and approve or
    // reject the estimate online without logging in.
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:8080";
    const approvalUrl = `${baseUrl}/estimate/${estimate.id}?token=${publicToken(
      "estimate",
      estimate.id,
    )}`;

    let emailPreviewUrl = null;
    let emailWarning = null;
    try {
      const result = await sendMail({
        to: estimate.customer.email,
        subject: `${companyName} \u2014 Estimate ${estimate.estimateNumber}`,
        text: `Hi ${estimate.customer.firstName},\n\nPlease find attached estimate ${estimate.estimateNumber} for ${money(estimate.total)}.\n\nReview and approve it online: ${approvalUrl}\n\nThank you,\n${companyName}`,
        html: `<p>Hi ${estimate.customer.firstName},</p><p>Please find attached estimate <strong>${estimate.estimateNumber}</strong> for <strong>${money(estimate.total)}</strong>.</p><p><a href="${approvalUrl}">Review &amp; approve your estimate online</a></p><p>Thank you,<br/>${companyName}</p>`,
        attachments: [
          {
            filename: `Estimate-${estimate.estimateNumber}.pdf`,
            content: pdf,
            contentType: "application/pdf",
          },
        ],
      });
      emailPreviewUrl = result.previewUrl;
    } catch (mailErr) {
      console.error("estimates.send email failed:", mailErr);
      emailWarning =
        "Estimate marked as sent, but the email could not be delivered (mail server unavailable).";
    }

    const updated = await prisma.estimate.update({
      where: { id: req.params.id },
      data: { status: "sent", sentAt: new Date() },
    });
    return res.json({
      success: true,
      data: updated,
      emailPreviewUrl,
      emailWarning,
    });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    console.error("estimates.send error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const approve = async (req, res) => {
  try {
    const estimate = await prisma.estimate.update({
      where: { id: req.params.id },
      data: { status: "approved", approvedAt: new Date() },
    });
    return res.json({ success: true, data: estimate });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const reject = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const estimate = await prisma.estimate.update({
      where: { id: req.params.id },
      data: { status: "rejected", rejectedAt: new Date(), rejectionReason },
    });
    return res.json({ success: true, data: estimate });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const convertToInvoice = async (req, res) => {
  try {
    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: { lineItems: true, invoice: true },
    });
    if (!estimate)
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    if (estimate.invoice) {
      return res.status(400).json({
        success: false,
        error: "Estimate has already been converted to an invoice",
      });
    }

    const settings = await prisma.companySettings.findFirst();
    if (!settings)
      return res
        .status(500)
        .json({ success: false, error: "Company settings not found" });

    const invoiceNumber = generateNumber(
      settings.invoicePrefix,
      settings.nextInvoiceNumber,
    );
    await prisma.companySettings.updateMany({
      data: { nextInvoiceNumber: { increment: 1 } },
    });

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        customerId: estimate.customerId,
        jobId: estimate.jobId,
        estimateId: estimate.id,
        status: "draft",
        subtotal: estimate.subtotal,
        discountType: estimate.discountType,
        discountValue: estimate.discountValue,
        taxRate: estimate.taxRate,
        taxAmount: estimate.taxAmount,
        total: estimate.total,
        balance: estimate.total,
        notes: estimate.notes,
        terms: estimate.terms,
        createdById: req.user.id,
        lineItems: {
          create: estimate.lineItems.map((item) => ({
            type: item.type,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            sortOrder: item.sortOrder,
            pricebookItemId: item.pricebookItemId,
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: "asc" } }, customer: true },
    });

    // Mark estimate as approved if it was in draft/sent
    if (["draft", "sent"].includes(estimate.status)) {
      await prisma.estimate.update({
        where: { id: estimate.id },
        data: { status: "approved", approvedAt: new Date() },
      });
    }

    return res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    console.error("estimates.convertToInvoice error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  get,
  getPdf,
  create,
  update,
  send,
  approve,
  reject,
  convertToInvoice,
};
