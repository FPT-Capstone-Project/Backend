const test = require('node:test');
const assert = require('node:assert/strict');
const { createAsyncCache } = require('../src/utils/asyncCache');

test('cache coalesces requests, expires after completion and isolates keys', async () => {
  let now = 0, calls = 0, finish;
  const cached = createAsyncCache({ ttlMs: 60, now: () => now });
  const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = cached('floor1', load);
  await Promise.resolve();
  now = 100;
  assert.equal(cached('floor1', load), first);
  finish(['point']);
  assert.deepEqual(await first, ['point']);
  now = 159;
  assert.deepEqual(await cached('floor1', load), ['point']);
  assert.equal(calls, 1);
  assert.equal(await cached('floor2', () => 'other'), 'other');
  now = 160;
  assert.equal(await cached('floor1', () => 'updated'), 'updated');
});

test('failed loads are retried and cache size is bounded', async () => {
  const cached = createAsyncCache({ ttlMs: 60_000, maxEntries: 2 });
  await assert.rejects(cached('a', () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cached('a', () => 1), 1);
  await cached('b', () => 2);
  await cached('c', () => 3);
  assert.equal(await cached('a', () => 4), 4);
});
