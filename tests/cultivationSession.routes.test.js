const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('session management allows operator inspections and restricts cancellation to admins', async () => {
  const userModelPath = require.resolve('../src/models/user.model');
  const controllerPath = require.resolve('../src/controllers/cultivationSession.controller');
  const authServicePath = require.resolve('../src/services/auth.service');
  const authMiddlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const routePath = require.resolve('../src/routes/cultivationSession.routes');
  let cancelCalls = 0;
  let inspectionCalls = 0;
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
      adminCreateProgress: noop,
      adminCreateInspection: (req, res) => {
        inspectionCalls += 1;
        res.sendStatus(204);
      },
      adminCreateHarvest: noop,
      adminComplete: noop,
      adminCancel: (req, res) => {
        cancelCalls += 1;
        res.sendStatus(204);
      },
      adminCreateNotification: noop,
    },
  };
  require.cache[authServicePath] = { exports: { sanitizeUser: (user) => user } };
  delete require.cache[authMiddlewarePath];
  delete require.cache[routePath];

  const env = require('../src/config/env');
  const app = express();
  app.use(express.json());
  app.use('/api/cultivation-sessions', require('../src/routes/cultivationSession.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({
    message: error.message,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const operatorToken = jwt.sign({ sub: '2' }, env.jwtSecret);
    const inspectionResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/session-trays/14/inspections`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ growthStage: 'FRUITING', growthProgress: 60 }),
      },
    );
    assert.equal(inspectionResponse.status, 204);
    assert.equal(inspectionCalls, 1);

    const operatorCancelResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/cancel`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Customer request' }),
      },
    );
    assert.equal(operatorCancelResponse.status, 403);
    assert.equal(cancelCalls, 0);

    const adminToken = jwt.sign({ sub: '1' }, env.jwtSecret);
    const adminCancelResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/cancel`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Customer request' }),
      },
    );
    assert.equal(adminCancelResponse.status, 204);
    assert.equal(cancelCalls, 1);

    const unauthenticatedResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/complete`,
      { method: 'POST' },
    );
    assert.equal(unauthenticatedResponse.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
