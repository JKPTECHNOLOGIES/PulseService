const prisma = require("../config/database");
const { paginate } = require("../utils/helpers");

const USER_SELECT = {
  select: { id: true, firstName: true, lastName: true },
};

function userName(user) {
  return user ? `${user.firstName} ${user.lastName}`.trim() : null;
}

/**
 * Merged, customer-scoped activity feed spanning Work Orders + Invoices +
 * Quotes: manually-written Notes plus narrated TimelineEvents, sorted
 * together by date. Pinned notes are returned separately (always the full
 * set, unpaginated) so the UI can keep them pinned above the feed regardless
 * of which page of the feed is showing.
 *
 * Fetches the customer's full note/event history and paginates in memory
 * rather than at the DB level, since the two sources are different tables
 * with no native way to UNION+paginate them together through the query
 * builder -- reasonable at the scale of one customer's own activity.
 */
const list = async (req, res) => {
  try {
    const { customerId, page = 1, limit = 20 } = req.query;
    if (!customerId) {
      return res
        .status(400)
        .json({ success: false, error: "customerId is required" });
    }
    const { skip, take } = paginate(page, limit);

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, error: "Customer not found" });
    }

    const [pinnedNotes, unpinnedNotes, events] = await Promise.all([
      prisma.note.findMany({
        where: { customerId, pinned: true },
        include: { createdBy: USER_SELECT },
        orderBy: { createdAt: "desc" },
      }),
      prisma.note.findMany({
        where: { customerId, pinned: false },
        include: { createdBy: USER_SELECT },
        orderBy: { createdAt: "desc" },
      }),
      prisma.timelineEvent.findMany({
        where: { customerId },
        include: { user: USER_SELECT },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const toNoteItem = (n) => ({
      kind: "note",
      id: n.id,
      createdAt: n.createdAt,
      body: n.body,
      pinned: n.pinned,
      user: n.createdBy
        ? { id: n.createdBy.id, name: userName(n.createdBy) }
        : null,
    });

    const toEventItem = (e) => ({
      kind: "event",
      id: e.id,
      createdAt: e.createdAt,
      entityType: e.entityType,
      entityId: e.entityId,
      entityLabel: e.entityLabel,
      action: e.action,
      description: e.description,
      user: e.user ? { id: e.user.id, name: userName(e.user) } : null,
    });

    const merged = [
      ...unpinnedNotes.map(toNoteItem),
      ...events.map(toEventItem),
    ].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = merged.length;
    const pageItems = merged.slice(skip, skip + take);

    return res.json({
      success: true,
      data: pageItems,
      pinned: pinnedNotes.map(toNoteItem),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    console.error("timeline.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list };
