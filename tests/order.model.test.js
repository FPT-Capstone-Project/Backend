const test = require('node:test');
const assert = require('node:assert/strict');

function loadOrderModel({
  durationDays = 30,
  growingDays = 25,
  availableTrays = 5,
  heldTrays = 0,
  spawnInventory = 30,
  heldSpawn = 0,
  readResults = {},
  cancelOrder = { order_id: 11, status: 'PENDING', payment_status: 'UNPAID' },
} = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/order.model');
  const statements = [];
  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });

      if (statement.startsWith('SELECT package_id')) {
        return { rows: [{ package_id: 7, package_name: '30 days', duration_days: durationDays, price: '500000', status: 'ACTIVE' }] };
      }
      if (statement.startsWith('SELECT mushroom_type_id')) {
        return { rows: [{ mushroom_type_id: 9, name: 'Oyster', growing_days: growingDays, price: '30000', status: 'ACTIVE' }] };
      }
      if (statement.startsWith('SELECT t.tray_id')) {
        return { rows: Array.from({ length: availableTrays }, (_, index) => ({ tray_id: index + 1 })) };
      }
      if (statement.startsWith('SELECT COALESCE(SUM(tr.quantity), 0)::int AS quantity')) {
        return { rows: [{ quantity: heldTrays }] };
      }
      if (statement.startsWith('SELECT COALESCE(SUM(tr.spawn_quantity), 0)::numeric AS quantity')) {
        return { rows: [{ quantity: heldSpawn }] };
      }
      if (statement.startsWith('SELECT inventory_id, mushroom_type_id, quantity FROM spawn_inventory')) {
        return { rows: spawnInventory == null ? [] : [{ inventory_id: 4, mushroom_type_id: 9, quantity: spawnInventory }] };
      }
      if (statement.startsWith('SELECT order_id, status, payment_status')) {
        return { rows: cancelOrder ? [cancelOrder] : [] };
      }
      if (statement.startsWith('UPDATE orders')) {
        return {
          rows: [{
            order_id: values[0],
            user_id: values[1],
            status: 'CANCELLED',
            payment_status: cancelOrder.payment_status === 'PENDING' ? 'FAILED' : cancelOrder.payment_status,
          }],
        };
      }
      if (statement.startsWith('INSERT INTO orders')) {
        const amount = (Number(values[1]) + Number(values[2])) * Number(values[3]);
        return { rows: [{ order_id: 11, user_id: values[0], subtotal: String(amount), total_amount: String(amount) }] };
      }
      if (statement.startsWith('INSERT INTO order_items')) {
        const unitPrice = Number(values[4]) + Number(values[5]);
        return {
          rows: [{
            order_item_id: 15,
            order_id: values[0],
            rental_package_id: values[1],
            mushroom_type_id: values[2],
            quantity: values[3],
            unit_price: String(unitPrice),
            total_price: String(unitPrice * Number(values[3])),
          }],
        };
      }
      if (statement.startsWith('UPDATE tray_reservations SET quantity')) return { rows: [] };
      if (statement.startsWith('INSERT INTO tray_reservations')) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = {
    connect: async () => client,
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });
      return { rows: statement.includes('WHERE o.order_id') ? readResults.detail || [] : readResults.list || [] };
    },
  };

  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: pool };

  return { model: require('../src/models/order.model'), statements };
}

test('creates a cultivation item for the selected package, mushroom, and tray quantity', async () => {
  const { model, statements } = loadOrderModel();
  const order = await model.createCultivationOrder({
    userId: 3,
    packageId: 7,
    mushroomTypeId: 9,
    quantity: 3,
  });

  assert.equal(order.user_id, 3);
  assert.equal(order.subtotal, '1590000');
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].rental_package_id, 7);
  assert.equal(order.items[0].mushroom_type_id, 9);
  assert.equal(order.items[0].package_name, '30 days');
  assert.equal(order.items[0].mushroom_name, 'Oyster');
  assert.equal(order.items[0].unit_price, '530000');
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.items[0].total_price, '1590000');
  assert.equal(statements.filter(({ statement }) => statement.startsWith('INSERT INTO order_items')).length, 1);
  const reservationInsert = statements.find(({ statement }) => statement.startsWith('INSERT INTO tray_reservations'));
  assert.ok(reservationInsert);
  assert.deepEqual(reservationInsert.values.slice(0, 3), [15, 3, 9]);
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
  assert.ok(!statements.some(({ statement }) => statement === 'ROLLBACK'));
});

