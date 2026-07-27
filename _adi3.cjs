const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await sleep(45000);
 for (const host of ['query2','query1']) {
  const u=`https://${host}.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/ADI?symbol=ADI&type=quarterlyTotalRevenue,quarterlyNetIncome,annualTotalRevenue,annualNetIncome&period1=1104537600&period2=1785110400&merge=false&lang=en-US&region=US`;
  const r=await fetch(u,{headers:{'User-Agent':UA,'Accept':'application/json'}});
  const t=await r.text();
  if(!t.trim().startsWith('{')){console.log(host,r.status,t.slice(0,80)); await sleep(20000); continue;}
  const j=JSON.parse(t);
  for (const s of (j?.timeseries?.result??[])) {
    const k=Object.keys(s).find(x=>x!=='meta'&&x!=='timestamp');
    if(!k) continue;
    console.log(host,k,'count=',(s[k]||[]).length);
    console.log('   ',(s[k]||[]).map(x=>`${x?.asOfDate}=${x?.reportedValue?.raw}`).join(' '));
  }
  break;
 }
})().catch(e=>console.error('ERR',e.message));
