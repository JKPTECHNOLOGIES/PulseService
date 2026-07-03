/**
 * Outbound sync queue: PulseService enqueues a row the moment a synced record
 * changes; QuickBooks Web Connector drains it via the SOAP endpoint.
 *
 * Entity types implemented: "customer" (add/update), "invoice"
 * (add/update-header-only/void), "payment" (add — reports a completed
 * payment against an already-synced invoice; PulseService never routes money
 * through QuickBooks). See docs/quickbooks-sync.md for the design notes.
 */
const prisma = require("../../config/database");
const qbxml = require("./qbxml.service");
const itemMapping = require("./item-mapping.service");

async function enqueueSync(entityType, entityId, forceOperation) {
  const settings = await prisma.quickBooksSettings.findFirst();
  if (!settings?.isEnabled) return null; // integration is off — no-op

  const existingPending = await prisma.quickBooksSyncQueue.findFirst({
    where: { entityType, entityId, status: "pending" },
  });
  if (existingPending) {
    // A void supersedes a still-pending add/update for the same record.
    if (forceOperation && existingPending.operation !== forceOperation) {
      return prisma.quickBooksSyncQueue.update({
        where: { id: existingPending.id },
        data: { operation: forceOperation },
      });
    }
    return existingPending; // already queued; sends live data anyway
  }

  const mapping = await prisma.quickBooksMapping.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });

  return prisma.quickBooksSyncQueue.create({
    data: {
      entityType,
      entityId,
      operation: forceOperation ?? (mapping ? "update" : "add"),
    },
  });
}

// A job may depend on another entity having synced first (an invoice needs its
// customer; a payment needs both its invoice and its customer). Rather than
// blocking the whole queue behind one not-yet-ready job, we scan a bounded
// window and return the first one that's actually sendable right now.
async function isReady(job) {
  if (job.entityType === "invoice" && job.operation !== "void") {
    const invoice = await prisma.invoice.findUnique({
      where: { id: job.entityId },
      select: { customerId: true },
    });
    if (!invoice) return true; // gone — let it fail loudly and get flagged
    const mapping = await prisma.quickBooksMapping.findUnique({
      where: {
        entityType_entityId: {
          entityType: "customer",
          entityId: invoice.customerId,
        },
      },
    });
    return !!mapping;
  }
  if (job.entityType === "payment") {
    const payment = await prisma.payment.findUnique({
      where: { id: job.entityId },
      select: { invoiceId: true, customerId: true },
    });
    if (!payment) return true;
    const [invoiceMapping, customerMapping] = await Promise.all([
      prisma.quickBooksMapping.findUnique({
        where: {
          entityType_entityId: {
            entityType: "invoice",
            entityId: payment.invoiceId,
          },
        },
      }),
      prisma.quickBooksMapping.findUnique({
        where: {
          entityType_entityId: {
            entityType: "customer",
            entityId: payment.customerId,
          },
        },
      }),
    ]);
    return !!invoiceMapping && !!customerMapping;
  }
  return true;
}

async function getNextPending() {
  const candidates = await prisma.quickBooksSyncQueue.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 25, // bounded scan so one blocked job can't stall everything behind it
  });
  for (const job of candidates) {
    if (await isReady(job)) return job;
  }
  return null;
}

function countPending() {
  return prisma.quickBooksSyncQueue.count({ where: { status: "pending" } });
}

function findSentByRequestId(requestId) {
  return prisma.quickBooksSyncQueue.findFirst({
    where: { requestId, status: "sent" },
  });
}

// We only ever have one job "sent" (in flight) at a time in this one-at-a-time
// model, so a QBWC-level connection error can be attributed to it directly.
function findCurrentlySent() {
  return prisma.quickBooksSyncQueue.findFirst({
    where: { status: "sent" },
    orderBy: { lastAttemptAt: "desc" },
  });
}

