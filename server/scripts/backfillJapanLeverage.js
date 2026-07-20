/**
 * Seed the Japan margin-leverage history.
 *
 * JPX's workbook always serves its full weekly history (2002 → present) in
 * one file, and so do four of the five ETF-issuer CSVs — only the HKEXnews
 * leg (CSOP 7262.HK) needs a date-range argument, which `days` widens for
 * this one-off deep backfill (the regular scraper polls a narrow 90-day
 * window daily).
 *
 * Usage: npm run backfill:japan-leverage -- [days]     (default 1830 ≈ 5y)
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getJapanLeverage } = require('../scrapers/japanLeverage');

const DAYS = Number(process.argv[2]) || 1830;
const BLOBS = [
  { name: 'japanLeverageHistory', file: path.join(__dirname, '..', 'data', 'japanLeverageHistory.json') },
  // The server seeds its request cache from latestSnapshots on boot, so a backfill
  // that only rewrites history leaves the API serving the pre-backfill payload —
  // refresh the snapshot too.
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[japan-leverage] storage mode: ${storage.status().mode} — fetching JPX weekly margin + ETF history (${DAYS}d HKEX window)…`);

  const data = await getJapanLeverage(DAYS);
  snapshotStore.put('japanLeverage', data);

  await storage.flush();
  await storage.close();

  const { dates, latest, etf } = data;
  console.log(`[japan-leverage] ${dates.length} weekly points: ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`[japan-leverage] latest ${latest.date}: purchases ${latest.purchases}T / sales ${latest.sales}T JPY, ratio ${latest.ratio}x`);
  const totalLatest = etf.total.length ? etf.total[etf.total.length - 1] : null;
  console.log(`[japan-leverage] 2x ETF net assets as of ${etf.fundsDate ?? '—'}: ${totalLatest ?? '—'}B JPY total`);
  for (const fund of etf.funds) {
    console.log(`[japan-leverage]   ${fund.label} (${fund.code}, ${fund.market}): ${fund.aum}B JPY`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('[japan-leverage] failed:', e); process.exit(1); });
