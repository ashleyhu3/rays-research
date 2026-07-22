'use strict';
const path    = require('path');
const storage = require('./storage');

// Persists the *latest* successful scrape for each source so the in-memory
// request cache (./cache.js) can be seeded on boot. Without this, the cache
// starts empty after every restart and the first visitor blocks on a live
// re-scrape of ~20 rate-limited external sources. With it, the first paint
// serves last-known values instantly while a background warmup refreshes.
//
// Shape: { [key]: { data: <payload>, fetchedAt: <ms> } }
// One blob (Mongo doc in prod, JSON file in dev) via the storage layer.
const FILE = path.join(__dirname, 'data', 'latestSnapshots.json');
const BLOB = 'latestSnapshots';
const compressedId = key => `latestSnapshot:${key}`;

let store = null;

function load() {
  if (!store) store = storage.read(BLOB, FILE);
  return store;
}

// Pull the latest snapshot from the backing store before serving a source that
// is collected out-of-process. This matters on long-lived/serverless instances:
// their in-memory copy may predate a GitHub Actions collector write to Mongo.
async function latest(key) {
  const compressed = await storage.readCompressed(compressedId(key), { refresh: true });
  if (compressed != null) return compressed;
  return storage.readField(BLOB, FILE, key, { refresh: true });
}

// Record the latest payload for a source. Called after every successful scrape.
function put(key, data) {
  if (data == null) return;
  const entry = { data, fetchedAt: Date.now() };
  if (!storage.writeCompressed(compressedId(key), entry)) {
    storage.writeField(BLOB, FILE, key, entry);
  }
}

async function seedKeys(cache, keys, ttlByKey = {}) {
  const entries = new Array(keys.length);
  let cursor = 0;
  async function worker() {
    while (cursor < keys.length) {
      const index = cursor++;
      entries[index] = [keys[index], await latest(keys[index])];
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, keys.length) }, worker));
  const seeded = [];
  for (const [key, entry] of entries) {
    if (!entry || entry.data == null) continue;
    cache.set(key, entry.data, ttlByKey[key] ?? 24 * 60 * 60 * 1000, entry.fetchedAt);
    seeded.push(key);
  }
  return seeded;
}

// Seed the in-memory request cache from the persisted snapshots. Entries are
// inserted with each source's normal TTL so routes serve them immediately, but
// carry their ORIGINAL fetch time so the Ask tab's freshness passport reflects
// when the data was really scraped, not boot time. Callers should still kick
// off a background refresh to replace stale values. Returns the seeded keys.
function seed(cache, ttlByKey = {}) {
  const s = load();
  const seeded = [];
  for (const [key, entry] of Object.entries(s)) {
    if (!entry || entry.data == null) continue;
    cache.set(key, entry.data, ttlByKey[key] ?? 24 * 60 * 60 * 1000, entry.fetchedAt);
    seeded.push(key);
  }
  return seeded;
}

module.exports = { put, seed, seedKeys, latest };
