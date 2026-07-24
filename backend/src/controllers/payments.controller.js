const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");
const { recordTimelineEvent } = require("../utils/timeline");

const money = (n) => "$" + Number(n || 0).toFixed(2);

// Columns with a real matching DB column -- these stay a normal, efficient
// paginated query with a Prisma `orderBy`. Sorting has to happen server-side
// across the whole filtered set (not just the current page), same as
// invoices.controller.js.
const PAYMENT_ORDER_BY = {
  date: (dir) => ({ paidAt: dir }),
  method: (dir) => ({ method: dir }),
  status: (dir) => ({ status: dir }),
  amount: (dir) => ({ amount: dir }),
};

const PAYMENT_INCLUDE = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      status: true,
    },
  },
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
    },
  },
};

function paymentCustomerName(p) {
  const c = p.customer;
  if (!c) return "";
  if (c.companyName && c.companyName.trim()) return c.companyName;
  return `${c.firstName || ""} ${c.lastName || ""}`.trim();
}

const list = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      customerId,
      method,
      status,
      sortKey,
      sortDir,
    } = req.query;
    const { skip, take } = paginate(page, limit);
    const dir = sortDir === "asc" ? "asc" : "desc";

    const where = {};
    if (customerId) where.customerId = customerId;
    if (method) where.method = method;
    if (status) where.status = status;

    // Sorting by customer has to look at every matching row (not just the
    // current page) since the effective name isn't a single DB column --
    // fetch the whole filtered set, sort/paginate in memory (same pattern as
    // invoices.controller.js).
    if (sortKey === "customer") {
      const all = await prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
      });

      const factor = dir === "asc" ? 1 : -1;
      all.sort(
        (a, b) =>
          paymentCustomerName(a)
            .toLowerCase()
            .localeCompare(paymentCustomerName(b).toLowerCase()) * factor,
      );

      const total = all.length;
      const pageRows = all.slice(skip, skip + take);

      return res.json({
        success: true,
        ...paginatedResponse(pageRows, total, page, limit),
      });
    }

    const orderBy = PAYMENT_ORDER_BY[sortKey]?.(dir) ?? { createdAt: "desc" };

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take,
        include: PAYMENT_INCLUDE,
        orderBy,
      }),
      prisma.payment.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(payments, total, page, limit),
    });
  } catch (err) {
    console.error("payments.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Undoes a previously recorded payment (e.g. it bounced, was recorded in
// error, or the invoice needs to be voided and the money returned). The
// payment row is kept for audit history but flagged 'reversed' -- distinct
// from an actual processor 'refunded' status, since no money necessarily
// moved -- and excluded from the invoice's amountPaid/balance, which unwinds
// the invoice's status back out of 'paid'. This is the only way to get a
// fully-paid invoice back into a voidable state.
const reversePayment = async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
    });
    if (!payment) {
      return res
        .status(404)
        .json({ success: false, error: "Payment not found" });
    }
    if (payment.status === "reversed" || payment.status === "refunded") {
      return res.status(400).json({
        success: false,
        error: "This payment has already been reversed",
      });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: payment.invoiceId },
    });
    if (!invoice) {
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });
    }
    if (invoice.status === "void") {
      return res.status(400).json({
        success: false,
        error: "Cannot reverse a payment on a voided invoice",
      });
    }

    const newAmountPaid = Math.max(0, invoice.amountPaid - payment.amount);
    const newBalance = Math.max(0, invoice.total - newAmountPaid);
    const newStatus =
      newBalance === 0
        ? "paid"
        : newAmountPaid > 0
          ? "partial"
          : invoice.dueDate && new Date(invoice.dueDate) < new Date()
            ? "overdue"
            : "sent";

    const [updatedPayment, updatedInvoice] = await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: "reversed" },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: newAmountPaid,
          balance: newBalance,
          status: newStatus,
          ...(newBalance > 0 && { paidAt: null }),
        },
      }),
    ]);

    await recordTimelineEvent({
      customerId: invoice.customerId,
      entityType: "invoice",
      entityId: invoice.id,
      entityLabel: invoice.invoiceNumber,
      action: "payment_reversed",
      description: `reversed a ${money(payment.amount)} payment on Invoice`,
      userId: req.user?.id,
    });

    return res.json({
      success: true,
      data: { payment: updatedPayment, invoice: updatedInvoice },
    });
  } catch (err) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "Payment not found" });
    }
    console.error("payments.reverse error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, reversePayment };
