const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentModel({ stalePayments = [] } = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/payment.model');
  const statements = [];
  const state = {
    stalePayments: stalePayments.map((payment) => ({ ...payment })),
    cancelledPaymentIds: [],
    failedOrderIds: [],
    expiredReservations: [],
  };

  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });

      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
        return { rows: [] };
      }

      if (statement.startsWith('SELECT p.payment_id, p.order_id')) {
        return { rows: state.stalePayments };
      }

      if (statement.startsWith("UPDATE payments SET status = 'CANCELLED'")) {
        const payment = state.stalePayments.find(({ payment_id }) => payment_id === values[0]);
        if (!payment || state.cancelledPaymentIds.includes(payment.payment_id)) return { rows: [] };
        state.cancelledPaymentIds.push(payment.payment_id);
        return { rows: [{ payment_id: payment.payment_id }] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'FAILED'")) {
        state.failedOrderIds.push(values[0]);
        return { rows: [] };
      }

      if (statement.startsWith("UPDATE tray_reservations SET status = 'EXPIRED'")) {
        state.expiredReservations.push(values[0]);
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL: ${statement}`);
    },
    release: () => {},
  };

  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: { connect: async () => client } };

  return { model: require('../src/models/payment.model'), state, statements };
}

test('expires stale PayOS payments and fails only their still-pending orders', async () => {
  const { model, state, statements } = loadPaymentModel({
    stalePayments: [{ payment_id: 21, order_id: 11 }],
  });

  const processed = await model.expireStalePayosPayments(15);

  assert.equal(processed, 1);
  assert.deepEqual(state.cancelledPaymentIds, [21]);
  assert.deepEqual(state.failedOrderIds, [11]);
  assert.deepEqual(state.expiredReservations, [11]);
  assert.ok(statements.some(({ statement, values }) => (
    statement.includes('p.payment_method = $1')
    && statement.includes("p.created_at < NOW() - ($2 * INTERVAL '1 minute')")
    && statement.includes('FOR UPDATE OF p, o')
    && values[0] === 'PAYOS'
    && values[1] === 16
  )));
});

test('returns zero when no stale pending PayOS payment is found', async () => {
  const { model, state } = loadPaymentModel();

  assert.equal(await model.expireStalePayosPayments(15), 0);
  assert.deepEqual(state.cancelledPaymentIds, []);
  assert.deepEqual(state.failedOrderIds, []);
});
