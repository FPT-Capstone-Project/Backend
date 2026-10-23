const pool = require('../config/db');

const notificationItemColumns = `
  notification_id,
  notification_type,
  title,
  message,
  is_read,
  created_at,
  read_at,
  rental_id
`;

const sentNotificationColumns = `
  notification_id,
  user_id,
  rental_id,
  notification_type,
  title,
  message,
  created_at
`;

async function findRentalRecipient(rentalId) {
  const result = await pool.query(
    `SELECT r.rental_id, r.user_id, r.status, u.status AS user_status
     FROM rentals r
     JOIN users u ON u.user_id = r.user_id
     WHERE r.rental_id = $1
     LIMIT 1`,
    [rentalId],
  );
  return result.rows[0] || null;
}

async function createForRental({ rentalId, userId, type, title, message, createdBy }) {
  const result = await pool.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, rental_id, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${sentNotificationColumns}`,
    [userId, type, title, message, rentalId, createdBy],
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
  findRentalRecipient,
  createForRental,
  findAllByUserId,
  markAsReadById,
  markAllAsReadByUserId,
};
