const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const jwt = require('jsonwebtoken');

async function setupDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      user_id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL
    );
    CREATE TABLE orders (
      order_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id)
    );
    CREATE TABLE notifications (
      notification_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id),
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_by INTEGER,
      reference_type TEXT,
      reference_id INTEGER
    );
    CREATE TABLE shipments (
      shipment_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(order_id),
      address TEXT NOT NULL,
      recipient_name VARCHAR(150) NOT NULL,
      recipient_phone VARCHAR(30) NOT NULL,
      shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
      carrier VARCHAR(100),
      tracking_code VARCHAR(150),
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      shipped_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      CONSTRAINT chk_shipment_dates CHECK (
        delivered_at IS NULL OR shipped_at IS NULL OR delivered_at >= shipped_at
      ),
      CONSTRAINT chk_shipping_fee CHECK (shipping_fee >= 0),
      CONSTRAINT shipments_status_check
        CHECK (status IN ('PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'))
    );
    INSERT INTO users (user_id, full_name) VALUES (7, 'Customer'), (8, 'Other Customer');
    INSERT INTO orders (order_id, user_id) VALUES (23, 7), (24, 7), (25, 8);
    INSERT INTO shipments (
      shipment_id, order_id, address, recipient_name, recipient_phone
    ) VALUES (5, 23, 'Farm Road 1', 'Customer', '0900000007');
  `);
  await db.exec(require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../migrations/033_allow_returned_shipments.sql'),
    'utf8',
  ));
  return db;
}

function loadShipmentService(db) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/shipment.model');
  const servicePath = require.resolve('../src/services/shipment.service');
  const pool = {
    query: (query, values = []) => db.query(query, values),
    connect: async () => ({
      query: (query, values = []) => db.query(query, values),
      release: () => {},
    }),
  };
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[dbPath] = { exports: pool };
  return require('../src/services/shipment.service');
}

test('staff can manually create one active shipment for an order', async () => {
  const db = await setupDatabase();
  try {
    const service = loadShipmentService(db);
    const standalone = await service.createShipment({
      orderId: '24',
      address: '  Delivery road  ',
      recipientName: '  Customer  ',
      recipientPhone: '  0900000007  ',
      shippingFee: '15000',
      carrier: '  Carrier  ',
      trackingCode: '  TRACK-23  ',
    });
    assert.equal(standalone.status, 'PENDING');
    assert.equal(standalone.order_id, 24);
    assert.equal(standalone.address, 'Delivery road');
    assert.equal(standalone.recipient_name, 'Customer');
    assert.equal(Number(standalone.shipping_fee), 15000);
    assert.equal(standalone.carrier, 'Carrier');
    assert.equal(standalone.tracking_code, 'TRACK-23');

    await assert.rejects(
      () => service.createShipment({
        orderId: 24,
        address: 'Duplicate road',
        recipientName: 'Customer',
        recipientPhone: '0900000007',
      }),
      { statusCode: 409 },
    );
    await assert.rejects(
      () => service.createShipment({
        orderId: 99,
        address: 'Unknown order',
        recipientName: 'Customer',
        recipientPhone: '0900000007',
      }),
      { statusCode: 404 },
    );
  } finally {
    await db.close();
  }
});

test('shipment listing returns order details and status updates record timestamps', async () => {
  const db = await setupDatabase();
  try {
    const service = loadShipmentService(db);
    const listed = await service.listShipments();
    assert.equal(listed.total, 1);
    assert.equal(listed.shipments[0].order_code, 'ORD-23');
    assert.equal(listed.shipments[0].customer_name, 'Customer');

    const shipped = await service.updateShipmentStatus(5, ' shipped ');
    assert.equal(shipped.status, 'SHIPPED');
    assert.ok(shipped.shipped_at);
    const notifications = await db.query(
      'SELECT * FROM notifications WHERE user_id = 7 ORDER BY notification_id DESC',
    );
    assert.equal(notifications.rows.length, 1);
    assert.equal(notifications.rows[0].notification_type, 'SHIPMENT_UPDATE');
    assert.match(
      notifications.rows[0].message,
      /Đã bàn giao cho đơn vị vận chuyển/,
    );
    const delivered = await service.updateShipmentStatus(5, 'DELIVERED');
    assert.ok(delivered.delivered_at);
    const returned = await service.updateShipmentStatus(5, 'RETURNED');
    assert.equal(returned.status, 'RETURNED');
    assert.equal(
      new Date(returned.delivered_at).getTime(),
      new Date(delivered.delivered_at).getTime(),
    );
    const pending = await service.updateShipmentStatus(5, 'PENDING');
    assert.equal(pending.shipped_at, null);
    assert.equal(pending.delivered_at, null);
  } finally {
    await db.close();
  }
});

test('operators update shipment details without changing status and can correct delivery time', async () => {
  const db = await setupDatabase();
  try {
    const service = loadShipmentService(db);
    await db.query(
      `UPDATE shipments
       SET status = 'IN_TRANSIT', shipped_at = '2026-11-21T08:30:00+07:00'
       WHERE shipment_id = 5`,
    );

    const details = await service.updateShipmentDetails(5, {
      carrier: '  Carrier  ',
      trackingCode: '  TRACK-23  ',
      shippingFee: '18000',
      shippedAt: '2026-11-21T08:30:00+07:00',
    });
    assert.equal(details.status, 'IN_TRANSIT');
    assert.equal(details.carrier, 'Carrier');
    assert.equal(details.tracking_code, 'TRACK-23');
    assert.equal(Number(details.shipping_fee), 18000);

    const delivered = await service.updateShipmentStatus(
      5,
      'DELIVERED',
      '2026-11-21T09:15:00+07:00',
      { user_id: 2, role_id: 2 },
    );
    assert.equal(delivered.status, 'DELIVERED');
    assert.equal(new Date(delivered.delivered_at).toISOString(), '2026-11-21T02:15:00.000Z');

    const corrected = await service.updateShipmentDetails(5, {
      carrier: 'Carrier',
      trackingCode: 'TRACK-23',
      shippingFee: 18000,
      shippedAt: '2026-11-21T08:30:00+07:00',
      deliveredAt: '2026-11-21T09:20:00+07:00',
    });
    assert.equal(corrected.status, 'DELIVERED');
    assert.equal(new Date(corrected.delivered_at).toISOString(), '2026-11-21T02:20:00.000Z');
    await assert.rejects(
      () => service.updateShipmentDetails(5, {
        carrier: 'Carrier',
        trackingCode: 'TRACK-23',
        shippingFee: 18000,
        shippedAt: '2026-11-21T08:30:00+07:00',
        deliveredAt: '2026-11-21T08:00:00+07:00',
      }),
      { statusCode: 400, message: 'Delivery time cannot be earlier than handoff time' },
    );
  } finally {
    await db.close();
  }
});

test('customers see only their own order shipments while staff can see any order', async () => {
  const db = await setupDatabase();
  try {
    const service = loadShipmentService(db);
    const customer = { user_id: 7, role_id: 3 };
    const ownOrder = await service.listShipmentsForOrder(23, customer);
    assert.equal(ownOrder.orderId, 23);
    assert.equal(ownOrder.total, 1);
    assert.equal(ownOrder.shipments[0].status, 'PENDING');

    const noShipments = await service.listShipmentsForOrder(24, customer);
    assert.equal(noShipments.total, 0);
    assert.deepEqual(noShipments.shipments, []);
    await assert.rejects(
      () => service.listShipmentsForOrder(25, customer),
      { statusCode: 404 },
    );

    const staffOrder = await service.listShipmentsForOrder(25, { user_id: 1, role_id: 1 });
    assert.equal(staffOrder.orderId, 25);
    assert.equal(staffOrder.total, 0);
  } finally {
    await db.close();
  }
});

test('shipment updates reject invalid status and return 404 for missing shipments', async () => {
  const db = await setupDatabase();
  try {
    const service = loadShipmentService(db);
    await assert.rejects(
      () => service.updateShipmentStatus(5, 'DELIVERY_FAILED'),
      { statusCode: 400 },
    );
    await assert.rejects(
      () => service.updateShipmentStatus(0, 'SHIPPED'),
      { statusCode: 400 },
    );
    await assert.rejects(
      () => service.updateShipmentStatus(99, 'SHIPPED'),
      { statusCode: 404 },
    );
  } finally {
    await db.close();
  }
});

test('shipment routes restrict listing and status changes to staff roles', async () => {
  const userModelPath = require.resolve('../src/models/user.model');
  const authServicePath = require.resolve('../src/services/auth.service');
  const authMiddlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const controllerPath = require.resolve('../src/controllers/shipment.controller');
  const routePath = require.resolve('../src/routes/shipment.routes');
  const calls = [];
  const handler = (name) => (req, res) => {
    calls.push({ name, user: req.user, params: req.params, body: req.body });
    res.sendStatus(204);
  };

  require.cache[userModelPath] = {
    exports: {
      findById: async (userId) => ({
        user_id: Number(userId),
        role_id: Number(userId),
        status: 'ACTIVE',
      }),
    },
  };
  require.cache[authServicePath] = { exports: { sanitizeUser: (user) => user } };
  require.cache[controllerPath] = {
    exports: {
      create: handler('create'),
      adminList: handler('list'),
      orderList: handler('orderList'),
      updateStatus: handler('update'),
      updateDetails: handler('updateDetails'),
    },
  };
  delete require.cache[authMiddlewarePath];
  delete require.cache[routePath];

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', require('../src/routes/shipment.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const env = require('../src/config/env');
    const token = (userId) => jwt.sign({ sub: String(userId) }, env.jwtSecret);
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/shipments`;
    const staffHeaders = { authorization: `Bearer ${token(2)}` };
    const customerHeaders = { authorization: `Bearer ${token(3)}` };

    assert.equal((await fetch(`${baseUrl}/admin`, { headers: staffHeaders })).status, 204);
    assert.equal((await fetch(`${baseUrl}/admin`, { headers: customerHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/admin`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/orders/23`, { headers: customerHeaders })).status, 204);
    assert.equal((await fetch(`${baseUrl}/orders/23`, { headers: staffHeaders })).status, 204);
    assert.equal((await fetch(`${baseUrl}/9/status`, {
      method: 'PATCH',
      headers: { ...staffHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'IN_TRANSIT' }),
    })).status, 204);
    assert.equal((await fetch(`${baseUrl}/9/details`, {
      method: 'PATCH',
      headers: { ...staffHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        carrier: 'Carrier',
        trackingCode: 'TRACK-9',
        shippingFee: 12000,
        shippedAt: '2026-11-21T08:30:00+07:00',
      }),
    })).status, 204);
    assert.equal((await fetch(`${baseUrl}/9/details`, {
      method: 'PATCH',
      headers: { ...customerHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })).status, 403);
    assert.equal((await fetch(baseUrl, {
      method: 'POST',
      headers: { ...staffHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 23, address: 'Street', recipientName: 'User', recipientPhone: '0900000000' }),
    })).status, 204);
    assert.deepEqual(calls.map((call) => call.name), ['list', 'orderList', 'orderList', 'update', 'updateDetails', 'create']);
    assert.equal(calls[1].params.orderId, '23');
    assert.equal(calls[3].body.status, 'IN_TRANSIT');
    assert.equal(calls[4].body.shippedAt, '2026-11-21T08:30:00+07:00');
    assert.equal(calls[5].body.orderId, 23);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
