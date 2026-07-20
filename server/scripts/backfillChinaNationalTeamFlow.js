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
 * Usage: npm run backfill:china-national-team-flow -- [days]   (default 365)
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getChinaNationalTeamFlow } = require('../scrapers/chinaNationalTeamFlow');

const DAYS = Number(process.argv[2]) || 365;
const BLOBS = [
  { name: 'chinaNationalTeamFlowHistory', file: path.join(__dirname, '..', 'data', 'chinaNationalTeamFlowHistory.json') },
  // The server seeds its request cache from latestSnapshots on boot, so a backfill
  // that only rewrites history leaves the API serving the pre-backfill payload —
  // refresh the snapshot too.
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[china-national-team-flow] storage mode: ${storage.status().mode} — backfilling ${DAYS} days…`);

  const data = await getChinaNationalTeamFlow(DAYS);
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
