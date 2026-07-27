'use strict';

const storage = require('../storage');
const allBlobs = require('../storageBlobs');
const {
  readIndexBreadth,
  updateIndexBreadth,
  incompleteBreadthKeys,
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

const RAW_BLOB = {
  sp500: 'breadthRawSp500History',
  ndx: 'breadthRawNdxHistory',
  hsi: 'breadthRawHsiHistory',
  csi300: 'breadthRawCsi300History',
  sox: 'breadthRawSoxHistory',
  nikkei225: 'breadthRawNikkei225History',
  chinext: 'breadthRawChinextHistory',
  taiex: 'breadthRawTaiexHistory',
  kospi200: 'breadthRawKospi200History',
  topix: 'breadthRawTopixHistory',
};

async function main() {
  try {
    const blobs = allBlobs.filter(blob => NAMES.has(blob.name));
    const blobByName = new Map(blobs.map(blob => [blob.name, blob]));
    await storage.init(blobs, { preload: false });
    const aggregateBlob = blobByName.get('indexBreadthHistory');
    await storage.load(aggregateBlob.name, aggregateBlob.file);

    const before = readIndexBreadth();
    const incompleteKeys = incompleteBreadthKeys(before);

    if (!incompleteKeys.length) {
      console.log('[index-breadth-backfill] all breadth series are already continuous');
      return;
    }

    for (const key of incompleteKeys) {
      const blob = blobByName.get(RAW_BLOB[key]);
      await storage.load(blob.name, blob.file);
    }
    if (incompleteKeys.some(key => key === 'sox' || key === 'nikkei225')) {
      const turnoverBlob = blobByName.get('globalIndicesHistory');
      await storage.load(turnoverBlob.name, turnoverBlob.file);
    }

    console.log(`[index-breadth-backfill] bootstrapping/rebuilding series: ${incompleteKeys.join(', ')}`);
    const failures = [];
    for (const key of incompleteKeys) {
      try {
        await updateIndexBreadth(key, { forceBootstrap: true });
      } catch (error) {
        failures.push(`${key}: ${error.message}`);
        console.error(`[index-breadth-backfill] ${key} failed: ${error.message}`);
      }
    }
    await storage.flush();
    const result = readIndexBreadth();
    for (const [key, series] of Object.entries(result)) {
      const valid = series.pctAboveBoth?.filter(value => value != null).length ?? 0;
      console.log(`[index-breadth-backfill] ${key}: ${series.dates.length} dates, ${valid} valid SMA observations`);
    }
    if (failures.length) {
      throw new Error(`Incomplete breadth backfill (${failures.join('; ')})`);
    }
  } finally {
    await storage.close();
  }
}

main().catch(error => {
  console.error('[index-breadth-backfill] failed:', error);
  process.exitCode = 1;
});
