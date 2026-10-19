const test = require('node:test');
const assert = require('node:assert/strict');

function loadOrderModel({
  durationDays = 30,
  growingDays = 25,
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
        const amount = Number(values[1]) + Number(values[2]);
        return { rows: [{ order_id: 11, user_id: values[0], subtotal: String(amount), total_amount: String(amount) }] };
      }
      if (statement.startsWith('INSERT INTO order_items')) {
        const isRental = statement.includes("'RENTAL'");
        return {
          rows: [{
            order_item_id: isRental ? 15 : 16,
            order_id: values[0],
            item_type: isRental ? 'RENTAL' : 'MUSHROOM',
            rental_package_id: isRental ? values[1] : null,
            mushroom_type_id: isRental ? null : values[1],
            quantity: 1,
            unit_price: values[2],
            total_price: values[2],
          }],
        };
      }
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

test('creates separate rental and mushroom order items with combined pricing', async () => {
  const { model, statements } = loadOrderModel();
  const order = await model.createRentalOrder({ userId: 3, packageId: 7, mushroomTypeId: 9 });

  assert.equal(order.user_id, 3);
  assert.equal(order.subtotal, '530000');
  assert.equal(order.items.length, 2);
  assert.equal(order.items[0].item_type, 'RENTAL');
  assert.equal(order.items[0].rental_package_id, 7);
  assert.equal(order.items[0].mushroom_type_id, null);
  assert.equal(order.items[0].package_name, '30 days');
  assert.equal(order.items[1].item_type, 'MUSHROOM');
  assert.equal(order.items[1].rental_package_id, null);
  assert.equal(order.items[1].mushroom_type_id, 9);
  assert.equal(order.items[1].mushroom_name, 'Oyster');
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
  assert.ok(!statements.some(({ statement }) => statement === 'ROLLBACK'));
});

test('rejects a mushroom that takes longer than the rental and rolls back', async () => {
  const { model, statements } = loadOrderModel({ durationDays: 20, growingDays: 25 });

  await assert.rejects(
    () => model.createRentalOrder({ userId: 3, packageId: 7, mushroomTypeId: 9 }),
    { statusCode: 400, message: /longer than the 20-day rental/ },
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
    item_type: 'RENTAL',
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
