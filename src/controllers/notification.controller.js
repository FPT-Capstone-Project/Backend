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

async function sendCultivationSessionNotification(req, res) {
  const { title, message, type } = req.body || {};
  const notification = await notificationService.sendCultivationSessionNotification(
    req.params.sessionId,
    { title, message, type },
    req.user.user_id,
  );
  res.status(201).json({ message: 'Notification sent successfully', data: notification });
}

async function confirmDeviceRepair(req, res) {
  const incident = await notificationService.confirmDeviceRepair(
    req.user.user_id, req.params.notificationId, req.body,
  );
  res.json({ message: 'Đã xác nhận sửa xong thiết bị', data: incident });
}

module.exports = { list, markRead, markAllRead, sendCultivationSessionNotification, confirmDeviceRepair };
