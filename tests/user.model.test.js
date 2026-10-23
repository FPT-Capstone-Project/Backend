const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('returns user role and independent order and rental counts', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/user.model');
  const originalDbModule = require.cache[dbPath];

  await db.exec(fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8'));
  await db.exec(`
    INSERT INTO roles(role_name) VALUES ('Admin'), ('Customer');
    INSERT INTO users(role_id, email, password_hash, full_name)
    VALUES (2, 'customer@example.test', 'hash', 'Test Customer');
    INSERT INTO orders(user_id) VALUES (1), (1);
    INSERT INTO rentals(order_id, user_id, duration_days) VALUES (1, 1, 30);
  `);

  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: { query: (...args) => db.query(...args) } };

  try {
    const userModel = require('../src/models/user.model');
    const users = await userModel.findAllWithRole({ roleId: 2 });
    const detail = await userModel.findDetailById(1);
    const updated = await userModel.updateStatusById(1, 'BLOCKED');

    assert.equal(users.length, 1);
    assert.equal(users[0].role_name, 'Customer');
    assert.equal(detail.order_count, 2);
    assert.equal(detail.rental_count, 1);
    assert.equal(updated.status, 'BLOCKED');
  } finally {
    delete require.cache[modelPath];
    if (originalDbModule) require.cache[dbPath] = originalDbModule;
    else delete require.cache[dbPath];
  }
});
