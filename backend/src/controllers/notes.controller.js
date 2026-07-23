const prisma = require("../config/database");

const USER_SELECT = {
  select: { id: true, firstName: true, lastName: true },
};

// Manually-written notes on a customer's merged timeline (Work Orders +
// Invoices + Quotes) -- not tied to a specific record, so they show up
// regardless of which one prompted them. Reads/creates are open to any
// authenticated user (same low-friction philosophy as attachments); only
// pinning is worth calling out separately below.

const create = async (req, res) => {
  try {
    const { customerId, body } = req.body;
    if (!customerId || !body || !body.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "customerId and body are required" });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, error: "Customer not found" });
    }

    const note = await prisma.note.create({
      data: {
        customerId,
        body: body.trim(),
        createdById: req.user?.id || null,
      },
      include: { createdBy: USER_SELECT },
    });

    return res.status(201).json({ success: true, data: note });
  } catch (err) {
    console.error("notes.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Toggles pinned state -- a pinned note always shows above the
// chronological feed (e.g. a standing service-agreement summary).
const setPinned = async (req, res) => {
  try {
    const { pinned } = req.body;
    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: { pinned: Boolean(pinned) },
      include: { createdBy: USER_SELECT },
    });
    return res.json({ success: true, data: note });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, error: "Note not found" });
    }
    console.error("notes.setPinned error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.note.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, error: "Note not found" });
    }
    console.error("notes.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { create, setPinned, remove };
