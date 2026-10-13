const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentModel() {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/payment.model');
  const statements = [];
  const state = {
    order: {
      order_id: 11,
      user_id: 3,
      total_amount: '530000',
      status: 'PENDING',
      payment_status: 'UNPAID',
    },
    payment: null,
    paymentInserts: 0,
    paymentPaidUpdates: 0,
    orderPaidUpdates: 0,
  };

  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });

      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };

      if (statement.startsWith('SELECT order_id, total_amount, status, payment_status')) {
        return {
          rows: values[0] === state.order.order_id && values[1] === state.order.user_id ? [state.order] : [],
        };
      }

      if (statement.startsWith('SELECT payment_id, order_id, amount, payment_method')) {
        const isPendingSepayPayment = state.payment
          && state.payment.order_id === values[0]
          && state.payment.payment_method === values[1]
          && state.payment.status === 'PENDING';
        return { rows: isPendingSepayPayment ? [state.payment] : [] };
      }

      if (statement.startsWith('INSERT INTO payments')) {
        state.paymentInserts += 1;
        state.payment = {
          payment_id: 21,
          order_id: values[0],
          amount: values[1],
          payment_method: values[2],
          transaction_code: null,
          status: 'PENDING',
          paid_at: null,
          created_at: new Date('2026-01-01T00:00:00Z'),
        };
        return { rows: [state.payment] };
      }

      if (statement.startsWith('UPDATE payments SET transaction_code')) {
        state.payment.transaction_code = values[0];
        return { rows: [state.payment] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'PENDING'")) {
        state.order.payment_status = 'PENDING';
        return { rows: [] };
      }

      if (statement.startsWith('SELECT p.payment_id')) {
        const found = state.payment
          && state.payment.transaction_code === values[0]
          && state.payment.payment_method === values[1];
        return {
          rows: found ? [{
            ...state.payment,
            order_status: state.order.status,
            order_payment_status: state.order.payment_status,
          }] : [],
        };
      }

      if (statement.startsWith("UPDATE payments SET status = 'PAID'")) {
        if (state.payment.payment_id !== values[0] || state.payment.status !== 'PENDING') return { rows: [] };
        state.payment.status = 'PAID';
        state.payment.paid_at = new Date('2026-01-02T00:00:00Z');
        state.paymentPaidUpdates += 1;
        return { rows: [state.payment] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'PAID'")) {
        state.order.payment_status = 'PAID';
        state.orderPaidUpdates += 1;
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL: ${statement}`);
    },
    release: () => {},
  };

  const pool = { connect: async () => client };
  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: pool };

  return { model: require('../src/models/payment.model'), state, statements };
}

test('creates one reusable pending SePay payment for an owned order', async () => {
  const { model, state } = loadPaymentModel();

  const first = await model.createOrGetSepayPayment(11, 3);
  const second = await model.createOrGetSepayPayment(11, 3);

  assert.equal(first.payment_id, 21);
  assert.equal(first.transaction_code, 'SP11P21');
  assert.equal(second.payment_id, 21);
  assert.equal(state.paymentInserts, 1);
  assert.equal(state.order.payment_status, 'PENDING');
});

test('marks a matching SePay payment paid exactly once when its webhook is retried', async () => {
  const { model, state, statements } = loadPaymentModel();
  await model.createOrGetSepayPayment(11, 3);

  const first = await model.markSepayPaymentAsPaid('SP11P21', 530000);
  const replay = await model.markSepayPaymentAsPaid('SP11P21', 530000);

  assert.equal(first.status, 'PAID');
  assert.equal(replay.status, 'PAID');
  assert.equal(state.paymentPaidUpdates, 1);
  assert.equal(state.orderPaidUpdates, 1);
  assert.equal(state.order.payment_status, 'PAID');
  assert.ok(statements.some(({ statement }) => statement.includes('FOR UPDATE OF p, o')));
});
