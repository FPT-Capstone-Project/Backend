const { emitToUser } = require('../socket');

function createNotificationRealtimeService({ emit = emitToUser, logger = console } = {}) {
  function publishNewNotification(userId, notificationId) {
    const recipientId = Number(userId);
    const id = Number(notificationId);
    if (!Number.isSafeInteger(recipientId) || recipientId <= 0
      || !Number.isSafeInteger(id) || id <= 0) {
      logger.error('Không thể phát thông báo realtime: dữ liệu không hợp lệ.');
      return;
    }

    try {
      emit(recipientId, 'notification:new', { notification_id: id });
    } catch (error) {
      logger.error('Không thể phát thông báo realtime tới user:', error);
    }
  }

  return { publishNewNotification };
}

module.exports = { ...createNotificationRealtimeService(), createNotificationRealtimeService };
