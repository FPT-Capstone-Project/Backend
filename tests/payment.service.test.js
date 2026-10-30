const test = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/app-error');

function futureExpiry(minutes = 15) {
  return new Date(Date.now() + (minutes * 60 * 1000));
}

function payment(overrides = {}) {
  const expiresAt = futureExpiry();
  return {
    payment_id: 21,
    order_id: 11,
    amount: '530000',
    payment_method: 'PAYOS',
    status: 'PENDING',
    created_at: new Date(),
    payos_payment_link_id: null,
    payos_checkout_url: null,
    payos_qr_code: null,
    expires_at: expiresAt,
    expires_at_epoch: Math.floor(expiresAt.getTime() / 1000),
    ...overrides,
  };
}

function loadPaymentService({
  env = {},
  createResult = { payment: payment(), reused: false },
  paymentStatusResult = null,
  createLinkResult = {
    paymentLinkId: 'plink-21',
    checkoutUrl: 'https://pay.example.test/checkout/21',
    qrCode: 'qr-21',
  },
  createLinkError = null,
  payosPaymentResult = null,
  signatureValid = true,
} = {}) {
  const envPath = require.resolve('../src/config/env');
  const modelPath = require.resolve('../src/models/payment.model');
  const payosPath = require.resolve('../src/utils/payos');
  const servicePath = require.resolve('../src/services/payment.service');
  const calls = [];
  const paymentModel = {
    createOrGetPayosPayment: async (...args) => {
      calls.push({ type: 'create', args });
      return createResult;
    },
    savePayosPaymentLink: async (...args) => {
      calls.push({ type: 'save-link', args });
      return {
        ...createResult.payment,
        payos_payment_link_id: args[1].paymentLinkId,
        payos_checkout_url: args[1].checkoutUrl,
        payos_qr_code: args[1].qrCode,
      };
    },
    markPayosPaymentFailed: async (...args) => {
      calls.push({ type: 'failed', args });
      return null;
    },
    markPayosPaymentAsPaid: async (...args) => {
      calls.push({ type: 'paid', args });
      return { payment_id: args[0], status: 'PAID' };
    },
    findPayosPaymentStatus: async (...args) => {
      calls.push({ type: 'status', args });
      return paymentStatusResult;
    },
  };
  const payos = {
    signPaymentRequest: (request) => {
      calls.push({ type: 'sign', args: [request] });
      return 'test-signature';
    },
    verifyWebhookSignature: (...args) => {
      calls.push({ type: 'verify', args });
      return signatureValid;
    },
    createPayosPaymentLink: async (request) => {
      calls.push({ type: 'create-link', args: [request] });
      if (createLinkError) throw createLinkError;
      return createLinkResult;
    },
    getPayosPaymentRequest: async (...args) => {
      calls.push({ type: 'payos-status', args });
      return payosPaymentResult;
    },
  };

  delete require.cache[envPath];
  delete require.cache[modelPath];
  delete require.cache[payosPath];
  delete require.cache[servicePath];
  require.cache[envPath] = {
    exports: {
      payosClientId: 'client-id',
      payosApiKey: 'api-key',
      payosChecksumKey: 'checksum-key',
      payosReturnUrl: 'https://app.example.test/payment/return',
      payosCancelUrl: 'https://app.example.test/payment/cancel',
      payosPaymentExpireMinutes: 15,
      cultivationReservationHoldMinutes: 15,
      ...env,
    },
  };
  require.cache[modelPath] = { exports: paymentModel };
  require.cache[payosPath] = { exports: payos };

  return { service: require('../src/services/payment.service'), calls };
}

