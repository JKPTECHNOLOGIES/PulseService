const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, customerId, direction, channel, search } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (customerId) where.customerId = customerId;
    if (direction) where.direction = direction;
    if (channel) where.channel = channel;
    if (search) {
      where.OR = [
        { body: { contains: search, mode: "insensitive" } },
        { subject: { contains: search, mode: "insensitive" } },
        { customer: { firstName: { contains: search, mode: "insensitive" } } },
        { customer: { lastName: { contains: search, mode: "insensitive" } } },
        { customer: { companyName: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [messages, total] = await Promise.all([
      prisma.customerMessage.findMany({
        where,
        skip,
        take,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
          sentBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { sentAt: "desc" },
      }),
      prisma.customerMessage.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(messages, total, page, limit) });
  } catch (err) {
    console.error("messages.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const { customerId, direction, channel, subject, body, sentAt } = req.body;
    if (!customerId || !body) {
      return res
        .status(400)
        .json({ success: false, error: "customerId and body are required" });
    }

    const message = await prisma.customerMessage.create({
      data: {
        customerId,
        direction: direction || "outbound",
        channel: channel || "sms",
        subject: subject || null,
        body,
        sentAt: sentAt ? new Date(sentAt) : new Date(),
        sentById: req.user.id,
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        sentBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    console.error("messages.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.customerMessage.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Message removed" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Message not found" });
    console.error("messages.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, create, remove };
