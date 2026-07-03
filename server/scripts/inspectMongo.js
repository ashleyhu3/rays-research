/**
 * READ-ONLY Mongo inspector. Connects with MONGODB_URI and reports, per blob,
 * how many day-keys are stored and the date range — so we can tell whether the
 * DRAM/AWS backfill actually survived in Mongo or was overwritten.
 *
 * Writes nothing. Safe to run against prod.
 *
 * Usage: MONGODB_URI=... node server/scripts/inspectMongo.js
 *   (or: node --env-file=.env server/scripts/inspectMongo.js)
 */
'use strict';

const BLOBS = ['metricsHistory', 'gpuHistory', 'dramHistory', 'awsHistory', 'cloudGpuHistory'];
const COLLECTION = 'blobs';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }

  const { MongoClient } = require('mongodb');
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || undefined);
  const col = db.collection(COLLECTION);

  for (const name of BLOBS) {
    const doc = await col.findOne({ _id: name });
    if (!doc || !doc.data) { console.log(`${name.padEnd(18)} — MISSING`); continue; }
    const days = Object.keys(doc.data).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    const range = days.length ? `${days[0]} → ${days[days.length - 1]}` : '(no day-keys)';
    console.log(`${name.padEnd(18)} — ${String(days.length).padStart(4)} days  ${range}  updated ${doc.updatedAt || '?'}`);
  }

  await c.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
