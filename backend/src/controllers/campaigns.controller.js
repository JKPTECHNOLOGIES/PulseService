const prisma = require("../config/database");

const list = async (req, res) => {
  try {
    const { status, archived } = req.query;
    const where = {};
    if (status) where.status = status;
    // Archived campaigns are hidden by default so old/completed campaigns stop
    // cluttering the list without ever being destroyed; ?archived=true shows
    // only archived ones, ?archived=all shows everything (mirrors jobs.list).
    if (archived === "true") where.isArchived = true;
    else if (archived !== "all") where.isArchived = false;

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return res.json({ success: true, data: campaigns });
  } catch (err) {
    console.error("campaigns.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const campaign = await prisma.campaign.create({ data: req.body });
    return res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    console.error("campaigns.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...data } = req.body;
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    console.error("campaigns.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    await prisma.campaign.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Campaign deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    console.error("campaigns.delete error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const archive = async (req, res) => {
  try {
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: { isArchived: true, archivedAt: new Date() },
    });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    console.error("campaigns.archive error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const unarchive = async (req, res) => {
  try {
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: { isArchived: false, archivedAt: null },
    });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    console.error("campaigns.unarchive error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  create,
  update,
  delete: deleteCampaign,
  archive,
  unarchive,
};
