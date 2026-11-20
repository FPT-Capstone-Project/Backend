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
    INSERT INTO order_items VALUES (1, 1, 2), (2, 1, 1), (3, 2, 1);
    INSERT INTO mushroom_types VALUES (1, 'Mushroom');
    INSERT INTO cultivation_sessions VALUES
      (1, 1, 1, 'CULTIVATING', 'NOT_READY', now(), NULL),
      (2, 2, 1, 'COMPLETED', 'NOT_READY', now(), now()),
      (3, 3, 1, 'CULTIVATING', 'NOT_READY', now(), NULL);
    INSERT INTO cultivation_rooms VALUES (1, 'Room A'), (2, 'Room B');
    INSERT INTO cultivation_floors VALUES (1, 'Floor A', 1), (2, 'Floor B', 2);
    INSERT INTO tray_positions VALUES (1, 2, 3), (2, 4, 5);
    INSERT INTO cultivation_trays VALUES
      (1, 'T1', 'OCCUPIED', 1, 1, 1),
      (2, 'T2', 'OCCUPIED', 2, 2, 2);
    INSERT INTO cultivation_session_trays VALUES
      (1, 1, 1, 'ACTIVE'), (2, 2, 2, 'RELEASED'), (3, 3, 2, 'ACTIVE');
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
    const first = await (await request(10, '?page=1&pageSize=1')).json();
    assert.deepEqual(first.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2 });
    assert.equal(first.data[0].session_id, 2);
    assert.equal(first.data[0].trays[0].assignment_status, 'RELEASED');
    assert.equal(first.data[0].trays[0].room_name, null);
    assert.equal(first.data[0].trays[0].tray_status, null);
    const second = await (await request(10, '?page=2&pageSize=1')).json();
    assert.equal(second.data[0].session_id, 1);
    assert.deepEqual(second.data[0].trays[0], {
      session_tray_id: 1, tray_id: 1, tray_code: 'T1', assignment_status: 'ACTIVE',
      tray_status: 'OCCUPIED', room_name: 'Room A', floor_name: 'Floor A',
      floor_number: 1, row_number: 2, column_number: 3,
    });
    const other = await (await request(11)).json();
    assert.deepEqual(other.data.map((session) => session.session_id), [3]);
    assert.equal(other.data[0].trays[0].room_name, 'Room B');
    assert.deepEqual((await (await request(12)).json()).data, []);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    saved.forEach(([path, previous]) => { if (previous) require.cache[path] = previous; else delete require.cache[path]; });
  }
});
