const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('WF-03/WF-04 audit migrations are repeatable and preserve existing rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users(user_id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES(1);
      CREATE TABLE cultivation_sessions(session_id INTEGER PRIMARY KEY);
      INSERT INTO cultivation_sessions VALUES(15);
      CREATE TABLE harvest_requests(harvest_request_id INTEGER PRIMARY KEY);
      INSERT INTO harvest_requests VALUES(10);
      CREATE TABLE cultivation_progress(progress_id INTEGER PRIMARY KEY, description TEXT);
      INSERT INTO cultivation_progress VALUES(1, 'Existing history');
    `);
    for (const file of ['018_wf03_growth_condition.sql','019_wf03_wf04_confirmation_audit.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8');
      await db.exec(sql);
      await db.exec(sql);
    }
    assert.deepEqual((await db.query('SELECT * FROM cultivation_progress')).rows, [{ progress_id: 1, description: 'Existing history', condition: null }]);
    await db.exec('UPDATE cultivation_sessions SET harvest_ready_by=1, harvest_ready_at=CURRENT_TIMESTAMP; UPDATE harvest_requests SET confirmed_by=1');
    await assert.rejects(() => db.exec('UPDATE harvest_requests SET confirmed_by=999'));
    assert.equal((await db.query('SELECT harvest_ready_by FROM cultivation_sessions WHERE session_id=15')).rows[0].harvest_ready_by, 1);
  } finally { await db.close(); }
});
