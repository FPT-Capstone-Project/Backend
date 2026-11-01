const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

async function setupDatabase() {
  const db = new PGlite();
  await db.exec(`
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
      start_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      harvest_date DATE,
      duration_days INTEGER NOT NULL,
      status TEXT NOT NULL,
      harvest_status TEXT NOT NULL DEFAULT 'NOT_READY'
    );
    CREATE TABLE cultivation_floors (
      floor_id SERIAL PRIMARY KEY,
      floor_number INTEGER NOT NULL DEFAULT 1,
      floor_name TEXT NOT NULL DEFAULT 'Floor 1',
      status TEXT NOT NULL
    );
    CREATE TABLE cultivation_rooms (
      room_id SERIAL PRIMARY KEY,
      room_name TEXT NOT NULL
    );
    CREATE TABLE cultivation_trays (
      tray_id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      floor_id INTEGER NOT NULL,
      tray_code TEXT,
      tray_name TEXT,
      status TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE cultivation_session_trays (
      session_tray_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      tray_id INTEGER NOT NULL,
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE cultivation_inspections (
      inspection_id SERIAL PRIMARY KEY,
      session_tray_id INTEGER NOT NULL,
      inspected_by INTEGER NOT NULL,
      inspection_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      reported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP
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
    INSERT INTO cultivation_session_trays (session_id, tray_id, status)
      VALUES (999, 3, 'ACTIVE');
    INSERT INTO cultivation_sessions (
      order_item_id, mushroom_type_id, duration_days, status
    ) VALUES (2, 1, 20, 'SPAWN_RESTING');
  `);
  return db;
}

function loadModel(db) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/cultivationSession.model');
  const pool = {
    connect: async () => ({
      query: (query, values = []) => db.query(query, values),
      release: () => {},
    }),
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

    const activated = await model.activateForAdmin(1);
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
    }
    const progressHistory = await model.findProgressForAdmin(1);
    assert.deepEqual(
      progressHistory.map((progress) => progress.current_stage),
      ['FRUITING_INITIATION', 'PINNING', 'YOUNG_FRUITING', 'MATURATION'],
    );
    await assert.rejects(
      () => model.createInspectionForAdmin(sessionTrayId, {
        growthStage: 'PINNING',
        growthProgress: 100,
      }, 1),
      { statusCode: 409, message: 'growthStage cannot be earlier than the latest stage' },
    );

    const harvestReady = await model.markHarvestReadyForAdmin(1);
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
