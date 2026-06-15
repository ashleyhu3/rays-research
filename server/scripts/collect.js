/**
 * One-shot data collector — runs every scraper once, persists the snapshots to
 * the configured store (Mongo via storage.js), then exits.
 *
 * Why this exists: on Render's free tier the web service sleeps when idle, so
 * its in-process `node-cron` can't reliably fire the daily scrape. This script
 * is run instead by an always-on external scheduler (GitHub Actions, see
 * .github/workflows/collect-data.yml) that writes to the same MongoDB the web
 * service reads from — so history keeps accumulating even while the site sleeps.
 *
 * It connects to Mongo first (so writes merge with existing history rather than
 * overwrite), runs the scrapers, then flushes pending writes before exiting.
 *
 * Usage: MONGODB_URI=... node server/scripts/collect.js
 */
const path = require('path');
const storage = require('../storage');
const scheduler = require('../scheduler');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BLOBS = [
  { name: 'metricsHistory', file: path.join(DATA_DIR, 'metricsHistory.json') },
  { name: 'gpuHistory',     file: path.join(DATA_DIR, 'gpuHistory.json') },
  { name: 'dramHistory',    file: path.join(DATA_DIR, 'dramHistory.json') },
  { name: 'awsHistory',     file: path.join(DATA_DIR, 'awsHistory.json') },
];

async function main() {
  if (!process.env.MONGODB_URI) {
    console.warn('[collect] MONGODB_URI not set — snapshots will write to local JSON files only.');
  }
  await storage.init(BLOBS);
  console.log(`[collect] storage mode: ${storage.status().mode}`);

  // Default: every scraper. COLLECT_KEYS=hn,gpu limits the run (testing / split cadences).
  const all = Object.keys(scheduler.scrapers);
  const keys = process.env.COLLECT_KEYS
    ? process.env.COLLECT_KEYS.split(',').map(k => k.trim()).filter(k => all.includes(k))
    : all;
  console.log(`[collect] running ${keys.length} scrapers…`);
  await scheduler.refreshAll(keys);   // runs each scraper, snapshots history via storage

  await storage.flush();              // ensure all Mongo upserts land before exit
  await storage.close();
  console.log('[collect] done.');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('[collect] failed:', e.message); process.exit(1); });
