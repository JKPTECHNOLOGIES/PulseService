const prisma = require("../config/database");
const permissionsService = require("../services/permissions.service");
const { recordTimelineEvent } = require("../utils/timeline");

// Only these entity types feed the customer timeline -- they're the ones with
// a direct customerId to attach to (a "customer" attachment IS the customer,
// and "inventory" attachments aren't tied to a customer at all).
const TIMELINE_ENTITY = {
  job: { model: prisma.job, numberField: "jobNumber", label: "Work Order" },
  invoice: {
    model: prisma.invoice,
    numberField: "invoiceNumber",
    label: "Invoice",
  },
  estimate: {
    model: prisma.estimate,
    numberField: "estimateNumber",
    label: "Quote",
  },
};

const SIGNATURE_PREFIX = "signature-";

async function narrateAttachment(entityType, entityId, action, userId, filename) {
  const config = TIMELINE_ENTITY[entityType];
  if (!config) return;
  const parent = await config.model.findUnique({
    where: { id: entityId },
    select: { customerId: true, [config.numberField]: true },
  });
  if (!parent) return;
  const isSignature = filename?.startsWith(SIGNATURE_PREFIX);
  const what = isSignature ? "a signature" : "a photo";
  const description =
    action === "add"
      ? `captured ${what} on ${config.label}`
      : `removed ${what} from ${config.label}`;
  await recordTimelineEvent({
    customerId: parent.customerId,
    entityType,
    entityId,
    entityLabel: parent[config.numberField],
    action: "attachment",
    description,
    userId,
  });
}

// Entity types that may own attachments, mapped to the Prisma delegate used to
// verify the parent record exists before storing a file. Keeping this list
// explicit prevents attachments from being orphaned against arbitrary ids.
const ENTITY_MODELS = {
  job: prisma.job,
  estimate: prisma.estimate,
  invoice: prisma.invoice,
  inventory: prisma.inventoryItem,
  customer: prisma.customer,
  equipment: prisma.equipment,
};

// Permission required to delete *someone else's* attachment on each entity
// type -- mirrors the edit/manage tier already used to write that entity.
// The uploader can always delete their own attachment regardless (e.g. a
// technician removing a job photo they just took by mistake).
const MANAGE_PERMISSION_BY_ENTITY = {
  job: "jobs.edit",
  estimate: "estimates.manage",
  invoice: "invoices.manage",
  inventory: "inventory.manage",
  customer: "customers.edit",
  equipment: "equipment.delete",
};

const ALLOWED_TYPES = Object.keys(ENTITY_MODELS);

// Metadata projection — never select `data` in list/detail responses; the raw
// bytes are only streamed through the dedicated /:id/raw endpoint.
const META_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  filename: true,
  mimeType: true,
  size: true,
  caption: true,
  uploadedById: true,
  createdAt: true,
};

const list = async (req, res) => {
  try {
    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) {
      return res.status(400).json({
        success: false,
        error: "entityType and entityId are required",
      });
    }
    if (!ALLOWED_TYPES.includes(entityType)) {
      return res
        .status(400)
        .json({ success: false, error: `Invalid entityType: ${entityType}` });
    }

    const attachments = await prisma.attachment.findMany({
      where: { entityType, entityId },
      select: META_SELECT,
      orderBy: { createdAt: "desc" },
    });

    return res.json({ success: true, data: attachments });
  } catch (err) {
    console.error("attachments.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const { entityType, entityId, caption } = req.body;

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }
    if (!entityType || !entityId) {
      return res.status(400).json({
        success: false,
        error: "entityType and entityId are required",
      });
    }
    if (!ALLOWED_TYPES.includes(entityType)) {
      return res
        .status(400)
        .json({ success: false, error: `Invalid entityType: ${entityType}` });
    }

    // Confirm the parent record exists so we never store dangling attachments.
    const parent = await ENTITY_MODELS[entityType].findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!parent) {
      return res
        .status(404)
        .json({ success: false, error: `${entityType} not found` });
    }

    const created = await prisma.attachment.create({
      data: {
        entityType,
        entityId,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        data: req.file.buffer,
        caption: caption || null,
        uploadedById: req.user?.id || null,
      },
      select: META_SELECT,
    });

    await narrateAttachment(
      entityType,
      entityId,
      "add",
      req.user?.id,
      created.filename,
    );

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("attachments.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Streams the raw bytes back with the stored content type. Used by both the web
// and mobile clients (they fetch it with the auth header and turn it into an
// object URL, so the binary stays behind authentication).
const getRaw = async (req, res) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
    });
    if (!attachment) {
      return res
        .status(404)
        .json({ success: false, error: "Attachment not found" });
    }

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Length", attachment.size);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.filename)}"`,
    );
    return res.send(attachment.data);
  } catch (err) {
    console.error("attachments.getRaw error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        filename: true,
        uploadedById: true,
      },
    });
    if (!attachment) {
      return res
        .status(404)
        .json({ success: false, error: "Attachment not found" });
    }

    // Anyone can delete an attachment they uploaded themselves. Deleting
    // someone else's requires the manage/edit permission for that entity
    // type -- otherwise any authenticated user could delete any photo/doc
    // company-wide, which is what this gate closes.
    const isOwner =
      attachment.uploadedById && attachment.uploadedById === req.user?.id;
    if (!isOwner) {
      const required = MANAGE_PERMISSION_BY_ENTITY[attachment.entityType];
      const ok =
        required && req.user?.role
          ? await permissionsService.hasPermission(req.user.role, required)
          : false;
      if (!ok) {
        return res.status(403).json({
          success: false,
          error:
            "You can only delete attachments you uploaded, unless you have permission to manage this record.",
        });
      }
    }

    await prisma.attachment.delete({ where: { id: req.params.id } });
    await narrateAttachment(
      attachment.entityType,
      attachment.entityId,
      "remove",
      req.user?.id,
      attachment.filename,
    );
    return res.json({ success: true });
  } catch (err) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "Attachment not found" });
    }
    console.error("attachments.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, create, getRaw, remove, ALLOWED_TYPES };
