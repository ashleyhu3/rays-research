'use strict';

// One-time/backfill migration from the legacy aggregate latestSnapshots blob
// to one gzip-compressed Mongo document per source. The web server can read
// both formats, so this is safe to rerun and safe during rolling deploys.
const path = require('path');
const fs = require('fs');
const storage = require('../storage');

const FILE = path.join(__dirname, '..', 'data', 'latestSnapshots.json');

(async () => {
  const snapshots = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  await storage.init([], { preload: false });
  if (storage.status().mode !== 'mongo') throw new Error('MONGODB_URI is required');

  for (const [key, entry] of Object.entries(snapshots)) {
    storage.writeCompressed(`latestSnapshot:${key}`, entry);
  }
  await storage.flush();
  console.log(`[snapshots] migrated ${Object.keys(snapshots).length} compressed source documents`);
  await storage.close();
})().catch(error => {
  console.error('[snapshots]', error.message);
  process.exitCode = 1;
});
