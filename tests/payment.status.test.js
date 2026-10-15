const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentStatusService(result) {
  const envPath = require.resolve('../src/config/env');
  const modelPath = require.resolve('../src/models/payment.model');
  const servicePath = require.resolve('../src/services/payment.service');
  const calls = [];

  delete require.cache[envPath];
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[envPath] = { exports: {} };
  require.cache[modelPath] = {
    exports: {
      findSepayPaymentStatus: async (...args) => {
        calls.push(args);
        return result;
      },
    },
  };

  return {
    service: require('../src/services/payment.service'),
    calls,
  };
}

test('returns a pending status from the database for the order owner', async () => {
  const { service, calls } = loadPaymentStatusService({
    order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
    payment: {
      order_id: 11,
      amount: '530000.00',
      status: 'PENDING',
      transaction_code: 'SP11P21',
    },
  });

  const result = await service.getSepayPaymentStatus(3, 11);

  assert.deepEqual(calls, [[11, 3]]);
  assert.deepEqual(result, {
    orderId: 11,
    orderStatus: 'PENDING',
    paymentStatus: 'PENDING',
    paymentCode: 'SP11P21',
    amount: 530000,
  });
});

test('returns a paid status after the webhook updates the database', async () => {
  const { service } = loadPaymentStatusService({
    order: { order_id: 11, status: 'PAID', payment_status: 'PAID' },
    payment: {
      order_id: 11,
      amount: '530000',
      status: 'PAID',
      transaction_code: 'SP11P21',
    },
  });

  assert.deepEqual(await service.getSepayPaymentStatus(3, 11), {
    orderId: 11,
    orderStatus: 'PAID',
    paymentStatus: 'PAID',
    paymentCode: 'SP11P21',
    amount: 530000,
  });
});

test('does not expose an order that is missing or owned by another user', async () => {
  const { service } = loadPaymentStatusService({ order: null, payment: null });

  await assert.rejects(
    () => service.getSepayPaymentStatus(99, 11),
    { statusCode: 404, message: 'Order not found' },
  );
});

test('returns a separate not-found error when the order has no SePay payment', async () => {
  const { service } = loadPaymentStatusService({
    order: { order_id: 11, status: 'PENDING', payment_status: 'UNPAID' },
    payment: null,
  });

  await assert.rejects(
    () => service.getSepayPaymentStatus(3, 11),
    { statusCode: 404, message: 'Payment not found for this order' },
  );
});

test('status polling only reads the status model and does not create or update payments', async () => {
  const { service, calls } = loadPaymentStatusService({
    order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
    payment: {
      order_id: 11,
      amount: '530000',
      status: 'PENDING',
      transaction_code: 'SP11P21',
    },
  });

  await service.getSepayPaymentStatus(3, 11);
  await service.getSepayPaymentStatus(3, 11);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [[11, 3], [11, 3]]);
});
