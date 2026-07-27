const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 // 1) the human page, to see what columns Yahoo actually renders
 const r=await fetch('https://finance.yahoo.com/quote/ADI/financials/',{headers:{'User-Agent':UA,'Accept':'text/html'}});
 const html=await r.text();
 console.log('page status',r.status,'len',html.length);
 const dates=[...html.matchAll(/\b(9\/\d{1,2}\/20\d\d|\d{1,2}\/\d{1,2}\/20\d\d)\b/g)].map(m=>m[1]);
 console.log('date-like strings in page:', [...new Set(dates)].slice(0,30));
 const m=html.match(/"asOfDate":"(\d{4}-\d{2}-\d{2})"/g);
 console.log('asOfDate hits:', m ? [...new Set(m)].slice(0,40) : 'none');
 await sleep(180000);
 for (const host of ['query2','query1']) {
  const u=`https://${host}.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/ADI?symbol=ADI&type=quarterlyTotalRevenue,annualTotalRevenue&period1=1104537600&period2=1785110400&merge=false&lang=en-US&region=US`;
  const rr=await fetch(u,{headers:{'User-Agent':UA,'Accept':'application/json'}});
  const t=await rr.text();
  if(!t.trim().startsWith('{')){console.log(host,rr.status,t.slice(0,60)); await sleep(30000); continue;}
  const j=JSON.parse(t);
  for (const s of (j?.timeseries?.result??[])) {
    const k=Object.keys(s).find(x=>x!=='meta'&&x!=='timestamp');
    if(!k) continue;
    console.log(host,k,'count=',(s[k]||[]).length,(s[k]||[]).map(x=>x?.asOfDate).join(' '));
  }
  break;
 }
})().catch(e=>console.error('ERR',e.message));
