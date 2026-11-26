const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const jwt = require('jsonwebtoken');

test('customer sessions include owned tray history without exposing reused tray locations', async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE orders (order_id INT PRIMARY KEY, user_id INT NOT NULL);
    CREATE TABLE order_items (order_item_id INT PRIMARY KEY, order_id INT NOT NULL, quantity INT NOT NULL);
    CREATE TABLE mushroom_types (mushroom_type_id INT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE cultivation_sessions (
      session_id INT PRIMARY KEY, order_item_id INT NOT NULL, mushroom_type_id INT NOT NULL,
      status TEXT NOT NULL, harvest_status TEXT, start_at TIMESTAMPTZ, end_at TIMESTAMPTZ
    );
    CREATE TABLE cultivation_rooms (room_id INT PRIMARY KEY, room_name TEXT);
    CREATE TABLE cultivation_floors (floor_id INT PRIMARY KEY, floor_name TEXT, floor_number INT);
    CREATE TABLE tray_positions (position_id INT PRIMARY KEY, row_number INT, column_number INT);
    CREATE TABLE cultivation_trays (
      tray_id INT PRIMARY KEY, tray_code TEXT, status TEXT, room_id INT, floor_id INT, position_id INT
    );
    CREATE TABLE cultivation_session_trays (session_tray_id INT PRIMARY KEY, session_id INT, tray_id INT, status TEXT);
    INSERT INTO orders VALUES (1, 10), (2, 11);
    INSERT INTO order_items VALUES (1, 1, 2), (2, 1, 1), (3, 2, 1), (4, 1, 1), (5, 1, 1);
    INSERT INTO mushroom_types VALUES (1, 'Mushroom');
    INSERT INTO cultivation_sessions VALUES
      (1, 1, 1, 'CULTIVATING', 'NOT_READY', now(), NULL),
      (2, 2, 1, 'COMPLETED', 'NOT_READY', now(), now()),
      (3, 3, 1, 'CULTIVATING', 'NOT_READY', now(), NULL),
      (4, 4, 1, 'CANCELLED', 'NOT_READY', now(), now()),
      (5, 5, 1, 'SPAWN_RESTING', 'NOT_READY', now(), NULL);
    INSERT INTO cultivation_rooms VALUES (1, 'Room A'), (2, 'Room B');
    INSERT INTO cultivation_floors VALUES (1, 'Floor A', 1), (2, 'Floor B', 2);
    INSERT INTO tray_positions VALUES (1, 2, 3), (2, 4, 5);
    INSERT INTO cultivation_trays VALUES
      (1, 'T1', 'OCCUPIED', 1, 1, 1),
      (2, 'T2', 'OCCUPIED', 2, 2, 2);
    INSERT INTO cultivation_session_trays VALUES
      (1, 1, 1, 'ACTIVE'), (2, 2, 2, 'RELEASED'), (3, 3, 2, 'ACTIVE');
    ALTER TABLE cultivation_sessions ADD COLUMN harvest_ready_at TIMESTAMPTZ;
    ALTER TABLE cultivation_sessions ADD COLUMN harvest_date DATE;
    ALTER TABLE cultivation_sessions ADD COLUMN duration_days INT;
    CREATE TABLE inventory_transactions (transaction_id INT, session_id INT, transaction_type TEXT, quantity INT);
    CREATE TABLE cultivation_progress (progress_id INT, session_id INT, current_stage TEXT, progress_percent NUMERIC, updated_at TIMESTAMPTZ);
    CREATE TABLE harvests (session_id INTEGER);
    CREATE TABLE harvest_requests (
      harvest_request_id INT, session_id INT, harvest_method TEXT, status TEXT,
      scheduled_at TIMESTAMPTZ, delivery_address TEXT, completed_at TIMESTAMPTZ
    );
    INSERT INTO harvest_requests VALUES
      (8, 2, 'PICKUP', 'COMPLETED', '2026-11-18 03:00:00+00', NULL, '2026-11-18 04:00:00+00');
  `);
  const paths = ['../src/config/db', '../src/models/user.model', '../src/services/auth.service'];
  const saved = paths.map((name) => [require.resolve(name), require.cache[require.resolve(name)]]);
  require.cache[saved[0][0]] = { exports: db };
  require.cache[saved[1][0]] = { exports: {
    findById: async (id) => ({ user_id: id, role_id: id === 1 ? 1 : 3, status: 'ACTIVE' }),
  } };
  require.cache[saved[2][0]] = { exports: { sanitizeUser: (user) => user } };
  const app = express();
  app.use('/api/customer', require('../src/routes/customerCultivation.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const secret = require('../src/config/env').jwtSecret;
  const request = (userId, query = '') => fetch(`http://127.0.0.1:${server.address().port}/api/customer/sessions${query}`, {
    headers: userId ? { authorization: `Bearer ${jwt.sign({ sub: String(userId) }, secret)}` } : {},
  });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request(1)).status, 403);
    assert.equal((await request(10, '?page=0')).status, 400);
    assert.equal((await request(10, '?status=INVALID')).status, 400);
    assert.equal((await request(10, '?status=ALL&status=COMPLETED')).status, 400);
    const all = await (await request(10)).json();
    assert.deepEqual(all.data.map((session) => session.session_id), [5, 4, 2, 1]);
    const growing = await (await request(10, '?status=GROWING&page=1&pageSize=1')).json();
    assert.deepEqual(growing.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2 });
    assert.deepEqual(growing.data.map((session) => session.session_id), [5]);
    const growingNext = await (await request(10, '?status=GROWING&page=2&pageSize=1')).json();
    assert.deepEqual(growingNext.data.map((session) => session.session_id), [1]);
    const completed = await (await request(10, '?status=COMPLETED')).json();
    assert.deepEqual(completed.data.map((session) => session.session_id), [2]);
    assert.equal(completed.pagination.total, 1);
    assert.deepEqual((await (await request(11, '?status=COMPLETED')).json()).data, []);
    const first = await (await request(10, '?page=1&pageSize=1')).json();
    assert.deepEqual(first.pagination, { page: 1, pageSize: 1, total: 4, totalPages: 4 });
    const third = await (await request(10, '?page=3&pageSize=1')).json();
    assert.equal(third.data[0].session_id, 2);
    assert.equal(third.data[0].trays[0].assignment_status, 'RELEASED');
    assert.equal(third.data[0].trays[0].room_name, null);
    assert.equal(third.data[0].trays[0].floor_id, null);
    assert.equal(third.data[0].trays[0].tray_status, null);
    const second = await (await request(10, '?page=4&pageSize=1')).json();
    assert.equal(second.data[0].session_id, 1);
    assert.deepEqual(second.data[0].trays[0], {
      session_tray_id: 1, tray_id: 1, tray_code: 'T1', assignment_status: 'ACTIVE',
      tray_status: 'OCCUPIED', room_name: 'Room A', floor_id: 1, floor_name: 'Floor A',
      floor_number: 1, row_number: 2, column_number: 3,
    });
    const other = await (await request(11)).json();
    assert.deepEqual(other.data.map((session) => session.session_id), [3]);
    assert.equal(other.data[0].trays[0].room_name, 'Room B');
    assert.deepEqual((await (await request(12)).json()).data, []);
    const requestStatus = (userId) => fetch(`http://127.0.0.1:${server.address().port}/api/customer/orders/1/cultivation-status`, {
      headers: { authorization: `Bearer ${jwt.sign({ sub: String(userId) }, secret)}` },
    });
    const status = await (await requestStatus(10)).json();
    const completedSession = status.data.sessions.find((session) => session.session_id === 2);
    assert.equal(completedSession.harvest_method, 'PICKUP');
    assert.equal(completedSession.handover_completed_at, '2026-11-18T04:00:00.000Z');
    assert.equal(status.data.sessions.find((session) => session.session_id === 1).handover_completed_at, null);
    assert.equal((await requestStatus(11)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    saved.forEach(([path, previous]) => { if (previous) require.cache[path] = previous; else delete require.cache[path]; });
  }
});
