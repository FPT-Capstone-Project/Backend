const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentStatusService(result) {
  const envPath = require.resolve('../src/config/env');
  const modelPath = require.resolve('../src/models/payment.model');
  const payosPath = require.resolve('../src/utils/payos');
  const servicePath = require.resolve('../src/services/payment.service');
  const calls = [];

  delete require.cache[envPath];
  delete require.cache[modelPath];
  delete require.cache[payosPath];
  delete require.cache[servicePath];
  require.cache[envPath] = { exports: {} };
  require.cache[modelPath] = {
    exports: {
      findPayosPaymentStatus: async (...args) => {
        calls.push(args);
        return result;
      },
    },
  };
  require.cache[payosPath] = {
    exports: {
      signPaymentRequest: () => '',
      verifyWebhookSignature: () => false,
      createPayosPaymentLink: async () => ({}),
      getPayosPaymentRequest: async () => ({}),
    },
  };

  return { service: require('../src/services/payment.service'), calls };
}

test('returns the pending order payment status for its owner', async () => {
  const { service, calls } = loadPaymentStatusService({
    order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
    payment: { payment_id: 21, order_id: 11, amount: '530000.00', status: 'PENDING' },
  });

  const result = await service.getPayosPaymentStatus(3, 11);

  assert.deepEqual(calls, [[11, 3]]);
  assert.deepEqual(result, {
    orderId: 11,
    orderStatus: 'PENDING',
    paymentStatus: 'PENDING',
    paymentCode: '21',
    amount: 530000,
  });
});

test('returns order PAID and CONFIRMED after a successful PayOS webhook', async () => {
  const { service } = loadPaymentStatusService({
    order: { order_id: 11, status: 'CONFIRMED', payment_status: 'PAID' },
    payment: { payment_id: 21, order_id: 11, amount: '530000', status: 'PAID' },
  });

  assert.deepEqual(await service.getPayosPaymentStatus(3, 11), {
    orderId: 11,
    orderStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentCode: '21',
    amount: 530000,
  });
});

test('does not expose missing or unowned orders and distinguishes an order without payment', async () => {
  const missingOrder = loadPaymentStatusService({ order: null, payment: null });
  await assert.rejects(
    () => missingOrder.service.getPayosPaymentStatus(99, 11),
    { statusCode: 404, message: 'Order not found' },
  );

  const missingPayment = loadPaymentStatusService({
    order: { order_id: 11, status: 'PENDING', payment_status: 'UNPAID' },
    payment: null,
  });
  await assert.rejects(
    () => missingPayment.service.getPayosPaymentStatus(3, 11),
    { statusCode: 404, message: 'Payment not found for this order' },
  );
});

test('payment status polling only reads the model and never creates a payment link', async () => {
  const { service, calls } = loadPaymentStatusService({
    order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
    payment: { payment_id: 21, order_id: 11, amount: '530000', status: 'PENDING' },
  });

  await service.getPayosPaymentStatus(3, 11);
  await service.getPayosPaymentStatus(3, 11);

  assert.deepEqual(calls, [[11, 3], [11, 3]]);
});
