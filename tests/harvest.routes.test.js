const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('WF-04 routes enforce staff harvest access and authenticated receiving ownership', async () => {
  const userModelPath = require.resolve('../src/models/user.model');
  const authServicePath = require.resolve('../src/services/auth.service');
  const authMiddlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const harvestControllerPath = require.resolve('../src/controllers/harvest.controller');
  const harvestRequestControllerPath = require.resolve('../src/controllers/harvestRequest.controller');
  const orderControllerPath = require.resolve('../src/controllers/order.controller');
  const harvestRoutePath = require.resolve('../src/routes/harvest.routes');
  const requestRoutePath = require.resolve('../src/routes/harvestRequest.routes');
  const orderRoutePath = require.resolve('../src/routes/order.routes');
  const calls = [];
  const handler = (name) => (req, res) => {
    calls.push({ name, user: req.user, params: req.params, body: req.body });
    res.sendStatus(204);
  };

  require.cache[userModelPath] = {
    exports: {
      findById: async (userId) => ({ user_id: Number(userId), role_id: Number(userId), status: 'ACTIVE' }),
    },
  };
  require.cache[authServicePath] = { exports: { sanitizeUser: (user) => user } };
  require.cache[harvestControllerPath] = {
    exports: {
      create: handler('createHarvest'),
      start: handler('startHarvest'),
      recordYield: handler('recordYield'),
      complete: handler('completeHarvest'),
      getById: handler('getHarvest'),
      adminList: handler('listHarvests'),
    },
  };
  require.cache[harvestRequestControllerPath] = {
    exports: {
      create: handler('createRequest'),
      update: handler('updateRequest'),
      complete: handler('completeRequest'),
    },
  };
  require.cache[orderControllerPath] = {
    exports: {
      create: handler('createOrder'),
      list: handler('listOrders'),
      getById: handler('getOrder'),
      cancel: handler('cancelOrder'),
      harvestHistory: handler('harvestHistory'),
    },
  };
  delete require.cache[authMiddlewarePath];
  delete require.cache[harvestRoutePath];
  delete require.cache[requestRoutePath];
  delete require.cache[orderRoutePath];

  const app = express();
  app.use(express.json());
  app.use('/api/harvests', require('../src/routes/harvest.routes'));
  app.use('/api/harvest-requests', require('../src/routes/harvestRequest.routes'));
  app.use('/api/orders', require('../src/routes/order.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const env = require('../src/config/env');
    const operatorToken = jwt.sign({ sub: '1' }, env.jwtSecret);
    const customerToken = jwt.sign({ sub: '3' }, env.jwtSecret);
    const headers = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

    const created = await fetch(`http://127.0.0.1:${server.address().port}/api/harvests`, {
      method: 'POST', headers: headers(operatorToken), body: JSON.stringify({ sessionId: 15 }),
    });
    assert.equal(created.status, 204);

    const forbiddenCreate = await fetch(`http://127.0.0.1:${server.address().port}/api/harvests`, {
      method: 'POST', headers: headers(customerToken), body: JSON.stringify({ sessionId: 15 }),
    });
    assert.equal(forbiddenCreate.status, 403);

    const yieldResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/harvests/8/yield`, {
      method: 'POST', headers: headers(operatorToken), body: JSON.stringify({ totalWeightKg: 1 }),
    });
    assert.equal(yieldResponse.status, 204);

    const requestCreated = await fetch(`http://127.0.0.1:${server.address().port}/api/harvest-requests`, {
      method: 'POST', headers: headers(customerToken), body: JSON.stringify({ sessionId: 15, harvestMethod: 'PICKUP' }),
    });
    assert.equal(requestCreated.status, 204);

    const requestUnauthenticated = await fetch(
      `http://127.0.0.1:${server.address().port}/api/harvest-requests/4`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ harvestMethod: 'DELIVERY' }) },
    );
    assert.equal(requestUnauthenticated.status, 401);

    const history = await fetch(
      `http://127.0.0.1:${server.address().port}/api/orders/12/harvest-history`,
      { headers: headers(operatorToken) },
    );
    assert.equal(history.status, 204);
    const forbiddenHistory = await fetch(
      `http://127.0.0.1:${server.address().port}/api/orders/12/harvest-history`,
      { headers: headers(customerToken) },
    );
    assert.equal(forbiddenHistory.status, 403);

    assert.deepEqual(calls.map((call) => call.name), [
      'createHarvest', 'recordYield', 'createRequest', 'harvestHistory',
    ]);
    assert.equal(calls[0].user.role_id, 1);
    assert.equal(calls[2].user.role_id, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
