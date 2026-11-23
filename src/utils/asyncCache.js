// Per-process, bounded cache. Concurrent callers share work; failures are never cached.
function createAsyncCache({ ttlMs, maxEntries = 32, now = Date.now }) {
  const entries = new Map();
  return function cached(key, load) {
    const existing = entries.get(key);
    if (existing && (existing.pending || existing.expiresAt > now())) return existing.promise;
    entries.delete(key);
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    const entry = { pending: true, expiresAt: 0, promise: null };
    entry.promise = Promise.resolve().then(load).then((value) => {
      entry.pending = false;
      entry.expiresAt = now() + ttlMs;
      return value;
    }, (error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry.promise;
  };
}

module.exports = { createAsyncCache };
