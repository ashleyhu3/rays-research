const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices:['yahooSurvey'], fetchOptions:{headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}} });
(async()=>{
  const q = await yf.fundamentalsTimeSeries('ADI',{period1:'2005-01-01',period2:'2026-07-27',type:'quarterly',module:'financials'});
  console.log('QUARTERLY rows:', q.length);
  console.log(q.map(r=>`${r.date.toISOString().slice(0,10)} rev=${r.totalRevenue} ni=${r.netIncome}`).join('\n'));
  const a = await yf.fundamentalsTimeSeries('ADI',{period1:'2005-01-01',period2:'2026-07-27',type:'annual',module:'financials'});
  console.log('\nANNUAL rows:', a.length);
  console.log(a.map(r=>`${r.date.toISOString().slice(0,10)} rev=${r.totalRevenue} ni=${r.netIncome}`).join('\n'));
})().catch(e=>console.error('ERR',e.message));
