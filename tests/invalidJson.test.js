const test = require('node:test');
const assert = require('node:assert/strict');

test('malformed JSON request bodies return a client error', async () => {
  const app = require('../src/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"issueType": ,}',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: 'Invalid JSON request body' });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
