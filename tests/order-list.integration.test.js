const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');

test('order list preserves order fields, ownership and one row per order with item summaries', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const previousDb = require.cache[dbPath];
  let server;
  try {
    await db.exec(`
      CREATE TABLE orders (
        order_id INT PRIMARY KEY, user_id INT, subtotal NUMERIC, discount NUMERIC,
        shipping_fee NUMERIC, total_amount NUMERIC, status TEXT, payment_status TEXT,
        created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
      );
      CREATE TABLE rental_packages (package_id INT PRIMARY KEY, package_name TEXT);
      CREATE TABLE mushroom_types (mushroom_type_id INT PRIMARY KEY, name TEXT);
      CREATE TABLE order_items (
        order_item_id INT PRIMARY KEY, order_id INT, rental_package_id INT,
        mushroom_type_id INT, total_price NUMERIC, quantity INT DEFAULT 1
      );
      INSERT INTO orders VALUES
        (17, 3, 480000, 0, 0, 480000, 'PROCESSING', 'PAID', '2026-11-03T10:00:00Z', '2026-11-03T10:00:00Z'),
        (18, 3, 720000, 20000, 10000, 710000, 'PENDING', 'UNPAID', '2026-11-03T10:00:00Z', '2026-11-03T10:00:00Z'),
        (19, 3, 0, 0, 0, 0, 'PENDING', 'UNPAID', '2026-11-03T11:00:00Z', '2026-11-03T11:00:00Z'),
        (20, 4, 480000, 0, 0, 480000, 'PENDING', 'UNPAID', '2026-11-03T12:00:00Z', '2026-11-03T12:00:00Z');
      INSERT INTO rental_packages VALUES (1, '30 days'), (2, '60 days');
      INSERT INTO mushroom_types VALUES (1, 'Oyster'), (2, 'Shiitake');
      INSERT INTO order_items VALUES
        (1, 17, 1, 1, 480000, 2), (3, 18, 2, 2, 240000, 1), (2, 18, 1, 1, 480000, 2);
      CREATE TABLE users (user_id INT PRIMARY KEY, full_name TEXT, email TEXT);
      INSERT INTO users VALUES (3, 'Customer A', 'a@example.test'), (4, 'Customer B', 'b@example.test');
    `);
    require.cache[dbPath] = { exports: { query: (sql, params) => db.query(sql, params) } };
    const controller = require('../src/controllers/order.controller');
    const userModelPath = require.resolve('../src/models/user.model');
    const authServicePath = require.resolve('../src/services/auth.service');
    require.cache[userModelPath] = { exports: {
      findById: async (id) => ({ user_id: id, role_id: id, status: 'ACTIVE' }),
    } };
    require.cache[authServicePath] = { exports: { sanitizeUser: (user) => user } };
    const app = express();
    app.get('/api/orders', (req, res, next) => {
      req.user = { user_id: 3 };
      next();
    }, controller.list);
    app.use('/api/orders', require('../src/routes/order.routes'));
    app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data.map((order) => order.order_id), [19, 18, 17]);
    assert.deepEqual(data[2], {
      order_id: 17, user_id: 3, subtotal: '480000', discount: '0', shipping_fee: '0',
      total_amount: '480000', status: 'PROCESSING', payment_status: 'PAID',
      created_at: '2026-11-03T10:00:00.000Z', updated_at: '2026-11-03T10:00:00.000Z',
      package_name: '30 days', mushroom_name: 'Oyster', total_price: '480000',
    });
    assert.equal(data[1].package_name, '30 days, 60 days');
    assert.equal(data[1].mushroom_name, 'Oyster, Shiitake');
    assert.equal(data[1].total_price, '720000');
    assert.equal(data[1].total_amount, '710000');
    assert.equal(data[1].payment_status, 'UNPAID');
    for (const field of ['package_name', 'mushroom_name', 'total_price']) {
      assert.equal(data[0][field], null);
    }

    const jwt = require('jsonwebtoken');
    const env = require('../src/config/env');
    const adminUrl = `http://127.0.0.1:${server.address().port}/api/orders/admin`;
    const headers = (role) => ({ authorization: `Bearer ${jwt.sign({ sub: String(role) }, env.jwtSecret)}` });
    assert.equal((await fetch(adminUrl)).status, 401);
    assert.equal((await fetch(adminUrl, { headers: headers(3) })).status, 403);
    for (const role of [1, 2]) {
      const adminResponse = await fetch(adminUrl, { headers: headers(role) });
      assert.equal(adminResponse.status, 200);
      const adminResult = await adminResponse.json();
      assert.deepEqual(adminResult.pagination, { page: 1, pageSize: 20, total: 4, totalPages: 1 });
      assert.deepEqual(adminResult.data.map((order) => order.order_id), [20, 19, 18, 17]);
      assert.equal(adminResult.data[0].customer_id, 4);
      assert.equal(adminResult.data[0].customer_name, 'Customer B');
      assert.equal(adminResult.data[0].customer_email, 'b@example.test');
      const multiItem = adminResult.data[2];
      assert.equal(multiItem.quantity, 3);
      assert.equal(multiItem.package_name, '30 days, 60 days');
      assert.equal(multiItem.mushroom_name, 'Oyster, Shiitake');
      assert.equal(multiItem.total_price, '720000');
      assert.equal(multiItem.payment_status, 'UNPAID');
      assert.equal(multiItem.status, 'PENDING');
      assert.equal(multiItem.created_at, '2026-11-03T10:00:00.000Z');
      assert.ok(!Object.hasOwn(multiItem, 'order_code'));
    }
    const paged = await (await fetch(`${adminUrl}?page=2&pageSize=2`, { headers: headers(1) })).json();
    assert.deepEqual(paged.data.map((order) => order.order_id), [18, 17]);
    assert.deepEqual(paged.pagination, { page: 2, pageSize: 2, total: 4, totalPages: 2 });
    const empty = await (await fetch(`${adminUrl}?page=3&pageSize=2`, { headers: headers(1) })).json();
    assert.deepEqual(empty.data, []);
    assert.equal(empty.pagination.total, 4);
    for (const query of ['page=0', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=101', 'pageSize=abc']) {
      assert.equal((await fetch(`${adminUrl}?${query}`, { headers: headers(1) })).status, 400);
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    await db.close();
  }
});

test('generated Swagger describes the three roles and both updated endpoints', () => {
  const spec = require('../src/config/swagger');
  const roleDescription = spec.components.schemas.RegisterRequest.properties.roleId.description;
  assert.match(roleDescription, /1 = Admin, 2 = Farm Operator, 3 = Customer/);
  assert.doesNotMatch(JSON.stringify(spec), /4\s*=\s*Shipper|1\s*=\s*Farm Operator|2\s*=\s*Admin/);
  assert.ok(spec.paths['/api/cultivation-sessions/admin'].get);
  const adminProperties = spec.paths['/api/orders/admin'].get.responses[200]
    .content['application/json'].schema.properties.data.items.properties;
  for (const field of ['customer_id', 'customer_name', 'customer_email', 'quantity', 'total_price', 'created_at', 'payment_status']) {
    assert.ok(adminProperties[field]);
  }
  const orderProperties = spec.paths['/api/orders'].get.responses[200]
    .content['application/json'].schema.properties.data.items.properties;
  for (const field of ['created_at', 'payment_status', 'package_name', 'mushroom_name', 'total_price']) {
    assert.ok(orderProperties[field]);
  }
});
