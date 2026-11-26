const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

function createTestPool(db) {
  // PGlite exposes one connection, so overlapping requests queue at checkout.
  let queued = Promise.resolve();
  return {
    query: (sql, params) => db.query(sql, params),
    async connect() {
      const previous = queued;
      let release;
      queued = new Promise((resolve) => { release = resolve; });
      await previous;
      return { query: (sql, params) => db.query(sql, params), release };
    },
  };
}

function form(fields) {
  const body = new FormData();
  for (const [field, value] of Object.entries(fields)) body.append(field, value);
  return body;
}

test('cultivation tray growth APIs work against the repository schema', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fs.readFileSync('database.sql', 'utf8'));
  await db.exec(`
    ALTER TABLE cultivation_sessions
      ADD COLUMN harvest_ready_at TIMESTAMPTZ,
      ADD COLUMN harvest_ready_by INTEGER;
  `);
  await db.exec(`
    INSERT INTO roles (role_id, role_name) VALUES (1, 'Admin'), (2, 'Farm Operator'), (3, 'Customer');
    INSERT INTO users (user_id, role_id, email, password_hash, full_name)
      VALUES (1, 1, 'admin@example.test', 'hash', 'Admin'),
             (2, 2, 'operator@example.test', 'hash', 'Operator'),
             (3, 3, 'customer@example.test', 'hash', 'Customer');
    INSERT INTO mushroom_types (name, growing_days) VALUES ('Test mushroom', 30);
    INSERT INTO orders (user_id) VALUES (3);
    INSERT INTO order_items (order_id, mushroom_type_id, unit_price, total_price)
      VALUES (1, 1, 10, 10), (1, 1, 10, 10), (1, 1, 10, 10);
    INSERT INTO cultivation_sessions (mushroom_type_id, start_at, order_item_id, status)
      VALUES (1, '2026-01-01T09:00:00Z', 1, 'CULTIVATING'),
             (1, '2026-01-01T09:00:00Z', 2, 'CULTIVATING'),
             (1, '2026-01-01T09:00:00Z', 3, 'READY_FOR_CULTIVATION');
    INSERT INTO cultivation_rooms (room_code, room_name) VALUES ('QR', 'QR room');
    INSERT INTO cultivation_trays (room_id, tray_code, status, qr_token)
      VALUES (1, 'TRAY-001', 'OCCUPIED', 'first'),
             (1, 'TRAY-002', 'OCCUPIED', 'second'),
             (1, 'TRAY-003', 'AVAILABLE', 'released'),
             (1, 'TRAY-004', 'AVAILABLE', 'unassigned'),
             (1, 'TRAY-005', 'OCCUPIED', 'too-early');
    INSERT INTO cultivation_session_trays (session_id, tray_id, status)
      VALUES (1, 1, 'ACTIVE'), (1, 2, 'ACTIVE'), (1, 3, 'RELEASED'), (3, 5, 'ACTIVE');
    INSERT INTO cultivation_progress
      (session_id, current_stage, progress_percent, start_date, expected_harvest_date, condition, description)
      VALUES (1, 'FRUITING_INITIATION', 20, '2026-01-01', '2026-01-31', 'NORMAL', 'Initial observation');
    INSERT INTO cultivation_inspections (session_tray_id, inspected_by, growth_status, inspection_date)
      VALUES (3, 2, 'MATURATION', CURRENT_TIMESTAMP),
             (1, 2, NULL, (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')
               AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '1 second');
  `);
  const dbPath = require.resolve('../src/config/db');
  const previousDb = require.cache[dbPath];
  require.cache[dbPath] = { exports: createTestPool(db) };
  t.after(() => {
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
  });

  const app = require('../src/app');
  const { jwtSecret } = require('../src/config/env');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  async function request(path, body, userId = 2, headers = {}) {
    const url = `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin${path}`;
    if (userId) headers = { ...headers, authorization: `Bearer ${jwt.sign({ sub: String(userId) }, jwtSecret)}` };
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', body, headers });
    return { status: response.status, body: await response.json() };
  }

  function update(qrToken, growthStatus, observations = {}) {
    return request('/qr-growth-update', form({ qr_token: qrToken, growth_status: growthStatus, ...observations }));
  }

  await t.test('validates access, multipart fields, QR tokens, assignments and lifecycle', async () => {
    const path = '/qr-growth-update';
    assert.equal((await request(path, form({}), null)).status, 401);
    assert.equal((await request(path, form({}), 3)).status, 403);
    assert.equal((await request('/1/growth-status', undefined, 3)).status, 403);
    assert.equal((await request(path, '{}', 2, { 'content-type': 'application/json' })).status, 400);
    for (const fields of [
      { growth_status: 'PINNING' },
      { qr_token: 'first' },
      { qr_token: 'first', growth_status: 'INVALID' },
      { qr_token: 'first', growth_status: 'PINNING', session_tray_id: '1' },
      { qr_token: 'first', growth_status: 'PINNING', inspected_by: '1' },
      { qr_token: 'first', growth_status: 'PINNING', images: new Blob(['image']) },
    ]) {
      assert.equal((await request(path, form(fields))).status, 400);
    }
    assert.equal((await update('unknown', 'PINNING')).status, 404);
    assert.equal((await update('unassigned', 'PINNING')).status, 409);
    assert.equal((await update('released', 'PINNING')).status, 409);
    assert.equal((await update('too-early', 'PINNING')).body.code, 'INVALID_SESSION_STATUS');
    assert.equal((await request('/bad/growth-status')).status, 400);
    assert.equal((await request('/999/growth-status')).status, 404);
    assert.deepEqual((await request('/2/growth-status')).body.data, {
      session_id: 2,
      session_stage: null,
      synchronization: { is_synchronized: false, total_trays: 0, updated_trays: 0, matching_trays: 0 },
      trays: [],
    });
  });

  await t.test('uses current daily inspections and excludes released trays', async () => {
    const original = await request('/inspections', form({
      qr_token: 'first', trayCondition: 'GOOD', mushroomCondition: 'NORMAL', notes: 'Routine observation',
    }), 1);
    assert.equal(original.status, 201);
    const inspection = original.body.data.inspection;
    assert.equal(inspection.growth_status, null);

    const partial = await update('first', 'PINNING');
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.deepEqual(partial.body.data, {
      session_id: 1,
      tray_id: 1,
      tray_code: 'TRAY-001',
      growth_status: 'PINNING',
      harvest_status: 'NOT_READY',
      harvest_ready: false,
      harvest_ready_changed: false,
      synchronization: {
        is_synchronized: false,
        session_stage: 'FRUITING_INITIATION',
        total_trays: 2,
        updated_trays: 1,
        matching_trays: 1,
      },
    });

    const history = await request('/1/growth-status');
    assert.equal(history.status, 200);
    assert.equal(history.body.success, true);
    assert.deepEqual(history.body.data.trays.map(({ tray_id, growth_status }) => [tray_id, growth_status]), [
      [1, 'PINNING'], [2, null],
    ]);
    assert.equal(history.body.data.trays[0].updated, true);
    assert.equal(Date.parse(history.body.data.trays[0].last_inspection_at), Date.parse(inspection.inspection_date));
    assert.equal(history.body.data.trays[1].updated, false);
    assert.equal(history.body.data.trays[1].last_inspection_at, null);

    assert.equal((await update('first', 'PINNING', { notes: 'Pins observed' })).status, 200);
    const { rows } = await db.query(`
      SELECT inspection_id, inspected_by, tray_condition, mushroom_condition, notes
      FROM cultivation_inspections WHERE session_tray_id = 1 ORDER BY inspection_id
    `);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], {
      inspection_id: inspection.inspection_id,
      inspected_by: 2,
      tray_condition: 'GOOD',
      mushroom_condition: 'NORMAL',
      notes: 'Pins observed',
    });
    const duplicate = await request('/inspections', form({ qr_token: 'first' }));
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'DUPLICATE_DAILY_INSPECTION');
  });

  await t.test('writes history only for a changed consensus and preserves progress metadata', async () => {
    const mixed = await update('second', 'FRUITING_INITIATION');
    assert.equal(mixed.status, 200);
    assert.deepEqual(mixed.body.data.synchronization, {
      is_synchronized: false,
      session_stage: 'FRUITING_INITIATION',
      total_trays: 2,
      updated_trays: 2,
      matching_trays: 1,
    });
    const matched = await update('second', 'PINNING');
    assert.equal(matched.status, 200);
    assert.deepEqual(matched.body.data.synchronization, {
      is_synchronized: true,
      session_stage: 'PINNING',
      total_trays: 2,
      updated_trays: 2,
      matching_trays: 2,
    });
    assert.match(matched.body.message, /Session growth stage updated/);
    const repeated = await update('second', 'PINNING');
    assert.equal(repeated.body.data.synchronization.is_synchronized, true);
    assert.equal(repeated.body.message, 'Tray growth status updated successfully');
    const { rows } = await db.query(`
      SELECT current_stage, progress_percent, start_date::text, expected_harvest_date::text, condition, description
      FROM cultivation_progress ORDER BY progress_id
    `);
    assert.deepEqual(rows, [rows[0], { ...rows[0], current_stage: 'PINNING' }]);
  });

  await t.test('overlapping requests see committed progress and append one stage change', async () => {
    const results = await Promise.all([update('first', 'YOUNG_FRUITING'), update('second', 'YOUNG_FRUITING')]);
    assert.deepEqual(results.map((result) => result.status), [200, 200]);
    const synchronizations = results.map((result) => result.body.data.synchronization);
    assert.deepEqual(synchronizations.map(({ is_synchronized }) => is_synchronized).sort(), [false, true]);
    assert.deepEqual(synchronizations.map(({ session_stage }) => session_stage).sort(), ['PINNING', 'YOUNG_FRUITING']);
    const history = await request('/1/growth-status');
    assert.equal(history.body.data.session_stage, 'YOUNG_FRUITING');
    assert.deepEqual(history.body.data.synchronization, {
      is_synchronized: true, total_trays: 2, updated_trays: 2, matching_trays: 2,
    });
    const { rows } = await db.query('SELECT current_stage FROM cultivation_progress ORDER BY progress_id');
    assert.deepEqual(rows.map(({ current_stage }) => current_stage), ['FRUITING_INITIATION', 'PINNING', 'YOUNG_FRUITING']);
  });

  await t.test('sets harvest readiness automatically after all mature trays pass the existing safety checks', async () => {
    await db.query('UPDATE order_items SET quantity = 2 WHERE order_item_id = 1');
    const firstTrayMature = await update('first', 'MATURATION');
    assert.equal(firstTrayMature.status, 200);
    assert.equal(firstTrayMature.body.data.synchronization.is_synchronized, false);
    assert.equal(firstTrayMature.body.data.harvest_status, 'NOT_READY');

    const issue = await db.query(
      `INSERT INTO cultivation_issues (
         session_tray_id, reported_by, issue_type, title, severity, status
       )
       VALUES (1, 2, 'DISEASE', 'Mold observed', 'LOW', 'OPEN')
       RETURNING issue_id`,
    );
    const blocked = await update('second', 'MATURATION');
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    assert.equal(blocked.body.data.synchronization.is_synchronized, true);
    assert.equal(blocked.body.data.harvest_status, 'NOT_READY');
    assert.equal(blocked.body.data.harvest_ready, false);

    await db.query(
      "UPDATE cultivation_issues SET status = 'RESOLVED' WHERE issue_id = $1",
      [issue.rows[0].issue_id],
    );
    const ready = await update('second', 'MATURATION');
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    assert.equal(ready.body.data.harvest_status, 'HARVEST_READY');
    assert.equal(ready.body.data.harvest_ready, true);
    assert.equal(ready.body.data.harvest_ready_changed, true);
    const session = await db.query(
      `SELECT harvest_status, harvest_ready_by, harvest_ready_at
       FROM cultivation_sessions WHERE session_id = 1`,
    );
    assert.equal(session.rows[0].harvest_status, 'HARVEST_READY');
    assert.equal(session.rows[0].harvest_ready_by, 2);
    assert.ok(session.rows[0].harvest_ready_at);
    const notification = await db.query(
      `SELECT created_by FROM notifications
       WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1
         AND title = 'Mushrooms ready for harvest'
       ORDER BY notification_id DESC LIMIT 1`,
    );
    assert.equal(notification.rows[0].created_by, 2);
  });
});
