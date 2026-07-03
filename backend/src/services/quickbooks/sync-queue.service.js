/**
 * Outbound sync queue: PulseService enqueues a row the moment a synced record
 * changes; QuickBooks Web Connector drains it via the SOAP endpoint. Only
 * "customer" is implemented as an entity type so far — buildRequestForJob is
 * the single place new entity types (invoice, payment) get wired in later.
 */
const prisma = require("../../config/database");
const qbxml = require("./qbxml.service");

async function enqueueSync(entityType, entityId) {
  const settings = await prisma.quickBooksSettings.findFirst();
  if (!settings?.isEnabled) return null; // integration is off — no-op

  const existingPending = await prisma.quickBooksSyncQueue.findFirst({
    where: { entityType, entityId, status: "pending" },
  });
  if (existingPending) return existingPending; // already queued; sends live data anyway

  const mapping = await prisma.quickBooksMapping.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });

  return prisma.quickBooksSyncQueue.create({
    data: { entityType, entityId, operation: mapping ? "update" : "add" },
  });
}

function getNextPending() {
  return prisma.quickBooksSyncQueue.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
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

/** Loads the record behind a queue row and builds the qbXML request for it. */
async function buildRequestForJob(job, qbxmlVersion) {
  if (job.entityType === "customer") {
    const customer = await prisma.customer.findUnique({
      where: { id: job.entityId },
      include: { locations: { where: { isPrimary: true }, take: 1 } },
    });
    if (!customer) throw new Error(`Customer ${job.entityId} no longer exists`);
    const customerInput = { ...customer, billAddress: customer.locations[0] ?? null };

    if (job.operation === "update") {
      const mapping = await prisma.quickBooksMapping.findUnique({
        where: { entityType_entityId: { entityType: "customer", entityId: job.entityId } },
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
    return qbxml.buildCustomerAddRequest({ requestId: job.id, customer: customerInput, qbxmlVersion });
  }

  throw new Error(`QuickBooks sync for entityType "${job.entityType}" is not implemented yet`);
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
        where: { entityType_entityId: { entityType: job.entityType, entityId: job.entityId } },
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
    await markSynced(job.id);
  } else {
    await markError(job.id, parsed.statusMessage || `QuickBooks error ${parsed.statusCode}`);
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
