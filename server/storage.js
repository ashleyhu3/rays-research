'use strict';
const fs = require('fs');

/**
 * Blob storage with a Mongo backend and a JSON-file fallback.
 *
 * The dashboard's history data (metricsHistory, gpuHistory, dramHistory) is
 * small and read/written whole, so each "blob" is stored as a single document
 * { _id: name, data: <object> } in one collection — mirroring the old
 * one-file-per-blob model with no schema churn.
 *
 * Mode is chosen by environment:
 *   • MONGODB_URI set  → Mongo. On init each blob is loaded into memory; if a
 *     blob is missing in Mongo it is seeded from the committed JSON file, so the
 *     backfilled baseline carries over on first deploy. Forward writes (daily
 *     snapshots) persist to Mongo, surviving Render's ephemeral filesystem.
 *   • no MONGODB_URI   → File. Behaves exactly like before (used in dev and by
 *     the one-off backfill scripts, which write JSON that gets committed).
 *
 * Reads are synchronous (served from an in-memory cache once init() has run),
 * so existing sync callers — history.all(), history.series() — are unchanged.
 * Writes update the cache synchronously and persist in the background.
 */
const COLLECTION = 'blobs';

let mode = 'file';
let client = null;
let collection = null;
const cache = new Map();   // name → object (authoritative in-memory copy)
const pending = new Set(); // in-flight Mongo writes, so a one-shot can flush
let ready = false;

function readFileBlob(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function writeFileBlob(file, obj) {
  try {
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj));
  } catch (e) {
    console.warn(`[storage] could not write ${file}:`, e.message);
  }
}

/**
 * Connect to Mongo (if configured) and preload the named blobs into memory.
 * Falls back to file mode on any connection error so the app still boots.
 * blobs: [{ name, file }]
 */
async function init(blobs) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    mode = 'file';
    ready = true;
    console.log('[storage] no MONGODB_URI — using local JSON files');
    return;
  }
  try {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
    });
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || undefined); // db from URI path if omitted
    collection = db.collection(COLLECTION);

    for (const { name, file } of blobs) {
      const doc = await collection.findOne({ _id: name });
      if (doc && doc.data && Object.keys(doc.data).length > 0) {
        cache.set(name, doc.data);
      } else {
        // Seed Mongo from the committed baseline JSON the first time.
        const seed = readFileBlob(file);
        cache.set(name, seed);
        await collection.updateOne(
          { _id: name },
          { $set: { data: seed, updatedAt: new Date() } },
          { upsert: true }
        );
        console.log(`[storage] seeded "${name}" into Mongo from ${file} (${Object.keys(seed).length} keys)`);
      }
    }
    mode = 'mongo';
    ready = true;
    console.log(`[storage] connected to MongoDB — ${blobs.length} blobs loaded`);
  } catch (e) {
    console.warn('[storage] Mongo init failed, falling back to files:', e.message);
    mode = 'file';
    ready = true;
    if (client) { try { await client.close(); } catch {} client = null; }
  }
}

// Synchronous read: in-memory cache when available, else the JSON file. Returns
// the cached object by reference so callers can mutate-then-write() in place.
function read(name, file) {
  if (cache.has(name)) return cache.get(name);
  const obj = readFileBlob(file);
  cache.set(name, obj);
  return obj;
}

// Synchronous-looking write: update cache now, persist in the background. The
// in-flight promise is tracked so a one-shot process (the collector) can await
// flush() before exiting — the long-running server just ignores it.
function write(name, file, obj) {
  cache.set(name, obj);
  if (mode === 'mongo' && collection) {
    const p = collection.updateOne(
      { _id: name },
      { $set: { data: obj, updatedAt: new Date() } },
      { upsert: true }
    ).catch(e => console.warn(`[storage] Mongo write "${name}" failed:`, e.message))
      .finally(() => pending.delete(p));
    pending.add(p);
  } else {
    writeFileBlob(file, obj);
  }
}

// Re-read one blob straight from Mongo into the cache, picking up whatever a
// different process (a script, another instance) wrote directly — without
// re-running whatever scrape produced it. No-op in file mode: there is only one
// copy, already in cache. Leaves the cache untouched if Mongo has no doc yet,
// rather than clobbering good in-memory data with an empty object.
async function reload(name, file) {
  if (mode !== 'mongo' || !collection) {
    const obj = readFileBlob(file);
    cache.set(name, obj);
    return obj;
  }
  const doc = await collection.findOne({ _id: name });
  if (doc && doc.data) cache.set(name, doc.data);
  return cache.get(name);
}

// Wait for all queued Mongo writes to land (no-op in file mode).
async function flush() {
  await Promise.allSettled([...pending]);
}

// Force-push the local JSON files into Mongo (used by the db:seed script after
// re-running backfills). Overwrites whatever is in Mongo for those blobs.
async function seedFromFiles(blobs) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const { MongoClient } = require('mongodb');
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || undefined);
  const col = db.collection(COLLECTION);
  for (const { name, file } of blobs) {
    const data = readFileBlob(file);
    await col.updateOne({ _id: name }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
    console.log(`[storage] pushed "${name}" → Mongo (${Object.keys(data).length} keys)`);
  }
  await c.close();
}

async function close() {
  await flush();
  if (client) { try { await client.close(); } catch {} client = null; }
}

function status() {
  return { mode, ready, blobs: [...cache.keys()] };
}

module.exports = { init, read, write, reload, flush, seedFromFiles, close, status };
