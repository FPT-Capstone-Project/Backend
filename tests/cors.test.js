const test = require('node:test');
const assert = require('node:assert/strict');

function close(server) {
  const closed = new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  server.closeAllConnections();
  return closed;
}

async function loadAppWithCorsOrigins(origins) {
  process.env.CORS_ORIGINS = origins;
  const envPath = require.resolve('../src/config/env');
  const appPath = require.resolve('../src/app');
  delete require.cache[envPath];
  delete require.cache[appPath];

  const app = require('../src/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  return { server, appPath, envPath };
}

test('allows configured origins and answers CORS preflight requests', async () => {
  const previousOrigins = process.env.CORS_ORIGINS;
  const { server, appPath, envPath } = await loadAppWithCorsOrigins(
    'https://frontend.example.com,http://localhost:5173',
  );

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://frontend.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://frontend.example.com');
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.equal(response.headers.get('access-control-allow-headers'), 'authorization,content-type');
    assert.match(response.headers.get('vary'), /Origin/);
  } finally {
    await close(server);
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousOrigins;
    delete require.cache[appPath];
    delete require.cache[envPath];
  }
});

test('does not grant CORS access to unconfigured origins', async () => {
  const previousOrigins = process.env.CORS_ORIGINS;
  const { server, appPath, envPath } = await loadAppWithCorsOrigins('https://frontend.example.com');

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`, {
      headers: { Origin: 'https://untrusted.example.com' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await close(server);
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousOrigins;
    delete require.cache[appPath];
    delete require.cache[envPath];
  }
});

test('allows any origin when the wildcard is configured', async () => {
  const previousOrigins = process.env.CORS_ORIGINS;
  const { server, appPath, envPath } = await loadAppWithCorsOrigins('*');

  try {
    const origin = 'http://localhost:4321';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`, {
      headers: { Origin: origin },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  } finally {
    await close(server);
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousOrigins;
    delete require.cache[appPath];
    delete require.cache[envPath];
  }
});
