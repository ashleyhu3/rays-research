/**
 * Collector-side Mongo sync for the scheduled StockTwits workflow. Two phases:
 *
 *   prepare <outDir>   Write one-row "resume stub" CSVs (latest message per
 *                      ticker) into outDir, so the Python collector's incremental
 *                      logic knows where to resume WITHOUT the full CSVs living
 *                      in the repo. Tickers with no Mongo data yet are skipped
 *                      (Python then full-scrapes them from its default start).
 *
 *   ingest <dir>       Upsert every api_tweets_*.csv in dir into Mongo (recent
 *                      messages + recomputed daily rollups), then prune raw
 *                      messages older than the retention window.
 *
 * The Python scraper runs between the two phases (see the workflow). Tickers are
 * read from stocktwits/Stocktwits-Scraper-main/tickers.txt.
 *
 * Usage: MONGODB_URI=... node server/scripts/syncStocktwits.js prepare <outDir>
 *        MONGODB_URI=... node server/scripts/syncStocktwits.js ingest  <dir>
 */
const fs = require('fs');
const path = require('path');
const store = require('../stocktwitsStore');

const TICKERS_FILE = path.join(__dirname, '..', '..', 'stocktwits', 'Stocktwits-Scraper-main', 'tickers.txt');

function readTickers() {
  return fs.readFileSync(TICKERS_FILE, 'utf8')
    .split('\n')
    .map(l => l.split('#', 1)[0].trim().toUpperCase())
    .filter(Boolean);
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set.'); process.exit(1); }
  const [phase, dir] = process.argv.slice(2);
  if (!phase || !dir) { console.error('Usage: syncStocktwits.js <prepare|ingest> <dir>'); process.exit(1); }

  if (phase === 'prepare') {
    const written = await store.writeResumeStubs(dir, readTickers());
    console.log(`[prepare] wrote ${written.length} resume stub(s) to ${dir}: ${written.join(', ') || '(none — all tickers will full-scrape)'}`);
  } else if (phase === 'ingest') {
    await store.ensureIndexes();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^api_tweets_.+\.csv$/.test(f)) : [];
    let upserted = 0, days = 0;
    for (const f of files) {
      const r = await store.ingestCsv(path.join(dir, f));
      upserted += r.upserted; days += r.daysRecomputed;
      console.log(`[ingest] ${r.file}: +${r.upserted} messages, ${r.daysRecomputed} days recomputed`);
    }
    const pruned = await store.prune();
    console.log(`[ingest] total +${upserted} messages across ${files.length} files, ${days} daily rollups updated; pruned ${pruned} message(s) older than ${store.retentionCutoff()}`);
  } else {
    console.error(`Unknown phase "${phase}" (expected prepare|ingest).`); process.exit(1);
  }
  await store.close();
  process.exit(0);
}

main().catch(e => { console.error('sync failed:', e.message); process.exit(1); });
