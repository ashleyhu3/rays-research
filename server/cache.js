const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { store.delete(key); return null; }
  return entry.data;
}

// `fetchedAt` is decoupled from `expires` on purpose: when seeding the cache
// from a persisted snapshot on boot we want the entry to be servable (a fresh
// expiry) yet still report its true age, so the Ask tab's freshness passport
// ("updated: 3h ago") stays honest instead of resetting to "just now".
function set(key, data, ttlMs = 24 * 60 * 60 * 1000, fetchedAt = Date.now()) {
  store.set(key, { data, expires: Date.now() + ttlMs, fetchedAt });
}

// When the entry was fetched (null if missing/expired) — used by the RAG to
// stamp each data section with its freshness.
function meta(key) {
  const entry = store.get(key);
  if (!entry || Date.now() > entry.expires) return null;
  return { fetchedAt: entry.fetchedAt, expires: entry.expires };
}

// Live (non-expired) keys — lets the RAG discover dynamic entries such as
// the per-ticker `options:<TICKER>:<date>` caches.
function keys() {
  return [...store.keys()].filter(k => get(k) !== null);
}

function clear() { store.clear(); }
function del(key) { store.delete(key); }

// ── Telemetry (powers the Data Validity Terminal) ──────────────────────────
// Operational health per source, updated by the scheduler/route on every
// scrape attempt. Kept separate from the data cache so a feed going DOWN never
// affects served data — the page reads strictly from these in-memory objects.
const telemetry = new Map(); // sourceId -> { status, lastSuccess, lastAttempt, payloadBytes, error, successCount, failCount }

function updateTelemetry(id, patch) {
  const cur = telemetry.get(id) || { successCount: 0, failCount: 0 };
  telemetry.set(id, { ...cur, ...patch });
}

function recordSuccess(id, payloadBytes) {
  const cur = telemetry.get(id) || { successCount: 0, failCount: 0 };
  telemetry.set(id, {
    ...cur,
    status: 'OPERATIONAL',
    lastSuccess: Date.now(),
    lastAttempt: Date.now(),
    payloadBytes,
    error: null,
    successCount: (cur.successCount || 0) + 1,
  });
}

function recordFailure(id, status, error) {
  const cur = telemetry.get(id) || { successCount: 0, failCount: 0 };
  telemetry.set(id, {
    ...cur,
    status,            // 'RATE-LIMITED' | 'DOWN'
    lastAttempt: Date.now(),
    error,
    failCount: (cur.failCount || 0) + 1,
  });
}

function getTelemetry(id) { return telemetry.get(id) || null; }

module.exports = { get, set, meta, keys, clear, del, updateTelemetry, recordSuccess, recordFailure, getTelemetry };
