const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('environment-history APIs return summarized records with role and ownership checks', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const userPath = require.resolve('../src/models/user.model');
  const previousDb = require.cache[dbPath];
  const previousUser = require.cache[userPath];
  const queries = [];
  let server;

  try {
    await db.exec(fs.readFileSync('database.sql', 'utf8'));
    await db.exec(`
      INSERT INTO roles (role_id, role_name) VALUES (1, 'Admin'), (3, 'Customer');
      INSERT INTO users (user_id, role_id, email, password_hash, full_name)
        VALUES (3, 3, 'owner@example.com', 'hash', 'Owner'),
               (4, 3, 'other@example.com', 'hash', 'Other');
      INSERT INTO mushroom_types (name, growing_days) VALUES ('API mushroom', 30);
      INSERT INTO orders (user_id) VALUES (3), (4);
      INSERT INTO order_items (order_id, mushroom_type_id, unit_price, total_price)
        VALUES (1, 1, 10, 10), (2, 1, 10, 10);
      INSERT INTO cultivation_rooms (room_code, room_name) VALUES ('API', 'API Room');
      INSERT INTO iot_masters (master_identifier) VALUES ('api-master');
      INSERT INTO cultivation_floors
        (room_id, floor_number, floor_name, master_id, node_address, misting_ssr_channel)
        VALUES (1, 1, 'API Floor', 1, 1, 1);
      INSERT INTO cultivation_sessions (session_id, mushroom_type_id, start_at, order_item_id, status)
        VALUES (1, 1, '2026-01-01 09:00:00', 1, 'CULTIVATING'),
               (2, 1, '2026-01-01 09:00:00', 2, 'CULTIVATING');
      INSERT INTO cultivation_environment_history
        (session_id, floor_id, period_start, period_end, growth_stage, temperature_avg, humidity_avg)
        VALUES (1, 1, '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z', 'PINNING', 25, 82),
               (2, 1, '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z', 'MATURATION', 26, 83);
    `);

    require.cache[dbPath] = {
      exports: { query: (sql, params) => {
        queries.push(sql);
        return db.query(sql, params);
      } },
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
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/environment-history${path}`, {
        headers: userId
          ? { authorization: `Bearer ${jwt.sign({ sub: String(userId) }, env.jwtSecret)}` }
          : {},
      });
      return { status: response.status, body: await response.json() };
    };

    assert.equal((await request('/sessions/1', null)).status, 401);
    assert.equal((await request('/sessions/1', 4)).status, 404);
    const history = await request('/sessions/1?from=2026-01-01T09:00:00Z&pageSize=5', 3);
    assert.equal(history.status, 200);
    assert.equal(history.body.data.length, 1);
    assert.equal(history.body.data[0].growth_stage, 'PINNING');
    assert.deepEqual(history.body.pagination, { page: 1, pageSize: 5, total: 1, totalPages: 1 });
    assert.equal((await request('/sessions/1/latest', 3)).body.data.temperature_avg, 25);

    const customerFloor = await request('/floors/1', 3);
    assert.equal(customerFloor.status, 200);
    assert.deepEqual(customerFloor.body.data.map((record) => record.session_id), [1]);
    const staffFloor = await request('/floors/1?page=1&pageSize=1', 1);
    assert.equal(staffFloor.status, 200);
    assert.equal(staffFloor.body.pagination.total, 2);
    assert.equal(staffFloor.body.data.length, 1);
    assert.equal((await request('/sessions/1?from=bad', 3)).status, 400);
    assert.ok(queries.every((sql) => !sql.includes('iot_sensor_readings')));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousUser) require.cache[userPath] = previousUser;
    else delete require.cache[userPath];
    await db.close();
  }
});
