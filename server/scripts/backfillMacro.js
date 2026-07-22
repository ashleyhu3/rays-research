/**
 * Fetch macro history once and persist it as the latest Mongo/file snapshot.
 * The web route serves this snapshot instead of depending on a live upstream
 * request. The scheduled collector keeps it fresh after the initial backfill.
 */
const storage = require('../storage');
const snapshotStore = require('../snapshotStore');
const BLOBS = require('../storageBlobs');
const scheduler = require('../scheduler');

async function main() {
  await storage.init(BLOBS);
  // Use the same merge path as scheduled/live refreshes so a transient partial
  // response cannot remove previously stored CPI/PPI history.
  const data = await scheduler.scrapers.macro();
  snapshotStore.put('macro', data);
  await storage.flush();
  console.log(`[macro] stored ${Object.keys(data.series).length} series (${Object.keys(data.errors).length} errors)`);
  await storage.close();
}

main().catch(error => {
  console.error('[macro]', error.message);
  process.exitCode = 1;
});
