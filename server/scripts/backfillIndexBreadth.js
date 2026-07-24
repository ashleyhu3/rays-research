'use strict';

const storage = require('../storage');
const allBlobs = require('../storageBlobs');
const {
  readIndexBreadth,
  updateIndexBreadth,
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
    const incompleteKeys = Object.entries(before)
      .filter(([, series]) => {
        const firstValid = series.pctAboveBoth?.findIndex(value => value != null) ?? -1;
        // A brand-new index has no valid observations at all (firstValid < 0)
        // and still needs its initial bootstrap; an existing one is incomplete
        // only if a gap appears after its first valid observation.
        if (firstValid < 0) return true;
        return series.pctAboveBoth.slice(firstValid).some(value => value == null);
      })
      .map(([key]) => key);

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
