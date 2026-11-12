const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Independent expectations from database.sql and migration 017.
const expected = {
  cultivation_inspection_images: ['uploaded_at'],
  cultivation_progress: ['updated_at'],
  cultivation_protocols: ['created_at'],
  cultivation_rooms: ['created_at', 'updated_at'],
  cultivation_session_trays: ['assigned_at'],
  cultivation_sessions: ['created_at'],
  cultivation_trays: ['created_at', 'updated_at'],
  disease_treatment_logs: ['performed_at'],
  expert_consultations: ['created_at'],
  harvests: ['created_at', 'updated_at'],
  inventory_transactions: ['created_at'],
  mushroom_conditions: ['created_at', 'updated_at'],
  mushroom_types: ['created_at'],
  orders: ['updated_at'],
  payments: ['created_at'],
  spawn_inventory: ['updated_at'],
  tray_positions: ['created_at', 'updated_at'],
  tray_reservations: ['created_at'],
  treatment_media: ['uploaded_at'],
  users: ['created_at', 'updated_at'],
};

test('restore missing timestamp defaults without rewriting history or business dates', async () => {
  const db = new PGlite();
  try {
    for (const [table, columns] of Object.entries(expected)) {
      await db.exec(`CREATE TABLE ${table} (id integer,
        ${columns.map(c => `${c} timestamptz NOT NULL`).join(',')});`);
      await assert.rejects(() => db.exec(`INSERT INTO ${table} (id) VALUES (1)`), { code: '23502' });
      await db.exec(`INSERT INTO ${table} VALUES (0,
        ${columns.map(() => "'2020-01-01T07:00:00+07:00'").join(',')})`);
    }
    await db.exec(`ALTER TABLE payments ADD COLUMN expires_at timestamptz;
      ALTER TABLE cultivation_sessions ADD COLUMN end_at timestamptz;`);
    const migration = fs.readFileSync(path.join(__dirname,
      '../migrations/027_restore_timestamp_defaults.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    for (const [table, columns] of Object.entries(expected)) {
      const inserted = (await db.query(`INSERT INTO ${table} (id) VALUES (1) RETURNING *`)).rows[0];
      const old = (await db.query(`SELECT * FROM ${table} WHERE id = 0`)).rows[0];
      for (const column of columns) {
        assert.ok(inserted[column], `${table}.${column} receives a timestamp`);
        assert.equal(new Date(old[column]).toISOString(), '2020-01-01T00:00:00.000Z');
      }
    }
    assert.equal((await db.query('SELECT expires_at FROM payments WHERE id = 1')).rows[0].expires_at, null);
    assert.equal((await db.query('SELECT end_at FROM cultivation_sessions WHERE id = 1')).rows[0].end_at, null);
  } finally {
    await db.close();
  }
});
