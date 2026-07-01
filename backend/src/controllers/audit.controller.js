const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");

const list = async (req, res) => {
  try {
    const { page = 1, limit = 25, entity, action, userId, search } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (entity) where.entity = entity;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (search) {
      where.OR = [
        { userEmail: { contains: search, mode: "insensitive" } },
        { path: { contains: search, mode: "insensitive" } },
        { entity: { contains: search, mode: "insensitive" } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(logs, total, page, limit),
    });
  } catch (err) {
    console.error("audit.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list };
