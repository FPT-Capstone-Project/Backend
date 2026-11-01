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
    INSERT INTO order_items (order_id, quantity) VALUES (1, 2);
    INSERT INTO cultivation_sessions (
      order_item_id, mushroom_type_id, duration_days, status
    ) VALUES (1, 1, 20, 'READY_FOR_CULTIVATION');
    INSERT INTO cultivation_rooms (room_name) VALUES ('Room 1');
    INSERT INTO cultivation_floors (status) VALUES ('ACTIVE');
    INSERT INTO cultivation_trays (room_id, floor_id, tray_code, status)
      VALUES (1, 1, 'T-01', 'AVAILABLE'), (1, 1, 'T-02', 'AVAILABLE'), (1, 1, 'T-03', 'AVAILABLE');
    INSERT INTO cultivation_session_trays (session_id, tray_id, status)
      VALUES (999, 3, 'ACTIVE');
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

test('WF-03 assigns trays, activates cultivation, records maturity, and ends harvest-ready', async () => {
  const db = await setupDatabase();
  try {
    const model = loadModel(db);

    const availableBeforeAssignment = await model.findAvailableTraysForAdmin();
    assert.deepEqual(availableBeforeAssignment.map((tray) => tray.tray_id), [1, 2]);

    const assignment = await model.assignTraysForAdmin(1);
    assert.equal(assignment.assignedTrays.length, 2);
    assert.deepEqual(
      (await db.query('SELECT status FROM cultivation_trays ORDER BY tray_id')).rows.map((row) => row.status),
      ['OCCUPIED', 'OCCUPIED', 'AVAILABLE'],
    );
    await assert.rejects(
      () => model.assignTraysForAdmin(1),
      { statusCode: 409, code: 'TRAYS_ALREADY_ASSIGNED' },
    );

    const activated = await model.activateForAdmin(1);
    assert.equal(activated.status, 'CULTIVATING');
    assert.equal(activated.harvest_status, 'NOT_READY');
    assert.equal(
      (await db.query('SELECT current_stage FROM cultivation_progress')).rows[0].current_stage,
      'FRUITING_INITIATION',
    );

    const sessionTrayId = assignment.assignedTrays[0].session_tray_id;
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
