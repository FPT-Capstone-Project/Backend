const test = require('node:test');
const assert = require('node:assert/strict');

function loadService({ detail = { user_id: 7, role_name: 'Customer' } } = {}) {
  const userModelPath = require.resolve('../src/models/user.model');
  const authServicePath = require.resolve('../src/services/auth.service');
  const servicePath = require.resolve('../src/services/user.service');
  const calls = [];

  delete require.cache[userModelPath];
  delete require.cache[authServicePath];
  delete require.cache[servicePath];
  require.cache[userModelPath] = {
    exports: {
      findAllWithRole: async (filters) => {
        calls.push({ method: 'findAllWithRole', filters });
        return [];
      },
      findDetailById: async (userId) => {
        calls.push({ method: 'findDetailById', userId });
        return detail;
      },
      updateStatusById: async (userId, status) => {
        calls.push({ method: 'updateStatusById', userId, status });
        return { user_id: userId, status };
      },
    },
  };
  require.cache[authServicePath] = {
    exports: {
      register: async (payload) => {
        calls.push({ method: 'register', payload });
        return { user: { user_id: 7 }, token: 'must-not-be-returned' };
      },
    },
  };

  return { service: require('../src/services/user.service'), calls };
}

test('lists users filtered by role ID', async () => {
  const { service, calls } = loadService();

  await service.getUsers({ roleId: '2' });

  assert.deepEqual(calls[0], {
    method: 'findAllWithRole',
    filters: { roleId: 2 },
  });
});

test('creates an account with a required role and does not return a JWT', async () => {
  const { service, calls } = loadService();

  const user = await service.createUser({
    email: 'new@example.com',
    password: 'password123',
    fullName: 'New User',
    roleId: 2,
  });

  assert.deepEqual(user, { user_id: 7, role_name: 'Customer' });
  assert.equal(calls[0].method, 'register');
  assert.equal(calls[0].payload.roleId, 2);
  assert.equal(calls[1].method, 'findDetailById');
  await assert.rejects(
    () => service.createUser({ email: 'missing-role@example.com' }),
    { statusCode: 400, message: 'roleId is required' },
  );
});

test('normalizes a valid status and rejects an invalid status', async () => {
  const { service, calls } = loadService();

  const user = await service.updateUserStatus('7', { status: ' blocked ' });

  assert.deepEqual(user, { user_id: 7, status: 'BLOCKED' });
  assert.deepEqual(calls[0], { method: 'updateStatusById', userId: 7, status: 'BLOCKED' });
  await assert.rejects(
    () => service.updateUserStatus(7, { status: 'deleted' }),
    { statusCode: 400, message: 'status must be ACTIVE, INACTIVE, or BLOCKED' },
  );
});
