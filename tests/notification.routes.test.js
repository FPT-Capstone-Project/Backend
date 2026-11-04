const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('staff send to the session Customer; retrieval and read routes preserve ownership', async () => {
  const db = new PGlite();
  const replacements = {
    '../src/config/db': { query: (...args) => db.query(...args) },
    '../src/models/user.model': {
      findById: async (id) => ({ user_id: id, role_id: id <= 2 ? id : 3, status: 'ACTIVE' }),
    },
    '../src/services/auth.service': { sanitizeUser: (user) => user },
  };
  const originals = new Map();
  let server;
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8'));
    await db.exec(`
      INSERT INTO roles(role_name) VALUES ('Admin'), ('Farm Operator'), ('Customer');
      INSERT INTO users(role_id, email, password_hash, full_name) VALUES
        (1, 'admin@test.local', 'hash', 'Admin'),
        (2, 'operator@test.local', 'hash', 'Operator'),
        (3, 'customer@test.local', 'hash', 'Customer'),
        (3, 'other@test.local', 'hash', 'Other');
      INSERT INTO orders(user_id) VALUES (3);
      INSERT INTO mushroom_types(name, growing_days) VALUES ('Oyster', 25);
      INSERT INTO order_items(order_id, mushroom_type_id, unit_price, total_price) VALUES (1, 1, 100, 100);
      INSERT INTO cultivation_sessions(mushroom_type_id, start_at, order_item_id, status)
        VALUES (1, CURRENT_TIMESTAMP, 1, 'CULTIVATING');
    `);
    for (const [name, exports] of Object.entries(replacements)) {
      const resolved = require.resolve(name);
      originals.set(resolved, require.cache[resolved]);
      require.cache[resolved] = { exports };
    }
    const app = express();
    app.use(express.json());
    app.use('/api/notifications', require('../src/routes/notification.routes'));
    app.use((error, req, res, next) => res.status(error.statusCode || error.status || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const env = require('../src/config/env');
    const request = async (method, suffix, userId, body, token) => {
      const headers = { 'content-type': 'application/json' };
      if (userId) headers.authorization = `Bearer ${token || jwt.sign({ sub: String(userId) }, env.jwtSecret)}`;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications${suffix}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const payload = { title: ' Update ', message: ' Growing well ' };
    for (const [user, expected] of [[1, 201], [2, 201], [3, 403], [undefined, 401]]) {
      const result = await request('POST', '/cultivation-sessions/1', user, {
        ...payload, userId: 4, createdBy: 4, referenceType: 'OTHER', referenceId: 999,
      });
      assert.equal(result.status, expected);
      if (expected === 201) {
        assert.equal(result.body.message, 'Notification sent successfully');
        assert.deepEqual(result.body.data, {
          notification_id: user, user_id: 3, notification_type: 'OPERATOR_MESSAGE',
          title: 'Update', message: 'Growing well', reference_type: 'CULTIVATION_SESSION',
          reference_id: 1, created_at: result.body.data.created_at,
        });
        assert.ok(result.body.data.created_at);
      }
    }
    assert.equal((await request('POST', '/cultivation-sessions/1', 1, payload, 'invalid')).status, 401);
    for (const body of [undefined, {}, [], { message: 'Update' }, { title: ' ', message: 'Update' },
      { title: 'Update', message: ' ' }, { ...payload, type: 'UNKNOWN' }]) {
      assert.equal((await request('POST', '/cultivation-sessions/1', 1, body)).status, 400);
    }
    assert.equal((await request('POST', '/cultivation-sessions/abc', 1, payload)).status, 400);
    assert.equal((await request('POST', '/cultivation-sessions/999', 1, payload)).status, 404);
    const stored = await db.query('SELECT user_id, created_by, reference_type, reference_id FROM notifications ORDER BY notification_id');
    assert.deepEqual(stored.rows, [1, 2].map((created_by) => ({
      user_id: 3, created_by, reference_type: 'CULTIVATION_SESSION', reference_id: 1,
    })));
    const list = await request('GET', '?userId=4', 3);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 2);
    assert.equal(list.body.meta.unread_count, 2);
    assert.deepEqual((await request('GET', '', 4)).body.data, []);
    assert.equal((await request('PATCH', '/1/read', 4)).status, 404);
    const read = await request('PATCH', '/1/read', 3);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.is_read, true);
    const reread = await request('PATCH', '/1/read', 3);
    assert.equal(reread.body.data.read_at, read.body.data.read_at);
    assert.equal((await request('PATCH', '/read-all', 4)).body.data.updated, 0);
    assert.equal((await request('PATCH', '/read-all', 3)).body.data.updated, 1);
    assert.equal((await request('GET', '', 3)).body.meta.unread_count, 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const [resolved, original] of originals) {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    }
    await db.close();
  }
});

test('Swagger exposes staff sending with required title/message and supported types', () => {
  const operation = require('../src/config/swagger').paths['/api/notifications/cultivation-sessions/{sessionId}'].post;
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  assert.equal(operation.parameters[0].name, 'sessionId');
  const schema = operation.requestBody.content['application/json'].schema;
  assert.deepEqual(schema.required, ['title', 'message']);
  assert.deepEqual(schema.properties.type.enum, ['OPERATOR_MESSAGE', 'MUSHROOM_DISEASE', 'DEVICE_ISSUE']);
  assert.equal(schema.properties.type.default, 'OPERATOR_MESSAGE');
  assert.deepEqual(Object.keys(operation.responses).sort(), ['201', '400', '401', '403', '404', '409', '500']);
});
