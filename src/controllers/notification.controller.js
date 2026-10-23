const notificationService = require('../services/notification.service');

async function list(req, res) {
  const result = await notificationService.getNotifications(req.user.user_id, req.query || {});
  res.json({
    data: result.notifications,
    pagination: result.pagination,
    meta: { unread_count: result.unreadCount },
  });
}

async function markRead(req, res) {
  const notification = await notificationService.markNotificationAsRead(
    req.user.user_id,
    req.params.notificationId,
  );
  res.json({ message: 'Notification marked as read', data: notification });
}

async function markAllRead(req, res) {
  const result = await notificationService.markAllNotificationsAsRead(req.user.user_id);
  res.json({ message: 'All notifications marked as read', data: result });
}

module.exports = { list, markRead, markAllRead };
