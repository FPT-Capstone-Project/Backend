const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function loadSyncApp(syncResult) {
  const servicePath = require.resolve('../src/services/payment.service');
  const controllerPath = require.resolve('../src/controllers/payment.controller');
  const middlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const routesPath = require.resolve('../src/routes/payment.routes');
  const originalService = require.cache[servicePath];
  const originalController = require.cache[controllerPath];
  const originalMiddleware = require.cache[middlewarePath];
  const originalRoutes = require.cache[routesPath];
  const calls = [];

  delete require.cache[servicePath];
  delete require.cache[controllerPath];
  delete require.cache[middlewarePath];
  delete require.cache[routesPath];
  require.cache[servicePath] = {
    exports: {
      syncPayosPayment: async (...args) => {
        calls.push(args);
        return syncResult;
      },
    },
  };
  require.cache[middlewarePath] = {
    exports: {
      authenticate: (req, res, next) => {
        req.user = { user_id: 3 };
        next();
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/payments', require('../src/routes/payment.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({
    message: error.message,
  }));

  return {
    app,
    calls,
    restore() {
      for (const [modulePath, original] of [
        [servicePath, originalService],
        [controllerPath, originalController],
        [middlewarePath, originalMiddleware],
        [routesPath, originalRoutes],
      ]) {
        delete require.cache[modulePath];
        if (original) require.cache[modulePath] = original;
      }
    },
  };
}

test('sync route uses the authenticated owner and returns the reconciled payment state', async () => {
  const synced = {
    synced: true,
    orderId: 11,
    orderStatus: 'PROCESSING',
    paymentStatus: 'PAID',
    paymentCode: '21',
    amount: 530000,
  };
  const loaded = loadSyncApp(synced);
  const server = loaded.app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/payments/orders/11/payos/sync`,
      { method: 'POST' },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: synced });
    assert.deepEqual(loaded.calls, [[3, '11']]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    loaded.restore();
  }
});
