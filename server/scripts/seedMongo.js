/**
 * Push the local committed JSON history files into MongoDB, overwriting the
 * stored blobs. Use this after re-running a backfill locally to publish the
 * fresh baseline to production.
 *
 * The server also auto-seeds any *missing* blob on first boot; this script is
 * the explicit "force overwrite" path for blobs that already exist in Mongo.
 *
 * Usage: MONGODB_URI=... node server/scripts/seedMongo.js
 *    or: npm run db:seed   (loads MONGODB_URI from .env)
 */
const path = require('path');
const storage = require('../storage');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BLOBS = [
  { name: 'metricsHistory',       file: path.join(DATA_DIR, 'metricsHistory.json') },
  { name: 'gpuHistory',           file: path.join(DATA_DIR, 'gpuHistory.json') },
  { name: 'dramHistory',          file: path.join(DATA_DIR, 'dramHistory.json') },
  { name: 'awsHistory',           file: path.join(DATA_DIR, 'awsHistory.json') },
  { name: 'cloudGpuHistory',      file: path.join(DATA_DIR, 'cloudGpuHistory.json') },
  { name: 'optionsOI',            file: path.join(DATA_DIR, 'optionsOI.json') },
  { name: 'shortInterestHistory', file: path.join(DATA_DIR, 'shortInterestHistory.json') },
  { name: 'sentimentData',        file: path.join(DATA_DIR, 'sentiment.json') },
];

storage.seedFromFiles(BLOBS)
  .then(() => { console.log('\nDone seeding Mongo from local JSON files.'); process.exit(0); })
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
