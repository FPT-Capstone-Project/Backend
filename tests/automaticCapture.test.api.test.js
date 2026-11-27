const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('manual camera test capture logs the image and creates AUTO inspections per active tray', async () => {
  const db = new PGlite();
  const modulePaths = [
    '../src/config/db',
    '../src/models/user.model',
    '../src/services/email.service',
    '../src/services/automaticCapture.service',
    '../src/models/automaticCapture.model',
    '../src/services/camera.service',
    '../src/services/cloudinary.service',
    '../src/controllers/automaticCapture.controller',
    '../src/routes/automaticCapture.routes',
    '../src/routes/root.routes',
    '../src/middlewares/auth.middleware',
  ].map((modulePath) => require.resolve(modulePath));
  const previousModules = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const captureCalls = [];
  let server;

  try {
    await db.exec(fs.readFileSync('database.sql', 'utf8'));
    await db.exec(`
      INSERT INTO roles (role_id, role_name) VALUES (1, 'Admin'), (2, 'Farm Operator'), (3, 'Customer');
      INSERT INTO users (user_id, role_id, email, password_hash, full_name)
        VALUES (1, 1, 'admin@example.com', 'hash', 'Admin');
      INSERT INTO mushroom_types (name, growing_days) VALUES ('Capture mushroom', 30);
      INSERT INTO orders (user_id) VALUES (1);
      INSERT INTO order_items (order_id, mushroom_type_id, unit_price, total_price)
        VALUES (1, 1, 10, 10);
      INSERT INTO cultivation_rooms (room_code, room_name) VALUES ('CAP', 'Capture Room');
      INSERT INTO iot_masters (master_identifier, cultivation_room_id) VALUES ('cap-master', 1);
      INSERT INTO cultivation_floors
        (room_id, floor_number, floor_name, master_id, node_address, misting_ssr_channel)
        VALUES (1, 1, 'Capture Floor', 1, 1, 1);
      INSERT INTO cultivation_sessions
        (session_id, mushroom_type_id, start_at, order_item_id, status)
        VALUES (1, 1, NOW(), 1, 'CULTIVATING');
      INSERT INTO cultivation_trays (room_id, floor_id, tray_code, status)
        VALUES (1, 1, 'CAP-1', 'OCCUPIED'),
               (1, 1, 'CAP-2', 'OCCUPIED'),
               (1, 1, 'CAP-3', 'AVAILABLE');
      INSERT INTO cultivation_session_trays (session_id, tray_id, status)
        VALUES (1, 1, 'ACTIVE'), (1, 2, 'ACTIVE');
      INSERT INTO cameras (room_id, floor_id, camera_code, camera_name, status)
        VALUES (1, 1, 'capture-cam', 'Capture Camera', 'ACTIVE'),
               (1, NULL, 'no-floor-cam', 'Camera Without Floor', 'ACTIVE'),
               (1, NULL, 'inactive-cam', 'Inactive Camera', 'INACTIVE'),
               (1, NULL, 'failing-cam', 'Failing Camera', 'ACTIVE');
      CREATE FUNCTION reject_capture_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.session_tray_id = 2 THEN
          RAISE EXCEPTION 'test inspection failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_capture_inspection
        BEFORE INSERT ON cultivation_inspections
        FOR EACH ROW EXECUTE FUNCTION reject_capture_inspection();
    `);

    const dbPath = modulePaths[0];
    const userPath = modulePaths[1];
    const emailPath = modulePaths[2];
    const servicePath = modulePaths[3];
    const modelPath = modulePaths[4];
    const cameraServicePath = modulePaths[5];
    const cloudinaryServicePath = modulePaths[6];
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
    require.cache[cameraServicePath] = {
      exports: {
        captureSnapshot: async (cameraId) => {
          captureCalls.push(cameraId);
          if (cameraId === 4) {
            const error = new Error('Imou snapshot failed');
            error.statusCode = 502;
            error.isOperational = true;
            throw error;
          }
          return {
            snapshotUrl: 'https://res.cloudinary.com/test/image/upload/captures/test.jpg',
            capturedAt: '2026-11-27T00:30:00.000Z',
          };
        },
      },
    };
    require.cache[cloudinaryServicePath] = {
      exports: {
        getPublicIdFromUrl: () => 'captures/test',
      },
    };
    delete require.cache[servicePath];
    delete require.cache[modelPath];

    const app = express();
    app.use(express.json());
    app.use('/api', require('../src/routes/root.routes'));
    app.use((error, req, res, next) => {
      res.status(error.statusCode || 500).json({ message: error.message });
    });
    const env = require('../src/config/env');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));

    const token = (userId) => jwt.sign({ sub: String(userId) }, env.jwtSecret);
    const request = async (userId, body) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/automatic-captures/test`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(userId ? { authorization: `Bearer ${token(userId)}` } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      return { status: response.status, body: await response.json() };
    };
    const getCameraTrays = async (userId, cameraId) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/automatic-captures/cameras/${cameraId}/trays`,
        {
          headers: userId
            ? { authorization: `Bearer ${token(userId)}` }
            : {},
        },
      );
      return { status: response.status, body: await response.json() };
    };

    assert.equal((await request(null, { cameraId: 1 })).status, 401);
    assert.equal((await request(3, { cameraId: 1 })).status, 403);
    assert.equal((await request(1, {})).status, 400);
    assert.equal((await request(1, { cameraId: 999 })).status, 404);
    assert.equal((await request(1, { cameraId: 3 })).status, 409);

    assert.equal((await getCameraTrays(null, 1)).status, 401);
    assert.equal((await getCameraTrays(3, 1)).status, 403);
    const cameraTrays = await getCameraTrays(2, 1);
    assert.equal(cameraTrays.status, 200);
    assert.equal(cameraTrays.body.data.cameraId, 1);
    assert.equal(cameraTrays.body.data.floorId, 1);
    assert.deepEqual(
      cameraTrays.body.data.trays.map((tray) => tray.tray_code),
      ['CAP-1', 'CAP-2'],
    );
    assert.equal(cameraTrays.body.data.trays[0].session_tray_id, 1);
    assert.equal(cameraTrays.body.data.trays[0].session_id, 1);
    assert.equal(cameraTrays.body.data.trays[0].session_status, 'CULTIVATING');
    assert.ok(cameraTrays.body.data.trays.every((tray) => tray.session_tray_id != null));
    assert.equal((await getCameraTrays(1, 2)).body.data.trays.length, 0);
    assert.equal((await getCameraTrays(1, 999)).status, 404);
    assert.equal((await getCameraTrays(1, 'invalid')).status, 400);

    const partial = await request(1, { cameraId: 1 });
    assert.equal(partial.status, 200);
    assert.deepEqual(partial.body, {
      success: false,
      message: 'Camera image captured; some tray inspections could not be saved',
      data: {
        logId: 1,
        cameraId: 1,
        floorId: 1,
        imageUrl: 'https://res.cloudinary.com/test/image/upload/captures/test.jpg',
        capturedAt: '2026-11-27T00:30:00.000Z',
        totalTrays: 2,
        successTrays: 1,
        failedTrays: 1,
        status: 'PARTIAL_SUCCESS',
        trays: [
          {
            trayId: 1,
            sessionTrayId: 1,
            inspectionId: 1,
            status: 'SUCCESS',
          },
          {
            trayId: 2,
            sessionTrayId: 2,
            status: 'FAILED',
            error: 'Failed to create inspection for session tray 2 (23514)',
          },
        ],
      },
    });
    const inspectionRows = (await db.query(`
      SELECT i.session_tray_id, i.source, i.capture_log_id, i.captured_at,
             i.tray_condition, i.mushroom_condition, i.growth_status, img.image_url
      FROM cultivation_inspections i
      INNER JOIN cultivation_inspection_images img USING (inspection_id)
    `)).rows;
    assert.equal(inspectionRows.length, 1);
    assert.equal(inspectionRows[0].session_tray_id, 1);
    assert.equal(inspectionRows[0].source, 'AUTO');
    assert.equal(inspectionRows[0].capture_log_id, 1);
    assert.equal(
      Date.parse(inspectionRows[0].captured_at),
      Date.parse('2026-11-27T00:30:00.000Z'),
    );
    assert.equal(inspectionRows[0].tray_condition, null);
    assert.equal(inspectionRows[0].mushroom_condition, null);
    assert.equal(inspectionRows[0].growth_status, null);
    assert.equal(
      inspectionRows[0].image_url,
      'https://res.cloudinary.com/test/image/upload/captures/test.jpg',
    );
    const partialLog = (await db.query(
      'SELECT * FROM automatic_capture_logs WHERE log_id = 1',
    )).rows[0];
    assert.equal(partialLog.public_id, 'captures/test');
    assert.match(partialLog.error_message, /session tray 2/);

    const noTrays = await request(1, { cameraId: 2 });
    assert.equal(noTrays.status, 200);
    assert.equal(noTrays.body.data.totalTrays, 0);
    assert.equal(noTrays.body.data.status, 'SUCCESS');

    const captureFailure = await request(1, { cameraId: 4 });
    assert.equal(captureFailure.status, 502);
    const failedLog = (await db.query(
      "SELECT status, error_message FROM automatic_capture_logs WHERE camera_id = 4",
    )).rows[0];
    assert.equal(failedLog.status, 'FAILED');
    assert.match(failedLog.error_message, /Imou snapshot failed/);
    assert.deepEqual(captureCalls, [1, 2, 4]);
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
