const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { io: connect } = require('socket.io-client');
const { createSocketServer } = require('../src/socket');
const { createRoomAccessService, parseRoomRequest } = require('../src/services/socketRoom.service');

const JWT_SECRET = 'socket-room-test-secret';

function createToken(userId) {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: '1m' });
}

function waitForConnection(client) {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

function emitWithAck(client, event, payload) {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}

test('parses only resource type and ID, never a client-provided room name', () => {
  assert.deepEqual(parseRoomRequest({ type: 'session', id: 12 }), { type: 'session', id: 12 });
  assert.deepEqual(parseRoomRequest({ type: 'issue', id: '9' }), { type: 'issue', id: 9 });
  assert.equal(parseRoomRequest({ type: 'user', id: 12 }), null);
  assert.equal(parseRoomRequest({ type: 'session', id: 12, room: 'user:8' }), null);
  assert.equal(parseRoomRequest({ type: 'session:12' }), null);
  assert.equal(parseRoomRequest({ type: 'session', id: 0 }), null);
});

test('enforces owner, active room assignment and expert assignment policies', async () => {
  const calls = [];
  const model = {
    resourceExists: async (...args) => { calls.push(['resourceExists', ...args]); return true; },
    customerOwnsSession: async (...args) => { calls.push(['customerOwnsSession', ...args]); return args[0] === 12; },
    customerHasActiveTrayInRoom: async (...args) => { calls.push(['customerHasActiveTrayInRoom', ...args]); return args[0] === 3; },
    customerOwnsIssue: async (...args) => { calls.push(['customerOwnsIssue', ...args]); return args[0] === 4; },
    customerOwnsConsultation: async (...args) => { calls.push(['customerOwnsConsultation', ...args]); return args[0] === 5; },
    expertIsAssignedToIssue: async (...args) => { calls.push(['expertIsAssignedToIssue', ...args]); return args[0] === 4; },
    expertIsAssignedToConsultation: async (...args) => { calls.push(['expertIsAssignedToConsultation', ...args]); return args[0] === 5; },
  };
  const access = createRoomAccessService(model);

  assert.equal(await access.canAccess({ userId: 7, roleId: 3 }, 'session', 12), true);
  assert.equal(await access.canAccess({ userId: 7, roleId: 3 }, 'session', 13), false);
  assert.equal(await access.canAccess({ userId: 7, roleId: 3 }, 'room', 3), true);
  assert.equal(await access.canAccess({ userId: 7, roleId: 3 }, 'room', 8), false);
  assert.equal(await access.canAccess({ userId: 7, roleId: 3 }, 'issue', 4), true);
  assert.equal(await access.canAccess({ userId: 7, roleId: 3 }, 'consultation', 5), true);

  const expert = { userId: 20, roleId: 4, roleName: 'Mushroom Expert' };
  assert.equal(await access.canAccess(expert, 'issue', 4), true);
  assert.equal(await access.canAccess(expert, 'issue', 8), false);
  assert.equal(await access.canAccess(expert, 'consultation', 5), true);
  assert.equal(await access.canAccess(expert, 'session', 12), false);
  assert.equal(await access.canAccess({ userId: 1, roleId: 1 }, 'room', 3), true);
  assert.deepEqual(calls.slice(-4), [
    ['expertIsAssignedToIssue', 4, 20],
    ['expertIsAssignedToIssue', 8, 20],
    ['expertIsAssignedToConsultation', 5, 20],
    ['resourceExists', 'room', 3],
  ]);
});

test('joins only authorized backend-derived rooms and allows leaving resource rooms', async () => {
  const server = http.createServer();
  const io = createSocketServer(server, {
    jwtSecret: JWT_SECRET,
    corsOrigins: ['*'],
    findUserById: async () => ({ user_id: 7, role_id: 3, status: 'ACTIVE', role_name: 'Customer' }),
    authorizeRoom: async (user, type, id) => user.userId === 7 && type === 'session' && id === 12,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = connect(`http://127.0.0.1:${server.address().port}`, {
    auth: { token: createToken(7) },
    transports: ['websocket'],
    reconnection: false,
  });

  try {
    await waitForConnection(client);
    const socket = [...io.of('/').sockets.values()][0];
    assert.equal(socket.rooms.has('user:7'), true);

    assert.deepEqual(await emitWithAck(client, 'room:join', { type: 'session', id: 12 }), {
      ok: true, type: 'session', id: 12,
    });
    assert.equal(socket.rooms.has('session:12'), true);

    assert.deepEqual(await emitWithAck(client, 'room:join', { type: 'session', id: 13 }), {
      ok: false, code: 'ROOM_ACCESS_DENIED',
    });
    assert.deepEqual(await emitWithAck(client, 'room:join', { room: 'user:8' }), {
      ok: false, code: 'INVALID_ROOM_REQUEST',
    });
    assert.equal(socket.rooms.has('user:8'), false);

    assert.deepEqual(await emitWithAck(client, 'room:leave', { type: 'session', id: 12 }), {
      ok: true, type: 'session', id: 12,
    });
    assert.equal(socket.rooms.has('session:12'), false);
    assert.equal(socket.rooms.has('user:7'), true);
  } finally {
    client.close();
    await new Promise((resolve) => io.close(resolve));
  }
});

test('assigns admin and expert role rooms from the authenticated database role', async () => {
  const server = http.createServer();
  const users = {
    1: { user_id: 1, role_id: 1, status: 'ACTIVE', role_name: 'Admin' },
    2: { user_id: 2, role_id: 4, status: 'ACTIVE', role_name: 'Mushroom Expert' },
    3: { user_id: 3, role_id: 2, status: 'ACTIVE', role_name: 'Farm Operator' },
  };
  const io = createSocketServer(server, {
    jwtSecret: JWT_SECRET,
    corsOrigins: ['*'],
    findUserById: async (userId) => users[userId] || null,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const clients = [1, 2, 3].map((userId) => connect(`http://127.0.0.1:${server.address().port}`, {
    auth: { token: createToken(userId) },
    transports: ['websocket'],
    reconnection: false,
  }));

  try {
    await Promise.all(clients.map(waitForConnection));
    const sockets = [...io.of('/').sockets.values()];
    const byUserId = new Map(sockets.map((socket) => [socket.data.user.userId, socket]));
    assert.equal(byUserId.get(1).rooms.has('admin'), true);
    assert.equal(byUserId.get(1).rooms.has('expert'), false);
    assert.equal(byUserId.get(2).rooms.has('expert'), true);
    assert.equal(byUserId.get(2).rooms.has('admin'), false);
    assert.equal(byUserId.get(3).rooms.has('admin'), false);
    assert.equal(byUserId.get(3).rooms.has('expert'), false);
  } finally {
    for (const client of clients) client.close();
    await new Promise((resolve) => io.close(resolve));
  }
});
