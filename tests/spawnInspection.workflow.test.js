const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('timestamp repair restores report and image inserts on existing tables', async () => {
  const db = await setupWorkflowDatabase();
  try {
    await db.exec(`
      ALTER TABLE spawn_inspections ALTER COLUMN inspected_at DROP DEFAULT,
        ALTER COLUMN created_at DROP DEFAULT;
      ALTER TABLE spawn_inspection_images ALTER COLUMN created_at DROP DEFAULT;
    `);
    const insert = `INSERT INTO spawn_inspections
      (session_id, inspected_by, stage, total_checked, normal_quantity, condition)
      VALUES (1, 1, 'RESTING', 3, 3, 'NORMAL') RETURNING *`;
    await assert.rejects(() => db.query(insert), { code: '23502' });
    const migration = readFileSync(path.join(__dirname,
      '../migrations/026_restore_spawn_inspection_timestamp_defaults.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const report = (await db.query(insert)).rows[0];
    assert.ok(report.inspected_at);
    assert.ok(report.created_at);
    const image = (await db.query(`INSERT INTO spawn_inspection_images
      (inspection_id, image_url) VALUES ($1, $2) RETURNING *`,
    [report.inspection_id, 'https://example.test/spawn.jpg'])).rows[0];
    assert.ok(image.created_at);
  } finally {
    await db.close();
  }
});

async function setupWorkflowDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      user_id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL
    );
    CREATE TABLE orders (
      order_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      payment_status TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROCESSING'
    );
    CREATE TABLE notifications (
      notification_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      reference_type TEXT,
      reference_id INTEGER
    );
    CREATE TABLE harvest_requests (
      harvest_request_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL UNIQUE,
      harvest_method TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ
    );
    CREATE TABLE mushroom_types (
      mushroom_type_id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE order_items (
      order_item_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      mushroom_type_id INTEGER NOT NULL
    );
    CREATE TABLE cultivation_sessions (
      session_id SERIAL PRIMARY KEY,
      order_item_id INTEGER NOT NULL,
      mushroom_type_id INTEGER NOT NULL,
      status VARCHAR NOT NULL CHECK (status IN (
        'PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT',
        'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVESTING',
        'COMPLETED', 'CANCELLED'
      )),
      harvest_status VARCHAR NOT NULL DEFAULT 'NOT_READY',
      start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      harvest_date DATE,
      duration_days INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE inventory_transactions (
      transaction_id SERIAL PRIMARY KEY,
      inventory_id INTEGER NOT NULL,
      session_id INTEGER,
      transaction_type TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      quantity_before NUMERIC NOT NULL,
      quantity_after NUMERIC NOT NULL,
      notes TEXT
    );
    CREATE TABLE spawn_inventory (
      inventory_id SERIAL PRIMARY KEY,
      mushroom_type_id INTEGER NOT NULL,
      quantity NUMERIC NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE spawn_inspections (
      inspection_id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL,
      inspected_by BIGINT NOT NULL,
      stage VARCHAR(50) NOT NULL,
      total_checked INTEGER NOT NULL,
      normal_quantity INTEGER NOT NULL DEFAULT 0,
      warning_quantity INTEGER NOT NULL DEFAULT 0,
      abnormal_quantity INTEGER NOT NULL DEFAULT 0,
      condition VARCHAR(30) NOT NULL,
      notes TEXT,
      replacement_quantity INTEGER NOT NULL DEFAULT 0,
      next_check_at TIMESTAMPTZ,
      inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (total_checked > 0),
      CHECK (normal_quantity + warning_quantity + abnormal_quantity = total_checked),
      CHECK (replacement_quantity <= abnormal_quantity)
    );
    CREATE TABLE spawn_inspection_images (
      image_id BIGSERIAL PRIMARY KEY,
      inspection_id BIGINT NOT NULL,
      image_url TEXT NOT NULL,
      caption TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE cultivation_progress (
      progress_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      current_stage TEXT NOT NULL,
      progress_percent NUMERIC NOT NULL,
      start_date DATE,
      expected_harvest_date DATE,
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE cultivation_floors (
      floor_id SERIAL PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE cultivation_trays (
      tray_id SERIAL PRIMARY KEY,
      floor_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE cultivation_session_trays (
      session_tray_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      tray_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE tray_reservations (
      reservation_id SERIAL PRIMARY KEY,
      order_item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    INSERT INTO users (full_name, email) VALUES ('Farm Operator', 'fo@example.test');
    INSERT INTO users (full_name, email) VALUES ('Customer', 'customer@example.test');
    INSERT INTO orders (user_id, payment_status) VALUES (2, 'PAID');
    INSERT INTO mushroom_types (name) VALUES ('Oyster');
    INSERT INTO order_items (order_id, quantity, mushroom_type_id) VALUES (1, 2, 1);
    INSERT INTO cultivation_sessions (order_item_id, mushroom_type_id, status, harvest_date)
      VALUES (1, 1, 'PENDING', CURRENT_DATE + 20);
    INSERT INTO inventory_transactions (
      inventory_id, session_id, transaction_type, quantity, quantity_before, quantity_after
    ) VALUES (1, 1, 'OUT', 6, 20, 14);
    INSERT INTO spawn_inventory (mushroom_type_id, quantity) VALUES (1, 8);
    INSERT INTO cultivation_floors (status) VALUES ('ACTIVE');
    INSERT INTO cultivation_trays (floor_id, status) VALUES (1, 'AVAILABLE'), (1, 'AVAILABLE');
  `);
  return db;
}

function loadModel(db) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/spawnInspection.model');
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
  return require('../src/models/spawnInspection.model');
}

test('farm workflow qualifies spawn without assigning trays or activating cultivation', async () => {
  const db = await setupWorkflowDatabase();
  try {
    const model = loadModel(db);
    assert.equal((await model.findAllForFarm()).length, 1);
    assert.equal((await model.findByIdForFarm(1)).spawn_quantity, 6);

    const restingStage = await model.changeStage(1, 'SPAWN_RESTING');
    assert.equal(restingStage.session_id, 1);
    assert.equal(restingStage.status, 'SPAWN_RESTING');
    const restingInspection = await model.createInspection(1, 1, {
      totalChecked: 6,
      normalQuantity: 4,
      warningQuantity: 1,
      abnormalQuantity: 1,
      condition: 'ABNORMAL',
      notes: 'One spawn unit requires replacement',
    });
    assert.equal(restingInspection.stage, 'RESTING');
    const replacement = await model.replaceAbnormalSpawn(restingInspection.inspection_id, 1);
    assert.equal(replacement.replacement_quantity, 1);
    await model.createImage(restingInspection.inspection_id, 'https://images.example.test/spawn.jpg', 'Day 1');
    assert.equal(Number((await db.query('SELECT quantity FROM spawn_inventory')).rows[0].quantity), 7);
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM inventory_transactions WHERE transaction_type = 'OUT'")).rows[0].count, 2);

    await model.createInspection(1, 1, {
      totalChecked: 6,
      normalQuantity: 6,
      warningQuantity: 0,
      abnormalQuantity: 0,
      condition: 'NORMAL',
    });
    await model.changeStage(1, 'READY_FOR_CULTIVATION');
    const session = await db.query('SELECT status FROM cultivation_sessions WHERE session_id = 1');
    const statusNotifications = await db.query(
      `SELECT title FROM notifications
       WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1
       ORDER BY notification_id`,
    );
    const trays = await db.query("SELECT status FROM cultivation_trays ORDER BY tray_id");
    const assignments = await db.query('SELECT COUNT(*)::int AS count FROM cultivation_session_trays');
    const progress = await db.query(
      'SELECT current_stage FROM cultivation_progress ORDER BY progress_id',
    );
    assert.equal(session.rows[0].status, 'READY_FOR_CULTIVATION');
    assert.deepEqual(statusNotifications.rows.map((row) => row.title), [
      'Phôi nấm đang được ủ',
      'Phôi nấm đã sẵn sàng',
    ]);
    assert.deepEqual(trays.rows.map((row) => row.status), ['AVAILABLE', 'AVAILABLE']);
    assert.equal(assignments.rows[0].count, 0);
    assert.deepEqual(progress.rows.map((row) => row.current_stage), [
      'SPAWN_RESTING',
      'READY_FOR_CULTIVATION',
    ]);

    const customerSessions = await model.findCustomerSessions(1, 2);
    const customerProgress = await model.findCustomerProgress(1, 2);
    const customerInspections = await model.findCustomerInspections(1, 2);
    assert.equal(customerSessions[0].status, 'READY_FOR_CULTIVATION');
    assert.equal(customerSessions[0].harvest_status, 'NOT_READY');
    assert.equal(customerSessions[0].current_stage, 'READY_FOR_CULTIVATION');
    assert.deepEqual(customerSessions[0].assigned_trays, []);
    assert.equal(customerSessions[0].spawn_quantity, 6);
    assert.equal(customerProgress.length, 2);
    assert.equal(customerInspections.length, 2);
    assert.deepEqual(customerInspections[1].images.map((image) => image.image_url), [
      'https://images.example.test/spawn.jpg',
    ]);
    assert.equal((await model.findCustomerSessions(1, 99, true)).length, 1);
    assert.equal((await model.findCustomerProgress(1, 99, true)).length, 2);
    assert.equal((await model.findCustomerInspections(1, 99, undefined, true)).length, 2);
    assert.equal((await model.findCustomerInspections(1, 99, 1, true)).length, 1);
    await assert.rejects(
      () => model.findCustomerSessions(1, 99),
      { statusCode: 404 },
    );
    await assert.rejects(
      () => model.findCustomerProgress(1, 99),
      { statusCode: 404 },
    );
    await assert.rejects(
      () => model.findCustomerInspections(1, 99),
      { statusCode: 404 },
    );
    await assert.rejects(
      () => model.changeStage(1, 'CULTIVATING'),
      { statusCode: 409 },
    );
  } finally {
    await db.close();
  }
});

test('new two-spawn trays require inspection of exactly the allocated spawn', async () => {
  const db = await setupWorkflowDatabase();
  try {
    await db.exec("UPDATE inventory_transactions SET quantity = 4, quantity_after = 16");
    const model = loadModel(db);
    assert.equal((await model.findByIdForFarm(1)).spawn_quantity, 4);
    assert.equal((await model.findAllForFarm())[0].spawn_quantity, 4);
    await model.changeStage(1, 'MYCELIAL_DEVELOPMENT');
    await assert.rejects(() => model.createInspection(1, 1, {
      totalChecked: 6, normalQuantity: 6, warningQuantity: 0,
      abnormalQuantity: 0, condition: 'NORMAL',
    }), { statusCode: 400 });
    await model.createInspection(1, 1, {
      totalChecked: 4, normalQuantity: 4, warningQuantity: 0,
      abnormalQuantity: 0, condition: 'NORMAL',
    });
    assert.equal((await model.changeStage(1, 'READY_FOR_CULTIVATION')).status, 'READY_FOR_CULTIVATION');
  } finally {
    await db.close();
  }
});

test('combined resting/incubation requires a complete NORMAL inspection before readiness', async () => {
  const db = await setupWorkflowDatabase();
  try {
    const model = loadModel(db);
    await assert.rejects(
      () => model.changeStage(1, 'READY_FOR_CULTIVATION'),
      { statusCode: 409 },
    );
    // Existing MYCELIAL_DEVELOPMENT value can also start the combined phase directly.
    await model.changeStage(1, 'MYCELIAL_DEVELOPMENT');
    await assert.rejects(
      () => model.changeStage(1, 'READY_FOR_CULTIVATION'),
      { statusCode: 409 },
    );
    await model.createInspection(1, 1, {
      totalChecked: 3,
      normalQuantity: 3,
      warningQuantity: 0,
      abnormalQuantity: 0,
      condition: 'NORMAL',
    });
    await assert.rejects(
      () => model.changeStage(1, 'READY_FOR_CULTIVATION'),
      { statusCode: 409 },
    );
    await model.createInspection(1, 1, {
      totalChecked: 6, normalQuantity: 5, warningQuantity: 1,
      abnormalQuantity: 0, condition: 'WARNING',
    });
    await assert.rejects(() => model.changeStage(1, 'READY_FOR_CULTIVATION'), { statusCode: 409 });
    await model.createInspection(1, 1, {
      totalChecked: 6, normalQuantity: 6, warningQuantity: 0,
      abnormalQuantity: 0, condition: 'NORMAL',
    });
    assert.equal((await model.changeStage(1, 'READY_FOR_CULTIVATION')).status, 'READY_FOR_CULTIVATION');
  } finally {
    await db.close();
  }
});
