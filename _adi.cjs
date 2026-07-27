const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
(async()=>{
  // exactly what the Yahoo financials page itself calls
  const u='https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/ADI?symbol=ADI&type=quarterlyTotalRevenue,quarterlyNetIncome&period1=1104537600&period2=1785000000&merge=false&lang=en-US&region=US';
  const r=await fetch(u,{headers:{'User-Agent':UA}});
  const j=await r.json();
  for (const s of (j?.timeseries?.result??[])) {
    const k=Object.keys(s).find(x=>x!=='meta'&&x!=='timestamp');
    if(!k) continue;
    console.log(k, 'count=', (s[k]||[]).length);
    console.log('  ', (s[k]||[]).map(x=>`${x?.asOfDate}:${x?.reportedValue?.raw}`).join(' '));
  }
})().catch(e=>console.error('ERR',e.message));
