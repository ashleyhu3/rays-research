/**
 * One-shot migration: push all local JSON data files to MongoDB, then verify.
 * After this runs successfully, the local files can be deleted and gitignored.
 *
 * Usage: node server/scripts/migrateLocalToMongo.js
 *    or: node -r dotenv/config server/scripts/migrateLocalToMongo.js
 */
'use strict';

// Load .env manually since dotenv may not be installed
try {
  const envPath = require('path').join(__dirname, '../../.env');
  const lines = require('fs').readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const storage = require('../storage');

const DATA_DIR = path.join(__dirname, '..', 'data');

const BLOBS = [
  { name: 'metricsHistory',  file: path.join(DATA_DIR, 'metricsHistory.json') },
  { name: 'gpuHistory',      file: path.join(DATA_DIR, 'gpuHistory.json') },
  { name: 'dramHistory',     file: path.join(DATA_DIR, 'dramHistory.json') },
  { name: 'nandHistory',     file: path.join(DATA_DIR, 'nandHistory.json') },
  { name: 'tftLcdHistory',   file: path.join(DATA_DIR, 'tftLcdHistory.json') },
  { name: 'awsHistory',      file: path.join(DATA_DIR, 'awsHistory.json') },
  { name: 'cpuHistory',      file: path.join(DATA_DIR, 'cpuHistory.json') },
  { name: 'tpuHistory',      file: path.join(DATA_DIR, 'tpuHistory.json') },
  { name: 'sentimentData',   file: path.join(DATA_DIR, 'sentiment.json') },
  { name: 'latestSnapshots', file: path.join(DATA_DIR, 'latestSnapshots.json') },
];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function walkDir(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full, ext));
    else if (!ext || entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);

  // ── 1. Blob history files ───────────────────────────────────────────────
  console.log('\n── Blob history files ─────────────────────────────────────');
  const blobCol = db.collection('blobs');
  for (const { name, file } of BLOBS) {
    const data = readJson(file);
    if (!data) { console.log(`  SKIP  ${name} (file not found: ${file})`); continue; }
    const keys = Array.isArray(data) ? data.length : Object.keys(data).length;
    await blobCol.updateOne({ _id: name }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
    console.log(`  OK    ${name} → ${keys} keys`);
  }

  // ── 2. Normalized transcripts ───────────────────────────────────────────
  console.log('\n── Normalized transcripts ─────────────────────────────────');
  const txCol = db.collection('normalized_transcripts');
  await txCol.createIndex({ ticker: 1, fiscal_period: 1 }, { unique: true, background: true });
  const txFiles = walkDir(path.join(DATA_DIR, 'transcripts'), '.json')
    .filter(f => !f.includes('/processed/') && !f.includes('/embeddings/') && !f.includes('manifest'));
  for (const file of txFiles) {
    const doc = readJson(file);
    if (!doc || !doc.ticker || !doc.fiscal_period) { console.log(`  SKIP  ${file} (no ticker/period)`); continue; }
    await txCol.updateOne(
      { ticker: doc.ticker, fiscal_period: doc.fiscal_period },
      { $set: { ...doc, updatedAt: new Date().toISOString() } },
      { upsert: true },
    );
    console.log(`  OK    transcript ${doc.ticker} ${doc.fiscal_period}`);
  }

  // ── 3. Enrichments (processed) ──────────────────────────────────────────
  console.log('\n── Enrichments (processed) ────────────────────────────────');
  const enrichCol = db.collection('transcript_enrichments');
  const chunkCol  = db.collection('transcript_chunks');
  const factCol   = db.collection('transcript_facts');
  await enrichCol.createIndex({ ticker: 1, fiscal_period: 1 }, { unique: true, background: true });
  await chunkCol.createIndex({ ticker: 1, fiscal_period: 1 }, { background: true });
  await factCol.createIndex({ ticker: 1, fiscal_period: 1 }, { background: true });

  const enrichFiles = walkDir(path.join(DATA_DIR, 'transcripts', 'processed'), '.json');
  for (const file of enrichFiles) {
    const doc = readJson(file);
    if (!doc || !doc.ticker || !doc.fiscal_period) { console.log(`  SKIP  ${file}`); continue; }
    const { chunks = [], facts = [], ...summary } = doc;
    await enrichCol.updateOne(
      { ticker: doc.ticker, fiscal_period: doc.fiscal_period },
      { $set: { ...summary, updatedAt: new Date().toISOString() } },
      { upsert: true },
    );
    if (chunks.length) {
      await chunkCol.deleteMany({ ticker: doc.ticker, fiscal_period: doc.fiscal_period });
      await chunkCol.insertMany(chunks.map(c => ({ ...c, ticker: doc.ticker, fiscal_period: doc.fiscal_period })));
    }
    if (facts.length) {
      await factCol.deleteMany({ ticker: doc.ticker, fiscal_period: doc.fiscal_period });
      await factCol.insertMany(facts.map(f => ({ ...f, ticker: doc.ticker, fiscal_period: doc.fiscal_period })));
    }
    console.log(`  OK    enrichment ${doc.ticker} ${doc.fiscal_period} (${chunks.length} chunks, ${facts.length} facts)`);
  }

  await client.close();
  console.log('\n✓ Migration complete. All local data has been pushed to MongoDB.');
  console.log('  You can now delete server/data/ contents (except files needed for local dev fallback).');
}

main().then(() => process.exit(0)).catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
