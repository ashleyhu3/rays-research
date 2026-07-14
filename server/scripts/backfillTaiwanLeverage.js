/**
 * Seed the Taiwan retail-firepower history.
 *
 * Backfills margin balances and Yuanta 2× fund net assets daily, plus the
 * combined TWSE + TPEx market-cap denominator at each TWSE week-end. The ratio
 * uses those measured weekly denominators and carries them between observations.
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

  const { dates, latest, funds, etfMarket, marketSizeDate } = data;
  console.log(`[taiwan-leverage] ${dates.length} trading days: ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`[taiwan-leverage] latest ${latest.date}: margin ${latest.margin} (listed ${latest.marginListed} + OTC ${latest.marginOtc}) · ETF ${latest.etf} → total ${latest.total} 億元`);
  console.log(`[taiwan-leverage] margin + Yuanta 2× / market cap: ${latest.leverageRatio?.toFixed(4) ?? '—'}% (market cap observed ${marketSizeDate ?? '—'})`);
  const cover = etfMarket?.total ? ` — ${((latest.etf / etfMarket.total) * 100).toFixed(0)}% of the ${etfMarket.total} 億 listed 2× market` : '';
  console.log(`[taiwan-leverage] ${funds.length} Yuanta 2× funds${cover}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[taiwan-leverage] failed:', e); process.exit(1); });
