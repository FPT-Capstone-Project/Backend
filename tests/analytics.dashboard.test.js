const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('dashboard aggregates PostgreSQL data through the mounted staff API', async (t) => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const userPath = require.resolve('../src/models/user.model');
  const previousDb = require.cache[dbPath];
  const previousUser = require.cache[userPath];
  let server;
  let queryCount = 0;
  try {
    await db.exec(`
      CREATE TABLE orders (order_id SERIAL PRIMARY KEY, total_amount NUMERIC, status TEXT, payment_status TEXT);
      CREATE TABLE payments (payment_id SERIAL PRIMARY KEY, order_id INT REFERENCES orders, amount NUMERIC, status TEXT);
      CREATE TABLE cultivation_sessions (session_id INT PRIMARY KEY, status TEXT);
      CREATE TABLE cultivation_trays (tray_id INT PRIMARY KEY, status TEXT);
      CREATE TABLE cultivation_session_trays (
        session_tray_id SERIAL PRIMARY KEY, session_id INT REFERENCES cultivation_sessions,
        tray_id INT REFERENCES cultivation_trays, status TEXT
      );
      CREATE TABLE harvests (
        harvest_id SERIAL PRIMARY KEY, status TEXT, total_weight_kg NUMERIC,
        usable_weight_kg NUMERIC, rejected_weight_kg NUMERIC
      );
    `);
    require.cache[dbPath] = { exports: { query: (sql, params) => {
      queryCount += 1;
      return db.query(sql, params);
    } } };
    require.cache[userPath] = { exports: {
      findById: async (id) => ({ user_id: id, role_id: id, status: 'ACTIVE' }),
    } };
    const app = require('../src/app');
    const env = require('../src/config/env');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/analytics/dashboard`;
    const request = (role) => fetch(url, {
      headers: role ? { authorization: `Bearer ${jwt.sign({ sub: String(role) }, env.jwtSecret)}` } : {},
    });
    const dashboard = async () => {
      const before = queryCount;
      const response = await request(1);
      assert.equal(response.status, 200);
      assert.equal(queryCount - before, 3);
      return (await response.json()).data;
    };

    await t.test('authorization and exact empty response', async () => {
      const empty = {
        revenue: { value: 0, currency: 'VND' }, trays_used: 0,
        harvest_quality: { usable_rate: 0, waste_rate: 0 },
      };
      for (const role of [1, 2]) {
        const response = await request(role);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { data: empty });
      }
      const before = queryCount;
      assert.equal((await request(3)).status, 403);
      assert.equal((await request()).status, 401);
      assert.equal((await fetch(url, { headers: { authorization: 'Bearer invalid' } })).status, 401);
      assert.equal(queryCount, before);
    });

    await t.test('revenue uses only PAID orders without payment row multiplication', async () => {
      await db.exec(`
        INSERT INTO orders(total_amount, status, payment_status) VALUES
          (100000, 'PROCESSING', 'PAID'), (200000, 'COMPLETED', 'PAID'),
          (500000, 'PENDING', 'PENDING'), (300000, 'CANCELLED', 'CANCELLED'),
          (400000, 'PROCESSING', 'UNPAID'), (500000, 'CANCELLED', 'REFUND_PENDING'),
          (600000, 'CANCELLED', 'REFUNDED'), (700000, 'PENDING', 'FAILED');
        INSERT INTO payments(order_id, amount, status) VALUES
          (1, 100000, 'PAID'), (1, 100000, 'PAID'), (3, 500000, 'PAID');
      `);
      assert.deepEqual((await dashboard()).revenue, { value: 300000, currency: 'VND' });
    });

    await t.test('tray usage counts assignments including reuse and completed releases', async () => {
      await db.exec(`
        INSERT INTO cultivation_trays VALUES
          (1, 'AVAILABLE'), (2, 'OCCUPIED'), (3, 'OCCUPIED'), (4, 'AVAILABLE'), (5, 'AVAILABLE');
        INSERT INTO cultivation_sessions VALUES
          (1, 'COMPLETED'), (2, 'CULTIVATING'), (3, 'HARVEST_READY'),
          (4, 'CANCELLED'), (5, 'READY_FOR_CULTIVATION'), (6, 'PENDING');
        INSERT INTO cultivation_session_trays(session_id, tray_id, status) VALUES
          (1, 1, 'RELEASED'), (1, 2, 'RELEASED'), (2, 1, 'ACTIVE'), (3, 3, 'ACTIVE'),
          (4, 4, 'RELEASED'), (5, 4, 'RELEASED'), (6, 5, 'ACTIVE');
      `);
      assert.equal((await dashboard()).trays_used, 4);
      await db.exec(`BEGIN; INSERT INTO cultivation_session_trays(session_id, tray_id, status)
        VALUES(2, 4, 'ACTIVE'); ROLLBACK;`);
      assert.equal((await dashboard()).trays_used, 4);
    });

    await t.test('quality uses weighted sums of valid completed harvests and exposes only rates', async () => {
      await db.exec(`
        INSERT INTO harvests(status, total_weight_kg, usable_weight_kg, rejected_weight_kg) VALUES
          ('COMPLETED', 200, 190, 10), ('COMPLETED', 50, 42.5, 7.5),
          ('PLANNED', 1000, 0, 1000), ('IN_PROGRESS', 1000, 1000, 0),
          ('CANCELLED', 1000, 0, 1000), ('COMPLETED', 1000, NULL, 0),
          ('COMPLETED', -100, 50, 50);
      `);
      assert.deepEqual((await dashboard()).harvest_quality, { usable_rate: 93, waste_rate: 7 });
    });

    for (const [name, total, usable, rejected, expected] of [
      ['decimal precision', 250, 231, 19, { usable_rate: 92.4, waste_rate: 7.6 }],
      ['two decimal rounding', 7, 6, 1, { usable_rate: 85.71, waste_rate: 14.29 }],
      ['zero denominator', 0, 0, 0, { usable_rate: 0, waste_rate: 0 }],
      ['inconsistent data is not normalized', 250, 200, 20, { usable_rate: 80, waste_rate: 8 }],
    ]) {
      await t.test(name, async () => {
        await db.exec('DELETE FROM harvests');
        await db.query(`INSERT INTO harvests(status, total_weight_kg, usable_weight_kg, rejected_weight_kg)
          VALUES ('COMPLETED', $1, $2, $3)`, [total, usable, rejected]);
        assert.deepEqual((await dashboard()).harvest_quality, expected);
      });
    }

    await t.test('Swagger documents access and percentage response', () => {
      const spec = require('../src/config/swagger');
      const operation = spec.paths['/api/analytics/dashboard'].get;
      assert.match(operation.description, /1 = Admin, 2 = Farm Operator, 3 = Customer/);
      assert.match(operation.description, /usable_rate = usable harvested weight/);
      const quality = operation.responses[200].content['application/json']
        .schema.properties.data.properties.harvest_quality.properties;
      assert.deepEqual(Object.keys(quality), ['usable_rate', 'waste_rate']);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousUser) require.cache[userPath] = previousUser;
    else delete require.cache[userPath];
    await db.close();
  }
});
