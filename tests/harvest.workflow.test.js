const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

async function setupDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      user_id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL
    );
    CREATE TABLE mushroom_types (
      mushroom_type_id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE orders (
      order_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id),
      status TEXT NOT NULL DEFAULT 'PROCESSING'
    );
    CREATE TABLE order_items (
      order_item_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(order_id)
    );
    CREATE TABLE cultivation_sessions (
      session_id SERIAL PRIMARY KEY,
      order_item_id INTEGER NOT NULL REFERENCES order_items(order_item_id),
      mushroom_type_id INTEGER NOT NULL REFERENCES mushroom_types(mushroom_type_id),
      status TEXT NOT NULL,
      harvest_status TEXT NOT NULL DEFAULT 'NOT_READY',
      end_at TIMESTAMPTZ
    );
    CREATE TABLE cultivation_trays (
      tray_id SERIAL PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE cultivation_session_trays (
      session_tray_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES cultivation_sessions(session_id),
      tray_id INTEGER NOT NULL REFERENCES cultivation_trays(tray_id),
      notes TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE cultivation_issues (issue_id SERIAL PRIMARY KEY, session_tray_id INTEGER, issue_type TEXT, severity TEXT, status TEXT);
    CREATE TABLE harvest_requests (
      harvest_request_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL UNIQUE REFERENCES cultivation_sessions(session_id),
      harvest_method TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'PENDING',
      customer_note TEXT,
      confirmed_at TIMESTAMPTZ,
      confirmed_by INTEGER REFERENCES users(user_id),
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE harvests (
      harvest_id SERIAL PRIMARY KEY,
      session_id INTEGER UNIQUE REFERENCES cultivation_sessions(session_id),
      harvest_request_id INTEGER REFERENCES harvest_requests(harvest_request_id),
      session_tray_id INTEGER,
      harvested_by INTEGER REFERENCES users(user_id),
      harvest_date DATE,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      total_weight_kg NUMERIC CHECK (total_weight_kg IS NULL OR total_weight_kg >= 0),
      usable_weight_kg NUMERIC CHECK (usable_weight_kg IS NULL OR usable_weight_kg >= 0),
      rejected_weight_kg NUMERIC CHECK (rejected_weight_kg IS NULL OR rejected_weight_kg >= 0),
      quality_grade TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        total_weight_kg IS NULL OR usable_weight_kg IS NULL OR rejected_weight_kg IS NULL
        OR usable_weight_kg + rejected_weight_kg = total_weight_kg
      )
    );
    CREATE TABLE shipments (
      shipment_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(order_id),
      status TEXT NOT NULL
    );

    INSERT INTO users (user_id, full_name) VALUES (1, 'Farm Operator'), (3, 'Customer');
    INSERT INTO mushroom_types (mushroom_type_id, name) VALUES (1, 'Oyster Mushroom');
    INSERT INTO orders (order_id, user_id, status) VALUES (1, 3, 'PROCESSING');
    INSERT INTO order_items (order_item_id, order_id) VALUES (1, 1), (2, 1), (3, 1);
    INSERT INTO cultivation_sessions (
      session_id, order_item_id, mushroom_type_id, status, harvest_status
    ) VALUES
      (1, 1, 1, 'HARVEST_READY', 'HARVEST_READY'),
      (2, 2, 1, 'HARVEST_READY', 'HARVEST_READY'),
      (3, 3, 1, 'CULTIVATING', 'NOT_READY');
    INSERT INTO cultivation_trays (tray_id, status) VALUES (1, 'OCCUPIED');
    INSERT INTO cultivation_session_trays (session_id, tray_id, status) VALUES (1, 1, 'ACTIVE');
  `);
  return db;
}

function loadModels(db) {
  const dbPath = require.resolve('../src/config/db');
  const harvestPath = require.resolve('../src/models/harvest.model');
  const requestPath = require.resolve('../src/models/harvestRequest.model');
  const harvestServicePath = require.resolve('../src/services/harvest.service');
  const pool = {
    connect: async () => ({
      query: (query, values = []) => db.query(query, values),
      release: () => {},
    }),
    query: (query, values = []) => db.query(query, values),
  };

  delete require.cache[dbPath];
  delete require.cache[harvestPath];
  delete require.cache[requestPath];
  delete require.cache[harvestServicePath];
  require.cache[dbPath] = { exports: pool };
  return {
    harvest: require('../src/models/harvest.model'),
    harvestRequest: require('../src/models/harvestRequest.model'),
    harvestService: require('../src/services/harvest.service'),
  };
}

async function completeHarvest(harvest, harvestId) {
  await harvest.start(harvestId, 1);
  await harvest.recordYield(harvestId, {
    totalWeightKg: 5.2,
    usableWeightKg: 4.8,
    rejectedWeightKg: 0.4,
    qualityGrade: 'A',
    notes: 'Even development.',
  }, 1);
  return harvest.complete(harvestId, 1);
}

test('WF-04 creates one harvest, records yield, completes the session, and preserves trays for WF-05', async () => {
  const db = await setupDatabase();
  try {
    const { harvest, harvestRequest, harvestService } = loadModels(db);
    const customer = { user_id: 3, role_id: 3 };

    await assert.rejects(
      () => harvest.create(3),
      { statusCode: 409, message: 'Cultivation session must be harvest ready before creating a harvest' },
    );
    await assert.rejects(
      () => harvestRequest.create(1, {
        harvestMethod: 'PICKUP',
        scheduledAt: '2026-10-26T09:00:00+07:00',
      }, { user_id: 99, role_id: 3 }),
      { statusCode: 403 },
    );

    const request = await harvestRequest.create(1, {
      harvestMethod: 'PICKUP',
      scheduledAt: '2026-10-26T09:00:00+07:00',
      customerNote: 'Please prepare a basket.',
    }, customer);
    assert.equal(request.status, 'SCHEDULED');
    await assert.rejects(
      () => harvestRequest.complete(request.harvest_request_id, customer),
      { statusCode: 409, message: 'Harvest must be completed before receiving can be completed' },
    );

    const planned = await harvest.create(1);
    assert.equal(planned.status, 'PLANNED');
    assert.equal(planned.session_id, 1);
    await assert.rejects(() => harvest.create(1), { statusCode: 409 });

    const started = await harvest.start(planned.harvest_id, 1);
    assert.equal(started.status, 'IN_PROGRESS');
    assert.equal(
      (await db.query('SELECT status FROM cultivation_sessions WHERE session_id = 1')).rows[0].status,
      'HARVESTING',
    );
    await assert.rejects(() => harvest.start(planned.harvest_id, 1), { statusCode: 409 });
    await assert.rejects(() => harvest.complete(planned.harvest_id, 1), {
      statusCode: 409,
      message: 'Actual yield must be recorded before completing a harvest',
    });
    await assert.rejects(
      () => harvestService.recordYield(planned.harvest_id, {
        totalWeightKg: 2,
        usableWeightKg: 1.5,
        rejectedWeightKg: 0.1,
      }, 1),
      { statusCode: 400, message: 'usableWeightKg and rejectedWeightKg must equal totalWeightKg' },
    );

    await harvest.recordYield(planned.harvest_id, {
      totalWeightKg: 5.2,
      usableWeightKg: 4.8,
      rejectedWeightKg: 0.4,
      qualityGrade: 'A',
      notes: 'Even development.',
    }, 1);
    const completed = await harvest.complete(planned.harvest_id, 1);
    assert.equal(completed.status, 'COMPLETED');
    assert.deepEqual(
      (await db.query(`
        SELECT s.status AS session_status, st.status AS assignment_status, t.status AS tray_status
        FROM cultivation_sessions s
        JOIN cultivation_session_trays st ON st.session_id = s.session_id
        JOIN cultivation_trays t ON t.tray_id = st.tray_id
        WHERE s.session_id = 1
      `)).rows[0],
      { session_status: 'HARVESTING', assignment_status: 'ACTIVE', tray_status: 'OCCUPIED' },
    );
    await assert.rejects(
      () => harvest.recordYield(planned.harvest_id, {
        totalWeightKg: 5.2,
        usableWeightKg: 4.8,
        rejectedWeightKg: 0.4,
      }, 1),
      { statusCode: 409 },
    );

    const pickupCompleted = await harvestRequest.complete(request.harvest_request_id, customer);
    assert.equal(pickupCompleted.status, 'COMPLETED');
    assert.equal(pickupCompleted.confirmed_by, 3);
    const after = (await db.query(`SELECT s.status, st.status AS assignment_status, t.status AS tray_status
      FROM cultivation_sessions s JOIN cultivation_session_trays st USING(session_id)
      JOIN cultivation_trays t USING(tray_id) WHERE s.session_id=1`)).rows[0];
    assert.deepEqual(after, { status: 'COMPLETED', assignment_status: 'RELEASED', tray_status: 'MAINTENANCE' });
    await assert.rejects(() => harvestRequest.complete(request.harvest_request_id, customer), { statusCode: 409 });

    const detail = await harvest.findById(planned.harvest_id);
    assert.equal(detail.order_code, 'ORD-1');
    assert.equal(detail.mushroom_type, 'Oyster Mushroom');
    assert.equal(detail.harvest_method, 'PICKUP');
    assert.equal(detail.customer_note, 'Please prepare a basket.');
    assert.equal(Number(detail.total_weight_kg), 5.2);
    const list = await harvest.findAllForAdmin({ status: 'COMPLETED', orderId: 1 });
    assert.equal(list.total, 1);
    assert.equal(list.harvests[0].harvest_id, planned.harvest_id);
    const history = await harvest.findOrderHistory(1);
    assert.equal(history.order_code, 'ORD-1');
    assert.equal(history.harvests[0].harvest.status, 'COMPLETED');
    assert.equal(Number(history.harvests[0].harvest.usable_weight_kg), 4.8);
  } finally {
    await db.close();
  }
});

test('WF-04 external delivery is confirmed by staff without any shipment', async () => {
  const db = await setupDatabase();
  try {
    const { harvest, harvestRequest } = loadModels(db);
    const customer = { user_id: 3, role_id: 3 };
    const operator = { user_id: 1, role_id: 1 };

    const request = await harvestRequest.create(2, { harvestMethod: 'DELIVERY' }, customer);
    assert.equal(request.status, 'PENDING');
    const planned = await harvest.create(2);
    await completeHarvest(harvest, planned.harvest_id);

    await assert.rejects(() => harvestRequest.complete(request.harvest_request_id, customer),
      { statusCode: 403, message: 'Farm Operator must confirm external delivery' });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM shipments')).rows[0].n, 0);
    const completed = await harvestRequest.complete(request.harvest_request_id, operator);
    assert.equal(completed.status, 'COMPLETED');
    assert.ok(completed.completed_at);
    assert.equal(completed.confirmed_by, 1);
  } finally {
    await db.close();
  }
});

test('WF-04 start requires receiving choice, pickup schedule and resolved quality issues', async () => {
  const db = await setupDatabase();
  try {
    const { harvest, harvestRequest } = loadModels(db);
    const planned = await harvest.create(1);
    await assert.rejects(() => harvest.start(planned.harvest_id, 1), { statusCode: 409 });
    assert.equal((await db.query('SELECT status FROM harvests WHERE harvest_id=$1', [planned.harvest_id])).rows[0].status, 'PLANNED');
    const request = await harvestRequest.create(1, { harvestMethod: 'PICKUP' }, { user_id: 3, role_id: 3 });
    await assert.rejects(() => harvest.start(planned.harvest_id, 1), { statusCode: 409 });
    await harvestRequest.update(request.harvest_request_id, { harvestMethod: 'PICKUP', scheduledAt: '2026-12-15T09:00:00+07:00' }, { user_id: 3, role_id: 3 });
    await db.exec("INSERT INTO cultivation_issues(session_tray_id, issue_type, severity, status) VALUES (1, 'DISEASE', 'LOW', 'OPEN')");
    await assert.rejects(() => harvest.start(planned.harvest_id, 1), { statusCode: 409 });
    await db.exec("UPDATE cultivation_issues SET status='RESOLVED'");
    await completeHarvest(harvest, planned.harvest_id);
    await assert.rejects(() => harvestRequest.complete(request.harvest_request_id, { user_id: 99, role_id: 3 }), { statusCode: 403 });
    const completed = await harvestRequest.complete(request.harvest_request_id, { user_id: 1, role_id: 2 });
    assert.equal(completed.confirmed_by, 1);
    assert.ok(completed.confirmed_at);
    assert.equal((await db.query('SELECT status FROM cultivation_trays WHERE tray_id=1')).rows[0].status, 'MAINTENANCE');
  } finally { await db.close(); }
});
