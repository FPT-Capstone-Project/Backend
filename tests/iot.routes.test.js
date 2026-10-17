const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('JWT protects IoT routes; all active users can control SSR without role or user allowlists', async () => {
  const modelPath = require.resolve('../src/models/user.model');
  require.cache[modelPath] = { exports: { findById: async (id) => id === 99 ? null : ({ user_id: id, role_id: id === 5 || id === 6 ? 7 : 3, status: id === 8 ? 'INACTIVE' : 'ACTIVE' }) } };
  // Existing middleware remains real; only data access and IoT business service are mocked.
  const servicePath = require.resolve('../src/services/iot.service');
  let calls = 0;
  require.cache[servicePath] = { exports: {
    control: async (masterId, channel, body, userId) => {
      calls += 1; assert.ok([3, 5, 6].includes(userId));
      return { commandId: '45c7c591-aacd-480d-934a-3cd2021a871e', masterId, channel: Number(channel), action: body.action, status: 'PUBLISHED' };
    }, listMasters: async () => [],
  } };
  const env = require('../src/config/env');
  const app = express(); app.use(express.json());
  app.use('/api/iot', require('../src/routes/iot.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/iot`;
  const token = (id) => jwt.sign({ sub: String(id) }, env.jwtSecret);
  try {
    for (const [authorization, code] of [[undefined, 401], ['Bearer invalid', 401], [`Bearer ${token(8)}`, 401], [`Bearer ${token(99)}`, 401], [`Bearer ${token(3)}`, 202], [`Bearer ${token(6)}`, 202], [`Bearer ${token(5)}`, 202]]) {
      const response = await fetch(`${url}/masters/master01/ssr/1/commands`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify({ action: 'ON' }),
      });
      assert.equal(response.status, code); await response.json();
    }
    assert.equal(calls, 3);
    assert.equal((await fetch(`${url}/masters`)).status, 401);
    const response = await fetch(`${url}/masters`, { headers: { authorization: `Bearer ${token(3)}` } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { data: [] });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Swagger documents all seven APIs, JWT, schemas and command errors', () => {
  const spec = require('../src/config/swagger');
  const entries = Object.entries(spec.paths).filter(([key]) => key.startsWith('/api/iot/'));
  assert.equal(entries.length, 7);
  for (const [, path] of entries) for (const operation of Object.values(path)) {
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    assert.ok(operation.responses[401]); assert.ok(operation.responses[400]);
  }
  const post = spec.paths['/api/iot/masters/{masterId}/ssr/{channel}/commands'].post;
  assert.ok(post.responses[202]); assert.ok(post.responses[503]); assert.ok(post.responses[504]);
  assert.ok(spec.components.schemas.IotCommand);
});
