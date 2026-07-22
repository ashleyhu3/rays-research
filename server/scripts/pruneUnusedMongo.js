'use strict';

/**
 * Remove Mongo data that is not referenced by the website.
 *
 * Dry-run (default): node --env-file=.env server/scripts/pruneUnusedMongo.js
 * Apply:             node --env-file=.env server/scripts/pruneUnusedMongo.js --apply
 */

const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const SAMPLE_DATABASE = 'sample_mflix';
const ORPHAN_BLOB_IDS = [null, 'optionsAlerts'];
const UNUSED_COLLECTIONS = [
  'transcripts',            // Legacy API collection; no frontend consumer.
  'normalized_transcripts', // Feeds a sidebar list, but no chart or table.
];

async function bsonBytes(collection, filter = {}) {
  const rows = await collection.aggregate([
    { $match: filter },
    { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } },
  ]).toArray();
  return rows[0]?.bytes || 0;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  try {
    const appDatabase = client.db(process.env.MONGODB_DB || undefined);
    const databases = await client.db().admin().listDatabases();
    const sampleInfo = databases.databases.find(database => database.name === SAMPLE_DATABASE);
    const blobs = appDatabase.collection('blobs');
    const orphanFilter = { _id: { $in: ORPHAN_BLOB_IDS } };
    const orphanCount = await blobs.countDocuments(orphanFilter);
    const orphanBytes = await bsonBytes(blobs, orphanFilter);
    const appCollections = await appDatabase.listCollections({}, { nameOnly: true }).toArray();
    const existingNames = new Set(appCollections.map(({ name }) => name));
    const unusedCollections = [];
    for (const name of UNUSED_COLLECTIONS) {
      if (!existingNames.has(name)) continue;
      const collection = appDatabase.collection(name);
      unusedCollections.push({
        name,
        count: await collection.countDocuments(),
        bytes: await bsonBytes(collection),
      });
    }

    console.log(`${APPLY ? 'Applying' : 'Dry run for'} Mongo cleanup:`);
    console.log(`- drop ${SAMPLE_DATABASE}: ${sampleInfo?.sizeOnDisk || 0} on-disk bytes`);
    console.log(`- delete ${orphanCount} orphan blob docs: ${orphanBytes} BSON bytes`);
    for (const collection of unusedCollections) {
      console.log(`- drop ${appDatabase.databaseName}.${collection.name}: ${collection.count} docs, ${collection.bytes} BSON bytes`);
    }
    for (const name of UNUSED_COLLECTIONS.filter(name => !existingNames.has(name))) {
      console.log(`- drop ${appDatabase.databaseName}.${name}: already absent`);
    }

    if (!APPLY) {
      console.log('No changes made. Re-run with --apply to delete these targets.');
      return;
    }

    if (sampleInfo) await client.db(SAMPLE_DATABASE).dropDatabase();
    const deleted = await blobs.deleteMany(orphanFilter);
    for (const collection of unusedCollections) {
      await appDatabase.collection(collection.name).drop();
    }

    const remainingDatabases = await client.db().admin().listDatabases();
    const sampleStillExists = remainingDatabases.databases.some(database => database.name === SAMPLE_DATABASE);
    const remainingOrphans = await blobs.countDocuments(orphanFilter);
    const remainingCollections = await appDatabase.listCollections({}, { nameOnly: true }).toArray();
    const remainingNames = new Set(remainingCollections.map(({ name }) => name));
    const unusedStillExists = UNUSED_COLLECTIONS.some(name => remainingNames.has(name));
    if (sampleStillExists || remainingOrphans || unusedStillExists) {
      throw new Error('Cleanup verification failed');
    }

    console.log(`Cleanup complete: sample database dropped, ${deleted.deletedCount} orphan blobs deleted, ${unusedCollections.length} unused collections dropped.`);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
