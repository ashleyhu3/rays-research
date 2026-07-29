/**
 * Seed the KOSPI investor net-buying history.
 *
 * Nothing here is estimated or interpolated: Naver republishes KRX's own daily
 * investor table, ten sessions per page, and every row is checked against the
 * zero-sum identity before it is stored. So one pass rebuilds the whole window
 * from the primary numbers.
 *
 * Cost is one request per ten sessions — roughly 125 requests for five years,
 * paced at ~8/sec, so a full backfill is under a minute.
 *
 * Usage: npm run backfill:korea-investor-flow -- [days]   (default 1830 ≈ 5y)
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getKoreaInvestorFlow } = require('../scrapers/koreaInvestorFlow');

const DAYS = Number(process.argv[2]) || 1830;
const BLOBS = [
  { name: 'koreaInvestorFlowHistory', file: path.join(__dirname, '..', 'data', 'koreaInvestorFlowHistory.json') },
  // The server seeds its request cache from latestSnapshots on boot, so a
  // backfill that only rewrites history leaves the API serving the pre-backfill
  // payload. Refresh the snapshot too.
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[korea-investor-flow] storage mode: ${storage.status().mode} — backfilling ${DAYS} days…`);

  const data = await getKoreaInvestorFlow(DAYS);
  snapshotStore.put('koreaInvestorFlow', data);

  await storage.flush();
  await storage.close();

  const { dates, latest } = data;
  console.log(`[korea-investor-flow] ${dates.length} trading days: ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`[korea-investor-flow] latest ${latest.date}: individuals ${latest.individual} · foreigners ${latest.foreign} · institutions ${latest.institution} 조원`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[korea-investor-flow] failed:', e); process.exit(1); });
