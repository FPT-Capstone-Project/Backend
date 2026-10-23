const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('user management routes require the Admin role', async () => {
  const userModelPath = require.resolve('../src/models/user.model');
  const controllerPath = require.resolve('../src/controllers/user.controller');
  const authServicePath = require.resolve('../src/services/auth.service');
  const authMiddlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const routePath = require.resolve('../src/routes/user.routes');
  const paths = [userModelPath, controllerPath, authServicePath, authMiddlewarePath, routePath];
  const originalCache = new Map(paths.map((path) => [path, require.cache[path]]));
  const noop = (req, res) => res.sendStatus(204);

  require.cache[userModelPath] = {
    exports: {
      findById: async (userId) => ({
        user_id: userId,
        role_id: Number(userId),
        status: 'ACTIVE',
      }),
    },
  };
  require.cache[controllerPath] = {
    exports: {
      list: noop,
      getById: noop,
      create: noop,
      updateStatus: noop,
    },
  };
  require.cache[authServicePath] = { exports: { sanitizeUser: (user) => user } };
  delete require.cache[authMiddlewarePath];
  delete require.cache[routePath];

  const env = require('../src/config/env');
  const app = express();
  app.use('/api/users', require('../src/routes/user.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({
    message: error.message,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const adminToken = jwt.sign({ sub: '1' }, env.jwtSecret);
    const operatorToken = jwt.sign({ sub: '2' }, env.jwtSecret);
    const adminResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/users`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const operatorResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/users`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    assert.equal(adminResponse.status, 204);
    assert.equal(operatorResponse.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [path, cachedModule] of originalCache) {
      if (cachedModule) require.cache[path] = cachedModule;
      else delete require.cache[path];
    }
  }
});
