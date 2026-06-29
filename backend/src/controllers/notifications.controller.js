const prisma = require('../config/database');

const list = async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return res.json({ success: true, data: notifications, unreadCount });
  } catch (err) {
    console.error('notifications.list error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const markRead = async (req, res) => {
  try {
    const { id, all } = req.body;

    if (all) {
      const result = await prisma.notification.updateMany({
        where: { userId: req.user.id, isRead: false },
        data: { isRead: true },
      });
      return res.json({ success: true, message: `${result.count} notifications marked as read` });
    }

    if (id) {
      await prisma.notification.update({
        where: { id },
        data: { isRead: true },
      });
      return res.json({ success: true, message: 'Notification marked as read' });
    }

    return res.status(400).json({ success: false, error: 'Provide id or all=true' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Notification not found' });
    console.error('notifications.markRead error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = { list, markRead };
