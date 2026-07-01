const prisma = require("../config/database");

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
    await prisma.attachment.delete({ where: { id: req.params.id } });
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
