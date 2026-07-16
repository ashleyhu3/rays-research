const fs = require('fs'), path = require('path');
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'); const env = {};
for (const l of envTxt.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { MongoClient } = require('mongodb');
const OUT = path.join(__dirname, 'data', 'mongo'); fs.mkdirSync(OUT, { recursive: true });

function shape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `Array(${v.length})` + (v.length ? `[${shape(v[0], depth + 1)}]` : '');
  if (typeof v === 'object') { const ks = Object.keys(v); return `{${ks.slice(0, 8).join(',')}${ks.length > 8 ? ',…+' + (ks.length - 8) : ''}}`; }
  return typeof v;
}

(async () => {
  const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await c.connect(); const db = c.db('test'); const B = db.collection('blobs');
  const BLOBS = ['gpuHistory', 'dramHistory', 'nandHistory', 'awsHistory', 'cloudGpuHistory', 'tpuHistory', 'cpuHistory', 'tftLcdHistory', 'sentimentData', 'shortInterestHistory', 'metricsHistory', 'optionsOI', 'dailyOptionsReport', 'optionsPriorYearVolume'];
  for (const id of BLOBS) {
    const doc = await B.findOne({ _id: id });
    if (!doc || !doc.data) { console.log(`\n### ${id}: MISSING`); continue; }
    const d = doc.data;
    fs.writeFileSync(path.join(OUT, id + '.json'), JSON.stringify(d));
    const topKeys = Object.keys(d);
    console.log(`\n### ${id}  top-level: {${topKeys.slice(0, 14).join(', ')}${topKeys.length > 14 ? ',…+' + (topKeys.length - 14) : ''}}`);
    // probe a few keys' shapes
    for (const k of topKeys.slice(0, 6)) console.log(`   .${k}: ${shape(d[k])}`);
    // if there's a dated array somewhere, show span
    for (const k of topKeys) {
      const v = d[k];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object' && (v[0].date || v[0].t || v[0].day)) {
        const df = x => x.date || x.t || x.day;
        console.log(`   .${k} span: ${df(v[0])} .. ${df(v[v.length - 1])} (${v.length})  sample=${JSON.stringify(v[v.length-1]).slice(0,160)}`);
      }
    }
  }
  // collections
  for (const col of ['stocktwits_daily', 'dcProjects', 'dcDeploymentTrends']) {
    const n = await db.collection(col).countDocuments();
    const one = await db.collection(col).findOne();
    console.log(`\n### collection ${col}: ${n} docs; keys={${one ? Object.keys(one).join(',') : ''}}`);
    console.log('   sample:', JSON.stringify(one).slice(0, 300));
  }
  // stocktwits span + symbols
  const st = db.collection('stocktwits_daily');
  const dates = (await st.distinct('date')).sort(); const syms = await st.distinct('symbol');
  console.log(`\nstocktwits_daily: ${dates[0]}..${dates[dates.length-1]} (${dates.length}d), ${syms.length} symbols: ${syms.join(',')}`);
  // export full stocktwits_daily to file
  const allSt = await st.find({}).toArray();
  fs.writeFileSync(path.join(OUT, 'stocktwits_daily.json'), JSON.stringify(allSt.map(r => { const { _id, ...rest } = r; return rest; })));
  await c.close();
  console.log('\nwrote blobs to', OUT);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
