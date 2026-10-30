const pool = require('../config/db');

const notificationItemColumns = `
  notification_id,
  notification_type,
  title,
  message,
  is_read,
  created_at,
  read_at,
  reference_type,
  reference_id
`;

const sentNotificationColumns = `
  notification_id,
  user_id,
  notification_type,
  title,
  message,
  created_at,
  reference_type,
  reference_id
`;

async function findSessionRecipient(sessionId) {
  const result = await pool.query(
    `SELECT s.session_id, s.status, o.user_id, u.status AS user_status
     FROM cultivation_sessions s
     JOIN order_items oi ON oi.order_item_id = s.order_item_id
     JOIN orders o ON o.order_id = oi.order_id
     JOIN users u ON u.user_id = o.user_id
     WHERE s.session_id = $1
     LIMIT 1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function createForSession({ sessionId, userId, type, title, message, createdBy }) {
  const result = await pool.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, created_by,
       reference_type, reference_id
     )
     VALUES ($1, $2, $3, $4, $5, 'CULTIVATION_SESSION', $6)
     RETURNING ${sentNotificationColumns}`,
    [userId, type, title, message, createdBy, sessionId],
  );
  return result.rows[0] || null;
}

function buildListFilter({ userId, isRead }) {
  const values = [userId];
  const conditions = ['user_id = $1'];
  if (isRead !== undefined) {
    values.push(isRead);
    conditions.push(`is_read = $${values.length}`);
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, values };
}

async function findAllByUserId({ userId, isRead, limit, offset }) {
  const { where, values } = buildListFilter({ userId, isRead });
  const countResult = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM notifications
     ${where}`,
    values,
  );
  const pageValues = [...values, limit, offset];
  const notificationsResult = await pool.query(
    `SELECT ${notificationItemColumns}
     FROM notifications
     ${where}
     ORDER BY created_at DESC, notification_id DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  const unreadResult = await pool.query(
    `SELECT COUNT(*)::INTEGER AS unread_count
     FROM notifications
     WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  );

  return {
    notifications: notificationsResult.rows,
    total: Number(countResult.rows[0] && countResult.rows[0].total) || 0,
    unreadCount: Number(unreadResult.rows[0] && unreadResult.rows[0].unread_count) || 0,
  };
}

async function markAsReadById(userId, notificationId) {
  const updatedResult = await pool.query(
    `UPDATE notifications
     SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
     WHERE notification_id = $1 AND user_id = $2 AND is_read = FALSE
     RETURNING ${notificationItemColumns}`,
    [notificationId, userId],
  );
  if (updatedResult.rows[0]) return updatedResult.rows[0];

  const existingResult = await pool.query(
    `SELECT ${notificationItemColumns}
     FROM notifications
     WHERE notification_id = $1 AND user_id = $2
     LIMIT 1`,
    [notificationId, userId],
  );
  return existingResult.rows[0] || null;
}

async function markAllAsReadByUserId(userId) {
  const result = await pool.query(
    `UPDATE notifications
     SET is_read = TRUE, read_at = NOW()
     WHERE user_id = $1 AND is_read = FALSE
     RETURNING notification_id`,
    [userId],
  );
  return result.rows.length;
}

module.exports = {
  findSessionRecipient,
  createForSession,
  findAllByUserId,
  markAsReadById,
  markAllAsReadByUserId,
};
