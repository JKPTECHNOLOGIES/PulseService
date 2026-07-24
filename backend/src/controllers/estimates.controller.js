const prisma = require("../config/database");
const { respondError } = require("../utils/apiError");
const {
  paginate,
  paginatedResponse,
  generateNumber,
  calculateTotals,
  escapeHtml,
} = require("../utils/helpers");
const { generateEstimatePdf } = require("../services/pdf.service");
const { sendMail } = require("../services/email.service");
const { publicToken } = require("../utils/publicToken");
const {
  recordTimelineEvent,
  describeFieldEdits,
} = require("../utils/timeline");

const money = (n) => "$" + Number(n || 0).toFixed(2);

const ESTIMATE_NARRATED_FIELDS = [
  { field: "notes", label: "Quote Notes" },
  { field: "terms", label: "Quote Terms" },
];

// Columns with a real matching DB column -- these stay a normal, efficient
// paginated query with a Prisma `orderBy`. "customer" is handled separately
// below since the visible name isn't a single DB column (see
// invoices.controller.js for the same pattern).
const ESTIMATE_ORDER_BY = {
  estimate: (dir) => ({ estimateNumber: dir }),
  title: (dir) => ({ title: dir }),
  date: (dir) => ({ createdAt: dir }),
  total: (dir) => ({ total: dir }),
  status: (dir) => ({ status: dir }),
};

const ESTIMATE_INCLUDE = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
    },
  },
  _count: { select: { lineItems: true } },
};

function estimateCustomerName(est) {
  const c = est.customer;
  if (!c) return "";
  if (c.companyName && c.companyName.trim()) return c.companyName;
  return `${c.firstName || ""} ${c.lastName || ""}`.trim();
}

