const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");
const quickbooksSync = require("../services/quickbooks/sync-queue.service");

async function getOrCreateSettings() {
  let settings = await prisma.quickBooksSettings.findFirst();
  if (!settings) settings = await prisma.quickBooksSettings.create({ data: {} });
  return settings;
}

// Never expose the password hash to the client.
function sanitize(settings) {
  const { webConnectorPasswordHash: _h, ...rest } = settings;
  return { ...rest, hasPassword: !!_h };
}

const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json({ success: true, data: sanitize(settings) });
  } catch (err) {
    console.error("quickbooks.getSettings error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const updateSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const {
      isEnabled,
      companyFileName,
      webConnectorUsername,
      webConnectorPassword, // plain text in the request; hashed before storing
      salesTaxItemName,
      depositToAccountName,
      appId,
      appName,
    } = req.body;

    const data = {
      ...(isEnabled !== undefined && { isEnabled: !!isEnabled }),
      ...(companyFileName !== undefined && { companyFileName: companyFileName || null }),
      ...(webConnectorUsername !== undefined && { webConnectorUsername }),
      ...(salesTaxItemName !== undefined && { salesTaxItemName }),
      ...(depositToAccountName !== undefined && {
        depositToAccountName: depositToAccountName || null,
      }),
      ...(appId !== undefined && { appId }),
      ...(appName !== undefined && { appName }),
    };

    if (webConnectorPassword) {
      data.webConnectorPasswordHash = await bcrypt.hash(webConnectorPassword, 10);
    }

    const updated = await prisma.quickBooksSettings.update({
      where: { id: settings.id },
      data,
    });
    return res.json({ success: true, data: sanitize(updated) });
  } catch (err) {
    console.error("quickbooks.updateSettings error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Generates the .qwc file the user opens once in QuickBooks Web Connector to
// register this integration. OwnerID/FileID are generated once and kept
// stable so re-downloading doesn't force re-adding the connector.
const downloadConnectorFile = async (req, res) => {
  try {
    let settings = await getOrCreateSettings();
    if (!settings.ownerId || !settings.qbwcFileId) {
      settings = await prisma.quickBooksSettings.update({
        where: { id: settings.id },
        data: {
          ownerId: settings.ownerId || crypto.randomUUID(),
          qbwcFileId: settings.qbwcFileId || crypto.randomUUID(),
        },
      });
    }

    const base = process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const appUrl = `${base}/api/v1/quickbooks/soap`;

    const xml =
      `<?xml version="1.0"?>\n` +
      `<QBWCXML>\n` +
      `    <AppName>${settings.appName}</AppName>\n` +
      `    <AppID>${settings.appId}</AppID>\n` +
      `    <AppURL>${appUrl}</AppURL>\n` +
      `    <AppDescription>Syncs customers, invoices and payments from PulseService into QuickBooks Desktop.</AppDescription>\n` +
      `    <AppSupport>${base}</AppSupport>\n` +
      `    <UserName>${settings.webConnectorUsername}</UserName>\n` +
      `    <OwnerID>{${settings.ownerId}}</OwnerID>\n` +
      `    <FileID>{${settings.qbwcFileId}}</FileID>\n` +
      `    <QBType>QBFS</QBType>\n` +
      `    <IsReadOnly>false</IsReadOnly>\n` +
      `</QBWCXML>\n`;

    res.setHeader("Content-Disposition", 'attachment; filename="pulseservice.qwc"');
    return res.type("application/xml").send(xml);
  } catch (err) {
    console.error("quickbooks.downloadConnectorFile error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Sync queue & identity map (visibility for Finance) ─────────────────────

const listQueue = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const { skip, take } = paginate(page, limit);
    const where = status ? { status } : {};

    const [jobs, total] = await Promise.all([
      prisma.quickBooksSyncQueue.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.quickBooksSyncQueue.count({ where }),
    ]);

    // Best-effort display label per entity (customer name today; extend when
    // invoice/payment sync land).
    const customerIds = jobs.filter((j) => j.entityType === "customer").map((j) => j.entityId);
    const customers = customerIds.length
      ? await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, firstName: true, lastName: true, companyName: true },
        })
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const enriched = jobs.map((j) => {
      const c = j.entityType === "customer" ? customerById.get(j.entityId) : null;
      return {
        ...j,
        entityLabel: c ? c.companyName || `${c.firstName} ${c.lastName}` : null,
      };
    });

    return res.json({ success: true, ...paginatedResponse(enriched, total, page, limit) });
  } catch (err) {
    console.error("quickbooks.listQueue error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const retryQueueItem = async (req, res) => {
  try {
    const job = await quickbooksSync.retry(req.params.id);
    return res.json({ success: true, data: job });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Queue item not found" });
    console.error("quickbooks.retryQueueItem error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const listMappings = async (req, res) => {
  try {
    const mappings = await prisma.quickBooksMapping.findMany({
      orderBy: { lastSyncedAt: "desc" },
      take: 200,
    });
    return res.json({ success: true, data: mappings });
  } catch (err) {
    console.error("quickbooks.listMappings error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Enqueues every active customer not yet synced (or previously errored) — a
// convenience for initial rollout / after enabling the integration.
const resyncCustomers = async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    let queued = 0;
    for (const c of customers) {
      const job = await quickbooksSync.enqueueSync("customer", c.id);
      if (job) queued += 1;
    }
    return res.json({ success: true, data: { queued } });
  } catch (err) {
    console.error("quickbooks.resyncCustomers error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Item mapping (pricebook item / category -> QuickBooks Item name) ───────

const listItemMappings = async (req, res) => {
  try {
    const mappings = await prisma.quickBooksItemMapping.findMany({
      where: { isActive: true },
      include: { pricebookItem: { select: { id: true, name: true, sku: true } } },
      orderBy: { createdAt: "asc" },
    });
    return res.json({ success: true, data: mappings });
  } catch (err) {
    console.error("quickbooks.listItemMappings error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const saveItemMapping = async (req, res) => {
  try {
    const { lineItemType, pricebookItemId, quickbooksItemName } = req.body;
    if (!quickbooksItemName)
      return res
        .status(400)
        .json({ success: false, error: "quickbooksItemName is required" });
    if (!lineItemType && !pricebookItemId)
      return res.status(400).json({
        success: false,
        error: "Provide either lineItemType (category fallback) or pricebookItemId",
      });

    const mapping = await prisma.quickBooksItemMapping.create({
      data: {
        lineItemType: lineItemType || null,
        pricebookItemId: pricebookItemId || null,
        quickbooksItemName,
      },
    });
    return res.status(201).json({ success: true, data: mapping });
  } catch (err) {
    console.error("quickbooks.saveItemMapping error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const deleteItemMapping = async (req, res) => {
  try {
    await prisma.quickBooksItemMapping.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: "Mapping removed" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Mapping not found" });
    console.error("quickbooks.deleteItemMapping error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  downloadConnectorFile,
  listQueue,
  retryQueueItem,
  listMappings,
  resyncCustomers,
  listItemMappings,
  saveItemMapping,
  deleteItemMapping,
};
