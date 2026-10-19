const test = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/app-error');

function payment(overrides = {}) {
  return {
    payment_id: 21,
    order_id: 11,
    amount: '530000',
    payment_method: 'PAYOS',
    status: 'PENDING',
    created_at: new Date('2026-01-01T00:00:00Z'),
    payos_payment_link_id: null,
    payos_checkout_url: null,
    payos_qr_code: null,
    ...overrides,
  };
}

function loadPaymentService({
  env = {},
  createResult = { payment: payment(), reused: false },
  createLinkResult = {
    paymentLinkId: 'plink-21',
    checkoutUrl: 'https://pay.example.test/checkout/21',
    qrCode: 'qr-21',
  },
  createLinkError = null,
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
      return null;
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
      ...env,
    },
  };
  require.cache[modelPath] = { exports: paymentModel };
  require.cache[payosPath] = { exports: payos };

  return { service: require('../src/services/payment.service'), calls };
}

test('creates a PayOS link for a new pending payment and persists the link details', async () => {
  const { service, calls } = loadPaymentService();
  const earliestExpiresAt = Math.floor(Date.now() / 1000) + 900;

  const result = await service.createPayosPayment(3, 11);
  const latestExpiresAt = Math.floor(Date.now() / 1000) + 900;
  const { expiresAt, ...responseWithoutExpiry } = result;

  assert.deepEqual(responseWithoutExpiry, {
    paymentId: 21,
    orderCode: 21,
    orderId: 11,
    amount: 530000,
    checkoutUrl: 'https://pay.example.test/checkout/21',
    qrCode: 'qr-21',
    paymentStatus: 'PENDING',
  });
  assert.ok(expiresAt >= earliestExpiresAt && expiresAt <= latestExpiresAt);
  assert.deepEqual(calls[0], { type: 'create', args: [11, 3, 15] });
  assert.deepEqual(calls.find(({ type }) => type === 'sign').args[0], {
    orderCode: 21,
    amount: 530000,
    description: 'DH11',
    returnUrl: 'https://app.example.test/payment/return',
    cancelUrl: 'https://app.example.test/payment/cancel',
    expiredAt: expiresAt,
  });
  assert.deepEqual(calls.find(({ type }) => type === 'create-link').args[0], {
    orderCode: 21,
    amount: 530000,
    description: 'DH11',
    returnUrl: 'https://app.example.test/payment/return',
    cancelUrl: 'https://app.example.test/payment/cancel',
    expiredAt: expiresAt,
    signature: 'test-signature',
  });
  assert.deepEqual(calls.find(({ type }) => type === 'save-link').args, [21, {
    paymentLinkId: 'plink-21',
    checkoutUrl: 'https://pay.example.test/checkout/21',
    qrCode: 'qr-21',
  }]);
});

test('returns an unexpired PayOS checkout link without asking PayOS to create another one', async () => {
  const { service, calls } = loadPaymentService({
    createResult: {
      reused: true,
      payment: payment({
        payos_payment_link_id: 'plink-21',
        payos_checkout_url: 'https://pay.example.test/checkout/21',
        payos_qr_code: 'qr-21',
      }),
    },
  });

  const result = await service.createPayosPayment(3, 11);

  assert.equal(result.checkoutUrl, 'https://pay.example.test/checkout/21');
  assert.equal(result.qrCode, 'qr-21');
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
