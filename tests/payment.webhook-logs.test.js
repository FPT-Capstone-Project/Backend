const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentModel({ payment, order = {} } = {}) {
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

test('accepts a late PayOS payment after its pending order payment was cancelled or failed', async () => {
  const { model, state } = loadPaymentModel({
    payment: { status: 'CANCELLED' },
    order: { payment_status: 'FAILED' },
  });

  const result = await model.markPayosPaymentAsPaid(21, 530000, 'late-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.paymentUpdates, 1);
  assert.equal(state.orderUpdates, 1);
  assert.equal(state.order.status, 'CONFIRMED');
  assert.equal(state.order.payment_status, 'PAID');
});

test('records an overpayment as paid and logs the excess for reconciliation', async (t) => {
  const { model, state } = loadPaymentModel();
  const warning = t.mock.method(console, 'warn', () => {});

  const result = await model.markPayosPaymentAsPaid(21, 530001, 'overpayment-reference-21');

  assert.equal(result.status, 'PAID');
  assert.equal(state.order.status, 'CONFIRMED');
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
