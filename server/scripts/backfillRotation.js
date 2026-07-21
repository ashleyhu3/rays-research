/**
 * Backfill Mongo/local history for every Rotation page dataset.
 *
 * Usage:
 *   npm run backfill:rotation -- [all|us|china|hk|premium] [days]
 *   npm run backfill:rotation -- hk 2555
 */
'use strict';

const storage = require('../storage');
const allBlobs = require('../storageBlobs');

const target = (process.argv[2] || 'all').toLowerCase();
const days = Number(process.argv[3]) || 1825;
const targets = {
  us: {
    blob: 'usPerformanceHistory',
    run: () => require('../scrapers/usPerformance').updateUsPerformance(days),
  },
  china: {
    blob: 'hkChinaPerformanceHistory',
    run: () => require('../scrapers/hkChinaPerformance').updateHkChinaPerformance(days),
  },
  hk: {
    blob: 'hkPerformanceHistory',
    run: () => require('../scrapers/hkPerformance').getHkPerformance(days),
  },
  premium: {
    blob: 'chinaEtfPremiumHistory',
    run: () => require('../scrapers/chinaEtfPremium').updateChinaEtfPremium(days),
  },
};

async function main() {
  const selected = target === 'all' ? Object.entries(targets) : [[target, targets[target]]];
  if (!selected[0][1]) throw new Error(`Unknown target "${target}"`);
  const names = new Set(selected.map(([, config]) => config.blob));
  await storage.init(allBlobs.filter(blob => names.has(blob.name)));
  console.log(`[rotation-backfill] storage=${storage.status().mode}; targets=${selected.map(([name]) => name).join(',')}; days=${days}`);

  for (const [name, config] of selected) {
    console.log(`[rotation-backfill] starting ${name}…`);
    const data = await config.run();
    const count = data.dates?.length ?? data.series?.reduce((sum, series) => sum + (series.points?.length ?? 0), 0) ?? 0;
    console.log(`[rotation-backfill] ${name}: ${count} persisted observations/dates`);
  }

  await storage.flush();
  await storage.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('[rotation-backfill] failed:', error);
  process.exit(1);
});
