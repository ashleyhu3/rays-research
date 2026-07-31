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

    // Default: repair only series with gaps. `--all` rebuilds every index from
    // scratch over the full bootstrap window, which is what extending the
    // history (e.g. two years → three) requires — a continuous-but-short series
    // is not "incomplete", so the default check would skip it.
    // `--only=a,b` limits either mode to specific indices.
    const args = process.argv.slice(2);
    const rebuildAll = args.includes('--all');
    const onlyArg = args.find(arg => arg.startsWith('--only='));
    const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean) : null;

    const before = readIndexBreadth();
    let incompleteKeys = rebuildAll ? Object.keys(RAW_BLOB) : incompleteBreadthKeys(before);
    if (only) {
      const unknown = only.filter(key => !RAW_BLOB[key]);
      if (unknown.length) throw new Error(`Unknown index key(s): ${unknown.join(', ')}`);
      incompleteKeys = incompleteKeys.filter(key => only.includes(key));
    }

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
    for (const [position, key] of incompleteKeys.entries()) {
      const startedAt = Date.now();
      console.log(`[index-breadth-backfill] (${position + 1}/${incompleteKeys.length}) ${key} starting…`);
      try {
        const series = await updateIndexBreadth(key, { forceBootstrap: true });
        const valid = series.pctAboveBoth?.filter(value => value != null).length ?? 0;
        // Flush per index: a full rebuild is a long network job, so each index's
        // result is persisted as soon as it is computed rather than risking the
        // whole run to a failure several indices later.
        await storage.flush();
        console.log(
          `[index-breadth-backfill] (${position + 1}/${incompleteKeys.length}) ${key} done in `
          + `${Math.round((Date.now() - startedAt) / 1000)}s — ${series.dates.length} dates, ${valid} valid`,
        );
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
