/**
 * Seed the Taiwan retail-firepower history.
 *
 * Only the margin layer backfills — TWSE publishes the balance in money terms
 * for every past day, and FinMind serves the whole window in one request. The
 * leveraged-ETF layer cannot be backfilled at all: units outstanding are only
 * published for the current day, so that layer starts accumulating from the
 * first collection and is left null before it.
 *
 * Usage: npm run backfill:taiwan-leverage -- [days]     (default 1830 ≈ 5y)
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getTaiwanLeverage } = require('../scrapers/taiwanLeverage');

const DAYS = Number(process.argv[2]) || 1830;
const BLOBS = [
  { name: 'taiwanLeverageHistory', file: path.join(__dirname, '..', 'data', 'taiwanLeverageHistory.json') },
  // The server seeds its request cache from latestSnapshots on boot, so a backfill
  // that only rewrites history leaves the API serving the pre-backfill payload —
  // including its old shape, which is how a newly added layer goes missing from
  // the chart while the data sits correct on disk. Refresh the snapshot too.
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
]

async function main() {
  await storage.init(BLOBS);
  console.log(`[taiwan-leverage] storage mode: ${storage.status().mode} — backfilling ${DAYS} days…`);

  const data = await getTaiwanLeverage(DAYS);
  snapshotStore.put('taiwanLeverage', data);

  await storage.flush();
  await storage.close();

  const { dates, latest, funds, etfMarket } = data;
  console.log(`[taiwan-leverage] ${dates.length} trading days: ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`[taiwan-leverage] latest ${latest.date}: margin ${latest.margin} (listed ${latest.marginListed} + OTC ${latest.marginOtc}) · ETF ${latest.etf} → total ${latest.total} 億元`);
  const cover = etfMarket?.total ? ` — ${((latest.etf / etfMarket.total) * 100).toFixed(0)}% of the ${etfMarket.total} 億 listed 2× market` : '';
  console.log(`[taiwan-leverage] ${funds.length} Yuanta 2× funds${cover}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[taiwan-leverage] failed:', e); process.exit(1); });
