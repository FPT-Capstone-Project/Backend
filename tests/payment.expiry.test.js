const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentModel({ staleReservations = [], hasPendingPayment = true } = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/payment.model');
  const statements = [];
  const state = {
    staleReservations: staleReservations.map((reservation) => ({ ...reservation })),
    cancelledOrderIds: [],
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

      if (statement.startsWith('SELECT tr.reservation_id, oi.order_id')) {
        return { rows: state.staleReservations };
      }
      if (statement.startsWith('SELECT order_id FROM orders')) {
        return { rows: [{ order_id: values[0] }] };
      }
      if (statement.startsWith('SELECT payment_id FROM payments')) {
        return { rows: hasPendingPayment ? [{ payment_id: values[0] + 10 }] : [] };
      }
      if (statement.startsWith('SELECT reservation_id FROM tray_reservations')) {
        return { rows: [{ reservation_id: values[0] }] };
      }

      if (statement.startsWith("UPDATE payments SET status = 'CANCELLED'")) {
        if (!hasPendingPayment || state.cancelledOrderIds.includes(values[0])) return { rows: [] };
        state.cancelledOrderIds.push(values[0]);
        return { rows: [{ payment_id: values[0] + 10 }] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'FAILED'")) {
        state.failedOrderIds.push(values[0]);
        return { rows: [] };
      }

      if (statement.startsWith("UPDATE tray_reservations SET status = 'EXPIRED'")) {
        state.expiredReservations.push(values[0]);
        return { rows: [{ reservation_id: values[0] }] };
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

test('expires held reservations, cancels their pending payment, and leaves the order pending for retry', async () => {
  const { model, state, statements } = loadPaymentModel({
    staleReservations: [{ reservation_id: 31, order_id: 11 }],
  });

  const processed = await model.expireStalePayosPayments();

  assert.equal(processed, 1);
  assert.deepEqual(state.cancelledOrderIds, [11]);
  assert.deepEqual(state.failedOrderIds, [11]);
  assert.deepEqual(state.expiredReservations, [31]);
  assert.ok(statements.some(({ statement }) => (
    statement.includes("tr.status = 'HELD' AND tr.expires_at <= CURRENT_TIMESTAMP")
  )));
  const orderLock = statements.findIndex(({ statement }) => statement.startsWith('SELECT order_id FROM orders'));
  const paymentLock = statements.findIndex(({ statement }) => statement.startsWith('SELECT payment_id FROM payments'));
  const reservationLock = statements.findIndex(({ statement }) => statement.startsWith('SELECT reservation_id FROM tray_reservations'));
  assert.ok(orderLock < paymentLock && paymentLock < reservationLock);
});

test('returns zero when no stale pending PayOS payment is found', async () => {
  const { model, state } = loadPaymentModel();

  assert.equal(await model.expireStalePayosPayments(), 0);
  assert.deepEqual(state.cancelledOrderIds, []);
  assert.deepEqual(state.failedOrderIds, []);
});
