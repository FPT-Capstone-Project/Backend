const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('customer IoT history returns assigned-floor data and enforces session ownership', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const userPath = require.resolve('../src/models/user.model');
  const previousDb = require.cache[dbPath];
  const previousUser = require.cache[userPath];
  let server;

  try {
    await db.exec(fs.readFileSync('database.sql', 'utf8'));
    await db.exec(`
      INSERT INTO roles (role_id, role_name) VALUES (1, 'Admin'), (3, 'Customer');
      INSERT INTO users (user_id, role_id, email, password_hash, full_name)
        VALUES (1, 1, 'admin@example.com', 'hash', 'Admin'),
               (3, 3, 'owner@example.com', 'hash', 'Owner'),
               (4, 3, 'other@example.com', 'hash', 'Other');
      INSERT INTO mushroom_types (name, growing_days) VALUES ('IoT API mushroom', 30);
      INSERT INTO orders (user_id, payment_status) VALUES (3, 'PAID'), (4, 'PAID');
      INSERT INTO order_items (order_id, mushroom_type_id, unit_price, total_price)
        VALUES (1, 1, 10, 10), (2, 1, 10, 10);
      INSERT INTO cultivation_rooms (room_code, room_name) VALUES ('IOT-API', 'IoT API Room');
      INSERT INTO iot_masters (master_identifier, cultivation_room_id)
        VALUES ('customer-history-master',
                (SELECT room_id FROM cultivation_rooms WHERE room_code = 'IOT-API'));
      INSERT INTO cultivation_floors
        (room_id, floor_number, floor_name, master_id, node_address, misting_ssr_channel)
        VALUES (
          (SELECT room_id FROM cultivation_rooms WHERE room_code = 'IOT-API'),
          1,
          'Customer Floor',
          (SELECT id FROM iot_masters WHERE master_identifier = 'customer-history-master'),
          1,
          1
        );
      INSERT INTO cultivation_trays (room_id, tray_code, floor_id, status)
        VALUES (
          (SELECT room_id FROM cultivation_rooms WHERE room_code = 'IOT-API'),
          'IOT-CUSTOMER-1',
          (SELECT floor_id FROM cultivation_floors WHERE floor_name = 'Customer Floor'),
          'OCCUPIED'
        ), (
          (SELECT room_id FROM cultivation_rooms WHERE room_code = 'IOT-API'),
          'IOT-CUSTOMER-2',
          (SELECT floor_id FROM cultivation_floors WHERE floor_name = 'Customer Floor'),
          'OCCUPIED'
        );
      INSERT INTO cultivation_sessions (session_id, mushroom_type_id, start_at, order_item_id, status)
        VALUES (1, 1, now() - interval '1 day', 1, 'CULTIVATING'),
               (2, 1, now() - interval '1 day', 2, 'CULTIVATING');
      INSERT INTO cultivation_session_trays (session_id, tray_id, assigned_at, status)
        VALUES (1, 1, now() - interval '1 hour', 'ACTIVE'),
               (2, 2, now() - interval '1 hour', 'ACTIVE');
      INSERT INTO iot_sensor_readings
        (master_id, node_address, sensor_address, temperature, humidity, is_valid, received_at, retained)
        VALUES ((SELECT id FROM iot_masters WHERE master_identifier = 'customer-history-master'),
                1, 1, 25.5, 82, true, now() - interval '10 seconds', false),
               ((SELECT id FROM iot_masters WHERE master_identifier = 'customer-history-master'),
                1, 2, 26, 80, true, now() - interval '5 seconds', false),
               ((SELECT id FROM iot_masters WHERE master_identifier = 'customer-history-master'),
                1, 3, 28, 79, true, now() - interval '2 hours', false);
      INSERT INTO iot_device_commands
        (id, master_id, channel, action, status, requested_by, requested_at, expires_at, published_at, completed_at)
        VALUES ('11111111-1111-4111-8111-111111111111',
                (SELECT id FROM iot_masters WHERE master_identifier = 'customer-history-master'),
                1, 'ON', 'PUBLISHED', NULL,
                now() - interval '5 minutes', now() + interval '1 minute',
                now() - interval '5 minutes', now() - interval '5 minutes');
    `);

    require.cache[dbPath] = {
      exports: { query: (sql, params) => db.query(sql, params) },
    };
    require.cache[userPath] = {
      exports: {
        findById: async (id) => ({
          user_id: id,
          role_id: id === 1 ? 1 : 3,
          status: 'ACTIVE',
        }),
      },
    };

    const app = require('../src/app');
    const env = require('../src/config/env');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));

    const request = async (path, userId) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        headers: userId
          ? { authorization: `Bearer ${jwt.sign({ sub: String(userId) }, env.jwtSecret)}` }
          : {},
      });
      return { status: response.status, body: await response.json() };
    };
    const base = '/api/customer/sessions/1/iot-history';

    assert.equal((await request(`${base}/sensors`, null)).status, 401);
    const sensorHistory = await request(`${base}/sensors?page=1&pageSize=100`, 3);
    assert.equal(sensorHistory.status, 200);
    assert.equal(sensorHistory.body.data.readings.length, 2);
    assert.deepEqual(
      sensorHistory.body.data.readings.map((reading) => reading.sensorId).sort(),
      [1, 2],
    );
    assert.ok(sensorHistory.body.data.readings.every((reading) => reading.ok));
    assert.equal(sensorHistory.body.data.readings[0].floorName, 'Customer Floor');

    const deviceHistory = await request(`${base}?page=1&pageSize=100`, 3);
    assert.equal(deviceHistory.status, 200);
    assert.equal(deviceHistory.body.data.deviceEvents.length, 1);
    assert.equal(deviceHistory.body.data.deviceEvents[0].controlMode, 'AUTOMATIC');
    assert.deepEqual(deviceHistory.body.data.deviceEvents[0].floors, [{
      floorId: 1,
      floorName: 'Customer Floor',
      deviceType: 'MISTING',
    }]);

    assert.equal((await request(`${base}/sensors`, 4)).status, 404);
    assert.equal((await request(`${base}/sensors?pageSize=101`, 3)).status, 400);
    assert.equal((await request(`${base}/sensors`, 1)).status, 200);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousUser) require.cache[userPath] = previousUser;
    else delete require.cache[userPath];
    await db.close();
  }
});
