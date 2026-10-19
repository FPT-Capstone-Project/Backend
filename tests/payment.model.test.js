const test = require('node:test');
const assert = require('node:assert/strict');

function normalize(query) {
  return query.trim().replace(/\s+/g, ' ');
}

function createPayment(overrides = {}) {
  return {
    payment_id: 21,
    order_id: 11,
    amount: 530000,
    payment_method: 'PAYOS',
    transaction_code: null,
    status: 'PENDING',
    paid_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    payos_payment_link_id: null,
    payos_checkout_url: null,
    payos_qr_code: null,
    ...overrides,
  };
}

function loadPaymentModel({ order = {}, payments = [] } = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/payment.model');
  const statements = [];
  const state = {
    order: {
      order_id: 11,
      user_id: 3,
      total_amount: '530000.49',
      status: 'PENDING',
      payment_status: 'UNPAID',
      ...order,
    },
    payments: payments.map(createPayment),
    nextPaymentId: 21,
    paymentPaidUpdates: 0,
    orderPaidUpdates: 0,
    paymentFailedUpdates: 0,
    orderFailedUpdates: 0,
  };

  const client = {
    query: async (query, values = []) => {
      const statement = normalize(query);
      statements.push({ statement, values });

      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };

      if (statement.startsWith('SELECT order_id, total_amount, status, payment_status')) {
        return {
          rows: values[0] === state.order.order_id && values[1] === state.order.user_id ? [state.order] : [],
        };
      }

      if (statement.includes('payos_checkout_url IS NOT NULL')) {
        const reusable = [...state.payments]
          .reverse()
          .find((payment) => payment.order_id === values[0]
            && payment.payment_method === values[1]
            && payment.status === 'PENDING'
            && payment.payos_checkout_url);
        return { rows: reusable ? [reusable] : [] };
      }

      if (statement.startsWith('INSERT INTO payments')) {
        const payment = createPayment({
          payment_id: state.nextPaymentId++,
          order_id: values[0],
          amount: values[1],
          payment_method: values[2],
        });
        state.payments.push(payment);
        return { rows: [payment] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'PENDING'")) {
        state.order.payment_status = 'PENDING';
        return { rows: [] };
      }

      if (statement.startsWith('SELECT p.payment_id, p.order_id, p.status')) {
        const payment = state.payments.find((entry) => (
          entry.payment_id === values[0] && entry.payment_method === values[1]
        ));
        return { rows: payment ? [payment] : [] };
      }

      if (statement.startsWith('SELECT payment_id, order_id, amount, payment_method')
        && statement.includes('WHERE payment_id = $1')) {
        const payment = state.payments.find((entry) => (
          entry.payment_id === values[0] && entry.payment_method === values[1]
        ));
        return { rows: payment ? [payment] : [] };
      }

      if (statement.startsWith('SELECT order_id, status, payment_status')) {
        return { rows: values[0] === state.order.order_id ? [state.order] : [] };
      }

      if (statement.startsWith("UPDATE payments SET status = 'PAID'")) {
        const payment = state.payments.find((entry) => entry.payment_id === values[0]);
        if (!payment || !['PENDING', 'CANCELLED', 'FAILED'].includes(payment.status)) return { rows: [] };
        payment.status = 'PAID';
        payment.paid_at = new Date('2026-01-02T00:00:00Z');
        payment.transaction_code = values[1];
        state.paymentPaidUpdates += 1;
        return { rows: [payment] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'PAID', status = 'CONFIRMED'")) {
        state.order.payment_status = 'PAID';
        state.order.status = 'CONFIRMED';
        state.orderPaidUpdates += 1;
        return { rows: [] };
      }

      if (statement.startsWith("UPDATE payments SET status = 'FAILED'")) {
        const payment = state.payments.find((entry) => entry.payment_id === values[0]);
        if (!payment || payment.status !== 'PENDING') return { rows: [] };
        payment.status = 'FAILED';
        state.paymentFailedUpdates += 1;
        return { rows: [payment] };
      }

      if (statement.startsWith("UPDATE orders SET payment_status = 'FAILED'")) {
        state.order.payment_status = 'FAILED';
        state.orderFailedUpdates += 1;
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL: ${statement}`);
    },
    release: () => {},
  };

  const pool = {
    connect: async () => client,
    query: async (query, values = []) => {
      const statement = normalize(query);
      statements.push({ statement, values });

      if (statement.startsWith('UPDATE payments SET payos_payment_link_id')) {
        const payment = state.payments.find((entry) => (
          entry.payment_id === values[0] && entry.payment_method === values[4] && entry.status === 'PENDING'
        ));
        if (!payment) return { rows: [] };
        payment.payos_payment_link_id = values[1];
        payment.payos_checkout_url = values[2];
        payment.payos_qr_code = values[3];
        return { rows: [payment] };
      }

      throw new Error(`Unexpected pool SQL: ${statement}`);
    },
  };

  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: pool };

  return { model: require('../src/models/payment.model'), state, statements };
}

test('creates a rounded pending PayOS payment and marks its order pending in one transaction', async () => {
  const { model, state, statements } = loadPaymentModel();

  const { payment, reused } = await model.createOrGetPayosPayment(11, 3, 15);

  assert.equal(reused, false);
  assert.equal(payment.payment_id, 21);
  assert.equal(payment.amount, 530000);
  assert.equal(payment.payment_method, 'PAYOS');
  assert.equal(state.order.payment_status, 'PENDING');
  assert.ok(statements.some(({ statement }) => statement.includes('FOR UPDATE')));
  assert.ok(statements.some(({ statement, values }) => (
    statement.includes('payos_checkout_url IS NOT NULL') && values[2] === 15
  )));
  assert.equal(statements.filter(({ statement }) => statement === 'BEGIN').length, 1);
  assert.equal(statements.filter(({ statement }) => statement === 'COMMIT').length, 1);
});

test('reuses an unexpired pending PayOS checkout link without creating another payment', async () => {
  const existing = createPayment({
    payos_payment_link_id: 'plink-21',
    payos_checkout_url: 'https://pay.example.test/21',
    payos_qr_code: 'qr-21',
  });
  const { model, state, statements } = loadPaymentModel({
    order: { payment_status: 'PENDING' },
    payments: [existing],
  });

  const { payment, reused } = await model.createOrGetPayosPayment(11, 3, 15);

  assert.equal(reused, true);
  assert.equal(payment.payment_id, 21);
  assert.equal(state.payments.length, 1);
  assert.equal(statements.some(({ statement }) => statement.startsWith('INSERT INTO payments')), false);
});

test('saves the PayOS checkout fields only on its pending PayOS payment', async () => {
  const { model, state } = loadPaymentModel({ payments: [createPayment()] });

  const saved = await model.savePayosPaymentLink(21, {
    paymentLinkId: 'plink-21',
    checkoutUrl: 'https://pay.example.test/21',
    qrCode: 'qr-21',
  });

  assert.equal(saved.payos_payment_link_id, 'plink-21');
  assert.equal(saved.payos_checkout_url, 'https://pay.example.test/21');
  assert.equal(saved.payos_qr_code, 'qr-21');
  assert.equal(state.payments[0].status, 'PENDING');
});

test('marks a completed PayOS payment and order paid exactly once in one transaction', async () => {
  const { model, state, statements } = loadPaymentModel({
    order: { payment_status: 'PENDING' },
    payments: [createPayment()],
  });

  const first = await model.markPayosPaymentAsPaid(21, 530000, 'PAYOS-REFERENCE-21');
  const replay = await model.markPayosPaymentAsPaid(21, 530000, 'PAYOS-REFERENCE-21');

  assert.equal(first.status, 'PAID');
  assert.equal(replay.status, 'PAID');
  assert.equal(first.transaction_code, 'PAYOS-REFERENCE-21');
  assert.equal(state.paymentPaidUpdates, 1);
  assert.equal(state.orderPaidUpdates, 1);
  assert.equal(state.order.payment_status, 'PAID');
  assert.equal(state.order.status, 'CONFIRMED');
  assert.ok(statements.some(({ statement }) => statement.includes("status IN ('PENDING', 'CANCELLED', 'FAILED')")));
});

test('marks a pending PayOS payment failed and leaves the order pending for retry', async () => {
  const { model, state } = loadPaymentModel({
    order: { payment_status: 'PENDING' },
    payments: [createPayment()],
  });

  const payment = await model.markPayosPaymentFailed(21);

  assert.equal(payment.status, 'FAILED');
  assert.equal(state.paymentFailedUpdates, 1);
  assert.equal(state.order.payment_status, 'FAILED');
  assert.equal(state.order.status, 'PENDING');
  assert.equal(state.orderFailedUpdates, 1);
});