function markSent(id, requestId) {
  return prisma.quickBooksSyncQueue.update({
    where: { id },
    data: {
      status: "sent",
      requestId,
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
}

function markSynced(id) {
  return prisma.quickBooksSyncQueue.update({
    where: { id },
    data: { status: "synced", lastError: null },
  });
}

function markError(id, message) {
  return prisma.quickBooksSyncQueue.update({
    where: { id },
    data: { status: "error", lastError: message },
  });
}

function retry(id) {
  return prisma.quickBooksSyncQueue.update({
    where: { id },
    data: { status: "pending", lastError: null, requestId: null },
  });
}

async function buildCustomerRequest(job, qbxmlVersion) {
  const customer = await prisma.customer.findUnique({
    where: { id: job.entityId },
    include: { locations: { where: { isPrimary: true }, take: 1 } },
  });
  if (!customer) throw new Error(`Customer ${job.entityId} no longer exists`);
  const customerInput = {
    ...customer,
    billAddress: customer.locations[0] ?? null,
  };

  if (job.operation === "update") {
    const mapping = await prisma.quickBooksMapping.findUnique({
      where: {
        entityType_entityId: { entityType: "customer", entityId: job.entityId },
      },
    });
    if (mapping) {
      return qbxml.buildCustomerModRequest({
        requestId: job.id,
        customer: customerInput,
        quickbooksId: mapping.quickbooksId,
        editSequence: mapping.editSequence,
        qbxmlVersion,
      });
    }
    // Never actually synced yet despite the "update" label (data drift) — Add instead.
  }
  return qbxml.buildCustomerAddRequest({
    requestId: job.id,
    customer: customerInput,
    qbxmlVersion,
  });
}

async function buildInvoiceLines(invoice) {
  const lines = [];
  for (const li of invoice.lineItems) {
    const itemName = await itemMapping.resolveItemName({
      pricebookItemId: li.pricebookItemId,
      lineItemType: li.type,
      label: li.name,
    });
    lines.push({
      itemName,
      description: li.description || li.name,
      quantity: li.quantity,
      rate: li.unitPrice,
      amount: li.total,
    });
  }

  if (Number(invoice.taxAmount) > 0) {
    const settings = await prisma.quickBooksSettings.findFirst();
    lines.push({
      itemName: settings.salesTaxItemName,
      amount: Number(invoice.taxAmount),
    });
  }

  if (Number(invoice.discountValue) > 0) {
    const discountItemName = await itemMapping.resolveItemName({
      lineItemType: "discount",
      label: "Invoice discount",
    });
    const discountAmount =
      invoice.discountType === "percentage"
        ? Number(invoice.subtotal) * (Number(invoice.discountValue) / 100)
        : Number(invoice.discountValue);
    lines.push({ itemName: discountItemName, amount: -discountAmount });
  }

  return lines;
}

async function buildInvoiceRequest(job, qbxmlVersion) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: job.entityId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!invoice) throw new Error(`Invoice ${job.entityId} no longer exists`);

  if (job.operation === "void") {
    const mapping = await prisma.quickBooksMapping.findUnique({
      where: {
        entityType_entityId: { entityType: "invoice", entityId: job.entityId },
      },
    });
    if (!mapping) throw new Error("Invoice has no QuickBooks mapping to void");
    return qbxml.buildTxnVoidRequest({
      requestId: job.id,
      quickbooksId: mapping.quickbooksId,
      txnDelType: "Invoice",
      qbxmlVersion,
    });
  }

  const customerMapping = await prisma.quickBooksMapping.findUnique({
    where: {
      entityType_entityId: {
        entityType: "customer",
        entityId: invoice.customerId,
      },
    },
  });
  if (!customerMapping) {
    // Should already be filtered out by isReady(); kept as a safety net.
    throw new Error(
      "Customer for this invoice has not synced to QuickBooks yet",
    );
  }

  if (job.operation === "update") {
    const mapping = await prisma.quickBooksMapping.findUnique({
      where: {
        entityType_entityId: { entityType: "invoice", entityId: job.entityId },
      },
    });
    if (mapping) {
      return qbxml.buildInvoiceModRequest({
        requestId: job.id,
        invoice,
        quickbooksId: mapping.quickbooksId,
        editSequence: mapping.editSequence,
        qbxmlVersion,
      });
    }
    // Never actually synced yet despite the "update" label — Add instead.
  }

  const lines = await buildInvoiceLines(invoice);
  return qbxml.buildInvoiceAddRequest({
    requestId: job.id,
    invoice,
    customerQbId: customerMapping.quickbooksId,
    lines,
    qbxmlVersion,
  });
}

async function buildPaymentRequest(job, qbxmlVersion) {
  const payment = await prisma.payment.findUnique({
    where: { id: job.entityId },
  });
  if (!payment) throw new Error(`Payment ${job.entityId} no longer exists`);

  const [invoiceMapping, customerMapping, settings] = await Promise.all([
    prisma.quickBooksMapping.findUnique({
      where: {
        entityType_entityId: {
          entityType: "invoice",
          entityId: payment.invoiceId,
        },
      },
    }),
    prisma.quickBooksMapping.findUnique({
      where: {
        entityType_entityId: {
          entityType: "customer",
          entityId: payment.customerId,
        },
      },
    }),
    prisma.quickBooksSettings.findFirst(),
  ]);
  if (!invoiceMapping)
    throw new Error(
      "Invoice for this payment has not synced to QuickBooks yet",
    );
  if (!customerMapping)
    throw new Error(
      "Customer for this payment has not synced to QuickBooks yet",
    );

  return qbxml.buildReceivePaymentAddRequest({
    requestId: job.id,
    customerQbId: customerMapping.quickbooksId,
    payment,
    invoiceTxnId: invoiceMapping.quickbooksId,
    depositToAccountName: settings.depositToAccountName,
    qbxmlVersion,
  });
}

/** Loads the record behind a queue row and builds the qbXML request for it. */
function buildRequestForJob(job, qbxmlVersion) {
  if (job.entityType === "customer")
    return buildCustomerRequest(job, qbxmlVersion);
  if (job.entityType === "invoice")
    return buildInvoiceRequest(job, qbxmlVersion);
  if (job.entityType === "payment")
    return buildPaymentRequest(job, qbxmlVersion);
  throw new Error(
    `QuickBooks sync for entityType "${job.entityType}" is not implemented yet`,
  );
}

/** Applies a parsed qbXML response to the matching queue row + identity map. */
async function applyResponse(parsed) {
  const job = await findSentByRequestId(parsed.requestId);
  if (!job) return null; // stale/duplicate response — nothing to reconcile

  if (qbxml.isSuccess(parsed)) {
    const identity = qbxml.extractIdentity(parsed.ret);
    const quickbooksId = identity?.listId ?? identity?.txnId ?? null;
    if (quickbooksId) {
      await prisma.quickBooksMapping.upsert({
        where: {
          entityType_entityId: {
            entityType: job.entityType,
            entityId: job.entityId,
          },
        },
        update: {
          quickbooksId,
          editSequence: identity.editSequence,
          lastSyncedAt: new Date(),
        },
        create: {
          entityType: job.entityType,
          entityId: job.entityId,
          quickbooksId,
          editSequence: identity.editSequence,
        },
      });
    }
    // A void has no *Ret to store, but the operation succeeding is itself the
    // outcome — no identity to update.
    await markSynced(job.id);
  } else {
    await markError(
      job.id,
      parsed.statusMessage || `QuickBooks error ${parsed.statusCode}`,
    );
  }
  return job;
}

module.exports = {
  enqueueSync,
  getNextPending,
  countPending,
  findSentByRequestId,
  findCurrentlySent,
  markSent,
  markSynced,
  markError,
  retry,
  buildRequestForJob,
  applyResponse,
};
