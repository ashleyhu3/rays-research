/**
 * Verify the MONGODB_URI connection and show what's stored.
 * Usage: npm run db:ping   (loads MONGODB_URI from .env)
 */
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set (add it to .env).'); process.exit(1); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || undefined);
    await db.command({ ping: 1 });
    console.log(`✓ Connected to MongoDB (db: ${db.databaseName})`);
    const docs = await db.collection('blobs').find({}).toArray();
    if (docs.length === 0) {
      console.log('  blobs collection is empty — the server will seed it from JSON on first boot.');
    } else {
      for (const d of docs) {
        console.log(`  ${d._id}: ${Object.keys(d.data || {}).length} keys · updated ${d.updatedAt?.toISOString?.() ?? '—'}`);
      }
    }
  } catch (e) {
    console.error('✗ Connection failed:', e.message);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
