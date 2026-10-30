const test = require('node:test');
const assert = require('node:assert/strict');

function normalize(query) {
  return query.trim().replace(/\s+/g, ' ');
}

function futureDate(minutes = 15) {
  return new Date(Date.now() + (minutes * 60 * 1000));
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
    created_at: new Date(),
    payos_payment_link_id: null,
    payos_checkout_url: null,
    payos_qr_code: null,
    expires_at: futureDate(),
    expires_at_epoch: Math.floor(futureDate().getTime() / 1000),
    ...overrides,
  };
}

function loadPaymentModel({
  order = {},
  payments = [],
  quantity = 2,
  trayCount = 5,
  spawnQuantity = 30,
  heldTrays = 0,
  heldSpawn = 0,
} = {}) {
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
      ...order,
    },
    payments: payments.map(createPayment),
    nextPaymentId: 21,
    paymentPaidUpdates: 0,
    paymentFailedUpdates: 0,
    orderPaidUpdates: 0,
    orderFailedUpdates: 0,
    sessionsCreated: 0,
    assignedTrayCount: 0,
    inventoryTransactions: 0,
    orderItems: [{
      order_item_id: 15,
      quantity,
      mushroom_type_id: 9,
      duration_days: 30,
    }],
    trays: Array.from({ length: trayCount }, (_, index) => ({ tray_id: index + 1 })),
    heldTrays,
    heldSpawn,
    inventory: spawnQuantity == null ? null : {
      inventory_id: 41,
      mushroom_type_id: 9,
      quantity: String(spawnQuantity),
    },
    reservation: {
      reservation_id: 31,
      order_item_id: 15,
      quantity,
      spawn_quantity: quantity * 3,
      status: 'HELD',
      expires_at: futureDate(),
      is_active: true,
    },
  };

  const client = {
    query: async (query, values = []) => {
      const statement = normalize(query);
      statements.push({ statement, values });

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };

      if (statement.startsWith('SELECT order_id, total_amount, status, payment_status')) {
        const found = values[0] === state.order.order_id && values[1] === state.order.user_id;
        return { rows: found ? [state.order] : [] };
      }
      if (statement.startsWith('SELECT order_id FROM payments')) {
        const payment = state.payments.find((entry) => (
          entry.payment_id === values[0] && entry.payment_method === values[1]
        ));
        return { rows: payment ? [{ order_id: payment.order_id }] : [] };
      }
      if (statement.startsWith('SELECT order_id, status, payment_status')) {
        return { rows: values[0] === state.order.order_id ? [state.order] : [] };
      }
      if (statement.startsWith('SELECT oi.order_item_id, oi.quantity, oi.mushroom_type_id')) {
        return { rows: state.orderItems };
      }
      if (statement.startsWith('SELECT t.tray_id')) return { rows: state.trays };
      if (statement.startsWith('SELECT COALESCE(SUM(tr.quantity)')) {
        return { rows: [{ quantity: state.heldTrays }] };
      }
      if (statement.startsWith('SELECT COALESCE(SUM(tr.spawn_quantity)')) {
        return { rows: [{ quantity: state.heldSpawn }] };
      }
      if (statement.startsWith('SELECT inventory_id, mushroom_type_id, quantity')) {
        return { rows: state.inventory ? [state.inventory] : [] };
      }
      if (statement.startsWith('UPDATE tray_reservations SET quantity')) {
        state.reservation.quantity = values[1];
        state.reservation.spawn_quantity = values[2];
        state.reservation.status = 'HELD';
        state.reservation.expires_at = futureDate(values[3]);
        state.reservation.is_active = true;
        return { rows: [state.reservation] };
      }
      if (statement.startsWith('INSERT INTO tray_reservations')) {
        state.reservation.quantity = values[1];
        state.reservation.spawn_quantity = values[2];
        state.reservation.status = 'HELD';
        state.reservation.expires_at = futureDate(values[3]);
        state.reservation.is_active = true;
        return { rows: [state.reservation] };
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
          expires_at: values[3],
          expires_at_epoch: Math.floor(new Date(values[3]).getTime() / 1000),
        });
        state.payments.push(payment);
        return { rows: [payment] };
      }
      if (statement.startsWith("UPDATE orders SET payment_status = 'PENDING'")) {
        state.order.payment_status = 'PENDING';
        return { rows: [] };
      }
      if (statement.startsWith('SELECT payment_id, order_id, amount, payment_method')
        && statement.includes('WHERE payment_id = $1')) {
        const payment = state.payments.find((entry) => (
          entry.payment_id === values[0] && entry.payment_method === values[1]
        ));
        return { rows: payment ? [payment] : [] };
      }
      if (statement.startsWith('SELECT payment_id FROM payments')) return { rows: [] };
      if (statement.startsWith('SELECT p.payment_id, p.order_id, p.status')) {
        const payment = state.payments.find((entry) => (
          entry.payment_id === values[0] && entry.payment_method === values[1]
        ));
        return { rows: payment ? [payment] : [] };
      }
      if (statement.startsWith('SELECT session_id FROM cultivation_sessions')) return { rows: [] };
      if (statement.startsWith('SELECT reservation_id, order_item_id, quantity, spawn_quantity')) {
        return { rows: [state.reservation] };
      }
      if (statement.startsWith("UPDATE tray_reservations SET status = 'EXPIRED'")) {
        state.reservation.status = 'EXPIRED';
        state.reservation.is_active = false;
        return { rows: [{ reservation_id: state.reservation.reservation_id }] };
      }
      if (statement.startsWith("UPDATE payments SET status = 'PAID'")) {
        const payment = state.payments.find((entry) => entry.payment_id === values[0]);
        if (!payment || !['PENDING', 'CANCELLED', 'FAILED'].includes(payment.status)) return { rows: [] };
        payment.status = 'PAID';
        payment.paid_at = new Date();
        payment.transaction_code = values[1];
        state.paymentPaidUpdates += 1;
        return { rows: [payment] };
      }
      if (statement.startsWith('SELECT protocol_id FROM cultivation_protocols')) return { rows: [] };
      if (statement.startsWith('INSERT INTO cultivation_sessions')) {
        state.sessionsCreated += 1;
        return {
          rows: [{
            session_id: 77,
            mushroom_type_id: values[0],
            start_at: new Date(),
            duration_days: values[1],
            status: 'ACTIVE',
            harvest_date: '2030-02-01',
          }],
        };
      }
      if (statement.startsWith('UPDATE spawn_inventory')) {
        if (!state.inventory || Number(state.inventory.quantity) < Number(values[1])) return { rows: [] };
        state.inventory.quantity = String(Number(state.inventory.quantity) - Number(values[1]));
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
      if (statement.startsWith('INSERT INTO cultivation_progress')
        || statement.startsWith('INSERT INTO notifications')) return { rows: [] };
      if (statement.startsWith("UPDATE orders SET payment_status = 'PAID', status = 'PROCESSING'")) {
        state.order.payment_status = 'PAID';
        state.order.status = 'PROCESSING';
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
      if (statement.startsWith('UPDATE payments p SET payos_payment_link_id')) {
        const payment = state.payments.find((entry) => (
          entry.payment_id === values[0] && entry.payment_method === values[5] && entry.status === 'PENDING'
        ));
        if (!payment) return { rows: [] };
        payment.payos_payment_link_id = values[1];
        payment.payos_checkout_url = values[2];
        payment.payos_qr_code = values[3];
        payment.expires_at = values[4];
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

test('creates a whole-VND payment after reserving trays and spawn for the configured hold', async () => {
  const { model, state, statements } = loadPaymentModel();

  const { payment, reused } = await model.createOrGetPayosPayment(11, 3, 15);

  assert.equal(reused, false);
  assert.equal(payment.amount, 530000);
  assert.equal(state.order.payment_status, 'PENDING');
  const reservationUpdate = statements.find(({ statement }) => statement.startsWith('UPDATE tray_reservations SET quantity'));
  assert.deepEqual(reservationUpdate.values.slice(0, 4), [15, 2, 6, 15]);
  assert.ok(statements.some(({ statement }) => statement.startsWith('SELECT inventory_id, mushroom_type_id, quantity')));
  assert.ok(statements.some(({ statement }) => statement.startsWith('SELECT COALESCE(SUM(tr.spawn_quantity)')));
  assert.ok(payment.expires_at instanceof Date);
  assert.equal(statements.filter(({ statement }) => statement === 'BEGIN').length, 1);
  assert.equal(statements.filter(({ statement }) => statement === 'COMMIT').length, 1);
});

test('rejects a fractional VND order total before creating a PayOS payment', async () => {
  const { model, statements } = loadPaymentModel({ order: { total_amount: '530000.49' } });

  await assert.rejects(
    () => model.createOrGetPayosPayment(11, 3, 15),
    { statusCode: 400, message: 'Order total must be a positive whole VND amount' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.equal(statements.some(({ statement }) => statement.startsWith('INSERT INTO payments')), false);
});

test('rechecks capacity and reuses a checkout link that expires no later than the renewed hold', async () => {
  const existing = createPayment({
    payos_payment_link_id: 'plink-21',
    payos_checkout_url: 'https://pay.example.test/21',
  });
  const { model, state, statements } = loadPaymentModel({
    order: { payment_status: 'PENDING' },
    payments: [existing],
  });

  const { payment, reused } = await model.createOrGetPayosPayment(11, 3, 15);

  assert.equal(reused, true);
  assert.equal(payment.payment_id, 21);
  assert.equal(state.payments.length, 1);
  assert.ok(statements.some(({ statement }) => statement.startsWith('SELECT reservation_id, order_item_id, quantity, spawn_quantity')));
  assert.equal(statements.some(({ statement }) => statement.startsWith('INSERT INTO payments')), false);
  const reusableQuery = statements.find(({ statement }) => statement.includes('payos_checkout_url IS NOT NULL'));
  assert.match(reusableQuery.statement, /expires_at <= \$3/);
});

test('saves a checkout link only while its reservation remains active through the link expiry', async () => {
  const { model, state, statements } = loadPaymentModel({ payments: [createPayment()] });
  const expiresAt = futureDate();

  const saved = await model.savePayosPaymentLink(21, {
    paymentLinkId: 'plink-21',
    checkoutUrl: 'https://pay.example.test/21',
    qrCode: 'qr-21',
    expiresAt,
  });

  assert.equal(saved.payos_checkout_url, 'https://pay.example.test/21');
  assert.equal(state.payments[0].status, 'PENDING');
  assert.equal(state.payments[0].expires_at, expiresAt);
  assert.ok(statements[0].statement.includes("tr.status = 'HELD'"));
  assert.ok(statements[0].statement.includes('tr.expires_at >= $5'));
});

test('fulfills a paid order idempotently, deducts spawn, and records an OUT transaction', async () => {
  const { model, state, statements } = loadPaymentModel({
    order: { payment_status: 'PENDING' },
    payments: [createPayment()],
    quantity: 2,
    spawnQuantity: 12,
  });

  const first = await model.markPayosPaymentAsPaid(21, 530000, 'PAYOS-REFERENCE-21');
  const replay = await model.markPayosPaymentAsPaid(21, 530000, 'PAYOS-REFERENCE-21');

  assert.equal(first.status, 'PAID');
  assert.equal(replay.status, 'PAID');
  assert.equal(state.paymentPaidUpdates, 1);
  assert.equal(state.sessionsCreated, 1);
  assert.equal(state.assignedTrayCount, 2);
  assert.equal(state.inventory.quantity, '6');
  assert.equal(state.inventoryTransactions, 1);
  assert.equal(state.reservation.status, 'CONSUMED');
  assert.equal(state.order.payment_status, 'PAID');
  assert.equal(state.order.status, 'PROCESSING');
  const inventoryUpdate = statements.find(({ statement }) => statement.startsWith('UPDATE spawn_inventory'));
  assert.deepEqual(inventoryUpdate.values, [41, 6]);
  const inventoryTransaction = statements.find(({ statement }) => statement.startsWith('INSERT INTO inventory_transactions'));
  assert.deepEqual(inventoryTransaction.values.slice(0, 6), [41, 77, 6, 12, 6, 'Cultivation order 11']);
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
