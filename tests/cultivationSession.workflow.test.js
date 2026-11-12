const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

async function setupDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE notifications (user_id INTEGER, notification_type TEXT, title TEXT, message TEXT, reference_type TEXT, reference_id INTEGER);
    CREATE TABLE orders (
      order_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROCESSING',
      payment_status TEXT NOT NULL DEFAULT 'PAID'
    );
    CREATE TABLE order_items (
      order_item_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL
    );
    CREATE TABLE cultivation_sessions (
      session_id SERIAL PRIMARY KEY,
      order_item_id INTEGER NOT NULL,
      mushroom_type_id INTEGER NOT NULL,
      start_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      harvest_date DATE,
      duration_days INTEGER NOT NULL,
      status TEXT NOT NULL,
      harvest_ready_at TIMESTAMPTZ, harvest_ready_by INTEGER,
      harvest_status VARCHAR NOT NULL DEFAULT 'NOT_READY'
    );
    CREATE TABLE cultivation_floors (
      floor_id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL DEFAULT 1,
      floor_number INTEGER NOT NULL DEFAULT 1,
      floor_name TEXT NOT NULL DEFAULT 'Floor 1',
      status TEXT NOT NULL
    );
    CREATE TABLE cultivation_rooms (
      room_id SERIAL PRIMARY KEY,
      room_name TEXT NOT NULL
    );
    CREATE TABLE tray_positions (
      position_id INTEGER PRIMARY KEY, floor_id INTEGER, room_id INTEGER,
      row_number INTEGER, column_number INTEGER, status TEXT DEFAULT 'ACTIVE'
    );
    CREATE TABLE iot_auto_control_configs (
      id SERIAL PRIMARY KEY, floor_id INTEGER, config_source TEXT,
      mushroom_type_id INTEGER, profile_approved BOOLEAN, source_profiles JSONB
    );
    CREATE TABLE cultivation_trays (
      tray_id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      floor_id INTEGER NOT NULL,
      position_id INTEGER,
      tray_code TEXT,
      tray_name TEXT,
      status TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE cultivation_session_trays (
      session_tray_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      tray_id INTEGER NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL
    );
    CREATE TABLE cultivation_progress (
      progress_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      current_stage TEXT NOT NULL,
      progress_percent NUMERIC NOT NULL,
      start_date DATE,
      expected_harvest_date DATE,
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE cultivation_inspections (
      inspection_id SERIAL PRIMARY KEY,
      session_tray_id INTEGER NOT NULL,
      inspected_by INTEGER NOT NULL,
      inspection_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      growth_stage TEXT,
      tray_condition TEXT,
      mushroom_condition TEXT,
      growth_progress NUMERIC,
      notes TEXT
    );
    CREATE TABLE cultivation_issues (
      issue_id SERIAL PRIMARY KEY,
      session_tray_id INTEGER NOT NULL,
      inspection_id INTEGER,
      reported_by INTEGER NOT NULL,
      issue_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      action_taken TEXT,
      next_action TEXT,
      reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMPTZ
    );
    CREATE TABLE harvests (
      harvest_id SERIAL PRIMARY KEY,
      session_tray_id INTEGER
    );

    INSERT INTO orders (user_id) VALUES (2);
    INSERT INTO order_items (order_id, quantity) VALUES (1, 2), (1, 2);
    INSERT INTO cultivation_sessions (
      order_item_id, mushroom_type_id, duration_days, status
    ) VALUES (1, 1, 20, 'READY_FOR_CULTIVATION');
    INSERT INTO cultivation_rooms (room_name) VALUES ('Room 1');
    INSERT INTO cultivation_floors (floor_number, floor_name, status)
      VALUES (1, 'Floor 1', 'ACTIVE'), (2, 'Floor 2', 'ACTIVE'), (3, 'Floor 3', 'INACTIVE');
    INSERT INTO cultivation_trays (room_id, floor_id, tray_code, status)
      VALUES
        (1, 1, 'F1-TRAY-01', 'AVAILABLE'),
        (1, 1, 'F1-TRAY-02', 'AVAILABLE'),
        (1, 1, 'F1-TRAY-03', 'AVAILABLE'),
        (1, 2, 'F2-TRAY-01', 'AVAILABLE'),
        (1, 3, 'F3-TRAY-01', 'AVAILABLE');
    INSERT INTO tray_positions(position_id,floor_id,room_id,row_number,column_number)
      SELECT tray_id,floor_id,room_id,1,tray_id FROM cultivation_trays;
    UPDATE cultivation_trays SET position_id=tray_id;
    INSERT INTO iot_auto_control_configs(floor_id,config_source,profile_approved,source_profiles)
      SELECT floor_id,'FLOOR',true,'[{"mushroom_type_id":1}]'::jsonb FROM cultivation_floors;
    CREATE UNIQUE INDEX uq_active_tray ON cultivation_session_trays(tray_id) WHERE status='ACTIVE';
    INSERT INTO cultivation_session_trays (session_id, tray_id, status)
      VALUES (999, 3, 'ACTIVE');
    INSERT INTO cultivation_sessions (
      order_item_id, mushroom_type_id, duration_days, status
    ) VALUES (2, 1, 20, 'SPAWN_RESTING');
  `);
  await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/018_wf03_growth_condition.sql'), 'utf8'));
  return db;
}

function loadModel(db) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/cultivationSession.model');
  // PGlite has one connection. Queue transactions as a size-one PostgreSQL pool would.
  let tail = Promise.resolve();
  const pool = {
    connect: async () => {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return {
      query: (query, values = []) => db.query(query, values),
      release,
      };
    },
    query: (query, values = []) => db.query(query, values),
  };
  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: pool };
  return require('../src/models/cultivationSession.model');
}

function isConflictOrInputError(error) {
  return [400, 404, 409].includes(error?.statusCode);
}

test('WF-03 lets the Farm Operator assign trays without an approved matching profile', async () => {
  for (const change of [
    'DELETE FROM iot_auto_control_configs',
    'UPDATE iot_auto_control_configs SET profile_approved=false',
    `UPDATE iot_auto_control_configs SET source_profiles='[{"mushroom_type_id":9}]'`,
  ]) {
    const db = await setupDatabase();
    try {
      const model = loadModel(db);
      await db.exec(change);
      const result = await model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1,2] });
      assert.equal(result.status, 'CULTIVATING');
      assert.equal(result.assigned_trays_count, 2);
    } finally { await db.close(); }
  }
});

test('WF-03 rejects invalid positions atomically', async () => {
  const db = await setupDatabase();
  try {
    const model = loadModel(db);
    for (const change of [
      'UPDATE cultivation_trays SET position_id=NULL WHERE tray_id=1',
      "UPDATE tray_positions SET status='INACTIVE' WHERE position_id=1",
      'UPDATE tray_positions SET room_id=2 WHERE position_id=1',
      'UPDATE tray_positions SET floor_id=2 WHERE position_id=1',
    ]) {
      await db.exec(change);
      await assert.rejects(() => model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1,2] }), { code: 'TRAY_POSITION_UNAVAILABLE' });
      assert.equal((await model.findAvailableTraysForAdmin(1)).length, 1);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM cultivation_trays WHERE status='OCCUPIED'")).rows[0].n, 0);
      await db.exec("UPDATE cultivation_trays SET position_id=1 WHERE tray_id=1; UPDATE tray_positions SET status='ACTIVE',room_id=1,floor_id=1 WHERE position_id=1");
    }
  } finally { await db.close(); }
});

test('WF-03 concurrent requests cannot assign the same trays twice with a single-session pool', async () => {
  const db = await setupDatabase();
  try {
    await db.exec("UPDATE cultivation_sessions SET status='READY_FOR_CULTIVATION' WHERE session_id=2");
    const model = loadModel(db);
    const results = await Promise.allSettled([1,2].map(id => model.assignTraysForAdmin(id, { floorId: 1, trayIds: [1,2] })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'TRAY_UNAVAILABLE');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM cultivation_session_trays WHERE tray_id IN (1,2) AND status='ACTIVE'")).rows[0].n, 2);
  } finally { await db.close(); }
});

test('WF-03 assigns only Farm Operator selected trays, activates cultivation, records maturity, and ends harvest-ready', async () => {
  const db = await setupDatabase();
  try {
    const model = loadModel(db);

    const floorOneAvailable = await model.findAvailableTraysForAdmin(1);
    const floorTwoAvailable = await model.findAvailableTraysForAdmin(2);
    const inactiveFloorAvailable = await model.findAvailableTraysForAdmin(3);
    assert.deepEqual(floorOneAvailable.map((tray) => tray.tray_id), [1, 2]);
    assert.deepEqual(floorTwoAvailable.map((tray) => tray.tray_id), [4]);
    assert.deepEqual(inactiveFloorAvailable, []);

    await assert.rejects(
      () => model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1] }),
      isConflictOrInputError,
    );
    await assert.rejects(
      () => model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1, 4] }),
      isConflictOrInputError,
    );
    await assert.rejects(
      () => model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1, 3] }),
      isConflictOrInputError,
    );
    await assert.rejects(
      () => model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1, 999999] }),
      isConflictOrInputError,
    );
    await assert.rejects(
      () => model.assignTraysForAdmin(2, { floorId: 1, trayIds: [1, 2] }),
      isConflictOrInputError,
    );
    assert.equal(
      (await db.query('SELECT COUNT(*)::int AS count FROM cultivation_session_trays WHERE session_id IN (1, 2)'))
        .rows[0].count,
      0,
    );
    assert.deepEqual(
      (await db.query('SELECT status FROM cultivation_trays WHERE tray_id IN (1, 2, 4) ORDER BY tray_id'))
        .rows.map((row) => row.status),
      ['AVAILABLE', 'AVAILABLE', 'AVAILABLE'],
    );

    const assignment = await model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1, 2] });
    assert.equal(assignment.session_id, 1);
    assert.deepEqual(assignment.floor, { floor_id: 1, floor_name: 'Floor 1' });
    assert.equal(assignment.required_trays, 2);
    assert.equal(assignment.assigned_trays_count, 2);
    assert.deepEqual(assignment.assigned_trays.map((tray) => tray.tray_id), [1, 2]);
    assert.deepEqual(assignment.assigned_trays.map((tray) => tray.tray_code), ['F1-TRAY-01', 'F1-TRAY-02']);
    assert.ok(assignment.assigned_trays.every((tray) => tray.status === 'ACTIVE'));
    assert.deepEqual(
      (await db.query('SELECT status FROM cultivation_trays ORDER BY tray_id')).rows.map((row) => row.status),
      ['OCCUPIED', 'OCCUPIED', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE'],
    );
    await db.query("UPDATE cultivation_sessions SET status = 'READY_FOR_CULTIVATION' WHERE session_id = 2");
    await assert.rejects(
      () => model.assignTraysForAdmin(2, { floorId: 1, trayIds: [1, 2] }),
      isConflictOrInputError,
    );
    assert.equal(
      (await db.query('SELECT COUNT(*)::int AS count FROM cultivation_session_trays WHERE session_id = 2')).rows[0].count,
      0,
    );

    const activated = assignment;
    assert.equal(activated.status, 'CULTIVATING');
    assert.equal(activated.harvest_status, 'NOT_READY');
    assert.equal(
      (await db.query('SELECT current_stage FROM cultivation_progress')).rows[0].current_stage,
      'FRUITING_INITIATION',
    );

    const sessionTrayId = assignment.assigned_trays[0].session_tray_id;
    for (const [growthStage, growthProgress] of [
      ['PINNING', 25],
      ['YOUNG_FRUITING', 65],
      ['MATURATION', 100],
    ]) {
      await model.createInspectionForAdmin(sessionTrayId, {
        growthStage,
        growthProgress,
        mushroomCondition: 'NORMAL',
      }, 1);
      await model.updateGrowthForAdmin(1, { currentStage: growthStage, progressPercent: growthProgress, condition: 'NORMAL' });
    }
    const progressHistory = await model.findProgressForAdmin(1);
    assert.deepEqual(
      progressHistory.map((progress) => progress.current_stage),
      ['FRUITING_INITIATION', 'PINNING', 'YOUNG_FRUITING', 'MATURATION'],
    );
    await assert.rejects(
      () => model.updateGrowthForAdmin(1, { currentStage: 'PINNING', progressPercent: 100, condition: 'NORMAL' }),
      { statusCode: 409, message: 'Mature growth cannot move back to growing' },
    );

    const harvestReady = await model.updateHarvestReadinessForAdmin(1, { harvestReady: true, notes: 'Ready after assessment' });
    assert.equal(harvestReady.status, 'CULTIVATING');
    assert.equal(harvestReady.harvest_status, 'HARVEST_READY');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM harvests')).rows[0].count, 0);

    const incident = await model.createIncidentForAdmin(1, {
      sessionTrayId,
      incidentType: 'SLOW_GROWTH',
      title: 'Slow growth',
      description: 'Observed before maturation.',
      severity: 'MEDIUM',
    }, 1);
    assert.equal(incident.issue_type, 'SLOW_GROWTH');
    assert.equal((await model.findIncidentsForAdmin(1)).length, 1);
  } finally {
    await db.close();
  }
});

test('growth history and separate readiness preserve lifecycle rules and atomicity', async () => {
  const db = await setupDatabase();
  try {
    const model = loadModel(db);
    const growing = { currentStage: 'YOUNG_FRUITING', progressPercent: 100, condition: 'NORMAL', notes: 'Growing' };
    await assert.rejects(() => model.updateGrowthForAdmin(1, growing), { code: 'INVALID_SESSION_STATUS' });
    await assert.rejects(() => model.updateHarvestReadinessForAdmin(1, { harvestReady: false }), { code: 'INVALID_SESSION_STATUS' });
    const assignment = await model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1,2] });
    assert.equal(assignment.status, 'CULTIVATING');
    await assert.rejects(() => model.updateHarvestReadinessForAdmin(1, { harvestReady: false }), { code: 'GROWTH_NOT_RECORDED' });
    await model.updateGrowthForAdmin(1, growing);
    assert.equal((await db.query('SELECT status FROM cultivation_sessions WHERE session_id=1')).rows[0].status, 'CULTIVATING');
    await assert.rejects(() => model.updateHarvestReadinessForAdmin(1, { harvestReady: true }), { code: 'HARVEST_NOT_READY' });
    const notReady = await model.updateHarvestReadinessForAdmin(1, { harvestReady: false, notes: 'Wait for size' });
    assert.equal(notReady.status, 'CULTIVATING');
    assert.equal(notReady.harvest_status, 'NOT_READY');
    const history = await model.findProgressForAdmin(1);
    assert.equal(history.at(-1).description, 'Wait for size');
    assert.equal(history.at(-1).condition, 'NORMAL');
    await assert.rejects(() => model.updateGrowthForAdmin(1, { ...growing, progressPercent: 99 }), { statusCode: 409 });
    await model.updateGrowthForAdmin(1, { ...growing, currentStage: 'MATURATION', notes: 'Mature' });
    const beforeInspection = (await model.findProgressForAdmin(1)).length;
    await model.createInspectionForAdmin(assignment.assigned_trays[0].session_tray_id,
      { growthStage: 'MATURATION', growthProgress: 100 }, 1);
    assert.equal((await model.findProgressForAdmin(1)).length, beforeInspection);
    for (const mutation of [
      "UPDATE cultivation_session_trays SET status='RELEASED' WHERE tray_id=1",
      "UPDATE cultivation_trays SET status='AVAILABLE' WHERE tray_id=1",
    ]) {
      await db.exec(mutation);
      await assert.rejects(() => model.updateHarvestReadinessForAdmin(1, { harvestReady: true }), { code: 'TRAYS_NOT_ASSIGNED' });
      assert.equal((await model.findProgressForAdmin(1)).length, beforeInspection);
      await db.exec("UPDATE cultivation_session_trays SET status='ACTIVE' WHERE tray_id=1; UPDATE cultivation_trays SET status='OCCUPIED' WHERE tray_id=1");
    }
    const ready = await model.updateHarvestReadinessForAdmin(1, { harvestReady: true, confirmedBy: 2, notes: 'Quality confirmed' });
    assert.equal(ready.status, 'CULTIVATING');
    assert.equal(ready.harvest_status, 'HARVEST_READY');
    assert.equal(ready.harvest_ready_by, 2);
    assert.ok(ready.harvest_ready_at);
    assert.ok((await db.query('SELECT * FROM notifications')).rows.length > 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM harvests')).rows[0].n, 0);
    assert.equal((await model.findProgressForAdmin(1)).at(-1).description, 'Quality confirmed');
    for (const status of ['READY_FOR_CULTIVATION','HARVEST_READY','HARVESTING','COMPLETED','CANCELLED']) {
      await db.query('UPDATE cultivation_sessions SET status=$1 WHERE session_id=1', [status]);
      await assert.rejects(() => model.updateGrowthForAdmin(1, growing), { code: 'INVALID_SESSION_STATUS' });
      await assert.rejects(() => model.updateHarvestReadinessForAdmin(1, { harvestReady: false }), { code: 'INVALID_SESSION_STATUS' });
    }
    await assert.rejects(() => model.updateGrowthForAdmin(999, growing), { statusCode: 404 });
    await assert.rejects(() => model.updateHarvestReadinessForAdmin(999, { harvestReady: true }), { statusCode: 404 });
  } finally { await db.close(); }
});

test('explicit floor is enforced and assignment failures leave lifecycle untouched', async () => {
  const db = await setupDatabase();
  try {
    const model = loadModel(db);
    await assert.rejects(() => model.assignTraysForAdmin(1, { floorId: 2, trayIds: [1,2] }), { code: 'TRAY_FLOOR_MISMATCH' });
    assert.equal((await db.query('SELECT status FROM cultivation_sessions WHERE session_id=1')).rows[0].status, 'READY_FOR_CULTIVATION');
    assert.equal((await model.findProgressForAdmin(1)).length, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM cultivation_trays WHERE status='OCCUPIED'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('WF-03 forecast history, quality blockers and readiness reassessment', async () => {
  const db = await setupDatabase();
  try {
    const model = loadModel(db);
    const assigned = await model.assignTraysForAdmin(1, { floorId: 1, trayIds: [1,2] });
    const observation = { currentStage: 'MATURATION', progressPercent: 90, condition: 'NORMAL', expectedHarvestDate: '2026-12-15' };
    const updated = await model.updateGrowthForAdmin(1, observation);
    assert.equal(updated.growth_status, 'MATURATION');
    assert.equal(new Date(updated.expected_harvest_date).toISOString().slice(0,10), '2026-12-15');
    assert.equal((await db.query('SELECT harvest_date::text AS date FROM cultivation_sessions WHERE session_id=1')).rows[0].date, '2026-12-15');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 3);
    for (const [issueType, severity] of [['DISEASE','LOW'],['CONTAMINATION','MEDIUM'],['QUALITY_FAILURE','LOW'],['DEVICE_FAILURE','HIGH']]) {
      const issue = await model.createIncidentForAdmin(1, { sessionTrayId: assigned.assigned_trays[0].session_tray_id,
        incidentType: issueType, title: 'Requires assessment', severity }, 2);
      await assert.rejects(() => model.updateHarvestReadinessForAdmin(1, { harvestReady: true, confirmedBy: 2 }), { code: 'UNRESOLVED_QUALITY_ISSUES' });
      assert.equal((await db.query('SELECT harvest_status FROM cultivation_sessions WHERE session_id=1')).rows[0].harvest_status, 'NOT_READY');
      await db.query("UPDATE cultivation_issues SET status='RESOLVED' WHERE issue_id=$1", [issue.issue_id]);
    }
    const ready = await model.updateHarvestReadinessForAdmin(1, { harvestReady: true, confirmedBy: 2 });
    assert.equal(ready.status, 'CULTIVATING');
    assert.equal(ready.harvest_ready_by, 2);
    assert.ok(ready.harvest_ready_at);
    await model.updateGrowthForAdmin(1, observation);
    const reassessment = (await db.query('SELECT harvest_status, harvest_ready_at, harvest_ready_by FROM cultivation_sessions WHERE session_id=1')).rows[0];
    assert.deepEqual(reassessment, { harvest_status: 'NOT_READY', harvest_ready_at: null, harvest_ready_by: null });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 5);
    const history = await model.findProgressForAdmin(1);
    assert.equal(history.length, 4);
    assert.equal(Number(history.at(-1).progress_percent), 90);
  } finally { await db.close(); }
});