test('uses the persisted reservation expiry for the PayOS link and response', async () => {
  const persistedExpiry = futureExpiry(12);
  const pendingPayment = payment({
    expires_at: persistedExpiry,
    expires_at_epoch: Math.floor(persistedExpiry.getTime() / 1000),
  });
  const { service, calls } = loadPaymentService({
    createResult: { payment: pendingPayment, reused: false },
  });

  const result = await service.createPayosPayment(3, 11);
  const expiresAt = Math.floor(persistedExpiry.getTime() / 1000);

  assert.equal(result.expiresAt, expiresAt);
  assert.deepEqual(calls[0], { type: 'create', args: [11, 3, 15] });
  assert.deepEqual(calls.find(({ type }) => type === 'sign').args[0], {
    orderCode: 21,
    amount: 530000,
    description: 'DH11',
    returnUrl: 'https://app.example.test/payment/return',
    cancelUrl: 'https://app.example.test/payment/cancel',
    expiredAt: expiresAt,
  });
  assert.deepEqual(calls.find(({ type }) => type === 'save-link').args, [21, {
    paymentLinkId: 'plink-21',
    checkoutUrl: 'https://pay.example.test/checkout/21',
    qrCode: 'qr-21',
    expiresAt: persistedExpiry,
  }]);
});

test('returns an unexpired PayOS checkout link without creating another one', async () => {
  const persistedExpiry = futureExpiry();
  const { service, calls } = loadPaymentService({
    createResult: {
      reused: true,
      payment: payment({
        payos_payment_link_id: 'plink-21',
        payos_checkout_url: 'https://pay.example.test/checkout/21',
        payos_qr_code: 'qr-21',
        expires_at: persistedExpiry,
        expires_at_epoch: Math.floor(persistedExpiry.getTime() / 1000),
      }),
    },
  });

  const result = await service.createPayosPayment(3, 11);

  assert.equal(result.checkoutUrl, 'https://pay.example.test/checkout/21');
  assert.equal(result.qrCode, 'qr-21');
  assert.equal(result.expiresAt, Math.floor(persistedExpiry.getTime() / 1000));
  assert.deepEqual(calls, [{ type: 'create', args: [11, 3, 15] }]);
});

test('marks a newly created payment failed when PayOS rejects the link request', async () => {
  const { service, calls } = loadPaymentService({
    createLinkError: new AppError('PayOS rejected payment', 502),
  });

  await assert.rejects(
    () => service.createPayosPayment(3, 11),
    { statusCode: 502, message: 'PayOS rejected payment' },
  );
  assert.deepEqual(calls.find(({ type }) => type === 'failed').args, [21]);
});

test('rejects payment-link creation before changing the database when PayOS is not configured', async () => {
  const { service, calls } = loadPaymentService({ env: { payosApiKey: '' } });

  await assert.rejects(
    () => service.createPayosPayment(3, 11),
    { statusCode: 503, message: 'PayOS is not configured' },
  );
  assert.deepEqual(calls, []);
});

test('rejects a PayOS link request with an invalid redirect URL before changing the database', async () => {
  const { service, calls } = loadPaymentService({ env: { payosReturnUrl: 'ftp://example.test/return' } });

  await assert.rejects(
    () => service.createPayosPayment(3, 11),
    { statusCode: 503, message: 'PAYOS_RETURN_URL must be a valid HTTP(S) URL' },
  );
  assert.deepEqual(calls, []);
});

test('processes a valid successful PayOS webhook using its order code, amount, and reference', async () => {
  const { service, calls } = loadPaymentService();
  const payload = {
    code: '00',
    success: true,
    data: { code: '00', orderCode: 21, amount: 530000, reference: 'PAYOS-REFERENCE-21' },
    signature: 'valid-signature',
  };

  await service.handlePayosWebhook(payload);

  assert.deepEqual(calls.find(({ type }) => type === 'verify').args, [payload.data, 'valid-signature']);
  assert.deepEqual(calls.find(({ type }) => type === 'paid').args, [21, 530000, 'PAYOS-REFERENCE-21']);
  assert.equal(calls.some(({ type }) => type === 'failed'), false);
});

