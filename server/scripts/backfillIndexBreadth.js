'use strict';

const storage = require('../storage');
const allBlobs = require('../storageBlobs');
const {
  readIndexBreadth,
  updateIndexBreadth,
  _test: { incompleteBreadthKeys },
} = require('../scrapers/indexBreadth');

const NAMES = new Set([
  'indexBreadthHistory',
  'globalIndicesHistory',
  'breadthRawSp500History',
  'breadthRawNdxHistory',
  'breadthRawHsiHistory',
  'breadthRawCsi300History',
  'breadthRawSoxHistory',
  'breadthRawNikkei225History',
  'breadthRawChinextHistory',
  'breadthRawTaiexHistory',
  'breadthRawKospi200History',
  'breadthRawTopixHistory',
]);

async function main() {
  try {
    await storage.init(allBlobs.filter(blob => NAMES.has(blob.name)));
    const before = readIndexBreadth();
    const incompleteKeys = incompleteBreadthKeys(before);

    if (!incompleteKeys.length) {
      console.log('[index-breadth-backfill] all breadth series are already continuous');
      return;
    }

    console.log(`[index-breadth-backfill] bootstrapping/rebuilding series: ${incompleteKeys.join(', ')}`);
    for (const key of incompleteKeys) {
      await updateIndexBreadth(key, { forceBootstrap: true });
    }
    await storage.flush();
    const result = readIndexBreadth();
    for (const [key, series] of Object.entries(result)) {
      const valid = series.pctAboveBoth?.filter(value => value != null).length ?? 0;
      console.log(`[index-breadth-backfill] ${key}: ${series.dates.length} dates, ${valid} valid SMA observations`);
    }
  } finally {
    await storage.close();
  }
}

main().catch(error => {
  console.error('[index-breadth-backfill] failed:', error);
  process.exitCode = 1;
});
