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
      updateProfileById: async (userId, profile) => {
        calls.push({ method: 'updateProfileById', userId, profile });
        return detail ? { user_id: userId, ...profile } : null;
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

test('updates only supplied profile fields and validates profile input', async () => {
  const { service, calls } = loadService();
  await service.updateProfile(7, { fullName: ' Updated Name ', phone: null });
  assert.deepEqual(calls[0], {
    method: 'updateProfileById', userId: 7,
    profile: { fullName: 'Updated Name', phone: null },
  });
  for (const payload of [{}, [], { fullName: ' ' }, { fullName: null },
    { phone: 123 }, { address: {} }, { roleId: 1 }, { email: 'new@example.com' },
    { status: 'ACTIVE' }, { fullName: 'Valid', password: 'changed' }]) {
    await assert.rejects(() => service.updateProfile(7, payload), { statusCode: 400 });
  }
  assert.equal(calls.length, 1);
  const missing = loadService({ detail: null });
  await assert.rejects(() => missing.service.updateProfile(7, { address: null }), { statusCode: 404 });
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
