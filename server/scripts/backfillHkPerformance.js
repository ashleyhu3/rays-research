/**
 * Seed the Hang Seng Composite sub-index history from East Money.
 *
 * East Money's kline endpoint carries the full history for every HSCI
 * sub-index back to their respective listing dates (HSCI itself back to
 * 2019+); one pass rebuilds the whole window.
 *
 * Usage: npm run backfill:hk-performance -- [days]      (default 2555 ≈ 7y)
 */
const path = require('path');
const storage = require('../storage');
const { getHkPerformance } = require('../scrapers/hkPerformance');

const DAYS = Number(process.argv[2]) || 2555;
const BLOBS = [
  { name: 'hkPerformanceHistory', file: path.join(__dirname, '..', 'data', 'hkPerformanceHistory.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[hk-performance] storage mode: ${storage.status().mode} — backfilling ${DAYS} days…`);

  const data = await getHkPerformance(DAYS);

  await storage.flush();
  await storage.close();

  console.log(`[hk-performance] ${data.dates.length} trading days: ${data.dates[0]} → ${data.dates[data.dates.length - 1]}`);
  for (const s of data.series) {
    const nonNull = s.closes.filter(c => c != null).length;
    console.log(`[hk-performance] ${s.ticker} ${s.name}: ${nonNull} closes${s.error ? ` (error: ${s.error})` : ''}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('[hk-performance] failed:', e); process.exit(1); });
