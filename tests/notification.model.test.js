const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('stores rental links and scopes notification reads to the owner', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/notification.model');
  const originalDbModule = require.cache[dbPath];

  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8'));
    await db.exec(`
      INSERT INTO roles(role_name) VALUES ('Customer');
      INSERT INTO users(role_id, email, password_hash, full_name)
      VALUES
        (1, 'customer@example.test', 'hash', 'Customer'),
        (1, 'operator@example.test', 'hash', 'Operator'),
        (1, 'other@example.test', 'hash', 'Other Customer');
      INSERT INTO orders(user_id) VALUES (1);
      INSERT INTO rentals(order_id, user_id, duration_days, status) VALUES (1, 1, 30, 'ACTIVE');
      INSERT INTO notifications (user_id, notification_type, title, message, rental_id)
      VALUES
        (1, 'TEST', 'Unread', 'Unread notification', 1),
        (1, 'TEST', 'Read', 'Read notification', 1),
        (3, 'TEST', 'Other', 'Other user notification', NULL);
      UPDATE notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP WHERE notification_id = 2;
    `);

    delete require.cache[modelPath];
    require.cache[dbPath] = { exports: { query: (...args) => db.query(...args) } };
    const notificationModel = require('../src/models/notification.model');

    const recipient = await notificationModel.findRentalRecipient(1);
    const created = await notificationModel.createForRental({
      rentalId: 1,
      userId: 1,
      type: 'OPERATOR_MESSAGE',
      title: 'Farm update',
      message: 'Operator update',
      createdBy: 2,
    });
    const initialList = await notificationModel.findAllByUserId({
      userId: 1, isRead: false, limit: 20, offset: 0,
    });
    const readList = await notificationModel.findAllByUserId({
      userId: 1, isRead: true, limit: 20, offset: 0,
    });
    const storedNotification = await db.query(
      'SELECT created_by FROM notifications WHERE notification_id = $1',
      [created.notification_id],
    );
    const firstRead = await notificationModel.markAsReadById(1, created.notification_id);
    const secondRead = await notificationModel.markAsReadById(1, created.notification_id);
    const foreignRead = await notificationModel.markAsReadById(1, 3);
    const markedAll = await notificationModel.markAllAsReadByUserId(1);
    const finalList = await notificationModel.findAllByUserId({
      userId: 1, isRead: false, limit: 20, offset: 0,
    });
    const otherList = await notificationModel.findAllByUserId({
      userId: 3, isRead: false, limit: 20, offset: 0,
    });

    assert.deepEqual(recipient, { rental_id: 1, user_id: 1, status: 'ACTIVE', user_status: 'ACTIVE' });
    assert.equal(created.user_id, 1);
    assert.equal(created.rental_id, 1);
    assert.equal(created.notification_type, 'OPERATOR_MESSAGE');
    assert.equal(created.message, 'Operator update');
    assert.equal(storedNotification.rows[0].created_by, 2);
    assert.equal(initialList.total, 2);
    assert.equal(initialList.unreadCount, 2);
    assert.equal(initialList.notifications.every((notification) => notification.rental_id === 1), true);
    assert.equal(readList.total, 1);
    assert.equal(readList.unreadCount, 2);
    assert.equal(firstRead.is_read, true);
    assert.equal(String(secondRead.read_at), String(firstRead.read_at));
    assert.equal(foreignRead, null);
    assert.equal(markedAll, 1);
    assert.equal(finalList.total, 0);
    assert.equal(finalList.unreadCount, 0);
    assert.equal(otherList.total, 1);
    assert.equal(otherList.unreadCount, 1);
  } finally {
    delete require.cache[modelPath];
    if (originalDbModule) require.cache[dbPath] = originalDbModule;
    else delete require.cache[dbPath];
    await db.close();
  }
});
