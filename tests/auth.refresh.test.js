const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('login issues rotating refresh tokens and logout revokes the token family', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const userModelPath = require.resolve('../src/models/user.model');
  const refreshModelPath = require.resolve('../src/models/refreshToken.model');
  const authServicePath = require.resolve('../src/services/auth.service');
  const originalDbModule = require.cache[dbPath];

  try {
    await db.exec(`
      CREATE TABLE public.users (
        user_id SERIAL PRIMARY KEY,
        role_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        is_email_verified BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO public.users (role_id, email, password_hash, full_name)
      VALUES (3, 'customer@example.test', 'hashed-password', 'Test Customer');
      CREATE TABLE public.refresh_tokens (
        refresh_token_id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        token_family UUID NOT NULL,
        device_name VARCHAR(255),
        user_agent TEXT,
        ip_address INET,
        expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
        replaced_by_token_id BIGINT REFERENCES public.refresh_tokens(refresh_token_id) ON DELETE SET NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL
      );
      CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens(user_id);
      CREATE INDEX idx_refresh_tokens_family ON public.refresh_tokens(token_family);
      CREATE INDEX idx_refresh_tokens_active
        ON public.refresh_tokens(user_id, expires_at) WHERE revoked_at IS NULL;
    `);

    delete require.cache[userModelPath];
    delete require.cache[refreshModelPath];
    delete require.cache[authServicePath];
    require.cache[dbPath] = {
      exports: {
        query: (...args) => db.query(...args),
        connect: async () => ({
          query: (...args) => db.query(...args),
          release: () => {},
        }),
      },
    };

    const userModel = require('../src/models/user.model');
    userModel.findByEmail = async () => ({
      user_id: 1,
      role_id: 3,
      email: 'customer@example.test',
      password_hash: 'hashed-password',
      full_name: 'Test Customer',
      status: 'ACTIVE',
      is_email_verified: true,
    });
    const authService = require('../src/services/auth.service');
    const refreshTokenModel = require('../src/models/refreshToken.model');
    const login = await authService.login({
      email: 'customer@example.test',
      password: 'correct-password',
      userAgent: 'test-agent',
      ipAddress: '127.0.0.1',
    });

    assert.ok(login.accessToken);
    assert.ok(login.refreshToken);
    assert.equal(Object.hasOwn(login, 'token'), false);
    assert.equal(jwt.verify(login.accessToken, require('../src/config/env').jwtSecret).sub, '1');

    const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
    const firstStored = (await db.query(
      'SELECT * FROM public.refresh_tokens WHERE token_hash = $1',
      [hash(login.refreshToken)],
    )).rows[0];
    assert.ok(firstStored);
    assert.equal(firstStored.user_agent, 'test-agent');
    assert.equal(firstStored.ip_address, '127.0.0.1');

    const refreshed = await authService.refresh({
      refreshToken: login.refreshToken,
      userAgent: 'test-agent',
      ipAddress: '127.0.0.1',
    });
    assert.ok(refreshed.accessToken);
    assert.ok(refreshed.refreshToken);
    assert.equal(Object.hasOwn(refreshed, 'token'), false);
    const rotated = (await db.query(
      'SELECT revoked_at, replaced_by_token_id FROM public.refresh_tokens WHERE refresh_token_id = $1',
      [firstStored.refresh_token_id],
    )).rows[0];
    assert.ok(rotated.revoked_at);
    assert.ok(rotated.replaced_by_token_id);

    await assert.rejects(
      authService.refresh({ refreshToken: login.refreshToken }),
      { statusCode: 401 },
    );
    assert.equal(
      (await db.query(
        'SELECT COUNT(*)::INTEGER AS count FROM public.refresh_tokens WHERE token_family = $1 AND revoked_at IS NULL',
        [firstStored.token_family],
      )).rows[0].count,
      0,
    );

    const secondLogin = await authService.login({
      email: 'customer@example.test',
      password: 'correct-password',
    });
    await authService.logout({ refreshToken: secondLogin.refreshToken });
    assert.equal(
      (await db.query(
        'SELECT COUNT(*)::INTEGER AS count FROM public.refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
        [hash(secondLogin.refreshToken)],
      )).rows[0].count,
      0,
    );
    assert.equal(typeof refreshTokenModel.rotate, 'function');
  } finally {
    delete require.cache[userModelPath];
    delete require.cache[refreshModelPath];
    delete require.cache[authServicePath];
    if (originalDbModule) require.cache[dbPath] = originalDbModule;
    else delete require.cache[dbPath];
    await db.close();
  }
});
