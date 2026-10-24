const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('farm operators cannot cancel rentals but can send rental notifications', async () => {
  const userModelPath = require.resolve('../src/models/user.model');
  const controllerPath = require.resolve('../src/controllers/rental.controller');
  const authServicePath = require.resolve('../src/services/auth.service');
  const authMiddlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const routePath = require.resolve('../src/routes/rental.routes');
  let cancelCalls = 0;
  let notificationCalls = 0;
  const noop = (req, res) => res.sendStatus(204);

  require.cache[userModelPath] = {
    exports: {
      findById: async (userId) => ({ user_id: userId, role_id: Number(userId), status: 'ACTIVE' }),
    },
  };
  require.cache[controllerPath] = {
    exports: {
      adminList: noop,
      adminGetById: noop,
      adminCreateFromOrder: noop,
      adminStartCultivation: noop,
      adminUpdate: noop,
      adminCreateProgress: noop,
      adminCreateHarvest: noop,
      adminComplete: noop,
      adminCancel: () => { cancelCalls += 1; },
      adminCreateNotification: (req, res) => {
        notificationCalls += 1;
        res.sendStatus(204);
      },
    },
  };
  require.cache[authServicePath] = {
    exports: {
      sanitizeUser: (user) => user,
    },
  };
  delete require.cache[authMiddlewarePath];
  delete require.cache[routePath];

  const env = require('../src/config/env');
  const app = express();
  app.use(express.json());
  app.use('/api/rentals', require('../src/routes/rental.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({
    message: error.message,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const token = jwt.sign({ sub: '2' }, env.jwtSecret);
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/rentals/admin/12/cancel`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Customer request' }),
      },
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      message: 'You do not have permission to access this resource',
    });
    assert.equal(cancelCalls, 0);

    const notificationResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/rentals/admin/12/notifications`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: 'Rental update' }),
      },
    );

    assert.equal(notificationResponse.status, 204);
    assert.equal(notificationCalls, 1);

    const customerToken = jwt.sign({ sub: '3' }, env.jwtSecret);
    const customerResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/rentals/admin/12/notifications`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${customerToken}` },
      },
    );
    assert.equal(customerResponse.status, 403);
    assert.equal(notificationCalls, 1);

    const unauthenticatedResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/rentals/admin/12/notifications`,
      { method: 'POST' },
    );
    assert.equal(unauthenticatedResponse.status, 401);
    assert.equal(notificationCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
