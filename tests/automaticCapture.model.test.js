const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

test('creates an automatic inspection and returns its session for realtime delivery', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/automaticCapture.model');
  const previousDb = require.cache[dbPath];
  const previousModel = require.cache[modelPath];

  try {
    await db.exec(`
      CREATE TABLE cultivation_session_trays (
        session_tray_id integer PRIMARY KEY,
        session_id integer NOT NULL,
        status text NOT NULL,
        tray_id integer NOT NULL
      );
      CREATE TABLE cultivation_sessions (
        session_id integer PRIMARY KEY,
        status text NOT NULL
      );
      CREATE TABLE cultivation_trays (
        tray_id integer PRIMARY KEY,
        floor_id integer NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE cultivation_inspections (
        inspection_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        session_tray_id integer NOT NULL,
        inspected_by integer NOT NULL,
        inspection_date timestamptz NOT NULL,
        source text NOT NULL,
        capture_log_id integer NOT NULL,
        captured_at timestamptz NOT NULL
      );
      CREATE TABLE cultivation_inspection_images (
        image_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        inspection_id integer NOT NULL,
        image_url text NOT NULL
      );
      INSERT INTO cultivation_session_trays VALUES (21, 7, 'ACTIVE', 31);
      INSERT INTO cultivation_sessions VALUES (7, 'CULTIVATING');
      INSERT INTO cultivation_trays VALUES (31, 2, 'OCCUPIED');
    `);

    require.cache[dbPath] = { exports: { query: (sql, params) => db.query(sql, params) } };
    delete require.cache[modelPath];
    const model = require('../src/models/automaticCapture.model');
    const inspection = await model.createCaptureInspection({
      sessionTrayId: 21,
      floorId: 2,
      inspectedBy: 3,
      logId: 9,
      imageUrl: 'https://images.example.test/capture.jpg',
      capturedAt: '2026-11-28T05:30:00.000Z',
    });

    assert.deepEqual(inspection, { inspection_id: 1, session_id: 7 });
    assert.equal(
      (await db.query('SELECT COUNT(*)::int AS count FROM cultivation_inspection_images')).rows[0].count,
      1,
    );
  } finally {
    delete require.cache[dbPath];
    delete require.cache[modelPath];
    if (previousDb) require.cache[dbPath] = previousDb;
    if (previousModel) require.cache[modelPath] = previousModel;
    await db.close();
  }
});
