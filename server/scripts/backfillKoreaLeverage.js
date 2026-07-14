/**
 * Seed the Korean retail-firepower history.
 *
 * Nothing here is estimated: KOFIA serves the three cash/credit layers as a
 * daily series over any window, and Daum's per-day listedSharesCount lets the
 * ETF layer be recomputed exactly (price × shares) back to each fund's listing.
 * So one pass rebuilds the full window from primary sources.
 *
 * Both sources reach back five years: KOFIA returns the whole daily window in
 * one response, and Daum keeps paging shares counts well past that.
 *
 * Usage: npm run backfill:korea-leverage -- [days]      (default 1830 ≈ 5y)
 */
const path = require('path');
const storage = require('../storage');
const { getKoreaLeverage } = require('../scrapers/koreaLeverage');

const DAYS = Number(process.argv[2]) || 1830;
const BLOBS = [{ name: 'koreaLeverageHistory', file: path.join(__dirname, '..', 'data', 'koreaLeverageHistory.json') }];

async function main() {
  await storage.init(BLOBS);
  console.log(`[korea-leverage] storage mode: ${storage.status().mode} — backfilling ${DAYS} days…`);

  const data = await getKoreaLeverage(DAYS);

  await storage.flush();
  await storage.close();

  const { dates, latest, funds } = data;
  console.log(`[korea-leverage] ${dates.length} trading days: ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`[korea-leverage] latest ${latest.date}: deposit ${latest.deposit} · CMA ${latest.cma} · margin ${latest.margin} · ETF ${latest.etf} → total ${latest.total} 조원`);
  console.log(`[korea-leverage] ${funds.length} leveraged ETFs, largest: ${funds.slice(0, 3).map(f => `${f.name} ${f.aum}`).join(' · ')}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[korea-leverage] failed:', e); process.exit(1); });
