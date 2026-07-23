/**
 * Seed the "national team" ETF flow history (see chinaNationalTeamFlow.js for
 * the full architecture).
 *
 * SZSE's fund-size report takes a real date range (paginated, cheap); SSE's
 * has none — backfilling it costs one request per missing trading day per
 * ticker (10 .SH tickers × ~250 trading days/year, at a polite pace). Default
 * is 365 days (~1.5–2 min); pass a larger value for deeper history at
 * proportionally greater cost.
 *
 * SZSE IP-blocks after a modest number of requests in one continuous session
 * (see chinaNationalTeamFlow.js's SZSE comments). A deep backfill across all
 * 7 .SZ tickers can trip that block partway through — the scraper now saves
 * progress after every ticker and stops early once a run looks blocked, so
 * re-running this same command later resumes rather than starting over. Pass
 * a ticker filter to run just the .SZ tickers (skipping the already-complete
 * .SH ones) or to retry a specific subset after a block clears (~25-30 min).
 *
 * Usage: npm run backfill:china-national-team-flow -- [days] [tickers]
 *   days     default 365
 *   tickers  optional comma-separated subset, e.g. 159915.SZ,159952.SZ
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getChinaNationalTeamFlow } = require('../scrapers/chinaNationalTeamFlow');

const DAYS = Number(process.argv[2]) || 365;
const TICKERS = process.argv[3] ? process.argv[3].split(',').map(s => s.trim()).filter(Boolean) : null;
const BLOBS = [
  { name: 'chinaNationalTeamFlowHistory', file: path.join(__dirname, '..', 'data', 'chinaNationalTeamFlowHistory.json') },
  // The server seeds its request cache from latestSnapshots on boot, so a backfill
  // that only rewrites history leaves the API serving the pre-backfill payload —
  // refresh the snapshot too.
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[china-national-team-flow] storage mode: ${storage.status().mode} — backfilling ${DAYS} days${TICKERS ? ` for ${TICKERS.join(', ')}` : ''}…`);

  const data = await getChinaNationalTeamFlow(DAYS, TICKERS);
  snapshotStore.put('chinaNationalTeamFlow', data);

  await storage.flush();
  await storage.close();

  const { dates, groups } = data;
  console.log(`[china-national-team-flow] ${dates.length} dates with flow data: ${dates[0] ?? '—'} → ${dates[dates.length - 1] ?? '—'}`);
  for (const [group, series] of Object.entries(groups)) {
    const last = [...series].reverse().find(v => v != null);
    console.log(`[china-national-team-flow]   ${group}: latest flow ${last ?? '—'}亿元`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('[china-national-team-flow] failed:', e); process.exit(1); });
