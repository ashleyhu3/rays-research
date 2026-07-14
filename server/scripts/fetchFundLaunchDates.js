/**
 * Resolve each leveraged ETF's launch date and cache it as JSON.
 *
 * Neither leverage scraper carries an inception date, and it cannot be inferred
 * from the history blob: a fund's first appearance there is the day our scraper
 * started tracking it, not the day it listed. KODEX KOSPI200 2× shows up on the
 * first day of our history and listed in 2010; Fubon TAIEX 2× appears in July
 * 2026 and listed in 2016.
 *
 * So take it from each fund's own price record instead: the earliest session an
 * exchange ever priced it is the day it began trading.
 *
 *   Korea (A-codes)  Daum's day pages, the same feed koreaLeverage reads AUM
 *                    from, paged back until it runs out of history.
 *   Taiwan (00xxxL)  FinMind's TaiwanStockPrice, from 2000. (FinMind's
 *                    TaiwanStockInfo has a `date` field, but it is the snapshot
 *                    date — today's — not the listing date.)
 *   Hong Kong        Yahoo's chart API, whose `firstTradeDate` is exactly this
 *                    quantity, for the two CSOP notes.
 *
 * Usage: node server/scripts/fetchFundLaunchDates.js [out.json]
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] ?? path.join(__dirname, '..', 'data', 'fundLaunchDates.json'));

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const DAUM_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://finance.daum.net/',
  'X-Requested-With': 'XMLHttpRequest',
};

const KOREA_CODES = ['A122630', 'A0193T0', 'A0193W0', 'A0195S0', 'A0195R0'];
const TAIWAN_CODES = ['00631L', '00675L'];
const HK_CODES = ['7709', '7747'];

/**
 * The oldest session Daum will serve for a code — its first day of trading.
 *
 * The page cap is a runaway guard only, and it has to clear the oldest fund here:
 * KODEX KOSPI200 2× listed in February 2010 and its record ends on page 41, so a
 * 40-page lid silently reported its 41st-page-deep listing as April 2010.
 */
async function koreaFirstSession(code) {
  let oldest = null;
  for (let page = 1; page <= 80; page += 1) {
    const url = `https://finance.daum.net/api/quote/${code}/days`
      + `?symbolCode=${code}&page=${page}&perPage=100&pagination=true`;
    const res = await fetch(url, { headers: DAUM_HEADERS, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Daum HTTP ${res.status} for ${code}`);
    const rows = (await res.json()).data ?? [];
    if (!rows.length) break;
    oldest = String(rows[rows.length - 1].date ?? '').slice(0, 10);
    // A short page is the end of the record: the fund has no history before it.
    if (rows.length < 100) break;
  }
  return oldest;
}

async function taiwanFirstSession(code) {
  const url = 'https://api.finmindtrade.com/api/v4/data'
    + `?dataset=TaiwanStockPrice&data_id=${code}&start_date=2000-01-01&end_date=${new Date().toISOString().slice(0, 10)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`FinMind HTTP ${res.status} for ${code}`);
  const rows = (await res.json()).data ?? [];
  return rows[0]?.date ?? null;
}

/**
 * Exchange listing dates as the issuers state them. These are the authority; the
 * scraped first session is kept only to cross-check them.
 *
 * The two agree everywhere they can. Where they don't, it is Yahoo that is wrong:
 * its `firstTradeDate` for the CSOP notes is where *its* price history starts, which
 * is weeks after the notes actually listed. Korea's Daum record, by contrast, reaches
 * back to the true first session and matches the issuer to the day.
 */
const ISSUER_LISTINGS = {
  7709:     { date: '2025-10-16', src: 'https://www.csopasset.com/en/products/hk-skhy-2l' },
  7747:     { date: '2025-05-28', src: 'https://www.csopasset.com/en/products/hk-smsn-2l' },
  A122630:  { date: '2010-02-22', src: 'https://m.samsungfund.com/sheet/20200211/2ETF25_20200131.pdf' },
  A0193T0:  { date: '2026-05-27', src: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFV6' },
  A0193W0:  { date: '2026-05-27', src: 'https://www.samsungfund.com/etf/insight/newsroom/view.do?seq=76354' },
  A0195S0:  { date: '2026-05-27', src: 'https://investments.miraeasset.com/tigeretf/ko/insight/etf-insight/view.do?detailsKey=687' },
  A0195R0:  { date: '2026-05-27', src: 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR70195R0008' },
};

// Yahoo states the quantity outright: the first session the note ever traded. It
// throttles a back-to-back pair of requests from one IP, so back off and retry
// rather than record a rate limit as an unknown launch date.
async function hkFirstSession(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.HK?range=max&interval=1d`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (res.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${code}`);
    const meta = (await res.json()).chart?.result?.[0]?.meta;
    return meta?.firstTradeDate
      ? new Date(meta.firstTradeDate * 1000).toISOString().slice(0, 10)
      : null;
  }
  return null;   // Throttled. The issuer's listing date stands on its own.
}

async function main() {
  // What each price record says the fund's first session was. Yahoo throttles this
  // IP freely, and it is only a cross-check, so a failure there is not fatal.
  const derived = {};
  for (const code of KOREA_CODES) derived[code] = await koreaFirstSession(code);
  for (const code of TAIWAN_CODES) derived[code] = await taiwanFirstSession(code);
  for (const code of HK_CODES) {
    derived[code] = await hkFirstSession(code).catch(() => null);
  }

  const launches = {};
  const disagreements = [];
  for (const code of [...KOREA_CODES, ...TAIWAN_CODES, ...HK_CODES]) {
    const issuer = ISSUER_LISTINGS[code]?.date ?? null;
    const first = derived[code] ?? null;
    launches[code] = issuer ?? first;

    if (issuer && first && issuer !== first) disagreements.push({ code, issuer, first });
    const agrees = issuer && first && issuer === first ? ' (price record agrees)' : '';
    const basis = issuer ? 'issuer' : 'first traded';
    console.log(`[launch-dates] ${code} — ${launches[code] ?? 'unresolved'} [${basis}]${agrees}`);
  }

  for (const { code, issuer, first } of disagreements) {
    console.log(`[launch-dates] ${code}: issuer says ${issuer}, price record starts ${first} — using the issuer`);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    note: 'Exchange listing date. Issuer-stated where published; otherwise the first '
      + 'session the exchange priced the fund.',
    sources: {
      issuer: 'CSOP, Samsung (KODEX) and Mirae (TIGER) product pages',
      korea: 'finance.daum.net day pages (cross-check)',
      taiwan: 'FinMind TaiwanStockPrice (first traded session)',
      hongKong: 'Yahoo chart API firstTradeDate (cross-check; starts after listing)',
    },
    fetchedAt: new Date().toISOString(),
    launches,
    crossCheck: { derived, disagreements },
  }, null, 2));
  console.log(`[launch-dates] wrote ${OUT}`);
}

main().catch(error => {
  console.error('[launch-dates] failed:', error.message);
  process.exitCode = 1;
});
