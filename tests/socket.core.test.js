const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { io: connect } = require('socket.io-client');
const { createSocketServer, initializeSocketServer, emitToUser } = require('../src/socket');

const JWT_SECRET = 'socket-core-test-secret';

function createToken(userId) {
  return jwt.sign({ sub: String(userId), roleId: 3 }, JWT_SECRET, { expiresIn: '1m' });
}

function waitForConnection(client) {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

function waitForConnectionError(client) {
  return new Promise((resolve) => client.once('connect_error', resolve));
}

test('authenticates sockets, assigns user identity and isolates user rooms', async () => {
  const server = http.createServer();
  const io = initializeSocketServer(server, {
    jwtSecret: JWT_SECRET,
    corsOrigins: ['*'],
    findUserById: async (userId) => userId === 7
      ? { user_id: 7, role_id: 3, status: 'ACTIVE', role_name: 'Customer' }
      : null,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];

  function makeClient(options = {}) {
    const client = connect(url, { transports: ['websocket'], reconnection: false, ...options });
    clients.push(client);
    return client;
  }

  try {
    const missingToken = makeClient();
    const missingTokenError = waitForConnectionError(missingToken);
    await assert.rejects(waitForConnection(missingToken), /Authentication required/);
    assert.match((await missingTokenError).message, /Authentication required/);

    const inactiveUser = makeClient({ auth: { token: createToken(8) } });
    const inactiveUserError = waitForConnectionError(inactiveUser);
    await assert.rejects(waitForConnection(inactiveUser), /Invalid or inactive user/);
    assert.match((await inactiveUserError).message, /Invalid or inactive user/);

    const customer = makeClient({ auth: { token: createToken(7) } });
    await waitForConnection(customer);
    const customerSocket = [...io.of('/').sockets.values()][0];
    assert.deepEqual(customerSocket.data.user, { userId: 7, roleId: 3, roleName: 'Customer' });
    assert.equal(customerSocket.rooms.has('user:7'), true);
    assert.equal(customerSocket.rooms.has('user:8'), false);

    const delivered = new Promise((resolve) => customer.once('private:update', resolve));
    emitToUser(7, 'private:update', { value: 'user-only' });
    assert.deepEqual(await delivered, { value: 'user-only' });
  } finally {
    for (const client of clients) client.close();
    await new Promise((resolve) => io.close(resolve));
  }
});

test('rejects invalid JWTs before looking up a user', async () => {
  let lookupCount = 0;
  const server = http.createServer();
  const io = createSocketServer(server, {
    jwtSecret: JWT_SECRET,
    corsOrigins: ['*'],
    findUserById: async () => { lookupCount += 1; return null; },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = connect(`http://127.0.0.1:${server.address().port}`, {
    auth: { token: 'not-a-valid-token' },
    transports: ['websocket'],
    reconnection: false,
  });

  try {
    const error = waitForConnectionError(client);
    await assert.rejects(waitForConnection(client), /Invalid or expired token/);
    assert.match((await error).message, /Invalid or expired token/);
    assert.equal(lookupCount, 0);
  } finally {
    client.close();
    await new Promise((resolve) => io.close(resolve));
  }
});
