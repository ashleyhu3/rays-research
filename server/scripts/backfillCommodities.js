const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const BLOBS = require('../storageBlobs');
const { getCommodityData } = require('../scrapers/commodities');

async function main() {
  await storage.init(BLOBS);
  const previous = (await snapshotStore.latest('commodities'))?.data;
  const data = await getCommodityData(previous);
  snapshotStore.put('commodities', data);
  await storage.flush();
  console.log(`[commodities] stored ${Object.keys(data.series).length} series (${Object.keys(data.errors).length} errors)`);
  await storage.close();
}

main().catch(error => {
  console.error('[commodities]', error.message);
  process.exitCode = 1;
});
