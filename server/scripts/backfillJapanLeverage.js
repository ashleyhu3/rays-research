/**
 * Seed the Japan margin-leverage history.
 *
 * JPX's workbook always serves its full weekly history (2002 → present) in
 * one file, so this is the same fetch the regular scraper does — there is no
 * days/range argument to tune.
 *
 * Usage: npm run backfill:japan-leverage
 */
const path = require('path');
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const { getJapanLeverage } = require('../scrapers/japanLeverage');

const BLOBS = [
  { name: 'japanLeverageHistory', file: path.join(__dirname, '..', 'data', 'japanLeverageHistory.json') },
  // The server seeds its request cache from latestSnapshots on boot, so a backfill
  // that only rewrites history leaves the API serving the pre-backfill payload —
  // refresh the snapshot too.
  { name: 'latestSnapshots', file: path.join(__dirname, '..', 'data', 'latestSnapshots.json') },
];

async function main() {
  await storage.init(BLOBS);
  console.log(`[japan-leverage] storage mode: ${storage.status().mode} — fetching JPX weekly margin history…`);

  const data = await getJapanLeverage();
  snapshotStore.put('japanLeverage', data);

  await storage.flush();
  await storage.close();

  const { dates, latest } = data;
  console.log(`[japan-leverage] ${dates.length} weekly points: ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`[japan-leverage] latest ${latest.date}: purchases ${latest.purchases}T / sales ${latest.sales}T JPY, ratio ${latest.ratio}x`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[japan-leverage] failed:', e); process.exit(1); });
