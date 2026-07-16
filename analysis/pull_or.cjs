const fs = require('fs');
const path = require('path');
// minimal .env parse
const envTxt = fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');
const env = {};
for (const line of envTxt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const { MongoClient } = require('mongodb');
(async () => {
  const uri = env.MONGODB_URI;
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await c.connect();
  const db = c.db(env.MONGODB_DB || undefined);
  const col = db.collection('blobs');
  const doc = await col.findOne({ _id: 'openrouterRanks' });
  if (!doc || !doc.data) { console.error('no openrouterRanks blob'); process.exit(2); }
  const d = doc.data;
  fs.writeFileSync(path.join(__dirname,'data','openrouterRanks.json'), JSON.stringify(d));
  console.log('weekLabels:', d.weekLabels?.length, 'first:', d.weekLabels?.[0], 'last:', d.weekLabels?.[d.weekLabels.length-1]);
  console.log('providers:', d.providers?.map(p=>p.name+':'+(p.pct*100).toFixed(1)+'%').slice(0,12).join(', '));
  console.log('trend models:', Object.keys(d.trend||{}).length);
  console.log('asOf:', d.asOf, 'latestWeek:', d.latestWeek);
  // also pull metricsHistory for price snapshots
  const mh = await col.findOne({ _id: 'metricsHistory' });
  if (mh && mh.data) { fs.writeFileSync(path.join(__dirname,'data','metricsHistory.json'), JSON.stringify(mh.data)); console.log('metricsHistory keys:', Object.keys(mh.data).length); }
  await c.close();
})().catch(e => { console.error('ERR', e.message); process.exit(3); });