test('records a failed PayOS event but acknowledges an invalid signature without database changes', async (t) => {
  const failed = loadPaymentService();
  await failed.service.handlePayosWebhook({
    code: '20',
    success: false,
    data: { code: '20', orderCode: 21, amount: 530000 },
    signature: 'valid-signature',
  });
  assert.deepEqual(failed.calls.find(({ type }) => type === 'failed').args, [21]);
  assert.equal(failed.calls.some(({ type }) => type === 'paid'), false);

  const invalid = loadPaymentService({ signatureValid: false });
  const warning = t.mock.method(console, 'warn', () => {});
  const result = await invalid.service.handlePayosWebhook({
    code: '00',
    success: true,
    data: { code: '00', orderCode: 21, amount: 530000 },
    signature: 'wrong-signature',
  });

  assert.deepEqual(result, { invalidSignature: true });
  assert.equal(invalid.calls.some(({ type }) => type === 'paid' || type === 'failed'), false);
  assert.equal(warning.mock.calls[0].arguments[1].reason, 'invalid_signature');
});

test('syncs a customer payment only after PayOS confirms a sufficient paid amount', async () => {
  const { service, calls } = loadPaymentService({
    paymentStatusResult: {
      order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
      payment: payment({ payment_id: 21, order_id: 11, amount: '530000' }),
    },
    payosPaymentResult: {
      orderCode: 21,
      status: 'PAID',
      amount: 530000,
      amountPaid: 530000,
      reference: 'PAYOS-REFERENCE-21',
    },
  });

  await service.syncPayosPayment(3, 11);

  assert.deepEqual(calls.find(({ type }) => type === 'status').args, [11, 3]);
  assert.deepEqual(calls.find(({ type }) => type === 'payos-status').args, [21]);
  assert.deepEqual(calls.find(({ type }) => type === 'paid').args, [
    21,
    530000,
    'PAYOS-REFERENCE-21',
  ]);
});

test('does not update a local payment when PayOS still reports it as pending', async () => {
  const { service, calls } = loadPaymentService({
    paymentStatusResult: {
      order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
      payment: payment({ payment_id: 21, order_id: 11, amount: '530000' }),
    },
    payosPaymentResult: {
      orderCode: 21,
      status: 'PENDING',
      amountPaid: 0,
    },
  });

  await service.syncPayosPayment(3, 11);

  assert.deepEqual(calls.find(({ type }) => type === 'payos-status').args, [21]);
  assert.equal(calls.some(({ type }) => type === 'paid'), false);
});

test('does not update a local payment when PayOS reports an insufficient paid amount', async () => {
  const { service, calls } = loadPaymentService({
    paymentStatusResult: {
      order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
      payment: payment({ payment_id: 21, order_id: 11, amount: '530000' }),
    },
    payosPaymentResult: {
      orderCode: 21,
      status: 'PAID',
      amount: 530000,
      amountPaid: 500000,
    },
  });

  await assert.rejects(
    () => service.syncPayosPayment(3, 11),
    { statusCode: 409, message: 'PayOS paid amount is lower than the order total' },
  );
  assert.equal(calls.some(({ type }) => type === 'paid'), false);
});

test('does not update a local payment when PayOS reports a different order total', async () => {
  const { service, calls } = loadPaymentService({
    paymentStatusResult: {
      order: { order_id: 11, status: 'PENDING', payment_status: 'PENDING' },
      payment: payment({ payment_id: 21, order_id: 11, amount: '530000' }),
    },
    payosPaymentResult: {
      orderCode: 21,
      status: 'PAID',
      amount: 530001,
      amountPaid: 530001,
    },
  });

  await assert.rejects(
    () => service.syncPayosPayment(3, 11),
    { statusCode: 502, message: 'PayOS payment amount does not match this order' },
  );
  assert.equal(calls.some(({ type }) => type === 'paid'), false);
});

test('does not call PayOS again when the local payment is already paid', async () => {
  const { service, calls } = loadPaymentService({
    paymentStatusResult: {
      order: { order_id: 11, status: 'PROCESSING', payment_status: 'PAID' },
      payment: payment({ payment_id: 21, order_id: 11, status: 'PAID' }),
    },
  });

  const result = await service.syncPayosPayment(3, 11);

  assert.deepEqual(result, {
    synced: false,
    payosStatus: 'PAID',
    orderId: 11,
    orderStatus: 'PROCESSING',
    paymentStatus: 'PAID',
    paymentCode: '21',
    amount: 530000,
  });
  assert.equal(calls.some(({ type }) => type === 'payos-status'), false);
});
