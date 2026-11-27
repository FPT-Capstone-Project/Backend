const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('automatic-capture APIs validate camera/configuration and expose paginated logs', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const userPath = require.resolve('../src/models/user.model');
  const emailPath = require.resolve('../src/services/email.service');
  const servicePath = require.resolve('../src/services/automaticCapture.service');
  const modelPath = require.resolve('../src/models/automaticCapture.model');
  const controllerPath = require.resolve('../src/controllers/automaticCapture.controller');
  const routePath = require.resolve('../src/routes/automaticCapture.routes');
  const authPath = require.resolve('../src/middlewares/auth.middleware');
  const modulePaths = [
    dbPath,
    userPath,
    emailPath,
    servicePath,
    modelPath,
    controllerPath,
    routePath,
    authPath,
  ];
  const previousModules = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  let server;

  try {
    await db.exec(fs.readFileSync('database.sql', 'utf8'));
    await db.exec(`
      INSERT INTO cultivation_rooms (room_code, room_name) VALUES ('AUTO', 'Auto Room');
      INSERT INTO iot_masters (master_identifier, cultivation_room_id)
        VALUES ('capture-master', 1);
      INSERT INTO cultivation_floors
        (room_id, floor_number, floor_name, master_id, node_address, misting_ssr_channel)
        VALUES (1, 1, 'Capture Floor', 1, 1, 1);
      INSERT INTO cameras (room_id, floor_id, camera_code, camera_name, status)
        VALUES (1, 1, 'active-cam', 'Active Camera', 'ACTIVE'),
               (1, NULL, 'inactive-cam', 'Inactive Camera', 'INACTIVE');
    `);

    require.cache[dbPath] = {
      exports: { query: (sql, params) => db.query(sql, params) },
    };
    require.cache[userPath] = {
      exports: {
        findById: async (id) => ({
          user_id: id,
          role_id: id === 3 ? 3 : id === 2 ? 2 : 1,
          status: 'ACTIVE',
        }),
      },
    };
    require.cache[emailPath] = { exports: { sendOtpEmail: async () => {} } };

    const app = express();
    app.use(express.json());
    app.use('/api/automatic-captures', require('../src/routes/automaticCapture.routes'));
    app.use((error, req, res, next) => {
      res.status(error.statusCode || 500).json({ message: error.message });
    });
    const env = require('../src/config/env');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));

    const token = (userId) => jwt.sign({ sub: String(userId) }, env.jwtSecret);
    const request = async (path, userId, options = {}) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/automatic-captures${path}`,
        {
          ...options,
          headers: {
            ...(options.body ? { 'content-type': 'application/json' } : {}),
            ...(userId ? { authorization: `Bearer ${token(userId)}` } : {}),
            ...options.headers,
          },
        },
      );
      return { status: response.status, body: await response.json() };
    };

    assert.equal((await request('/configs')).status, 401);
    assert.equal((await request('/configs', 3)).status, 403);
    const configs = await request('/configs', 1);
    assert.equal(configs.status, 200);
    assert.equal(configs.body.data.length, 2);
    assert.equal(configs.body.data[0].config_id, null);

    const unconfigured = await request('/cameras/1/config', 2);
    assert.equal(unconfigured.status, 200);
    assert.equal(unconfigured.body.data.config_id, null);
    assert.equal((await request('/cameras/999/config', 1)).status, 404);
    assert.equal((await request('/cameras/2/config', 1)).status, 409);

    const saved = await request('/cameras/1/config', 1, {
      method: 'PUT',
      body: JSON.stringify({ captureTimes: ['08:00', '14:30'], isEnabled: true }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.data.capture_times, ['08:00:00', '14:30:00']);
    assert.equal(saved.body.data.is_enabled, true);

    const updated = await request('/cameras/1/config', 2, {
      method: 'PUT',
      body: JSON.stringify({ captureTimes: ['09:15'], isEnabled: false }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.data.capture_times, ['09:15:00']);
    assert.equal(updated.body.data.is_enabled, false);
    assert.equal(
      (await db.query('SELECT COUNT(*)::int AS count FROM automatic_capture_configs')).rows[0].count,
      1,
    );

    for (const captureTimes of [['8:00'], ['24:00'], ['08:00', '08:00'], []]) {
      const invalid = await request('/cameras/1/config', 1, {
        method: 'PUT',
        body: JSON.stringify({ captureTimes, isEnabled: true }),
      });
      assert.equal(invalid.status, 400, JSON.stringify(captureTimes));
    }
    assert.equal((await request('/cameras/2/config', 1, {
      method: 'PUT',
      body: JSON.stringify({ captureTimes: ['08:00'], isEnabled: true }),
    })).status, 409);

    await db.exec(`
      INSERT INTO automatic_capture_logs (camera_id, scheduled_at, captured_at, status)
        VALUES (1, '2026-11-27T08:00:00Z', '2026-11-27T08:00:10Z', 'SUCCESS'),
               (1, '2026-11-27T14:30:00Z', NULL, 'FAILED');
    `);
    const logs = await request('/logs?cameraId=1&page=1&pageSize=1', 1);
    assert.equal(logs.status, 200);
    assert.equal(logs.body.data.length, 1);
    assert.deepEqual(logs.body.pagination, {
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    const detail = await request(`/logs/${logs.body.data[0].log_id}`, 2);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.camera_name, 'Active Camera');
    assert.equal((await request('/logs/not-an-id', 1)).status, 400);
    assert.equal((await request('/logs/999', 1)).status, 404);
    assert.equal((await request('/logs?status=UNKNOWN', 1)).status, 400);
    assert.equal((await request('/logs?cameraId=999', 1)).status, 404);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const modulePath of modulePaths) {
      delete require.cache[modulePath];
      const previousModule = previousModules.get(modulePath);
      if (previousModule) require.cache[modulePath] = previousModule;
    }
    await db.close();
  }
});
