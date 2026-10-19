const test = require('node:test');
const assert = require('node:assert/strict');

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function loadApp(handlePayosWebhookResult = null) {
  const servicePath = require.resolve('../src/services/payment.service');
  const controllerPath = require.resolve('../src/controllers/payment.controller');
  const paymentRoutesPath = require.resolve('../src/routes/payment.routes');
  const rootRoutesPath = require.resolve('../src/routes/root.routes');
  const appPath = require.resolve('../src/app');
  let received;

  delete require.cache[servicePath];
  delete require.cache[controllerPath];
  delete require.cache[paymentRoutesPath];
  delete require.cache[rootRoutesPath];
  delete require.cache[appPath];
  require.cache[servicePath] = {
    exports: {
      handlePayosWebhook: async (payload) => {
        received = payload;
        return handlePayosWebhookResult;
      },
      payosWebhookHealth: () => ({ ok: true }),
    },
  };

  return { app: require('../src/app'), getReceived: () => received };
}

test('accepts a JSON PayOS webhook and returns the required acknowledgement', async () => {
  const { app, getReceived } = loadApp();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const payload = {
      code: '00',
      success: true,
      data: { code: '00', orderCode: 21, amount: 530000, reference: 'PAYOS-REFERENCE-21' },
      signature: 'valid-signature',
    };
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/payments/payos/webhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(getReceived(), payload);
  } finally {
    await close(server);
  }
});

test('acknowledges invalid PayOS webhook signatures without exposing an error', async () => {
  const { app } = loadApp({ invalidSignature: true });
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/payments/payos/webhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '00', success: true, data: {}, signature: 'wrong-signature' }),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: 'invalid signature' });
  } finally {
    await close(server);
  }
});

test('exposes a health check for PayOS webhook registration', async () => {
  const { app } = loadApp();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/payments/payos/webhook`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await close(server);
  }
});
