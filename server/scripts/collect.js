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
const storage = require('../storage');
const scheduler = require('../scheduler');
const BLOBS = require('../storageBlobs');

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

  // The sentiment scraper self-serves a cached snapshot for up to 3 days; this
  // always-on collector is the reliable daily-refresh path, so force it to do a
  // real recompute each run (otherwise the snapshot advances only every ~4 days).
  process.env.SENTIMENT_FORCE = '1';

  const rotation = keys.filter(key => scheduler.ROTATION_KEYS.includes(key));
  const remaining = keys.filter(key => !scheduler.ROTATION_KEYS.includes(key));
  if (remaining.length) await scheduler.refreshAll(remaining);
  for (const key of rotation) await scheduler.refreshAll([key]);

  await storage.flush();              // ensure all Mongo upserts land before exit
  await storage.close();
  console.log('[collect] done.');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('[collect] failed:', e.message); process.exit(1); });
