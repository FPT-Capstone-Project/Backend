const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('017 upgrades harvests to the WF-04 session lifecycle idempotently', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE cultivation_sessions (
        session_id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'PENDING',
        harvest_status TEXT NOT NULL DEFAULT 'NOT_READY'
      );
      CREATE TABLE cultivation_session_trays (
        session_tray_id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES cultivation_sessions(session_id)
      );
      CREATE TABLE harvest_requests (
        harvest_request_id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL UNIQUE REFERENCES cultivation_sessions(session_id)
      );
      CREATE TABLE harvests (
        harvest_id SERIAL PRIMARY KEY,
        harvest_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        harvest_request_id INTEGER REFERENCES harvest_requests(harvest_request_id),
        session_tray_id INTEGER REFERENCES cultivation_session_trays(session_tray_id),
        total_weight_kg NUMERIC,
        usable_weight_kg NUMERIC,
        rejected_weight_kg NUMERIC DEFAULT 0
      );

      INSERT INTO cultivation_sessions (status) VALUES ('CULTIVATING'), ('CULTIVATING');
      INSERT INTO cultivation_session_trays (session_id) VALUES (1), (1);
      INSERT INTO harvest_requests (session_id) VALUES (1);
      INSERT INTO harvests (harvest_date, harvest_request_id, session_tray_id)
        VALUES ('2026-10-24', 1, 1), ('2026-10-24', NULL, 2);
    `);

    const migration = fs.readFileSync('migrations/017_wf04_harvest_lifecycle.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);

    assert.equal(
      (await db.query('SELECT COUNT(*)::int AS count FROM harvests WHERE session_id = 1')).rows[0].count,
      1,
    );
    assert.equal(
      (await db.query('SELECT COUNT(*)::int AS count FROM harvests WHERE session_id IS NULL')).rows[0].count,
      1,
    );

    const planned = await db.query(`
      INSERT INTO harvests (session_id)
      VALUES (2)
      RETURNING status, harvest_date, updated_at
    `);
    assert.equal(planned.rows[0].status, 'PLANNED');
    assert.equal(planned.rows[0].harvest_date, null);
    assert.ok(planned.rows[0].updated_at);

    await assert.rejects(
      db.exec("INSERT INTO harvests (session_id, status) VALUES (2, 'PLANNED')"),
      { code: '23505' },
    );
    await assert.rejects(
      db.exec("INSERT INTO harvests (session_id, status) VALUES (1, 'INVALID')"),
      { code: '23514' },
    );
    await assert.rejects(
      db.exec('INSERT INTO harvests (total_weight_kg) VALUES (-1)'),
      { code: '23514' },
    );
    await assert.rejects(
      db.exec('INSERT INTO harvests (total_weight_kg, usable_weight_kg, rejected_weight_kg) VALUES (2, 1, 0)'),
      { code: '23514' },
    );

    await db.exec("UPDATE cultivation_sessions SET status = 'HARVEST_READY' WHERE session_id = 2");
    await assert.rejects(
      db.exec("UPDATE cultivation_sessions SET status = 'INVALID' WHERE session_id = 2"),
      { code: '23514' },
    );
  } finally {
    await db.close();
  }
});
