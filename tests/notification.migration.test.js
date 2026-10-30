const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8');

test('notification schema references cultivation sessions without a rentals table', () => {
  assert.match(schema, /reference_type\s+VARCHAR/i);
  assert.match(schema, /reference_id\s+INTEGER/i);
  assert.doesNotMatch(schema, /CREATE TABLE public\.rentals/i);
  assert.doesNotMatch(schema, /\brental_id\b/i);
});
