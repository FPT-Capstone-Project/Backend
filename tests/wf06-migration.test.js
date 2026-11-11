const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('016 upgrades existing disease-management tables idempotently', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (user_id SERIAL PRIMARY KEY);
      CREATE TABLE cultivation_issues (
        issue_id SERIAL PRIMARY KEY,
        session_tray_id INTEGER,
        inspection_id INTEGER,
        spawn_inspection_id BIGINT,
        status TEXT NOT NULL DEFAULT 'OPEN'
          CHECK (status IN ('OPEN', 'WAITING_EXPERT', 'IN_PROGRESS', 'MONITORING', 'RESOLVED'))
      );
      CREATE TABLE expert_consultations (
        consultation_id SERIAL PRIMARY KEY,
        issue_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'))
      );
      CREATE TABLE disease_treatment_logs (
        treatment_log_id BIGSERIAL PRIMARY KEY,
        consultation_id INTEGER NOT NULL,
        performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE treatment_media (
        media_id BIGSERIAL PRIMARY KEY,
        treatment_log_id BIGINT NOT NULL,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO cultivation_issues (session_tray_id, status)
        VALUES (1, 'WAITING_EXPERT'), (2, 'MONITORING');
    `);
    const migration = fs.readFileSync(
      'migrations/016_wf06_disease_management.sql',
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);

    assert.deepEqual(
      (await db.query('SELECT status FROM cultivation_issues ORDER BY issue_id')).rows,
      [{ status: 'PENDING_EXPERT' }, { status: 'IN_PROGRESS' }],
    );
    await db.exec(`
      INSERT INTO cultivation_issues (spawn_inspection_id, status)
      VALUES (1, 'OPEN');
    `);
    await assert.rejects(
      db.exec(`INSERT INTO cultivation_issues (session_tray_id, spawn_inspection_id, status)
        VALUES (1, 1, 'OPEN')`),
      { code: '23514' },
    );
  } finally {
    await db.close();
  }
});
