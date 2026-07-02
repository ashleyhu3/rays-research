/**
 * Seed AI data center buildout data into MongoDB.
 * Usage: npm run db:seed:dc
 *   or:  node --env-file=.env server/scripts/seedDcBuildouts.js
 */
const { MongoClient } = require('mongodb');
const path = require('path');
const fs   = require('fs');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const raw  = fs.readFileSync(path.join(__dirname, '../data/dcBuildouts.json'), 'utf8');
  const data = JSON.parse(raw);

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);

  // Upsert deployment trend snapshot (single document, keyed by type)
  await db.collection('dcDeploymentTrends').replaceOne(
    { _type: 'snapshot' },
    { _type: 'snapshot', updatedAt: new Date(), ...data.deploymentTrends },
    { upsert: true }
  );
  console.log('[dc-buildouts] upserted deployment trends');

  // Replace operator totals
  await db.collection('dcOperators').deleteMany({});
  await db.collection('dcOperators').insertMany(data.operators.map(o => ({ ...o, updatedAt: new Date() })));
  console.log(`[dc-buildouts] inserted ${data.operators.length} operators`);

  // Replace project locations
  await db.collection('dcProjects').deleteMany({});
  await db.collection('dcProjects').insertMany(data.projects.map(p => ({ ...p, updatedAt: new Date() })));
  console.log(`[dc-buildouts] inserted ${data.projects.length} projects`);

  // Replace per-company chart data
  await db.collection('dcCompanyCharts').deleteMany({});
  const companyDocs = Object.entries(data.companyCharts).map(([key, val]) => ({
    _key: key, ...val, updatedAt: new Date(),
  }));
  await db.collection('dcCompanyCharts').insertMany(companyDocs);
  console.log(`[dc-buildouts] inserted ${companyDocs.length} company charts`);

  await client.close();
  console.log('[dc-buildouts] done');
}

main().catch(e => { console.error(e); process.exit(1); });
