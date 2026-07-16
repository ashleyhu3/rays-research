const fs=require('fs'),path=require('path');
const envTxt=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const env={};
for(const l of envTxt.split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
const {MongoClient}=require('mongodb');
(async()=>{
  const c=new MongoClient(env.MONGODB_URI,{serverSelectionTimeoutMS:15000});
  await c.connect();const db=c.db('test');
  // spans of key collections
  for(const col of ['dcDeploymentTrends','dcProjects','stocktwits_daily']){
    const n=await db.collection(col).countDocuments();
    const one=await db.collection(col).findOne();
    console.log(`\n${col}: ${n} docs; sample keys:`,one?Object.keys(one).slice(0,12):null);
    if(one) console.log('  sample:',JSON.stringify(one).slice(0,250));
  }
  // blob spans
  const b=db.collection('blobs');
  for(const id of ['cloudGpuHistory','shortInterestHistory','sentimentData','taiwanLeverageHistory']){
    const d=await b.findOne({_id:id});
    if(d&&d.data){const keys=Object.keys(d.data);console.log(`\nblob ${id}: ${keys.length} top-level keys; e.g.`,keys.slice(0,6));}
  }
  await c.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
