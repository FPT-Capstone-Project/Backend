const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('015 upgrades existing harvest and treatment schema idempotently', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (user_id SERIAL PRIMARY KEY);
      CREATE TABLE cultivation_sessions (session_id SERIAL PRIMARY KEY);
      CREATE TABLE cultivation_session_trays (session_tray_id SERIAL PRIMARY KEY);
      CREATE TABLE cultivation_inspections (inspection_id SERIAL PRIMARY KEY);
      CREATE TABLE spawn_inspections (inspection_id BIGSERIAL PRIMARY KEY);
      CREATE TABLE expert_consultations (
        consultation_id SERIAL PRIMARY KEY,
        status VARCHAR NOT NULL DEFAULT 'PENDING'
      );
      CREATE TABLE cultivation_issues (
        issue_id SERIAL PRIMARY KEY,
        session_tray_id INTEGER NOT NULL
          REFERENCES cultivation_session_trays(session_tray_id),
        inspection_id INTEGER REFERENCES cultivation_inspections(inspection_id),
        reported_by INTEGER NOT NULL REFERENCES users(user_id),
        status VARCHAR NOT NULL DEFAULT 'OPEN'
      );
    `);

    const migration = fs.readFileSync(
      'migrations/015_add_harvest_and_treatment_schema.sql',
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);

    await db.exec(`
      INSERT INTO users DEFAULT VALUES;
      INSERT INTO cultivation_sessions DEFAULT VALUES;
      INSERT INTO spawn_inspections DEFAULT VALUES;
      INSERT INTO expert_consultations DEFAULT VALUES;
      INSERT INTO cultivation_issues (reported_by, spawn_inspection_id) VALUES (1, 1);
      INSERT INTO disease_treatment_logs (
        consultation_id, performed_by, action_description
      ) VALUES (1, 1, 'Applied treatment');
      INSERT INTO treatment_media (
        treatment_log_id, media_url, media_type, media_stage, uploaded_by
      ) VALUES (1, 'https://example.test/image.png', 'IMAGE', 'BEFORE', 1);
    `);

    assert.deepEqual(
      (await db.query('SELECT harvest_status FROM cultivation_sessions')).rows,
      [{ harvest_status: 'NOT_READY' }],
    );
    assert.equal(
      (await db.query('SELECT spawn_inspection_id FROM cultivation_issues')).rows[0]
        .spawn_inspection_id,
      1,
    );
    assert.equal(
      (await db.query('SELECT COUNT(*)::int AS count FROM treatment_media')).rows[0].count,
      1,
    );
    await assert.rejects(
      db.exec("UPDATE cultivation_sessions SET harvest_status = 'INVALID'"),
      { code: '23514' },
    );
    await assert.rejects(
      db.exec("UPDATE cultivation_issues SET status = 'INVALID'"),
      { code: '23514' },
    );
    await assert.rejects(
      db.exec("UPDATE expert_consultations SET status = 'INVALID'"),
      { code: '23514' },
    );
  } finally {
    await db.close();
  }
});
