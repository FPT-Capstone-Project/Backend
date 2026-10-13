const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadPaymentService({ payment = null } = {}) {
  const envPath = require.resolve('../src/config/env');
  const modelPath = require.resolve('../src/models/payment.model');
  const servicePath = require.resolve('../src/services/payment.service');
  const calls = [];
  const paymentModel = {
    createOrGetSepayPayment: async (orderId, userId) => {
      calls.push({ type: 'create', orderId, userId });
      return payment || {
        payment_id: 21,
        order_id: orderId,
        amount: '530000',
        payment_method: 'SEPAY_QR',
        status: 'PENDING',
        transaction_code: 'SP11P21',
      };
    },
    markSepayPaymentAsPaid: async (paymentCode, amount) => {
      calls.push({ type: 'paid', paymentCode, amount });
      return { payment_id: 21, status: 'PAID' };
    },
  };

  delete require.cache[envPath];
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[envPath] = {
    exports: {
      sepayBankCode: 'MB',
      sepayAccountNumber: '0123456789',
      sepayQrTemplate: 'compact',
      sepayWebhookSecret: 'test-webhook-secret',
      sepayWebhookMaxAgeSeconds: 300,
    },
  };
  require.cache[modelPath] = { exports: paymentModel };

  return { service: require('../src/services/payment.service'), calls };
}

function sign(rawBody, timestamp) {
  const hmac = crypto.createHmac('sha256', 'test-webhook-secret');
  hmac.update(`${timestamp}.`);
  hmac.update(rawBody);
  return `sha256=${hmac.digest('hex')}`;
}

test('creates a SePay QR from the server-side pending payment amount', async () => {
  const { service, calls } = loadPaymentService();

  const result = await service.createSepayQrPayment(3, 11);
  const qrUrl = new URL(result.qr_url);

  assert.deepEqual(calls, [{ type: 'create', orderId: 11, userId: 3 }]);
  assert.equal(result.payment_code, 'SP11P21');
  assert.equal(qrUrl.origin, 'https://vietqr.app');
  assert.equal(qrUrl.searchParams.get('acc'), '0123456789');
  assert.equal(qrUrl.searchParams.get('bank'), 'MB');
  assert.equal(qrUrl.searchParams.get('amount'), '530000');
  assert.equal(qrUrl.searchParams.get('des'), 'SP11P21');
});

test('accepts a valid signed money-in webhook and rejects changed raw bytes', async () => {
  const { service, calls } = loadPaymentService();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from(JSON.stringify({
    accountNumber: '0123456789',
    content: 'Payment SP11P21',
    transferType: 'in',
    transferAmount: 530000,
  }));
  const signature = sign(rawBody, timestamp);

  await service.handleSepayWebhook({ rawBody, signature, timestamp });

  assert.deepEqual(calls, [{ type: 'paid', paymentCode: 'SP11P21', amount: 530000 }]);
  await assert.rejects(
    () => service.handleSepayWebhook({
      rawBody: Buffer.from(`${rawBody.toString('utf8')} `),
      signature,
      timestamp,
    }),
    { statusCode: 401, message: 'Invalid SePay webhook signature' },
  );
  assert.equal(calls.length, 1);
});
