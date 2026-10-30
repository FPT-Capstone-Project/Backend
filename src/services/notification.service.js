const notificationModel = require('../models/notification.model');
const AppError = require('../utils/app-error');
const { parsePagination } = require('../utils/pagination');

const NOTIFICATION_TYPES = ['OPERATOR_MESSAGE', 'MUSHROOM_DISEASE', 'DEVICE_ISSUE'];
const NOTIFIABLE_SESSION_STATUSES = ['PLANNED', 'ACTIVE'];
const DEFAULT_NOTIFICATION_TITLE = 'Thông báo từ SmartMush Farm';

function parseId(value, fieldName) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return id;
}

function normalizeMessage(value) {
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message) throw new AppError('message is required', 400);
  if (message.length > 1000) throw new AppError('message must be at most 1000 characters', 400);
  return message;
}

function normalizeTitle(value) {
  if (value === undefined) return DEFAULT_NOTIFICATION_TITLE;
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > 100) {
    throw new AppError('title must be between 1 and 100 characters', 400);
  }
  return title;
}

function normalizeType(value) {
  if (value === undefined) return 'OPERATOR_MESSAGE';
  const type = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!NOTIFICATION_TYPES.includes(type)) {
    throw new AppError(`type must be one of: ${NOTIFICATION_TYPES.join(', ')}`, 400);
  }
  return type;
}

function parseIsRead(value) {
  if (value === undefined) return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  throw new AppError('isRead must be true or false', 400);
}

async function sendCultivationSessionNotification(sessionId, payload = {}, createdBy) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const id = parseId(sessionId, 'sessionId');
  const message = normalizeMessage(body.message);
  const title = normalizeTitle(body.title);
  const type = normalizeType(body.type);
  const operatorId = parseId(createdBy, 'createdBy');
  const recipient = await notificationModel.findSessionRecipient(id);
  if (!recipient) throw new AppError('Cultivation session not found', 404);
  if (!NOTIFIABLE_SESSION_STATUSES.includes(recipient.status)) {
    throw new AppError('Cannot send notifications for a completed or cancelled session', 409);
  }
  if (recipient.user_status !== 'ACTIVE') {
    throw new AppError('Recipient account is not active', 409);
  }

  const notification = await notificationModel.createForSession({
    sessionId: id,
    userId: recipient.user_id,
    message,
    title,
    type,
    createdBy: operatorId,
  });
  return notification;
}

async function getNotifications(userId, query = {}) {
  const pagination = parsePagination(query);
  const result = await notificationModel.findAllByUserId({
    userId: parseId(userId, 'userId'),
    isRead: parseIsRead(query.isRead),
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return {
    notifications: result.notifications,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pagination.pageSize),
    },
    unreadCount: result.unreadCount,
  };
}

async function markNotificationAsRead(userId, notificationId) {
  const notification = await notificationModel.markAsReadById(
    parseId(userId, 'userId'),
    parseId(notificationId, 'notificationId'),
  );
  if (!notification) throw new AppError('Notification not found', 404);
  return notification;
}

async function markAllNotificationsAsRead(userId) {
  const updated = await notificationModel.markAllAsReadByUserId(parseId(userId, 'userId'));
  return { updated };
}

module.exports = {
  sendCultivationSessionNotification,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
