/**
 * Seed the China A-share margin-leverage history.
 *
 * SSE's margin history serves any date range in one request; SZSE's margin
 * history and both exchanges' market cap (the ratio charts' denominator) have
 * no range query, so five years of those costs one request per trading day
 * each (~1,300 × 3 ≈ 3,900, at a polite pace) — budget several minutes for
 * this to run. The four 2× ETFs (HKEX, KRX, NYSE Arca) come from Yahoo
 * Finance in one request each.
 *
 * Usage: npm run backfill:china-leverage -- [days]     (default 1830 ≈ 5y)
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getChinaLeverage } = require('../scrapers/chinaLeverage');

const DAYS = Number(process.argv[2]) || 1830;
const BLOBS = [
  { name: 'chinaLeverageHistory', file: path.join(__dirname, '..', 'data', 'chinaLeverageHistory.json') },
  // The server seeds its request cache from latestSnapshots on boot, so a backfill
  // that only rewrites history leaves the API serving the pre-backfill payload —
  // refresh the snapshot too.
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[china-leverage] storage mode: ${storage.status().mode} — backfilling ${DAYS} days…`);

  const data = await getChinaLeverage(DAYS);
  snapshotStore.put('chinaLeverage', data);

  await storage.flush();
  await storage.close();

  const { dates, latest, etf } = data;
  console.log(`[china-leverage] ${dates.length} trading days: ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`[china-leverage] latest ${latest.date}: balance ${latest.balance}T + lending ${latest.lendBalance}B → total ${latest.totalBalance}T CNY`);
  console.log(`[china-leverage] purchase ${latest.purchase}B / repay ${latest.repay}B / lending volume ${latest.lendVolume}M shares`);
  const totalLatest = etf.total.length ? etf.total[etf.total.length - 1] : null;
  console.log(`[china-leverage] ETF net assets as of ${etf.fundsDate ?? '—'}: ${totalLatest ?? '—'}B CNY total`);
  for (const fund of etf.funds) {
    console.log(`[china-leverage]   ${fund.label} (${fund.code}, ${fund.market}): ${fund.aum}B CNY${fund.approx ? ' (approx.)' : ''}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('[china-leverage] failed:', e); process.exit(1); });
