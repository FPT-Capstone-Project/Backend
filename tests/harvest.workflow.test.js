const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const migration = require('node:fs').readFileSync('migrations/037_harvest_workflow_v2.sql', 'utf8');
const pendingDeliveryMigration = require('node:fs').readFileSync('migrations/038_pending_harvest_delivery_confirmation.sql', 'utf8');

function nextPickup(days = 1) {
  const date = new Date(Date.now() + 7 * 3600000);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.toISOString().slice(0, 10)}T09:00:00+07:00`;
}

async function setupDatabase({ migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      user_id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL, address TEXT DEFAULT 'Profile address', phone TEXT, email TEXT,
      role_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE'
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
      end_at TIMESTAMPTZ,
      harvest_ready_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    CREATE TABLE cultivation_progress (
      progress_id SERIAL PRIMARY KEY, session_id INTEGER, current_stage TEXT, updated_at TIMESTAMPTZ
    );
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
      CONSTRAINT chk_harvests_weight_classification CHECK (
        total_weight_kg IS NULL OR usable_weight_kg IS NULL OR rejected_weight_kg IS NULL
        OR usable_weight_kg + rejected_weight_kg = total_weight_kg
      )
    );
    CREATE TABLE shipments (
      shipment_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(order_id),
      address TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      shipping_fee NUMERIC NOT NULL DEFAULT 0,
      carrier TEXT,
      tracking_code TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      shipped_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ
    );
    CREATE TABLE notifications (
      notification_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      reference_type TEXT,
      reference_id INTEGER
    );

    INSERT INTO users (user_id, full_name, phone, role_id, status)
    VALUES
      (1, 'Farm Operator', '0900000001', 2, 'ACTIVE'),
      (2, 'Second Farm Operator', '0900000002', 2, 'ACTIVE'),
      (3, 'Customer', '0900000003', 3, 'ACTIVE'),
      (4, 'Inactive Farm Operator', '0900000004', 2, 'INACTIVE');
    INSERT INTO mushroom_types (mushroom_type_id, name) VALUES (1, 'Oyster Mushroom');
    INSERT INTO orders (order_id, user_id, status) VALUES (1, 3, 'PROCESSING'), (2, 3, 'PROCESSING'), (3, 3, 'PROCESSING');
    INSERT INTO order_items (order_item_id, order_id) VALUES (1, 1), (2, 2), (3, 3), (4, 1);
    INSERT INTO cultivation_sessions (
      session_id, order_item_id, mushroom_type_id, status, harvest_status
    ) VALUES
      (1, 1, 1, 'HARVEST_READY', 'HARVEST_READY'),
      (2, 2, 1, 'HARVEST_READY', 'HARVEST_READY'),
      (3, 3, 1, 'CULTIVATING', 'NOT_READY');
    INSERT INTO cultivation_trays (tray_id, status) VALUES (1, 'OCCUPIED');
    INSERT INTO cultivation_session_trays (session_id, tray_id, status) VALUES (1, 1, 'ACTIVE');
  `);
  await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/029_harvest_request_delivery_address.sql'), 'utf8'));
  if (migrate) await db.exec(migration);
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
  delete require.cache[require.resolve('../src/models/shipment.model')];
  delete require.cache[requestPath];
  delete require.cache[harvestServicePath];
  delete require.cache[require.resolve('../src/services/harvestRequest.service')];
  require.cache[dbPath] = { exports: pool };
  return {
    shipment: require('../src/models/shipment.model'),
    harvest: require('../src/models/harvest.model'),
    harvestRequest: require('../src/models/harvestRequest.model'),
    harvestRequestService: require('../src/services/harvestRequest.service'),
    harvestService: require('../src/services/harvest.service'),
  };
}


