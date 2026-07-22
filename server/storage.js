'use strict';
const fs = require('fs');
const zlib = require('zlib');

/**
 * Blob storage with a Mongo backend and a JSON-file fallback.
 *
 * The dashboard's history data (metricsHistory, gpuHistory, dramHistory) is
 * small and read/written whole, so each "blob" is stored as a single document
 * { _id: name, data: <object> } in one collection — mirroring the old
 * one-file-per-blob model with no schema churn.
 *
 * Mode is chosen by environment:
 *   • MONGODB_URI set  → Mongo. CLI jobs preload their requested blobs, while
 *     the web server loads route-specific blobs lazily. Missing blobs are seeded
 *     from committed JSON files. Forward writes persist to Mongo.
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
const blobFiles = new Map();
const loading = new Map();
const fieldCache = new Map();
const fieldLoading = new Map();
const compressedCache = new Map();
const compressedLoading = new Map();
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
async function init(blobs, { preload = true } = {}) {
  for (const { name, file } of blobs) blobFiles.set(name, file);
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
      socketTimeoutMS: 30000,
      waitQueueTimeoutMS: 15000,
      // Snapshot/history documents are repetitive JSON time series. Compress
      // them on the Mongo wire so multi-year payloads do not spend a minute
      // crossing the network before Express can answer.
      compressors: ['zlib'],
      zlibCompressionLevel: 6,
    });
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || undefined); // db from URI path if omitted
    collection = db.collection(COLLECTION);

    mode = 'mongo';
    ready = true;
    console.log(`[storage] connected to MongoDB${preload ? '' : ' — lazy blob loading enabled'}`);
    if (preload) {
      for (const { name, file } of blobs) await load(name, file);
      console.log(`[storage] ${blobs.length} blobs loaded`);
    }
  } catch (e) {
    console.warn('[storage] Mongo init failed, falling back to files:', e.message);
    mode = 'file';
    ready = true;
    if (client) { try { await client.close(); } catch {} client = null; }
  }
}

// Load one blob on demand. Web requests use this instead of making every cold
// start download every Mongo document, including multi-megabyte reports that
// are unrelated to the requested route.
async function load(name, file = blobFiles.get(name)) {
  if (cache.has(name)) return cache.get(name);
  if (loading.has(name)) return loading.get(name);

  const promise = (async () => {
    if (mode !== 'mongo' || !collection) {
      const value = readFileBlob(file);
      cache.set(name, value);
      return value;
    }

    try {
      const doc = await collection.findOne({ _id: name }, { maxTimeMS: 15000 });
      if (doc?.data && Object.keys(doc.data).length > 0) {
        cache.set(name, doc.data);
        return doc.data;
      }

      const seed = readFileBlob(file);
      cache.set(name, seed);
      await collection.updateOne(
        { _id: name },
        { $set: { data: seed, updatedAt: new Date() } },
        { upsert: true, maxTimeMS: 15000 },
      );
      console.log(`[storage] seeded "${name}" into Mongo from ${file} (${Object.keys(seed).length} keys)`);
      return seed;
    } catch (error) {
      console.warn(`[storage] Mongo load "${name}" failed, using local fallback:`, error.message);
      const fallback = readFileBlob(file);
      // Do not make a transient Mongo failure sticky when no committed fallback
      // exists; a later request should be allowed to retry the remote read.
      if (Object.keys(fallback).length > 0) cache.set(name, fallback);
      return fallback;
    }
  })().finally(() => loading.delete(name));

  loading.set(name, promise);
  return promise;
}

async function loadMany(blobs, concurrency = 2) {
  const results = new Array(blobs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < blobs.length) {
      const index = cursor++;
      const { name, file } = blobs[index];
      results[index] = await load(name, file);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, blobs.length) }, worker));
  return results;
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
  for (const key of fieldCache.keys()) {
    if (key.startsWith(`${name}:`)) fieldCache.delete(key);
  }
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
  const doc = await collection.findOne({ _id: name }, { maxTimeMS: 15000 });
  if (doc && doc.data) {
    cache.set(name, doc.data);
    for (const key of fieldCache.keys()) {
      if (key.startsWith(`${name}:`)) fieldCache.delete(key);
    }
  }
  return cache.get(name);
}

// Read or write one property of a blob without transferring the rest of the
// document. latestSnapshots uses this so a commodities request does not also
// download every unrelated dashboard snapshot.
async function readField(name, file, field, { refresh = false } = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(field)) throw new Error(`Invalid storage field: ${field}`);
  const cacheKey = `${name}:${field}`;
  if (refresh) fieldCache.delete(cacheKey);
  if (fieldCache.has(cacheKey)) return fieldCache.get(cacheKey);
  if (fieldLoading.has(cacheKey)) return fieldLoading.get(cacheKey);
  if (mode !== 'mongo' || !collection) return read(name, file)?.[field] ?? null;

  const promise = (async () => {
    try {
      const path = `data.${field}`;
      const doc = await collection.findOne(
        { _id: name },
        { projection: { [path]: 1 }, maxTimeMS: 15000 },
      );
      const value = doc?.data?.[field] ?? null;
      if (value != null) fieldCache.set(cacheKey, value);
      return value;
    } catch (error) {
      console.warn(`[storage] Mongo field read "${name}.${field}" failed:`, error.message);
      return readFileBlob(file)?.[field] ?? null;
    }
  })().finally(() => fieldLoading.delete(cacheKey));
  fieldLoading.set(cacheKey, promise);
  return promise;
}

function writeField(name, file, field, value) {
  if (!/^[A-Za-z0-9_-]+$/.test(field)) throw new Error(`Invalid storage field: ${field}`);
  fieldCache.set(`${name}:${field}`, value);
  if (cache.has(name)) cache.get(name)[field] = value;

  if (mode === 'mongo' && collection) {
    const p = collection.updateOne(
      { _id: name },
      { $set: { [`data.${field}`]: value, updatedAt: new Date() } },
      { upsert: true, maxTimeMS: 15000 },
    ).catch(error => console.warn(`[storage] Mongo field write "${name}.${field}" failed:`, error.message))
      .finally(() => pending.delete(p));
    pending.add(p);
    return;
  }

  const current = read(name, file);
  current[field] = value;
  writeFileBlob(file, current);
}

async function readCompressed(id, { refresh = false } = {}) {
  if (!/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error(`Invalid compressed document id: ${id}`);
  if (refresh) compressedCache.delete(id);
  if (compressedCache.has(id)) return compressedCache.get(id);
  if (compressedLoading.has(id)) return compressedLoading.get(id);
  if (mode !== 'mongo' || !collection) return null;

  const promise = (async () => {
    try {
      const doc = await collection.findOne(
        { _id: id },
        { projection: { compressed: 1 }, maxTimeMS: 15000 },
      );
      if (!doc?.compressed) return null;
      const bytes = Buffer.isBuffer(doc.compressed)
        ? doc.compressed
        : Buffer.from(doc.compressed.buffer || doc.compressed.value?.() || doc.compressed);
      const value = JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
      compressedCache.set(id, value);
      return value;
    } catch (error) {
      console.warn(`[storage] compressed read "${id}" failed:`, error.message);
      return null;
    }
  })().finally(() => compressedLoading.delete(id));
  compressedLoading.set(id, promise);
  return promise;
}

function writeCompressed(id, value) {
  if (!/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error(`Invalid compressed document id: ${id}`);
  if (mode !== 'mongo' || !collection) return false;
  compressedCache.set(id, value);
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 });
  const p = collection.updateOne(
    { _id: id },
    { $set: { compressed, encoding: 'gzip-json', updatedAt: new Date() } },
    { upsert: true, maxTimeMS: 15000 },
  ).catch(error => console.warn(`[storage] compressed write "${id}" failed:`, error.message))
    .finally(() => pending.delete(p));
  pending.add(p);
  return true;
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

module.exports = {
  init, load, loadMany, read, write, reload, readField, writeField,
  readCompressed, writeCompressed,
  flush, seedFromFiles, close, status,
};
