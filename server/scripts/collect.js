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

  // Default: every scraper. COLLECT_KEYS=hn,gpu limits the run (testing / split
  // cadences); COLLECT_EXCLUDE_KEYS removes keys from an otherwise full run.
  // The scheduled workflow uses the latter to isolate SZSE-heavy collectors
  // that must not hit ShowReport concurrently from the same runner.
  const all = Object.keys(scheduler.scrapers);
  let keys = process.env.COLLECT_KEYS
    ? process.env.COLLECT_KEYS.split(',').map(k => k.trim()).filter(k => all.includes(k))
    : all;
  if (process.env.COLLECT_EXCLUDE_KEYS) {
    const excluded = new Set(process.env.COLLECT_EXCLUDE_KEYS.split(',').map(k => k.trim()).filter(Boolean));
    keys = keys.filter(k => !excluded.has(k));
  }

  // A targeted scheduled step can name the exact canonical blobs its scraper
  // mutates. This avoids downloading every unrelated dashboard history twice
  // when one scraper is deliberately isolated from the main collector.
  const preloadNames = process.env.COLLECT_BLOBS
    ? new Set(process.env.COLLECT_BLOBS.split(',').map(name => name.trim()).filter(Boolean))
    : null;
  await storage.init(BLOBS, { preload: !preloadNames });
  if (preloadNames) {
    const selected = BLOBS.filter(blob => preloadNames.has(blob.name));
    if (selected.length !== preloadNames.size) {
      const known = new Set(selected.map(blob => blob.name));
      throw new Error(`Unknown COLLECT_BLOBS: ${[...preloadNames].filter(name => !known.has(name)).join(', ')}`);
    }
    await storage.loadMany(selected);
  }
  console.log(`[collect] storage mode: ${storage.status().mode}`);
  console.log(`[collect] running ${keys.length} scrapers…`);

  // The sentiment scraper self-serves a cached snapshot for up to 3 days; this
  // always-on collector is the reliable daily-refresh path, so force it to do a
  // real recompute each run (otherwise the snapshot advances only every ~4 days).
  process.env.SENTIMENT_FORCE = '1';

  // chinaNationalTeamFlow and chinaLeverage both use SZSE's aggressively
  // rate-limited ShowReport endpoint. A full collection previously launched
  // them together inside refreshAll's Promise.allSettled burst, causing SZSE
  // to block the runner and leaving every Shenzhen ETF stale. Finish flow
  // first, then start the rest of the collection.
  if (keys.includes('chinaNationalTeamFlow') && keys.length > 1) {
    await scheduler.refreshAll(['chinaNationalTeamFlow']);
    keys = keys.filter(key => key !== 'chinaNationalTeamFlow');
  }

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
