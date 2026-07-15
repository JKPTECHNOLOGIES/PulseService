const prisma = require("../config/database");
const { respondError } = require("../utils/apiError");
const {
  paginate,
  paginatedResponse,
  generateNumber,
  calculateTotals,
} = require("../utils/helpers");
const { generateInvoicePdf } = require("../services/pdf.service");
const { sendMail } = require("../services/email.service");
const quickbooksSync = require("../services/quickbooks/sync-queue.service");

const money = (n) => "$" + Number(n || 0).toFixed(2);

// Drafts never sync — an invoice only goes to QuickBooks once it's finalized.
// A void supersedes whatever operation would otherwise apply. Never lets a
// QuickBooks hiccup break the invoicing API.
async function enqueueQuickBooksInvoiceSync(invoiceId) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true },
    });
    if (!invoice || invoice.status === "draft") return;

    if (invoice.status === "void") {
      const mapping = await prisma.quickBooksMapping.findUnique({
        where: {
          entityType_entityId: { entityType: "invoice", entityId: invoiceId },
        },
      });
      if (!mapping) return; // never synced — nothing to void in QuickBooks
      await quickbooksSync.enqueueSync("invoice", invoiceId, "void");
      return;
    }

    await quickbooksSync.enqueueSync("invoice", invoiceId);
  } catch (err) {
    console.error("quickbooks enqueueSync (invoice) error:", err);
  }
}

async function enqueueQuickBooksPaymentSync(paymentId) {
  try {
    await quickbooksSync.enqueueSync("payment", paymentId);
  } catch (err) {
    console.error("quickbooks enqueueSync (payment) error:", err);
  }
}

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, customerId, search } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { customer: { firstName: { contains: search, mode: "insensitive" } } },
        { customer: { lastName: { contains: search, mode: "insensitive" } } },
        {
          customer: { companyName: { contains: search, mode: "insensitive" } },
        },
        // Work order (job) number + description, so the search bar matches
        // "by Name, Invoice #, or WO#" like the office is used to.
        { job: { jobNumber: { contains: search, mode: "insensitive" } } },
        { job: { summary: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [invoices, total, agg] = await Promise.all([
      prisma.invoice.findMany({
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
          job: { select: { id: true, jobNumber: true, summary: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.invoice.count({ where }),
      // Grand totals across the whole filtered set (not just this page), for
      // the totals row under the table.
      prisma.invoice.aggregate({
        where,
        _sum: { total: true, balance: true },
      }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(invoices, total, page, limit),
      summary: {
        total: agg._sum.total ?? 0,
        balance: agg._sum.balance ?? 0,
      },
    });
  } catch (err) {
    console.error("invoices.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        job: {
          select: { id: true, jobNumber: true, summary: true, status: true },
        },
        estimate: { select: { id: true, estimateNumber: true } },
        lineItems: { orderBy: { sortOrder: "asc" } },
        payments: { orderBy: { createdAt: "desc" } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!invoice)
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });
    return res.json({ success: true, data: invoice });
  } catch (err) {
    console.error("invoices.get error:", err);
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

    const invoiceNumber = generateNumber(
      settings.invoicePrefix,
      settings.nextInvoiceNumber,
    );
    await prisma.companySettings.updateMany({
      data: { nextInvoiceNumber: { increment: 1 } },
    });

    const {
      lineItems = [],
      discountType,
      discountValue = 0,
      taxRate: _taxRate,
      dueDate,
      ...invoiceData
    } = req.body;
    const totals = calculateTotals(lineItems, discountType, discountValue);

    const invoice = await prisma.invoice.create({
      data: {
        ...invoiceData,
        // Date-only string from <input type="date"> -> full DateTime for Prisma.
        dueDate: dueDate ? new Date(dueDate) : null,
        invoiceNumber,
        createdById: req.user.id,
        discountType,
        discountValue,
        // Tax is no longer a supported charge on invoices; always zeroed.
        taxRate: 0,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        balance: totals.total,
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
            includeOnDocument: item.includeOnDocument !== false,
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: "asc" } }, customer: true },
    });

    await enqueueQuickBooksInvoiceSync(invoice.id);
    return res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    return respondError(res, err, "invoice");
  }
};

const update = async (req, res) => {
  try {
    const {
      lineItems,
      discountType,
      discountValue = 0,
      taxRate: _taxRate,
      dueDate,
      id: _id,
      invoiceNumber: _in,
      createdAt: _ca,
      updatedAt: _ua,
      ...invoiceData
    } = req.body;

    // Lock edits once a payment is applied or the invoice is void, to protect
    // accounting integrity (void & reissue instead).
    const existing = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });
    }
    if (existing.status === "void" || existing.amountPaid > 0) {
      return res.status(400).json({
        success: false,
        error:
          "This invoice can't be edited because a payment has been recorded or it is void. Void and reissue instead.",
      });
    }

    const updateData = {
      ...invoiceData,
      discountType,
      discountValue,
      // Tax is no longer a supported charge on invoices; always zeroed
      // whenever the invoice is edited.
      taxRate: 0,
    };
    if (dueDate !== undefined) {
      updateData.dueDate = dueDate ? new Date(dueDate) : null;
    }

    if (lineItems) {
      const totals = calculateTotals(lineItems, discountType, discountValue);

      updateData.subtotal = totals.subtotal;
      updateData.taxAmount = totals.taxAmount;
      updateData.total = totals.total;
      updateData.balance = Math.max(
        0,
        totals.total - (existing?.amountPaid || 0),
      );

      await prisma.invoiceLineItem.deleteMany({
        where: { invoiceId: req.params.id },
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
          includeOnDocument: item.includeOnDocument !== false,
        })),
      };
    }

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: updateData,
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    });

    await enqueueQuickBooksInvoiceSync(invoice.id);
    return res.json({ success: true, data: invoice });
  } catch (err) {
    return respondError(res, err, "invoice");
  }
};

