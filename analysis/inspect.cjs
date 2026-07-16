const fs = require('fs'); const path = require('path');
const envTxt = fs.readFileSync(path.join(__dirname,'..','.env'),'utf8'); const env = {};
for (const line of envTxt.split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await c.connect();
  console.log('DB from URI default:', c.db().databaseName);
  const admin = c.db().admin();
  const dbs = await admin.listDatabases();
  for (const dbi of dbs.databases) {
    if (['admin','local','config'].includes(dbi.name)) continue;
    const db = c.db(dbi.name);
    const cols = await db.listCollections().toArray();
    console.log(`\nDB ${dbi.name}: collections = ${cols.map(x=>x.name).join(', ')}`);
    if (cols.find(x=>x.name==='blobs')) {
      const ids = await db.collection('blobs').find({}, { projection: { _id: 1 } }).toArray();
      console.log('  blob ids:', ids.map(x=>x._id).join(', '));
    }
  }
  await c.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(3);});