const list = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      customerId,
      search,
      sortKey,
      sortDir,
    } = req.query;
    const { skip, take } = paginate(page, limit);
    const dir = sortDir === "asc" ? "asc" : "desc";

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

    // Sorting by customer has to look at every matching row (not just the
    // current page) since the effective name isn't a single DB column --
    // fetch the whole filtered set, sort/paginate in memory (same pattern as
    // invoices.controller.js).
    if (sortKey === "customer") {
      const all = await prisma.estimate.findMany({
        where,
        include: ESTIMATE_INCLUDE,
      });

      const factor = dir === "asc" ? 1 : -1;
      all.sort(
        (a, b) =>
          estimateCustomerName(a)
            .toLowerCase()
            .localeCompare(estimateCustomerName(b).toLowerCase()) * factor,
      );

      const total = all.length;
      const pageRows = all.slice(skip, skip + take);

      return res.json({
        success: true,
        ...paginatedResponse(pageRows, total, page, limit),
      });
    }

    const orderBy = ESTIMATE_ORDER_BY[sortKey]?.(dir) ?? { createdAt: "desc" };

    const [estimates, total] = await Promise.all([
      prisma.estimate.findMany({
        where,
        skip,
        take,
        include: ESTIMATE_INCLUDE,
        orderBy,
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
      taxRate: _taxRate,
      validUntil,
      ...estimateData
    } = req.body;
    const totals = calculateTotals(lineItems, discountType, discountValue);

    const estimate = await prisma.estimate.create({
      data: {
        ...estimateData,
        // The job picker submits "" (not null/undefined) when no job is
        // linked -- an empty string is still a non-null FK value to Prisma,
        // so left as-is it fails with "job doesn't exist" on every jobless
        // quote instead of just leaving the relation unset.
        jobId: estimateData.jobId || null,
        // `validUntil` arrives as a date-only string (YYYY-MM-DD) from the
        // <input type="date">; Prisma's DateTime needs a full instant.
        validUntil: validUntil ? new Date(validUntil) : null,
        estimateNumber,
        createdById: req.user.id,
        discountType,
        discountValue,
        // Tax is no longer a supported charge on estimates; always zeroed.
        taxRate: 0,
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

    await recordTimelineEvent({
      customerId: estimate.customerId,
      entityType: "estimate",
      entityId: estimate.id,
      entityLabel: estimate.estimateNumber,
      action: "created",
      description: "created Quote",
      userId: req.user?.id,
    });

    return res.status(201).json({ success: true, data: estimate });
  } catch (err) {
    return respondError(res, err, "estimate");
  }
};

const update = async (req, res) => {
  try {
    const {
      lineItems,
      discountType,
      discountValue = 0,
      taxRate: _taxRate,
      validUntil,
      id: _id,
      estimateNumber: _en,
      createdAt: _ca,
      updatedAt: _ua,
      ...estimateData
    } = req.body;

    const before = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      select: {
        customerId: true,
        estimateNumber: true,
        notes: true,
        terms: true,
      },
    });
    if (!before) {
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    }

    const updateData = {
      ...estimateData,
      // See create() -- the job picker submits "" rather than
      // null/undefined when no job is linked, which Prisma treats as a real
      // (non-existent) foreign key instead of "no job".
      jobId: estimateData.jobId || null,
      discountType,
      discountValue,
      // Tax is no longer a supported charge on estimates; always zeroed
      // whenever the estimate is edited.
      taxRate: 0,
    };
    if (validUntil !== undefined) {
      updateData.validUntil = validUntil ? new Date(validUntil) : null;
    }

    if (lineItems) {
      const totals = calculateTotals(lineItems, discountType, discountValue);
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

    const fieldEdits = describeFieldEdits(
      before,
      estimate,
      ESTIMATE_NARRATED_FIELDS,
    );
    for (const description of fieldEdits) {
      await recordTimelineEvent({
        customerId: before.customerId,
        entityType: "estimate",
        entityId: estimate.id,
        entityLabel: before.estimateNumber,
        action: "edited",
        description,
        userId: req.user?.id,
      });
    }
    if (lineItems && fieldEdits.length === 0) {
      await recordTimelineEvent({
        customerId: before.customerId,
        entityType: "estimate",
        entityId: estimate.id,
        entityLabel: before.estimateNumber,
        action: "edited",
        description: "edited Quote line items",
        userId: req.user?.id,
      });
    }

    return res.json({ success: true, data: estimate });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });
    return respondError(res, err, "estimate");
  }
};

// Streams the estimate as a PDF (opens/downloads in the browser).
const getPdf = async (req, res) => {
  try {
    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { include: { locations: true } },
        job: { include: { location: true } },
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
        customer: { include: { locations: true } },
        job: { include: { location: true } },
        lineItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!estimate)
      return res
        .status(404)
        .json({ success: false, error: "Estimate not found" });

    // Defaults to the customer's primary email; the quote screen's "Send To"
    // picker can instead pass one or more specific addresses (e.g. a billing
    // contact) when the customer has more than one on file.
    const recipients = Array.isArray(req.body.recipients)
      ? req.body.recipients.map((r) => String(r).trim()).filter(Boolean)
      : estimate.customer?.email
        ? [estimate.customer.email]
        : [];

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No recipient email address selected",
      });
    }

    const settings = await prisma.companySettings.findFirst();
    const companyName = settings?.name || "Prime Comfort Solutions";
    const pdf = await generateEstimatePdf(estimate, settings);

    // Public, token-gated link the customer can open to review and approve or
    // reject the estimate online without logging in. Always included below
    // regardless of a custom subject/message, since it's the one actionable
    // link the customer needs -- not just decorative text to edit away.
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:8080";
    const approvalUrl = `${baseUrl}/estimate/${estimate.id}?token=${publicToken(
      "estimate",
      estimate.id,
    )}`;

    // The "Preview Email" dialog lets the sender write their own subject and
    // message to accompany the attached PDF -- these override the default
    // canned template when provided, rather than the PDF being the entire
    // email as before.
    const customSubject =
      typeof req.body.subject === "string" ? req.body.subject.trim() : "";
    const customMessage =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    const subject =
      customSubject ||
      `${companyName} \u2014 Estimate ${estimate.estimateNumber}`;
    const body =
      customMessage ||
      `Hi ${estimate.customer.firstName},\n\nPlease find attached estimate ${estimate.estimateNumber} for ${money(estimate.total)}.\n\nThank you,\n${companyName}`;
    const text = `${body}\n\nReview and approve it online: ${approvalUrl}`;
    const html = `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p><p><a href="${approvalUrl}">Review &amp; approve your estimate online</a></p>`;

    let emailPreviewUrl = null;
    let emailWarning = null;
    try {
      const result = await sendMail({
        to: recipients.join(", "),
        subject,
        text,
        html,
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

    await recordTimelineEvent({
      customerId: estimate.customerId,
      entityType: "estimate",
      entityId: estimate.id,
      entityLabel: estimate.estimateNumber,
      action: "sent",
      description: emailWarning
        ? "tried to send Quote, but the email failed to deliver"
        : `emailed Quote to ${recipients.join(", ")}`,
      userId: req.user?.id,
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

    await recordTimelineEvent({
      customerId: estimate.customerId,
      entityType: "estimate",
      entityId: estimate.id,
      entityLabel: estimate.estimateNumber,
      action: "approved",
      description: "approved Quote",
      userId: req.user?.id,
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

    await recordTimelineEvent({
      customerId: estimate.customerId,
      entityType: "estimate",
      entityId: estimate.id,
      entityLabel: estimate.estimateNumber,
      action: "rejected",
      description: rejectionReason
        ? `rejected Quote (${rejectionReason})`
        : "rejected Quote",
      userId: req.user?.id,
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

    await recordTimelineEvent({
      customerId: estimate.customerId,
      entityType: "estimate",
      entityId: estimate.id,
      entityLabel: estimate.estimateNumber,
      action: "converted",
      description: `converted Quote to Invoice #${invoice.invoiceNumber}`,
      userId: req.user?.id,
    });
    await recordTimelineEvent({
      customerId: invoice.customerId,
      entityType: "invoice",
      entityId: invoice.id,
      entityLabel: invoice.invoiceNumber,
      action: "created",
      description: `created Invoice from Quote #${estimate.estimateNumber}`,
      userId: req.user?.id,
    });

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