// Streams the invoice as a PDF (opens/downloads in the browser).
const getPdf = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        lineItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!invoice)
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });

    const settings = await prisma.companySettings.findFirst();
    const pdf = await generateInvoicePdf(invoice, settings);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="Invoice-${invoice.invoiceNumber}.pdf"`,
    );
    return res.send(pdf);
  } catch (err) {
    console.error("invoices.getPdf error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Generates the PDF, emails it to the customer, and marks the invoice sent.
const send = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        lineItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!invoice)
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });
    if (!invoice.customer?.email) {
      return res.status(400).json({
        success: false,
        error: "Customer has no email address on file",
      });
    }

    const settings = await prisma.companySettings.findFirst();
    const companyName = settings?.name || "Prime Comfort Solutions";
    const pdf = await generateInvoicePdf(invoice, settings);

    let emailPreviewUrl = null;
    let emailWarning = null;
    try {
      const result = await sendMail({
        to: invoice.customer.email,
        subject: `${companyName} \u2014 Invoice ${invoice.invoiceNumber}`,
        text: `Hi ${invoice.customer.firstName},\n\nPlease find attached invoice ${invoice.invoiceNumber} for ${money(invoice.total)}. Balance due: ${money(invoice.balance)}.\n\nThank you,\n${companyName}`,
        html: `<p>Hi ${invoice.customer.firstName},</p><p>Please find attached invoice <strong>${invoice.invoiceNumber}</strong> for <strong>${money(invoice.total)}</strong>. Balance due: <strong>${money(invoice.balance)}</strong>.</p><p>Thank you,<br/>${companyName}</p>`,
        attachments: [
          {
            filename: `Invoice-${invoice.invoiceNumber}.pdf`,
            content: pdf,
            contentType: "application/pdf",
          },
        ],
      });
      emailPreviewUrl = result.previewUrl;
    } catch (mailErr) {
      console.error("invoices.send email failed:", mailErr);
      emailWarning =
        "Invoice marked as sent, but the email could not be delivered (mail server unavailable).";
    }

    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: "sent", sentAt: new Date() },
    });
    await enqueueQuickBooksInvoiceSync(updated.id);
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
        .json({ success: false, error: "Invoice not found" });
    console.error("invoices.send error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const recordPayment = async (req, res) => {
  try {
    const { amount, method, referenceNumber, notes, paidAt } = req.body;
    if (!amount || !method) {
      return res
        .status(400)
        .json({ success: false, error: "amount and method are required" });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });
    if (!invoice)
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });
    if (invoice.status === "void") {
      return res.status(400).json({
        success: false,
        error: "Cannot record payment on a voided invoice",
      });
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
        status: "completed",
      },
    });

    const newAmountPaid = invoice.amountPaid + parseFloat(amount);
    const newBalance = Math.max(0, invoice.total - newAmountPaid);
    const newStatus =
      newBalance === 0
        ? "paid"
        : invoice.status === "draft"
          ? "sent"
          : invoice.status;

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: newAmountPaid,
        balance: newBalance,
        status: newStatus,
        ...(newBalance === 0 && { paidAt: new Date() }),
      },
    });

    // Only (re)sync the invoice if this payment is what takes it out of draft
    // for the first time. Once an invoice is already synced, paid/balance
    // status flows through the ReceivePayment transaction itself in
    // QuickBooks — re-syncing the invoice header would just be a no-op Mod.
    if (invoice.status === "draft") {
      await enqueueQuickBooksInvoiceSync(updatedInvoice.id);
    }
    await enqueueQuickBooksPaymentSync(payment.id);

    return res.json({
      success: true,
      data: { payment, invoice: updatedInvoice },
    });
  } catch (err) {
    console.error("invoices.recordPayment error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const voidInvoice = async (req, res) => {
  try {
    const { voidReason } = req.body;
    const existing = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });
    }
    // A paid (or partially paid) invoice can't be voided out from under its
    // payment history -- that would leave real, collected money pointing at a
    // void document. Reverse the payment(s) first (POST /payments/:id/reverse),
    // which naturally moves the invoice out of "paid" and clears amountPaid.
    if (existing.amountPaid > 0) {
      return res.status(400).json({
        success: false,
        error:
          "This invoice has payments recorded against it. Reverse the payment(s) before voiding.",
      });
    }

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: "void", voidedAt: new Date(), voidReason },
    });
    await enqueueQuickBooksInvoiceSync(invoice.id);
    return res.json({ success: true, data: invoice });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });
    console.error("invoices.void error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Invoice counts per status (plus the grand total), used to badge the category
// tabs on the invoice list.
const stats = async (req, res) => {
  try {
    const grouped = await prisma.invoice.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const byStatus = {};
    let total = 0;
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
      total += g._count._all;
    }
    return res.json({ success: true, data: { total, byStatus } });
  } catch (err) {
    console.error("invoices.stats error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  stats,
  get,
  getPdf,
  create,
  update,
  send,
  recordPayment,
  void: voidInvoice,
};
