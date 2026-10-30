const test = require('node:test');
const assert = require('node:assert/strict');

function normalize(query) {
  return query.trim().replace(/\s+/g, ' ');
}

function loadPaymentModel({
  payment,
  otherPayments = [],
  order = {},
  reservation = {},
  inventoryQuantity = 10,
  trayCount = 2,
} = {}) {
  const dbPath = require.resolve('../src/config/db');
  const reservationPath = require.resolve('../src/models/cultivationReservation.model');
  const modelPath = require.resolve('../src/models/payment.model');
  const state = {
    payment: payment === null ? null : {
      payment_id: 21,
      order_id: 11,
      amount: '530000',
      payment_method: 'PAYOS',
      transaction_code: null,
      status: 'PENDING',
      ...payment,
    },
    otherPayments: otherPayments.map((entry) => ({
      order_id: 11,
      payment_method: 'PAYOS',
      status: 'PENDING',
      ...entry,
    })),
    order: {
      order_id: 11,
      status: 'PENDING',
      payment_status: 'PENDING',
      ...order,
    },
    reservation: {
      reservation_id: 31,
      order_item_id: 15,
      quantity: 1,
      spawn_quantity: 3,
      status: 'HELD',
      expires_at: new Date(Date.now() + 60_000),
      is_active: true,
      ...reservation,
    },
    inventory: { inventory_id: 41, mushroom_type_id: 9, quantity: inventoryQuantity },
    trays: Array.from({ length: trayCount }, (_, index) => ({ tray_id: index + 1 })),
    paymentUpdates: 0,
    sessionsCreated: 0,
    assignedTrayCount: 0,
    inventoryTransactions: 0,
    notifications: [],
  };

  const client = {
    query: async (query, values = []) => {
      const statement = normalize(query);
      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };

      if (statement.startsWith('SELECT payment_id, order_id, amount, payment_method')) {
        return { rows: state.payment ? [state.payment] : [] };
      }
      if (statement.startsWith('SELECT order_id FROM payments')) {
        return { rows: state.payment ? [{ order_id: state.payment.order_id }] : [] };
      }
      if (statement.startsWith('SELECT payment_id FROM payments')) {
        const candidates = state.otherPayments.filter((entry) => (
          entry.order_id === values[0] && entry.payment_method === values[1]
        ));
        if (statement.includes('payment_id > $3')) {
          const newer = candidates.find((entry) => entry.payment_id > values[2]);
          return { rows: newer ? [newer] : [] };
        }
        const paid = candidates.find((entry) => entry.status === 'PAID' && entry.payment_id !== values[2]);
        return { rows: paid ? [paid] : [] };
      }
      if (statement.startsWith('SELECT order_id, status, payment_status')) {
        return { rows: state.payment ? [state.order] : [] };
      }
      if (statement.startsWith('SELECT oi.order_item_id, oi.quantity, oi.mushroom_type_id')) {
        return { rows: [{ order_item_id: 15, quantity: 1, mushroom_type_id: 9, duration_days: 20 }] };
      }
      if (statement.startsWith('SELECT session_id FROM cultivation_sessions')) return { rows: [] };
      if (statement.startsWith('SELECT reservation_id, order_item_id, quantity, spawn_quantity')) {
        return { rows: [state.reservation] };
      }
      if (statement.startsWith('SELECT t.tray_id')) return { rows: state.trays };
      if (statement.startsWith('SELECT COALESCE(SUM(tr.quantity)')) return { rows: [{ quantity: 0 }] };
      if (statement.startsWith('SELECT COALESCE(SUM(tr.spawn_quantity)')) return { rows: [{ quantity: 0 }] };
      if (statement.startsWith('SELECT inventory_id, mushroom_type_id, quantity')) {
        return { rows: state.inventory ? [state.inventory] : [] };
      }
      if (statement.startsWith("UPDATE payments SET status = 'PAID'")) {
        if (!state.payment || !['PENDING', 'CANCELLED', 'FAILED'].includes(state.payment.status)) return { rows: [] };
        state.payment.status = 'PAID';
        state.payment.transaction_code = values[1];
        state.paymentUpdates += 1;
        return { rows: [state.payment] };
      }
      if (statement.startsWith("UPDATE orders SET payment_status = 'REFUND_PENDING'")) {
        state.order.payment_status = 'REFUND_PENDING';
        return { rows: [] };
      }
      if (statement.startsWith('SELECT protocol_id FROM cultivation_protocols')) return { rows: [] };
      if (statement.startsWith('INSERT INTO cultivation_sessions')) {
        state.sessionsCreated += 1;
        return {
          rows: [{ session_id: 77, harvest_date: '2026-02-01', duration_days: 20, status: 'ACTIVE' }],
        };
      }
      if (statement.startsWith('UPDATE spawn_inventory')) {
        if (!state.inventory || Number(state.inventory.quantity) < Number(values[1])) return { rows: [] };
        state.inventory.quantity = Number(state.inventory.quantity) - Number(values[1]);
        return { rows: [{ quantity: state.inventory.quantity }] };
      }
      if (statement.startsWith('INSERT INTO inventory_transactions')) {
        state.inventoryTransactions += 1;
        return { rows: [] };
      }
      if (statement.startsWith('UPDATE cultivation_trays')) return { rows: [{ tray_id: values[0] }] };
      if (statement.startsWith('INSERT INTO cultivation_session_trays')) {
        state.assignedTrayCount += 1;
        return { rows: [] };
      }
      if (statement.startsWith("UPDATE tray_reservations SET status = 'CONSUMED'")) {
        state.reservation.status = 'CONSUMED';
        return { rows: [] };
      }
      if (statement.startsWith("UPDATE tray_reservations SET status = 'EXPIRED'")) {
        state.reservation.status = 'EXPIRED';
        return { rows: [] };
      }
      if (statement.startsWith("UPDATE tray_reservations SET status = 'RELEASED'")) {
        return { rows: [] };
      }
      if (statement.startsWith('INSERT INTO cultivation_progress')) return { rows: [] };
      if (statement.startsWith('INSERT INTO notifications')) {
        state.notifications.push(statement.includes('PAYMENT_REFUND_REQUIRED') ? 'REFUND' : 'STARTED');
        return { rows: [] };
      }
      if (statement.startsWith("UPDATE orders SET payment_status = 'PAID', status = 'PROCESSING'")) {
        state.order.payment_status = 'PAID';
        state.order.status = 'PROCESSING';
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL: ${statement}`);
    },
    release: () => {},
  };

  delete require.cache[dbPath];
  delete require.cache[reservationPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: { connect: async () => client } };

  return { model: require('../src/models/payment.model'), state };
}

test('logs and leaves state unchanged when the PayOS payment does not exist', async (t) => {
  const { model, state } = loadPaymentModel({ payment: null });
  const warning = t.mock.method(console, 'warn', () => {});

  assert.equal(await model.markPayosPaymentAsPaid(404, 530000, 'reference-404'), null);
  assert.equal(state.paymentUpdates, 0);
  assert.deepEqual(warning.mock.calls[0].arguments[1], {
    orderCode: 404,
    paidAmount: 530000,
    reason: 'payment_not_found',
  });
});

test('logs and leaves state unchanged when the PayOS amount is too small', async (t) => {
  const { model, state } = loadPaymentModel();
  const warning = t.mock.method(console, 'warn', () => {});

  assert.equal(await model.markPayosPaymentAsPaid(21, 529999, 'reference-21'), null);
  assert.equal(state.paymentUpdates, 0);
  assert.deepEqual(warning.mock.calls[0].arguments[1], {
    orderCode: 21,
    paidAmount: 529999,
    reason: 'insufficient_paid_amount',
    expectedAmount: 530000,
    shortfallAmount: 1,
  });
});

test('fulfills a paid order once, consumes spawn, and records the OUT transaction', async () => {
  const { model, state } = loadPaymentModel();

  const first = await model.markPayosPaymentAsPaid(21, 530000, 'reference-21');
  const replay = await model.markPayosPaymentAsPaid(21, 530000, 'reference-21');

  assert.equal(first.status, 'PAID');
  assert.equal(replay.status, 'PAID');
  assert.equal(state.paymentUpdates, 1);
  assert.equal(state.order.payment_status, 'PAID');
  assert.equal(state.order.status, 'PROCESSING');
  assert.equal(state.sessionsCreated, 1);
  assert.equal(state.assignedTrayCount, 1);
  assert.equal(state.inventory.quantity, 7);
  assert.equal(state.inventoryTransactions, 1);
  assert.equal(state.reservation.status, 'CONSUMED');
  assert.deepEqual(state.notifications, ['STARTED']);
});

test('acknowledges late payment but requests a refund when expired resources are unavailable', async () => {
  const { model, state } = loadPaymentModel({
    payment: { status: 'CANCELLED' },
    order: { payment_status: 'FAILED' },
    reservation: {
      status: 'EXPIRED',
      expires_at: new Date(Date.now() - 60_000),
      is_active: false,
    },
    inventoryQuantity: 2,
  });

  const result = await model.markPayosPaymentAsPaid(21, 530000, 'late-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.paymentUpdates, 1);
  assert.equal(state.order.status, 'PENDING');
  assert.equal(state.order.payment_status, 'REFUND_PENDING');
  assert.equal(state.sessionsCreated, 0);
  assert.equal(state.assignedTrayCount, 0);
  assert.equal(state.inventory.quantity, 2);
  assert.equal(state.inventoryTransactions, 0);
  assert.equal(state.reservation.status, 'EXPIRED');
  assert.deepEqual(state.notifications, ['REFUND']);
});

test('does not let an old payment consume a newer retry hold', async () => {
  const { model, state } = loadPaymentModel({
    payment: { status: 'CANCELLED' },
    order: { payment_status: 'FAILED' },
    otherPayments: [{ payment_id: 22, status: 'PENDING' }],
  });

  const result = await model.markPayosPaymentAsPaid(21, 530000, 'old-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.order.payment_status, 'REFUND_PENDING');
  assert.equal(state.sessionsCreated, 0);
  assert.equal(state.inventoryTransactions, 0);
  assert.deepEqual(state.notifications, ['REFUND']);
});

test('records money received for a cancelled order without reviving that order', async () => {
  const { model, state } = loadPaymentModel({
    payment: { status: 'CANCELLED' },
    order: { status: 'CANCELLED', payment_status: 'FAILED' },
  });

  const result = await model.markPayosPaymentAsPaid(21, 530000, 'late-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.paymentUpdates, 1);
  assert.equal(state.order.status, 'CANCELLED');
  assert.equal(state.order.payment_status, 'FAILED');
  assert.equal(state.sessionsCreated, 0);
});
