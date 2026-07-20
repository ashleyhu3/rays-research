/**
 * Seed the US leverage history: FINRA margin debt, CFTC TFF leveraged-fund
 * equity-index futures positions, and leveraged-ETF net assets. FINRA and CFTC
 * both publish official historical files, so one regular scraper run can build
 * a real backfill; the scheduler then keeps extending the same history.
 *
 * Usage: npm run backfill:us-leverage
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getUsLeverage } = require('../scrapers/usLeverage');

const BLOBS = [
  { name: 'usLeverageHistory', file: path.join(__dirname, '..', 'data', 'usLeverageHistory.json') },
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[us-leverage] storage mode: ${storage.status().mode} — fetching FINRA/CFTC/ETF data…`);

  const data = await getUsLeverage();
  snapshotStore.put('usLeverage', data);

  await storage.flush();
  await storage.close();

  console.log(`[us-leverage] margin debt: ${data.marginDebt.dates.length} months, latest ${data.marginDebt.latest.date}: $${data.marginDebt.latest.value}B`);
  for (const [key, series] of Object.entries(data.cftc.contracts)) {
    const latestStack = (series.latest.long ?? 0) + (series.latest.short ?? 0) + (series.latest.spreading ?? 0);
    console.log(`[us-leverage] CFTC ${key}: ${series.dates.length}w, latest ${series.latest.date ?? '—'}: ${latestStack} LF stack / ${series.latest.totalOpenInterest ?? '—'} total OI`);
  }
  console.log(`[us-leverage] Leveraged ETF net assets: ${data.leveragedEtf.funds.length}/9 funds as of ${data.leveragedEtf.fundsDate ?? '—'}`);
  for (const fund of data.leveragedEtf.funds) {
    console.log(`[us-leverage]   ${fund.label} (${fund.key}): $${fund.aum}B`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('[us-leverage] failed:', e); process.exit(1); });