test('customer receiving selections and method changes notify all active farm operators', async () => {
  const db = await setupDatabase();
  try {
    const { harvestRequest } = loadModels(db);
    const customer = { user_id: 3, role_id: 3 };
    const request = await harvestRequest.create(1, {
      harvestMethod: 'PICKUP',
      scheduledAt: nextPickup(),
    }, customer);

    const selectedNotifications = (await db.query(
      `SELECT user_id, title, message FROM notifications
       WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1
         AND user_id IN (1, 2, 4)
       ORDER BY user_id`,
    )).rows;
    assert.deepEqual(selectedNotifications.map(({ user_id }) => user_id), [1, 2]);
    assert.equal(selectedNotifications[0].title, 'Khách hàng đã chọn phương thức nhận nấm');
    assert.match(selectedNotifications[0].message, /đến hái tại trang trại/);

    await harvestRequest.update(request.harvest_request_id, {
      harvestMethod: 'PICKUP',
      scheduledAt: nextPickup(2),
    }, customer);
    assert.equal(
      (await db.query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id IN (1, 2, 4)`,
      )).rows[0].count,
      2,
    );

    await harvestRequest.update(request.harvest_request_id, {
      harvestMethod: 'DELIVERY',
    }, customer);

    const operatorNotifications = (await db.query(
      `SELECT user_id, title, message FROM notifications
       WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1
         AND user_id IN (1, 2, 4)
       ORDER BY user_id, notification_id`,
    )).rows;
    assert.equal(operatorNotifications.length, 4);
    assert.deepEqual(operatorNotifications.map(({ user_id }) => user_id), [1, 1, 2, 2]);
    assert.deepEqual(operatorNotifications.map(({ title }) => title), [
      'Khách hàng đã chọn phương thức nhận nấm',
      'Khách hàng đã cập nhật phương thức nhận nấm',
      'Khách hàng đã chọn phương thức nhận nấm',
      'Khách hàng đã cập nhật phương thức nhận nấm',
    ]);
    assert.match(operatorNotifications[1].message, /giao hàng/);
    assert.match(operatorNotifications[3].message, /giao hàng/);
    assert.equal(
      (await db.query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = 3`,
      )).rows[0].count,
      3,
    );
  } finally {
    await db.close();
  }
});

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
        scheduledAt: nextPickup(),
      }, { user_id: 99, role_id: 3 }),
      { statusCode: 403 },
    );

    const request = await harvestRequest.create(1, {
      harvestMethod: 'PICKUP',
      scheduledAt: nextPickup(),
      customerNote: 'Please prepare a basket.',
    }, customer);
    assert.equal(request.status, 'SCHEDULED');
    assert.equal(
      (await db.query(
        `SELECT title FROM notifications
         WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1`,
      )).rows[0].title,
      'Đã ghi nhận yêu cầu khách đến hái',
    );
    await assert.rejects(
      () => harvestRequest.complete(request.harvest_request_id, customer),
      { statusCode: 409, message: 'Harvest must be completed before handover' },
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
    assert.equal(
      (await db.query(
        `SELECT COUNT(*)::int AS count FROM notifications
         WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1
           AND user_id = 3`,
      )).rows[0].count,
      2,
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
    assert.equal(
      (await db.query(
        `SELECT COUNT(*)::int AS count FROM notifications
         WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1
           AND user_id = 3`,
      )).rows[0].count,
      3,
    );
    assert.deepEqual(
      (await db.query(`
        SELECT s.status AS session_status, st.status AS assignment_status, t.status AS tray_status
        FROM cultivation_sessions s
        JOIN cultivation_session_trays st ON st.session_id = s.session_id
        JOIN cultivation_trays t ON t.tray_id = st.tray_id
        WHERE s.session_id = 1
      `)).rows[0],
      { session_status: 'COMPLETED', assignment_status: 'RELEASED', tray_status: 'MAINTENANCE' },
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
    assert.equal(pickupCompleted.confirmed_by, 1);
    assert.equal(
      (await db.query(
        `SELECT notification_type FROM notifications
         WHERE reference_type = 'CULTIVATION_SESSION' AND reference_id = 1
         ORDER BY notification_id DESC LIMIT 1`,
      )).rows[0].notification_type,
      'CULTIVATION_COMPLETED',
    );
    const after = (await db.query(`SELECT s.status, st.status AS assignment_status, t.status AS tray_status
      FROM cultivation_sessions s JOIN cultivation_session_trays st USING(session_id)
      JOIN cultivation_trays t USING(tray_id) WHERE s.session_id=1`)).rows[0];
    assert.deepEqual(after, { status: 'COMPLETED', assignment_status: 'RELEASED', tray_status: 'MAINTENANCE' });
    assert.equal((await db.query('SELECT status FROM orders WHERE order_id = 1')).rows[0].status, 'COMPLETED');
    assert.equal((await harvest.complete(planned.harvest_id, 1)).status, 'COMPLETED');
    assert.equal((await db.query('SELECT * FROM shipments')).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM notifications WHERE notification_type = 'CULTIVATION_COMPLETED'")).rows.length, 1);

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


const customer = { user_id: 3, role_id: 3 };
const operator = { user_id: 1, role_id: 2 };
const delivery = { harvestMethod: 'DELIVERY', deliveryAddress: 'Farm Road 1' };
const weights = { totalWeightKg: 5.2, usableWeightKg: 4.8, rejectedWeightKg: 0.4 };

test('PICKUP uses the Vietnam calendar day of harvest readiness and the actual appointment time', async (t) => {
  const db = await setupDatabase();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-26T03:00:00Z') });
  try {
    const { harvestRequestService } = loadModels(db);
    const pickup = (scheduledAt) => harvestRequestService.createHarvestRequest({
      sessionId: 1, harvestMethod: 'PICKUP', scheduledAt,
    }, customer);
    await db.exec(`
      SET TIME ZONE 'UTC';
      UPDATE cultivation_sessions SET status = 'CULTIVATING', harvest_ready_at = NULL WHERE session_id = 1;
    `);
    await assert.rejects(pickup('2026-11-28T09:00:00+07:00'), {
      statusCode: 409, message: 'Harvest readiness timestamp is missing or invalid',
    });
    await db.exec(`
      UPDATE cultivation_sessions SET harvest_ready_at = NULL WHERE session_id = 2;
      INSERT INTO cultivation_progress (session_id, current_stage, updated_at) VALUES
        (1, 'MATURATION', '2026-11-25T22:30:00Z'),
        (2, 'MATURATION', '2026-11-25T22:30:00Z'), (2, 'MATURATION', '2026-11-26T00:00:00Z');
      INSERT INTO notifications (user_id, notification_type, title, message, reference_type, reference_id, created_at)
      SELECT 3, 'OPERATOR_MESSAGE', 'Mushrooms ready for harvest',
             'Please choose pickup at the farm or external delivery.',
             'CULTIVATION_SESSION', session_id, '2026-11-25T22:30:00Z'
      FROM cultivation_sessions WHERE session_id IN (1, 2);
    `);
    const backfill = require('node:fs').readFileSync('migrations/039_backfill_harvest_ready_at.sql', 'utf8');
    await db.exec(backfill);
    assert.equal((await db.query('SELECT harvest_ready_at FROM cultivation_sessions WHERE session_id = 2')).rows[0].harvest_ready_at, null);

    await assert.rejects(pickup('2026-11-26T09:59:00+07:00'), { statusCode: 400 });
    await assert.rejects(pickup('2026-11-28T06:59:00+07:00'), { statusCode: 400 });
    await assert.rejects(pickup('2026-11-29T17:00:01+07:00'), { statusCode: 400 });
    await assert.rejects(pickup('2026-11-30T07:00:00+07:00'), { statusCode: 400 });

    for (const [input, expected] of [
      ['2026-11-26T10:00:00+07:00', '2026-11-26T03:00:00.000Z'],
      ['2026-11-28T09:00:00+07:00', '2026-11-28T02:00:00.000Z'],
      ['2026-11-28T09:00:00', '2026-11-28T02:00:00.000Z'],
      ['2026-11-29T10:00:00Z', '2026-11-29T10:00:00.000Z'],
    ]) {
      const request = await pickup(input);
      assert.equal(request.scheduled_at.toISOString(), expected);
      await harvestRequestService.cancelHarvestRequest(request.harvest_request_id, customer);
    }
  } finally { await db.close(); }
});

test('migration enforces one session per order on inserts and moves and preserves history', async () => {
  const db = await setupDatabase({ migrate: false });
  try {
    await db.exec("INSERT INTO cultivation_sessions (session_id, order_item_id, mushroom_type_id, status) VALUES (9, 4, 1, 'COMPLETED')");
    await assert.rejects(db.exec(migration), /Order 1 has multiple cultivation sessions/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT * FROM cultivation_sessions')).rows.length, 4);
    await db.exec('INSERT INTO orders (order_id, user_id) VALUES (4, 3); UPDATE order_items SET order_id = 4 WHERE order_item_id = 4');
    await db.exec(`
      UPDATE cultivation_sessions SET status = 'ACTIVE' WHERE session_id = 3;
      ALTER TABLE cultivation_sessions ADD CONSTRAINT chk_session_status CHECK (status IN (
        'PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT', 'READY_FOR_CULTIVATION',
        'CULTIVATING', 'HARVEST_READY', 'HARVESTING', 'COMPLETED', 'CANCELLED'
      )) NOT VALID;
    `);
    await db.exec(migration);
    assert.deepEqual(
      (await db.query('SELECT order_id, status, harvest_status FROM cultivation_sessions WHERE session_id = 3')).rows[0],
      { order_id: 3, status: 'CULTIVATING', harvest_status: 'NOT_READY' },
    );
    await assert.rejects(db.exec("UPDATE cultivation_sessions SET status = 'ACTIVE' WHERE session_id = 3"), { code: '23514' });
    assert.equal((await db.query('SELECT * FROM cultivation_sessions WHERE session_id = 9')).rows[0].order_id, 4);
    await db.exec('INSERT INTO order_items (order_item_id, order_id) VALUES (5, 1)');
    await assert.rejects(db.exec("INSERT INTO cultivation_sessions (session_id, order_item_id, mushroom_type_id, status) VALUES (10, 5, 1, 'PENDING')"), { code: '23505' });
    await assert.rejects(db.exec('UPDATE cultivation_sessions SET order_item_id = 5 WHERE session_id = 2'), { code: '23505' });
    await assert.rejects(db.exec('UPDATE order_items SET order_id = 1 WHERE order_item_id = 2'), { code: '23505' });
    await db.exec('INSERT INTO orders (order_id, user_id) VALUES (5, 3); UPDATE order_items SET order_id = 5 WHERE order_item_id = 2');
    assert.equal((await db.query('SELECT order_id FROM cultivation_sessions WHERE session_id = 2')).rows[0].order_id, 5);
    assert.equal((await db.query('SELECT * FROM cultivation_sessions')).rows.length, 4);
  } finally { await db.close(); }
});

test('request validates ownership, readiness, pickup schedule and address and preserves cancelled history', async () => {
  const db = await setupDatabase();
  try {
    const { harvestRequest, harvestService } = loadModels(db);
    await assert.rejects(harvestRequest.create(1, delivery, operator), { statusCode: 403 });
    await assert.rejects(harvestRequest.create(3, delivery, customer), { statusCode: 409 });
    await assert.rejects(harvestRequest.create(1, { harvestMethod: 'DELIVERY' }, customer), { statusCode: 400 });
    await assert.rejects(harvestRequest.create(1, { harvestMethod: 'PICKUP', scheduledAt: nextPickup(4) }, customer), { statusCode: 400 });

    const first = await harvestRequest.create(1, delivery, customer);
    assert.equal(first.delivery_address, delivery.deliveryAddress);
    await assert.rejects(harvestRequest.create(1, delivery, customer), { statusCode: 409 });
    await assert.rejects(harvestRequest.cancel(first.harvest_request_id, { user_id: 99, role_id: 3 }), { statusCode: 403 });
    assert.equal((await harvestRequest.cancel(first.harvest_request_id, customer)).status, 'CANCELLED');
    await assert.rejects(harvestRequest.cancel(first.harvest_request_id, customer), { statusCode: 409 });
    const second = await harvestRequest.create(1, { harvestMethod: 'PICKUP', scheduledAt: nextPickup() }, customer);
    assert.notEqual(first.harvest_request_id, second.harvest_request_id);
    assert.equal((await db.query('SELECT * FROM shipments')).rows.length, 0);
    await harvestService.createHarvest({ sessionId: 1, ...weights }, 1);
    await assert.rejects(harvestRequest.cancel(second.harvest_request_id, customer), { statusCode: 409 });
    assert.equal((await harvestRequest.findAllForAdmin()).total, 2);
  } finally { await db.close(); }
});

test('combined harvest enforces readiness, request, weights and incident checks and records yield atomically', async () => {
  const db = await setupDatabase();
  try {
    const { harvestService, harvestRequest } = loadModels(db);
    await assert.rejects(harvestService.createHarvest({ sessionId: 3, ...weights }, 1), { statusCode: 409 });
    await assert.rejects(harvestService.createHarvest({ sessionId: 1, ...weights }, 1), { statusCode: 409 });
    await harvestRequest.create(1, { harvestMethod: 'PICKUP', scheduledAt: nextPickup() }, customer);
    await assert.rejects(harvestService.createHarvest({ sessionId: 1, ...weights, rejectedWeightKg: -1 }, 1), { statusCode: 400 });
    await assert.rejects(harvestService.createHarvest({ sessionId: 1, ...weights, totalWeightKg: 10 }, 1), { statusCode: 400 });
    await db.exec("INSERT INTO cultivation_issues (session_tray_id, issue_type, severity, status) VALUES (1, 'DISEASE', 'HIGH', 'OPEN')");
    await assert.rejects(harvestService.createHarvest({ sessionId: 1, ...weights }, 1), /Resolve quality/);
    assert.equal((await db.query('SELECT * FROM harvests')).rows.length, 0);
    await db.exec("UPDATE cultivation_issues SET status = 'RESOLVED'");
    await assert.rejects(harvestService.createHarvest({ sessionId: 1, ...weights, totalWeightKg: 5.2000000001 }, 1), { statusCode: 400 });
    assert.equal((await db.query('SELECT * FROM harvests')).rows.length, 0);
    const harvest = await harvestService.createHarvest({ sessionId: 1, ...weights, qualityGrade: ' a ', notes: 'Good' }, 1);
    assert.equal(harvest.status, 'IN_PROGRESS');
    assert.equal(harvest.harvested_by, 1);
    assert.ok(harvest.harvest_date);
    assert.equal(Number(harvest.total_weight_kg), 5.2);
    assert.equal(harvest.quality_grade, 'A');
    assert.equal(harvest.notes, 'Good');
    assert.equal((await db.query('SELECT status FROM cultivation_sessions WHERE session_id = 1')).rows[0].status, 'HARVESTING');
    assert.equal((await db.query("SELECT * FROM notifications WHERE user_id = 3 AND title = 'Đang thu hoạch nấm'")).rows.length, 1);
    await assert.rejects(harvestService.createHarvest({ sessionId: 1, ...weights }, 1), { statusCode: 409 });
  } finally { await db.close(); }
});

test('delivery shipment creation and customer receipt roll back on failure and are idempotent', async () => {
  const db = await setupDatabase();
  try {
    const { harvest, harvestRequest, harvestService, shipment } = loadModels(db);
    const request = await harvestRequest.create(1, delivery, customer);
    assert.equal((await db.query('SELECT * FROM shipments')).rows.length, 0);
    const started = await harvestService.createHarvest({ sessionId: 1, ...weights }, 1);
    assert.equal((await db.query('SELECT * FROM shipments')).rows.length, 0);
    await db.exec("ALTER TABLE shipments ADD CHECK (address <> 'Farm Road 1')");
    await assert.rejects(harvest.complete(started.harvest_id, 1), { code: '23514' });
    assert.equal((await harvest.findById(started.harvest_id)).status, 'IN_PROGRESS');
    await db.exec('ALTER TABLE shipments DROP CONSTRAINT shipments_address_check');
    await harvest.complete(started.harvest_id, 1);
    await harvest.complete(started.harvest_id, 1);
    const shipments = (await db.query('SELECT * FROM shipments')).rows;
    assert.equal(shipments.length, 1);
    const [{ shipment_id: id, order_id: orderId, harvest_request_id: requestId, status }] = shipments;
    assert.equal(orderId, 1);
    assert.equal(requestId, request.harvest_request_id);
    assert.equal(status, 'PENDING');
    const before = await harvest.findById(started.harvest_id);
    assert.equal(before.cultivation_status, 'HARVESTING');
    assert.equal(before.harvest_request_status, 'PENDING');
    await assert.rejects(harvestRequest.complete(requestId, operator), { statusCode: 409 });
    await assert.rejects(shipment.updateStatus(id, 'DELIVERED', operator), { statusCode: 403 });
    for (const status of ['SHIPPED', 'IN_TRANSIT']) {
      await assert.rejects(shipment.updateStatus(id, status, operator), { statusCode: 409 });
    }
    await assert.rejects(shipment.confirmReceived(id, { user_id: 99, role_id: 3 }), { statusCode: 404 });
    await db.exec("ALTER TABLE cultivation_trays ADD CHECK (status <> 'MAINTENANCE')");
    await assert.rejects(shipment.confirmReceived(id, customer), { code: '23514' });
    const pending = (await db.query('SELECT status, delivered_at FROM shipments')).rows[0];
    assert.deepEqual(pending, { status: 'PENDING', delivered_at: null });
    const rolledBack = await harvest.findById(started.harvest_id);
    assert.equal(rolledBack.harvest_request_status, 'PENDING');
    assert.equal(rolledBack.cultivation_status, 'HARVESTING');
    await db.exec('ALTER TABLE cultivation_trays DROP CONSTRAINT cultivation_trays_status_check');
    const first = await shipment.confirmReceived(id, customer);
    const second = await shipment.confirmReceived(id, customer);
    assert.equal(first.status, 'DELIVERED');
    assert.ok(first.delivered_at);
    assert.equal(first.shipped_at, null);
    assert.deepEqual(first, second);
    const after = await harvest.findById(started.harvest_id);
    assert.equal(after.harvest_request_status, 'COMPLETED');
    assert.equal(after.confirmed_by, 3);
    assert.equal(after.cultivation_status, 'COMPLETED');
    assert.equal((await db.query('SELECT status FROM cultivation_trays')).rows[0].status, 'MAINTENANCE');
    assert.equal((await db.query("SELECT * FROM notifications WHERE notification_type = 'CULTIVATION_COMPLETED'")).rows.length, 1);
  } finally { await db.close(); }
});

test('only pending shipments can be confirmed and migration preserves legacy handoff history', async () => {
  const db = await setupDatabase();
  try {
    const { harvest, harvestRequest, harvestService, shipment } = loadModels(db);
    for (const [sessionId, failure] of [[1, 'CANCELLED'], [2, 'RETURNED']]) {
      await harvestRequest.create(sessionId, delivery, customer);
      const started = await harvestService.createHarvest({ sessionId, ...weights }, 1);
      await harvest.complete(started.harvest_id, 1);
      const [{ shipment_id: id }] = (await db.query('SELECT shipment_id FROM shipments WHERE order_id = $1', [sessionId])).rows;
      const legacyStatus = sessionId === 1 ? 'SHIPPED' : 'IN_TRANSIT';
      const handoff = '2026-11-01T08:00:00.000Z';
      await db.query('UPDATE shipments SET status = $2, shipped_at = $3 WHERE shipment_id = $1', [id, legacyStatus, handoff]);
      await assert.rejects(shipment.confirmReceived(id, customer), { statusCode: 409 });
      await db.exec(pendingDeliveryMigration);
      const { rows: [migrated] } = await db.query('SELECT status, shipped_at FROM shipments WHERE shipment_id = $1', [id]);
      assert.equal(migrated.status, 'PENDING');
      assert.equal(migrated.shipped_at.toISOString(), handoff);
      await shipment.updateStatus(id, failure, operator);
      await assert.rejects(shipment.confirmReceived(id, customer), { statusCode: 409 });
      const waiting = await harvest.findById(started.harvest_id);
      assert.equal(waiting.harvest_request_status, 'PENDING');
      assert.equal(waiting.cultivation_status, 'HARVESTING');
    }
    assert.deepEqual((await db.query('SELECT status FROM shipments ORDER BY order_id')).rows, [
      { status: 'CANCELLED' }, { status: 'RETURNED' },
    ]);
  } finally { await db.close(); }
});
