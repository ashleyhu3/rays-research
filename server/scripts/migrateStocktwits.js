/**
 * One-time migration: move the committed StockTwits CSVs into MongoDB.
 *
 * Reads every stocktwits/Stocktwits-Scraper-main/data/api_tweets_*.csv and:
 *   • builds the per-(ticker, UTC-day) rollup from ALL history → `stocktwits_daily`
 *     (kept forever — this is the posting-volume / sentiment chart data), and
 *   • inserts the raw messages from the last 18 months → `stocktwits_messages`
 *     (retention-bounded; powers keyword search).
 * Creates the required indexes (incl. the $text index) first. Idempotent: it
 * upserts by message_id and by (ticker|date), so re-running is safe.
 *
 * Run this ONCE, after setting MONGODB_URI, before switching the collector
 * workflow over to Mongo. Then you can stop committing the CSVs.
 *
 * Usage: MONGODB_URI=... node server/scripts/migrateStocktwits.js
 *    or:  npm run stocktwits:migrate   (loads MONGODB_URI from .env)
 */
const store = require('../stocktwitsStore');

(async () => {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set.'); process.exit(1); }
  console.log(`Migrating CSVs from ${store.DATA_DIR}`);
  console.log(`Retention cutoff for raw messages: ${store.retentionCutoff()} (last ${store.RETENTION_MONTHS} months)\n`);
  const summary = await store.migrateCsvDir();
  const totals = summary.reduce((a, s) => ({ rows: a.rows + s.rawRows, msgs: a.msgs + s.messagesInserted, daily: a.daily + s.dailyDocs }), { rows: 0, msgs: 0, daily: 0 });
  console.log(`\nDone. ${summary.length} tickers · ${totals.rows.toLocaleString()} CSV rows → ${totals.msgs.toLocaleString()} messages (<=18mo) + ${totals.daily.toLocaleString()} daily rollup docs.`);
  await store.close();
  process.exit(0);
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
