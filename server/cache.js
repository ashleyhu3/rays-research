const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { store.delete(key); return null; }
  return entry.data;
}

function set(key, data, ttlMs = 24 * 60 * 60 * 1000) {
  store.set(key, { data, expires: Date.now() + ttlMs });
}

function clear() { store.clear(); }

module.exports = { get, set, clear };
