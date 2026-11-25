const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('tray QR APIs create, backfill, render and scan tokens with current sessions', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const userPath = require.resolve('../src/models/user.model');
  const previousDb = require.cache[dbPath];
  const previousUser = require.cache[userPath];
  let server;

  try {
    await db.exec(`
      CREATE TABLE cultivation_rooms (
        room_id SERIAL PRIMARY KEY, room_code TEXT, room_name TEXT, description TEXT,
        capacity INTEGER, status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE cultivation_floors (
        floor_id SERIAL PRIMARY KEY, floor_number INTEGER, floor_name TEXT
      );
      CREATE TABLE tray_positions (
        position_id SERIAL PRIMARY KEY, row_number INTEGER, column_number INTEGER
      );
      CREATE TABLE cultivation_trays (
        tray_id SERIAL PRIMARY KEY, room_id INTEGER NOT NULL, floor_id INTEGER,
        position_id INTEGER, tray_code TEXT UNIQUE, tray_name TEXT, status TEXT DEFAULT 'AVAILABLE',
        qr_token TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX uq_cultivation_trays_qr_token
        ON cultivation_trays(qr_token) WHERE qr_token IS NOT NULL;
      CREATE TABLE mushroom_types (mushroom_type_id SERIAL PRIMARY KEY, name TEXT);
      CREATE TABLE cultivation_sessions (
        session_id SERIAL PRIMARY KEY, status TEXT, harvest_status TEXT, start_at TIMESTAMPTZ,
        end_at TIMESTAMPTZ, harvest_date DATE, duration_days INTEGER, mushroom_type_id INTEGER
      );
      CREATE TABLE cultivation_session_trays (
        session_tray_id SERIAL PRIMARY KEY, session_id INTEGER, tray_id INTEGER,
        status TEXT, assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO cultivation_rooms(room_code, room_name) VALUES ('R1', 'Room 1');
      INSERT INTO cultivation_trays(room_id, tray_code) VALUES (1, 'OLD-1');
      INSERT INTO mushroom_types(name) VALUES ('Oyster mushroom');
      INSERT INTO cultivation_sessions(status, harvest_status, start_at, mushroom_type_id) VALUES
        ('CULTIVATING', 'NOT_READY', CURRENT_TIMESTAMP, 1),
        ('PENDING', 'NOT_READY', CURRENT_TIMESTAMP, 1);
    `);

    require.cache[dbPath] = { exports: { query: (sql, params) => db.query(sql, params) } };
    require.cache[userPath] = { exports: {
      findById: async (id) => ({ user_id: id, role_id: id, status: 'ACTIVE' }),
    } };
    const app = express();
    app.use(express.json());
    app.use('/api/cultivation-trays', require('../src/routes/cultivationTray.routes'));
    app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));

    const base = `http://127.0.0.1:${server.address().port}/api/cultivation-trays`;
    const env = require('../src/config/env');
    const request = (path, role, options = {}) => fetch(`${base}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${jwt.sign({ sub: String(role) }, env.jwtSecret)}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });

    const createResponse = await request('', 1, {
      method: 'POST',
      body: JSON.stringify({ roomId: 1, trayCode: 'NEW-1' }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).data;
    const token = (await db.query('SELECT qr_token FROM cultivation_trays WHERE tray_id=$1', [created.tray_id])).rows[0].qr_token;
    assert.match(token, /^[0-9a-f]{64}$/);

    const imageResponse = await request(`/${created.tray_id}/qr`, 1);
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get('content-type'), /image\/png/);
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()).subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    await db.exec(`
      INSERT INTO cultivation_session_trays(session_id, tray_id, status) VALUES
        (1, ${created.tray_id}, 'ACTIVE'), (2, ${created.tray_id}, 'ACTIVE');
    `);
    const scanResponse = await request('/qr/scan', 1, {
      method: 'POST',
      body: JSON.stringify({ qrToken: token }),
    });
    assert.equal(scanResponse.status, 200);
    const scanned = (await scanResponse.json()).data;
    assert.equal(scanned.tray.tray_id, created.tray_id);
    assert.equal(scanned.sessions.length, 1);
    assert.equal(scanned.sessions[0].mushroom_name, 'Oyster mushroom');

    assert.equal((await request('/qr/scan', 1, {
      method: 'POST', body: JSON.stringify({ qrToken: 'unknown-token' }),
    })).status, 404);
    assert.equal((await request('/qr/backfill', 3, { method: 'POST' })).status, 403);

    const backfillResponse = await request('/qr/backfill', 1, { method: 'POST' });
    assert.equal(backfillResponse.status, 200);
    assert.deepEqual((await backfillResponse.json()).data, { updated_count: 1, tray_ids: [1] });
    assert.match((await db.query('SELECT qr_token FROM cultivation_trays WHERE tray_id=1')).rows[0].qr_token,
      /^[0-9a-f]{64}$/);
    assert.equal((await request('/qr/backfill', 1, { method: 'POST' })).status, 200);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousUser) require.cache[userPath] = previousUser;
    else delete require.cache[userPath];
    await db.close();
  }
});
