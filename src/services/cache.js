// Bump the version whenever the fetchAll() data shape changes — cached
// snapshots from an older shape would otherwise hide new charts until the TTL expires.
const PREFIX = 'signal_v7_';
const TTL = 2 * 60 * 60 * 1000; // 2 hours — short enough that stale shapes don't persist

export function getCached(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > TTL) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry; // { data, ts }
  } catch {
    return null;
  }
}

export function setCached(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export function clearCache() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX))
    .forEach(k => localStorage.removeItem(k));
}
