const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadPayos(envOverrides = {}) {
  const envPath = require.resolve('../src/config/env');
  const payosPath = require.resolve('../src/utils/payos');

  delete require.cache[envPath];
  delete require.cache[payosPath];
  require.cache[envPath] = {
    exports: {
      payosClientId: 'test-client-id',
      payosApiKey: 'test-api-key',
      payosChecksumKey: 'test-checksum-key',
      ...envOverrides,
    },
  };

  return require('../src/utils/payos');
}

function hmac(value) {
  return crypto.createHmac('sha256', 'test-checksum-key').update(value).digest('hex');
}

test('signs payment-link data in PayOS alphabetical-key order', () => {
  const { signPaymentRequest } = loadPayos();

  const signature = signPaymentRequest({
    amount: 530000,
    cancelUrl: 'https://app.example.test/payment/cancel',
    description: 'DH11',
    orderCode: 21,
    returnUrl: 'https://app.example.test/payment/return',
  });

  assert.equal(signature, hmac(
    'amount=530000&cancelUrl=https://app.example.test/payment/cancel&description=DH11&orderCode=21&returnUrl=https://app.example.test/payment/return',
  ));
});

test('verifies a signed PayOS webhook object and rejects an altered signature', () => {
  const { verifyWebhookSignature } = loadPayos();
  const data = {
    amount: 530000,
    orderCode: 21,
    nested: { z: 2, a: 1 },
    nullable: null,
    undefinedValue: 'undefined',
    items: [{ z: 2, a: 1 }],
  };
  const canonical = 'amount=530000&items=[{"a":1,"z":2}]&nested={"a":1,"z":2}&nullable=&orderCode=21&undefinedValue=';

  assert.equal(verifyWebhookSignature(data, hmac(canonical)), true);
  assert.equal(verifyWebhookSignature(data, `${hmac(canonical)}0`), false);
  assert.equal(verifyWebhookSignature(data, hmac(canonical).slice(1)), false);
  assert.equal(verifyWebhookSignature(null, hmac(canonical)), false);
});

test('creates a PayOS payment link with the required merchant headers and returns data', async (t) => {
  const { createPayosPaymentLink } = loadPayos();
  let request;
  t.mock.method(global, 'fetch', async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({
        code: '00',
        data: { paymentLinkId: 'plink-21', checkoutUrl: 'https://pay.example.test/21' },
      }),
    };
  });

  const payload = { orderCode: 21, amount: 530000, description: 'DH11', signature: 'signature' };
  const result = await createPayosPaymentLink(payload);

  assert.deepEqual(result, { paymentLinkId: 'plink-21', checkoutUrl: 'https://pay.example.test/21' });
  assert.equal(request.url, 'https://api-merchant.payos.vn/v2/payment-requests');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(request.options.headers, {
    'Content-Type': 'application/json',
    'x-client-id': 'test-client-id',
    'x-api-key': 'test-api-key',
  });
  assert.deepEqual(JSON.parse(request.options.body), payload);
  assert.ok(request.options.signal);
});

test('surfaces PayOS API errors and confirms a configured webhook URL', async (t) => {
  const { createPayosPaymentLink, confirmPayosWebhook } = loadPayos();
  const requests = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/v2/payment-requests')) {
      return { ok: false, json: async () => ({ code: '20', desc: 'Invalid request' }) };
    }
    return { ok: true, json: async () => ({ code: '00', data: { webhookUrl: 'https://api.example.test/webhook' } }) };
  });

  await assert.rejects(
    () => createPayosPaymentLink({ orderCode: 21 }),
    { statusCode: 502, message: 'Invalid request' },
  );
  assert.deepEqual(
    await confirmPayosWebhook('https://api.example.test/webhook'),
    { webhookUrl: 'https://api.example.test/webhook' },
  );
  assert.equal(requests[1].url, 'https://api-merchant.payos.vn/confirm-webhook');
  assert.deepEqual(JSON.parse(requests[1].options.body), { webhookUrl: 'https://api.example.test/webhook' });
});

test('rejects payment-link creation when PayOS credentials are incomplete', async () => {
  const { createPayosPaymentLink } = loadPayos({ payosChecksumKey: '' });

  await assert.rejects(
    () => createPayosPaymentLink({ orderCode: 21 }),
    { statusCode: 503, message: 'PayOS is not configured' },
  );
});
