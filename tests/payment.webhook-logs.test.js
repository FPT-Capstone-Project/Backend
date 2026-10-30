const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentModel({
  payment,
  order = {},
  reservation = { reservation_id: 31, quantity: 1, status: 'HELD' },
} = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/payment.model');
  const state = {
    payment: payment === null ? null : {
      payment_id: 21,
      order_id: 11,
      amount: '530000',
      payment_method: 'PAYOS',
      transaction_code: null,
      status: 'PENDING',
      paid_at: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      payos_payment_link_id: 'plink-21',
      payos_checkout_url: 'https://pay.example.test/21',
      payos_qr_code: 'qr-21',
      ...(payment || {}),
    },
    order: {
      order_id: 11,
      status: 'PENDING',
      payment_status: 'PENDING',
      ...order,
    },
    paymentUpdates: 0,
    orderUpdates: 0,
    sessionsCreated: 0,
    assignedTrayCount: 0,
    orderItems: [{
      order_item_id: 15,
      quantity: 1,
      mushroom_type_id: 9,
      duration_days: 30,
    }],
    trays: [{ tray_id: 1 }, { tray_id: 2 }],
    reservation,
  };

  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };

      if (statement.startsWith('SELECT payment_id, order_id, amount, payment_method')) {
        const found = state.payment
          && state.payment.payment_id === values[0]
          && state.payment.payment_method === values[1];
        return { rows: found ? [state.payment] : [] };
      }

      if (statement.startsWith('SELECT order_id, status, payment_status')) {
        return { rows: state.payment && values[0] === state.order.order_id ? [state.order] : [] };
      }

      if (statement.startsWith("UPDATE payments SET status = 'PAID'")) {
        if (!state.payment || !['PENDING', 'CANCELLED', 'FAILED'].includes(state.payment.status)) return { rows: [] };
        state.payment.status = 'PAID';
        state.payment.transaction_code = values[1];
        state.paymentUpdates += 1;
        return { rows: [state.payment] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'PAID', status = 'CONFIRMED'")) {
        state.order.status = 'CONFIRMED';
        state.order.payment_status = 'PAID';
        state.orderUpdates += 1;
        return { rows: [] };
      }

      if (statement.startsWith('SELECT oi.order_item_id, oi.quantity, oi.mushroom_type_id')) {
        return { rows: state.orderItems };
      }

      if (statement.startsWith('SELECT session_id FROM cultivation_sessions')) {
        return { rows: [] };
      }

      if (statement.startsWith('SELECT reservation_id, quantity, status FROM tray_reservations')) {
        return { rows: [state.reservation] };
      }

      if (statement.startsWith('SELECT t.tray_id')) {
        return { rows: state.trays };
      }

      if (statement.startsWith('SELECT COALESCE(SUM(quantity), 0)::int AS quantity')) {
        return { rows: [{ quantity: 0 }] };
      }

      if (statement.startsWith('SELECT protocol_id FROM cultivation_protocols')) {
        return { rows: [] };
      }

      if (statement.startsWith('INSERT INTO cultivation_sessions')) {
        state.sessionsCreated += 1;
        return {
          rows: [{
            session_id: 77,
            start_at: '2026-01-02T00:00:00.000Z',
            duration_days: values[1],
            status: 'ACTIVE',
            harvest_date: '2026-02-01',
          }],
        };
      }

      if (statement.startsWith('UPDATE cultivation_trays')) {
        return { rows: [{ tray_id: values[0] }] };
      }

      if (statement.startsWith('INSERT INTO cultivation_session_trays')) {
        state.assignedTrayCount += 1;
        return { rows: [] };
      }

      if (statement.startsWith('UPDATE tray_reservations SET status = \'CONSUMED\'')
        || statement.startsWith('INSERT INTO cultivation_progress')
        || statement.startsWith('INSERT INTO notifications')) {
        if (statement.startsWith('UPDATE tray_reservations SET status = \'CONSUMED\'')) {
          state.reservation.status = 'CONSUMED';
        }
        return { rows: [] };
      }

      if (statement.startsWith("UPDATE tray_reservations SET status = 'HELD'")) {
        state.reservation.status = 'HELD';
        return { rows: [state.reservation] };
      }

      if (statement.startsWith("UPDATE orders SET status = 'PROCESSING'")) {
        state.order.status = 'PROCESSING';
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL: ${statement}`);
    },
    release: () => {},
  };

  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: { connect: async () => client } };

  return { model: require('../src/models/payment.model'), state };
}

test('logs and leaves state unchanged when the PayOS payment does not exist', async (t) => {
  const { model, state } = loadPaymentModel({ payment: null });
  const warning = t.mock.method(console, 'warn', () => {});

  assert.equal(await model.markPayosPaymentAsPaid(404, 530000, 'reference-404'), null);
  assert.equal(state.paymentUpdates, 0);
  assert.equal(state.orderUpdates, 0);
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
  assert.equal(state.orderUpdates, 0);
  assert.deepEqual(warning.mock.calls[0].arguments[1], {
    orderCode: 21,
    paidAmount: 529999,
    reason: 'insufficient_paid_amount',
    expectedAmount: 530000,
    shortfallAmount: 1,
  });
});

test('fulfills a late PayOS payment after its pending payment was cancelled or failed', async () => {
  const { model, state } = loadPaymentModel({
    payment: { status: 'CANCELLED' },
    order: { payment_status: 'FAILED' },
    reservation: { reservation_id: 31, quantity: 1, status: 'EXPIRED' },
  });

  const result = await model.markPayosPaymentAsPaid(21, 530000, 'late-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.paymentUpdates, 1);
  assert.equal(state.orderUpdates, 1);
  assert.equal(state.order.status, 'PROCESSING');
  assert.equal(state.order.payment_status, 'PAID');
  assert.equal(state.sessionsCreated, 1);
  assert.equal(state.assignedTrayCount, 1);
  assert.equal(state.reservation.status, 'CONSUMED');
});

test('records an overpayment as paid and logs the excess for reconciliation', async (t) => {
  const { model, state } = loadPaymentModel();
  const warning = t.mock.method(console, 'warn', () => {});

  const result = await model.markPayosPaymentAsPaid(21, 530001, 'overpayment-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.order.status, 'PROCESSING');
  assert.equal(state.sessionsCreated, 1);
  assert.equal(state.assignedTrayCount, 1);
  assert.deepEqual(warning.mock.calls[0].arguments[1], {
    orderCode: 21,
    paidAmount: 530001,
    expectedAmount: 530000,
    excessAmount: 1,
  });
});

test('records money received for a cancelled order without reviving that order', async (t) => {
  const { model, state } = loadPaymentModel({
    payment: { status: 'CANCELLED' },
    order: { status: 'CANCELLED', payment_status: 'FAILED' },
  });
  const warning = t.mock.method(console, 'warn', () => {});

  const result = await model.markPayosPaymentAsPaid(21, 530001, 'late-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.paymentUpdates, 1);
  assert.equal(state.orderUpdates, 0);
  assert.equal(state.order.status, 'CANCELLED');
  assert.equal(state.order.payment_status, 'FAILED');
  assert.deepEqual(warning.mock.calls[0].arguments[1], { orderCode: 21, paidAmount: 530001 });
});
