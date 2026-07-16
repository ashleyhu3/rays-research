const fs=require('fs'),path=require('path');
const envTxt=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const env={};
for(const l of envTxt.split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
const {MongoClient}=require('mongodb');
(async()=>{
  const c=new MongoClient(env.MONGODB_URI,{serverSelectionTimeoutMS:15000});
  await c.connect();const db=c.db('test');
  const st=db.collection('stocktwits_daily');
  const dates=await st.distinct('date');dates.sort();
  const syms=await st.distinct('symbol');
  console.log('stocktwits_daily span:',dates[0],'->',dates[dates.length-1],`(${dates.length} days), symbols(${syms.length}):`,syms.slice(0,25).join(','));
  const sd=await db.collection('blobs').findOne({_id:'sentimentData'});
  if(sd&&sd.data){
    console.log('\nsentimentData.tickers sample:',JSON.stringify(sd.data.tickers).slice(0,200));
    console.log('sentimentData.rolling keys:',Object.keys(sd.data.rolling||{}).slice(0,5));
    const r=sd.data.rolling;const k=Object.keys(r||{})[0];
    if(k)console.log(`rolling["${k}"]:`,JSON.stringify(r[k]).slice(0,200));
  }
  await c.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