test('rejects orders when selected tray quantity exceeds available trays', async () => {
  const { model, statements } = loadOrderModel({ availableTrays: 4, heldTrays: 2 });
  await assert.rejects(
    () => model.createCultivationOrder({
      userId: 3,
      packageId: 7,
      mushroomTypeId: 9,
      quantity: 3,
    }),
    { statusCode: 409, code: 'INSUFFICIENT_TRAYS', message: 'Only 2 cultivation trays are currently available' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO orders')));
});

test('rejects orders when selected mushroom spawn is held or unavailable', async () => {
  const { model, statements } = loadOrderModel({ spawnInventory: 10, heldSpawn: 2 });

  await assert.rejects(
    () => model.createCultivationOrder({
      userId: 3,
      packageId: 7,
      mushroomTypeId: 9,
      quantity: 3,
    }),
    { statusCode: 409, code: 'INSUFFICIENT_SPAWN', message: 'Only 8 spawn units are currently available' },
  );

  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO orders')));
});

test('rejects a mushroom that takes longer than the selected package and rolls back', async () => {
  const { model, statements } = loadOrderModel({ durationDays: 20, growingDays: 25 });

  await assert.rejects(
    () => model.createCultivationOrder({
      userId: 3,
      packageId: 7,
      mushroomTypeId: 9,
      quantity: 1,
    }),
    { statusCode: 400, message: /longer than the 20-day package/ },
  );

  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO orders')));
});

test('lists and returns order details only with the authenticated customer ID', async () => {
  const detailRow = {
    order_id: 11,
    user_id: 3,
    subtotal: '530000',
    discount: '0',
    shipping_fee: '0',
    total_amount: '530000',
    status: 'PENDING',
    order_item_id: 15,
    rental_package_id: 7,
    mushroom_type_id: null,
    package_name: '30 days',
    mushroom_name: null,
    quantity: 1,
    unit_price: '500000',
    total_price: '500000',
  };
  const { model, statements } = loadOrderModel({
    readResults: {
      list: [{ order_id: 11, user_id: 3, status: 'PENDING' }],
      detail: [detailRow],
    },
  });

  const orders = await model.findAllByUserId(3);
  const order = await model.findByIdForUser(11, 3);

  assert.equal(orders[0].order_id, 11);
  assert.equal(order.items[0].package_name, '30 days');
  assert.deepEqual(statements[0].values, [3]);
  assert.deepEqual(statements[1].values, [11, 3]);
  assert.match(statements[1].statement, /WHERE o\.order_id = \$1 AND o\.user_id = \$2/);
});

test('cancels a pending unpaid order for its owner', async () => {
  const { model, statements } = loadOrderModel();

  const order = await model.cancelOrderForUser(11, 3);

  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.payment_status, 'UNPAID');
  assert.deepEqual(statements[1].values, [11, 3]);
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
});

test('cancels pending payments and marks the order payment as failed', async () => {
  const { model, statements } = loadOrderModel({
    cancelOrder: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
  });

  const order = await model.cancelOrderForUser(11, 3);

  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.payment_status, 'FAILED');
  assert.ok(statements.some(({ statement }) => (
    statement === "UPDATE payments SET status = 'CANCELLED' WHERE order_id = $1 AND status = 'PENDING'"
  )));
  assert.ok(statements.some(({ statement }) => (
    statement.startsWith("UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED'")
  )));
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
});

test('rejects cancellation when the order has already been paid', async () => {
  const { model, statements } = loadOrderModel({
    cancelOrder: { order_id: 11, status: 'PENDING', payment_status: 'PAID' },
  });

  await assert.rejects(
    () => model.cancelOrderForUser(11, 3),
    { statusCode: 409, message: 'Only unpaid orders or orders with failed payment can be cancelled' },
  );

  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('UPDATE orders')));
});
