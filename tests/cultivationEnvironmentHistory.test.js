const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('aggregates valid, non-retained IoT readings by session and floor for a 10-minute period', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/cultivationEnvironmentHistory.model');
  const previousDb = require.cache[dbPath];
  const previousModel = require.cache[modelPath];
  require.cache[dbPath] = { exports: { query: (...args) => db.query(...args) } };
  delete require.cache[modelPath];

  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8'));
    await db.exec(fs.readFileSync(
      path.join(__dirname, '../migrations/021_cultivation_environment_history.sql'),
      'utf8',
    ));
    await db.exec(`
      INSERT INTO roles (role_id, role_name) VALUES (3, 'Customer');
      INSERT INTO users (role_id, email, password_hash, full_name)
        VALUES (3, 'env-history@example.com', 'hash', 'Environment Test');
      INSERT INTO mushroom_types (name, growing_days) VALUES ('Test mushroom', 30);
      INSERT INTO orders (user_id) VALUES (1);
      INSERT INTO order_items (order_id, mushroom_type_id, unit_price, total_price)
        VALUES (1, 1, 10, 10);
      INSERT INTO cultivation_rooms (room_code, room_name) VALUES ('ENV', 'Environment Room');
      INSERT INTO iot_masters (master_identifier) VALUES ('env-master');
      INSERT INTO cultivation_floors
        (room_id, floor_number, floor_name, master_id, node_address, misting_ssr_channel)
        VALUES (1, 1, 'Environment Floor', 1, 1, 1);
      INSERT INTO cultivation_trays (room_id, tray_code, floor_id, status)
        VALUES (1, 'ENV-TRAY', 1, 'OCCUPIED');
      INSERT INTO cultivation_sessions (mushroom_type_id, start_at, order_item_id, status)
        VALUES (1, '2026-01-01 09:00:00', 1, 'CULTIVATING');
      INSERT INTO cultivation_session_trays (session_id, tray_id, assigned_at)
        VALUES (1, 1, '2026-01-01 09:00:00');
      INSERT INTO cultivation_progress (session_id, current_stage, updated_at)
        VALUES (1, 'PINNING', '2026-01-01 09:30:00');
      INSERT INTO iot_sensor_readings
        (master_id, node_address, sensor_address, temperature, humidity, is_valid, received_at)
      VALUES
        (1, 1, 1, 24, 80, TRUE, '2026-01-01 10:01:00+00'),
        (1, 1, 1, 26, 82, TRUE, '2026-01-01 10:02:00+00'),
        (1, 1, 1, 26, 82, TRUE, '2026-01-01 10:03:00+00'),
        (1, 1, 2, 30, 86, TRUE, '2026-01-01 10:06:00+00'),
        (1, 1, 3, 28, NULL, TRUE, '2026-01-01 10:07:00+00'),
        (1, 1, 1, 100, 100, FALSE, '2026-01-01 10:08:00+00'),
        (1, 1, 2, 100, 100, TRUE, '2026-01-01 10:09:00+00');
      UPDATE iot_sensor_readings SET retained = TRUE WHERE id = 7;
    `);

    const model = require('../src/models/cultivationEnvironmentHistory.model');
    const periodStart = new Date('2026-01-01T10:00:00.000Z');
    const periodEnd = new Date('2026-01-01T10:10:00.000Z');

    assert.equal(await model.aggregatePeriod(periodStart, periodEnd), 1);
    assert.equal(await model.aggregatePeriod(periodStart, periodEnd), 0);
    const history = await db.query(
      `SELECT session_id, floor_id, period_start, period_end, growth_stage,
              temperature_avg, humidity_avg
       FROM cultivation_environment_history`,
    );
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].session_id, 1);
    assert.equal(history.rows[0].floor_id, 1);
    assert.equal(history.rows[0].growth_stage, 'PINNING');
    assert.ok(Math.abs(history.rows[0].temperature_avg - ((76 / 3 + 30 + 28) / 3)) < 0.000001);
    assert.ok(Math.abs(history.rows[0].humidity_avg - ((244 / 3 + 86) / 2)) < 0.000001);
  } finally {
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousModel) require.cache[modelPath] = previousModel;
    else delete require.cache[modelPath];
    await db.close();
  }
});

test('environment-history worker uses completed 10-minute buckets and deduplicates concurrent ticks', async () => {
  const { createJob } = require('../jobs/environmentHistory.job');
  const calls = [];
  let periodLookups = 0;
  const client = {
    async query(sql, values) {
      calls.push([sql, values]);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('SELECT DISTINCT buckets.period_start')) {
        periodLookups += 1;
        return {
          rows: periodLookups === 1
            ? [{ period_start: new Date('2026-01-01T10:00:00.000Z') }]
            : [],
        };
      }
      if (sql.includes('INSERT INTO public.cultivation_environment_history')) {
        return { rows: [{ history_id: 1 }], rowCount: 1 };
      }
      return { rows: [] };
    },
    release() {},
  };
  const job = createJob(
    { connect: async () => client },
    { info() {}, error: assert.fail },
    () => new Date('2026-01-01T10:27:12.000Z'),
  );

  const firstTick = job.run();
  const concurrentTick = job.run();
  assert.equal(firstTick, concurrentTick);
  assert.equal(await firstTick, 1);
  const savedPeriod = calls.find(([sql]) => sql.includes('INSERT INTO public.cultivation_environment_history'));
  assert.deepEqual(savedPeriod[1], [
    new Date('2026-01-01T10:00:00.000Z'),
    new Date('2026-01-01T10:10:00.000Z'),
  ]);
  assert.equal(calls.filter(([sql]) => sql.includes('pg_try_advisory_lock')).length, 1);
  assert.ok(calls.some(([sql]) => sql.includes('pg_advisory_unlock')));
});
