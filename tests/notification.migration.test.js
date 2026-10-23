const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../migrations/010_add_notification_rental_link.sql'),
  'utf8',
);

test('notification link migration is guarded and transactional', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS rental_id INT[\s\S]*REFERENCES rentals\(rental_id\) ON DELETE SET NULL/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS created_by INT[\s\S]*REFERENCES users\(user_id\) ON DELETE SET NULL/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_notifications_rental[\s\S]*notifications\(rental_id\)/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_notifications_user_created[\s\S]*notifications\(user_id, created_at DESC\)/i);
  assert.match(migration, /COMMIT;\s*$/m);
});
