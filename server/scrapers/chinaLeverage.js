/**
 * China A-share market leverage — SSE (Shanghai) + SZSE (Shenzhen) combined
 * margin-trading balances, one point per trading day, plus the four listed 2×
 * daily leveraged products that track A-share indices, across three markets.
 *
 *   balance       融资余额        combined SSE + SZSE margin (financing) balance
 *   purchase      融资买入额      combined margin purchase amount, that day's flow
 *   repay         融资偿还额      combined margin repayment amount, that day's flow
 *   lendBalance   融券余额        combined securities-lending balance, in money
 *   lendVolume    融券卖出量      combined securities-lending sell volume, in shares
 *   totalBalance  两融余额        combined margin + securities-lending balance
 *
 * Neither exchange's official summary table publishes 融资偿还额 as a market
 * total — only SSE does, and only in a field its own website leaves off the
 * public column list (see sseMargin below). SZSE's is derived from the
 * exchange's own published roll-forward identity, printed in the report's own
 * footer: 本日融资余额 = 前日融资余额 + 本日融资买入 − 本日融资偿还额.
 *
 * SSE (query.sse.com.cn) serves any date range in one request, complete with
 * every metric this page charts. SZSE (szse.cn) only serves one date per
 * request, so its history is built up day by day — cheap on the daily poll
 * (only new days are fetched), a few-minute job for a deep backfill.
 *
 * No 2× leveraged product exists for four of the six major A-share indices
 * (SSE 50, CSI 500, STAR 50, CSI 1000) — mainland China does not permit
 * onshore leveraged ETFs, and no offshore issuer has brought one to market for
 * those four. Only two indices have real, listed products, and CSI 300 has
 * three separate listings:
 *   csi300     CSOP CSI 300 Index Daily (2×) Leveraged Product     7233.HK
 *   chinext    Bosera SZSE ChiNext Daily (2×) Leveraged Product    7234.HK
 *   csi300Krx  Mirae Asset TIGER China CSI300 Leverage (synthetic) 204480.KS
 *   csi300Us   Direxion Daily CSI 300 China A Share Bull 2X Shares CHAU
 *
 * Each is sourced differently, and every AUM is converted to CNY so the four
 * can be summed into one total and compared in one table — the same
 * multi-currency rollup koreaLeverage.js does for its own HK/US legs:
 *   csi300     HKEXnews daily L&I disclosure workbook — reports its own AUM
 *              directly in RMB, no FX needed. The workbook's internal
 *              "stockId" (distinct from the stock code) is required to query
 *              it and its resolver endpoint is Akamai-gated to real browser
 *              sessions; it was resolved once via Playwright and is hardcoded
 *              below, same as koreaLeverage.js's HKEX_FUNDS.
 *   chinext    Same HKEXnews mechanism, different issuer's workbook, reports
 *              in HKD — converted to CNY via that day's FX close.
 *   csi300Krx  Daum's /api/quote/{code}/days, exactly like koreaLeverage.js's
 *              own domestic funds: exact AUM = that day's price × that day's
 *              listedSharesCount, in KRW — converted to CNY via FX.
 *   csi300Us   No free source publishes CHAU's historical shares outstanding
 *              — Yahoo's endpoint for it needs an auth cookie this scraper
 *              doesn't have, and Direxion's own site sits behind a Cloudflare
 *              bot-check not worth defeating. Nasdaq's listing page discloses
 *              current net assets for free, but only today's snapshot: shares
 *              outstanding is implied as (today's Nasdaq AUM ÷ today's close)
 *              and applied across the historical Yahoo close-price series.
 *              Re-read every run, so the implied share count self-corrects
 *              going forward; it is an approximation for days before this
 *              scraper started running, since no free source gives a true
 *              historical share count for this fund.
 */
const path = require('path');
const XLSX = require('@e965/xlsx');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'chinaLeverageHistory.json');
const BLOB = 'chinaLeverageHistory';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const YUAN_T = 1e12;
const YUAN_B = 1e9;
const SHARES_M = 1e6;
const YI = 1e8; // 亿 — the unit SZSE quotes its report in

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);
const compact = day => day.replace(/-/g, '');
const round = v => Math.round(v);
const round2 = v => Math.round(v * 100) / 100;

/* ── SSE: query.sse.com.cn ─────────────────────────────────────────── */

const SSE_URL = 'https://query.sse.com.cn/marketdata/tradedata/queryMargin.do';

// One request covers the whole window (pageSize 5000 rows ≈ 20 years of
// trading days). The response's field names are undocumented but stable and
// self-consistent — verified against the exchange's own roll-forward identity
// (rzye[t] ≈ rzye[t-1] + rzmre[t] − rzche[t], within a few yuan of rounding).
// rzche (融资偿还额) is dropped by the field's public column listing on
// sse.com.cn but is present in the raw JSON this endpoint actually returns.
async function sseMargin(from, to) {
  const q = new URLSearchParams({
    isPagination: 'true',
    beginDate: from,
    endDate: to,
    tabType: '',
    stockCode: '',
    'pageHelp.pageSize': '5000',
    'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1',
    'pageHelp.cacheSize': '1',
    'pageHelp.endPage': '5',
  });
  const res = await fetch(`${SSE_URL}?${q}`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.sse.com.cn/' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`SSE margin HTTP ${res.status}`);
  const json = await res.json();
  const rows = json.pageHelp?.data ?? [];
  const out = {};
  for (const row of rows) {
    const raw = String(row.opDate ?? '');
    if (!/^\d{8}$/.test(raw)) continue;
    const day = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    const balance = Number(row.rzye);
    if (!Number.isFinite(balance)) continue;
    out[day] = {
      balance,
      purchase: Number(row.rzmre),
      repay: Number(row.rzche),
      lendVolume: Number(row.rqmcl),
      lendBalance: Number(row.rqylje),
      totalBalance: Number(row.rzrqjyzl),
    };
  }
  if (!Object.keys(out).length) throw new Error('SSE margin returned no rows');
  return out;
}

/* ── SZSE: szse.cn report API ──────────────────────────────────────── */

const SZSE_URL = 'https://www.szse.cn/api/report/ShowReport/data';

// One date per request — this report has no range query. Values come back as
// comma-formatted strings in 亿 (hundred million); repayment amount isn't
// published here at all and is derived by the caller from consecutive days'
// balance + purchase, per the exchange's own roll-forward identity (see the
// footer note this same report prints alongside its data).
async function szseMarginDay(day) {
  const q = new URLSearchParams({
    SHOWTYPE: 'JSON',
    CATALOGID: '1837_xxpl',
    txtDate: day,
    tab1PAGENO: '1',
    random: String(Math.random()),
  });
  const res = await fetch(`${SZSE_URL}?${q}`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.szse.cn/disclosure/margin/object/index.html' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`SZSE margin HTTP ${res.status}`);
  const json = await res.json();
  const row = json?.[0]?.data?.[0];
  if (!row) return null; // market closed that day
  const num = v => Number(String(v ?? '').replace(/,/g, '')) * YI;
  const balance = num(row.jrrzye);
  if (!Number.isFinite(balance)) return null;
  return {
    balance,
    purchase: num(row.jrrzmr),
    lendVolume: num(row.jrrjmc),
    lendBalance: num(row.jrrjye),
    totalBalance: num(row.jrrzrjye),
    // repay filled in by the caller, which has the trading-day sequence
  };
}

/* ── 2× products: net assets (AUM), one point per trading day ───────── */

// Static metadata for the four products — see the file header for how each
// is sourced. Order here is the fund table's default (falls back to sort by
// AUM once assembled).
const ETF_PRODUCTS = [
  { key: 'csi300', label: 'CSOP CSI 300 2×', code: '7233.HK', market: 'Hong Kong' },
  { key: 'chinext', label: 'Bosera ChiNext 2×', code: '7234.HK', market: 'Hong Kong' },
  { key: 'csi300Krx', label: 'Mirae TIGER CSI300 2×', code: '204480.KS', market: 'Korea' },
  { key: 'csi300Us', label: 'Direxion CSI 300 2×', code: 'CHAU', market: 'United States' },
];

/* HKEXnews: csi300 (7233.HK) and chinext (7234.HK) ─────────────────── */

const HKEX_HOST = 'https://www1.hkexnews.hk';
const HKEX_SEARCH = `${HKEX_HOST}/search/titleSearchServlet.do`;

// stockId is HKEXnews' internal identifier, not the stock code — resolved
// once via a real browser against /search/prefix.do?type=A&name=07233&
// market=SEHK (that lookup is Akamai-gated to real browser sessions) and
// stable thereafter, same as koreaLeverage.js's HKEX_FUNDS.
const HKEX_PRODUCTS = {
  csi300: { code: '7233', stockId: 1000050043 },
  chinext: { code: '7234', stockId: 1000152421 },
};

async function hkexFilings(stockId, from, to) {
  const q = new URLSearchParams({
    sortDir: '0', sortByOptions: 'DateTime', category: '0', market: 'SEHK',
    stockId: String(stockId), documentType: '-1',
    fromDate: from, toDate: to,
    title: '', searchType: '1', t1code: '-2', t2Gcode: '-2', t2code: '-2',
    rowRange: '2000', lang: 'E',
  });
  const res = await fetch(`${HKEX_SEARCH}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HKEXnews search HTTP ${res.status}`);
  const json = await res.json();
  const rows = JSON.parse(json.result ?? '[]');
  return rows.filter(r => r.FILE_TYPE === 'XLSX' && r.FILE_LINK);
}

// Small pool — same limit koreaLeverage.js uses; a burst with no lid is
// exactly the shape that gets an IP throttled.
async function mapPool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i]); }
  }));
}

// Each issuer files its own workbook per product per day (unlike Korea's
// CSOP single-stock family, where one workbook covers several products at
// once). Rows are label-keyed; read by label rather than position, since
// issuers pad labels with footnote markers between filings.
function parseHkexProductWorkbook(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const findRow = label => rows.find(r => String(r?.[0] ?? '').trim().startsWith(label));
  const dateRow = findRow('Date (ddmmmyyyy)');
  const aumRow = findRow('Asset Under Management (L&I Product Total)');
  if (!dateRow || !aumRow) return null;
  const dateCell = dateRow[2];
  const day = dateCell instanceof Date && Number.isFinite(dateCell.getTime())
    ? dateCell.toISOString().slice(0, 10) : null;
  const currency = aumRow[1];
  const aum = Number(aumRow[2]);
  if (!day || !Number.isFinite(aum)) return null;
  return { day, currency, aum };
}

async function hkexProductHistory(stockId, from, to) {
  const filings = await hkexFilings(stockId, from, to);
  const out = {};
  await mapPool(filings, 4, async row => {
    try {
      const res = await fetch(`${HKEX_HOST}${row.FILE_LINK}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return;
      const buffer = Buffer.from(await res.arrayBuffer());
      const parsed = parseHkexProductWorkbook(buffer);
      if (parsed) out[parsed.day] = parsed; // { currency, aum }
    } catch (e) {
      console.warn(`[chinaLeverage] HKEXnews workbook ${row.FILE_LINK}: ${e.message}`);
    }
  });
  return out;
}

/* Daum: csi300Krx (204480.KS) ──────────────────────────────────────── */

const DAUM_HEADERS = { 'User-Agent': UA, Referer: 'https://finance.daum.net/domestic/all_etfs' };
const TIGER_CSI300_CODE = 'A204480';

async function daumJson(url) {
  const res = await fetch(url, { headers: DAUM_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Daum HTTP ${res.status} for ${url}`);
  return res.json();
}

// Same pagination pattern as koreaLeverage.js's fundHistory: 100 trading days
// per page, capped at 40 pages (≈16 years) as a runaway guard.
async function tigerCsi300History(from) {
  const out = {};
  for (let page = 1; page <= 40; page++) {
    const json = await daumJson(`https://finance.daum.net/api/quote/${TIGER_CSI300_CODE}/days?symbolCode=${TIGER_CSI300_CODE}&page=${page}&perPage=100&pagination=true`);
    const rows = json.data ?? [];
    for (const r of rows) {
      const day = String(r.date ?? '').slice(0, 10);
      if (!day || day < from) continue;
      if (!Number.isFinite(r.tradePrice) || !Number.isFinite(r.listedSharesCount)) continue;
      out[day] = r.tradePrice * r.listedSharesCount; // raw KRW
    }
    const oldest = String(rows[rows.length - 1]?.date ?? '').slice(0, 10);
    if (rows.length < 100 || (oldest && oldest < from)) break;
  }
  return out;
}

// `decimals` matters here: FX crosses like KRW/CNY (~0.0046) round straight
// to zero at the usual 2-decimal price precision, so callers converting a
// currency ask for more.
async function yahooDailyClose(symbol, range, decimals = 2) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol} returned no data`);
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const tz = result.meta?.exchangeTimezoneName ?? 'Asia/Hong_Kong';
  const scale = 10 ** decimals;
  const out = {};
  timestamps.forEach((ts, i) => {
    const close = closes[i];
    if (!Number.isFinite(close)) return;
    const day = new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: tz });
    out[day] = Math.round(close * scale) / scale;
  });
  return out;
}

/* Nasdaq: csi300Us (CHAU) current net assets — see the file header ────── */

async function nasdaqCurrentAum(symbol) {
  const res = await fetch(`https://api.nasdaq.com/api/quote/${symbol}/summary?assetclass=etf`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Nasdaq ${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const raw = json?.data?.summaryData?.AUM?.value; // e.g. "98,600" — thousands of USD
  const thousands = Number(String(raw ?? '').replace(/,/g, ''));
  if (!Number.isFinite(thousands)) throw new Error(`Nasdaq ${symbol} AUM missing`);
  return thousands * 1000; // raw USD
}

// Most-recent FX rate on or before `day` — the same lookahead-free join
// koreaLeverage.js uses for its own HKEX/US legs, so a leg's trading holiday
// doesn't leave that day's conversion unconverted.
function fxOnOrBefore(table, day) {
  let rate = null;
  for (const d of Object.keys(table).sort()) {
    if (d > day) break;
    rate = table[d];
  }
  return rate;
}

/* ── History blob ──────────────────────────────────────────────────── */

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

/**
 * Scrape the last `days` calendar days of both exchanges plus the two HK 2×
 * products, merge into history, and return the assembled series.
 *
 * days defaults to a month: enough to repair a gap after the site was asleep,
 * small enough to stay a light daily poll. The backfill script passes ~1830.
 */
async function getChinaLeverage(days = 30) {
  const today = new Date();
  const from = iso(new Date(today.getTime() - days * 86400000));
  const to = iso(today);
  const history = loadHistory();

  const sse = await sseMargin(compact(from), compact(to));
  const tradingDays = Object.keys(sse).sort();

  // SZSE: one request per trading day, skipping days already stored — so the
  // daily poll costs a handful of requests and only a backfill pays in full.
  // Pace is configurable (env vars) because a deep backfill's ~1200 requests
  // at the daily poll's brisk 150ms pace previously tripped SZSE's bot
  // detection into blocking the source IP outright; a slower pace with
  // periodic longer rests keeps a backfill under the radar. Left at their
  // defaults, the daily poll's handful of requests behave exactly as before.
  const szseDelayMs = Number(process.env.CHINA_LEVERAGE_SZSE_DELAY_MS) || 150;
  const szseRestEvery = Number(process.env.CHINA_LEVERAGE_SZSE_REST_EVERY) || 0;
  const szseRestMs = Number(process.env.CHINA_LEVERAGE_SZSE_REST_MS) || 0;
  // Newest-first: a deep backfill's request budget is capped by SZSE's own
  // throttling well before it reaches every day, so prioritize the recent,
  // chart-relevant days over ancient ones — order doesn't matter for the
  // daily poll's handful of days either way.
  const needSzse = tradingDays.filter(d => !history[d]?.szse).reverse();
  if (needSzse.length > 5) console.log(`[chinaLeverage] SZSE: fetching ${needSzse.length} days…`);
  const szseFresh = {};
  let szseOk = 0;
  for (let i = 0; i < needSzse.length; i++) {
    const day = needSzse[i];
    try {
      const row = await szseMarginDay(day);
      if (row) { szseFresh[day] = row; szseOk++; }
    } catch (e) {
      console.warn(`[chinaLeverage] SZSE ${day}: ${e.message}`);
    }
    if (szseRestEvery && (i + 1) % szseRestEvery === 0) {
      console.log(`[chinaLeverage] SZSE: resting ${szseRestMs}ms after ${i + 1}/${needSzse.length}…`);
      await sleep(szseRestMs);
    } else {
      await sleep(szseDelayMs); // be a good citizen
    }
  }
  if (needSzse.length > 5) console.log(`[chinaLeverage] SZSE: got ${szseOk}/${needSzse.length}`);

  const etfRange = days > 1460 ? '10y' : days > 700 ? '5y' : days > 300 ? '2y' : '1y';
  const [hkexCsi300, hkexChinext, tigerHistory, chauCloses, hkdCny, krwCny, usdCny, chauAum] = await Promise.all([
    hkexProductHistory(HKEX_PRODUCTS.csi300.stockId, compact(from), compact(to)).catch(e => {
      console.warn(`[chinaLeverage] HKEXnews 7233: ${e.message}`); return {};
    }),
    hkexProductHistory(HKEX_PRODUCTS.chinext.stockId, compact(from), compact(to)).catch(e => {
      console.warn(`[chinaLeverage] HKEXnews 7234: ${e.message}`); return {};
    }),
    tigerCsi300History(from).catch(e => {
      console.warn(`[chinaLeverage] Daum ${TIGER_CSI300_CODE}: ${e.message}`); return {};
    }),
    yahooDailyClose('CHAU', etfRange).catch(e => {
      console.warn(`[chinaLeverage] Yahoo CHAU: ${e.message}`); return {};
    }),
    yahooDailyClose('HKDCNY=X', etfRange, 6).catch(e => {
      console.warn(`[chinaLeverage] Yahoo HKDCNY=X: ${e.message}`); return {};
    }),
    yahooDailyClose('KRWCNY=X', etfRange, 6).catch(e => {
      console.warn(`[chinaLeverage] Yahoo KRWCNY=X: ${e.message}`); return {};
    }),
    yahooDailyClose('CNY=X', etfRange, 6).catch(e => {
      console.warn(`[chinaLeverage] Yahoo CNY=X (USD/CNY): ${e.message}`); return {};
    }),
    nasdaqCurrentAum('CHAU').catch(e => {
      console.warn(`[chinaLeverage] Nasdaq CHAU: ${e.message}`); return null;
    }),
  ]);

  for (const day of tradingDays) {
    history[day] = { ...(history[day] ?? {}), sse: sse[day] };
  }

  // Derive SZSE's repayment amount from the roll-forward identity, walking
  // every known day (stored history + this run's fresh fetches) in true
  // chronological order so a small daily-poll window still finds yesterday's
  // balance in already-stored history rather than only within this run.
  const allDays = [...new Set([
    ...Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ...tradingDays,
  ])].sort();
  let lastBalance = null;
  for (const day of allDays) {
    const fresh = szseFresh[day];
    const existing = history[day]?.szse;
    if (!fresh) {
      if (Number.isFinite(existing?.balance)) lastBalance = existing.balance;
      continue;
    }
    if (Number.isFinite(lastBalance) && Number.isFinite(fresh.purchase) && Number.isFinite(fresh.balance)) {
      fresh.repay = round(lastBalance + fresh.purchase - fresh.balance);
    }
    if (Number.isFinite(fresh.balance)) lastBalance = fresh.balance;
    history[day] = { ...(history[day] ?? {}), szse: fresh };
  }

  // Every product's AUM is converted to CNY here, at write time, so assemble()
  // only ever deals in one currency.
  history.etf = history.etf ?? {};

  // csi300 (7233.HK) discloses its own AUM directly in RMB — no FX needed.
  history.etf.csi300 = { ...(history.etf.csi300 ?? {}) };
  for (const [day, row] of Object.entries(hkexCsi300)) {
    if (row.currency !== 'RMB' || !Number.isFinite(row.aum)) continue;
    history.etf.csi300[day] = { aum: round(row.aum) };
  }

  // chinext (7234.HK) discloses in HKD — converted via that day's FX close.
  history.etf.chinext = { ...(history.etf.chinext ?? {}) };
  for (const [day, row] of Object.entries(hkexChinext)) {
    if (row.currency !== 'HKD' || !Number.isFinite(row.aum)) continue;
    const rate = fxOnOrBefore(hkdCny, day);
    if (!Number.isFinite(rate)) continue;
    history.etf.chinext[day] = { aum: round(row.aum * rate) };
  }

  // csi300Krx (204480.KS): exact AUM in KRW, converted via FX.
  history.etf.csi300Krx = { ...(history.etf.csi300Krx ?? {}) };
  for (const [day, aumKrw] of Object.entries(tigerHistory)) {
    const rate = fxOnOrBefore(krwCny, day);
    if (!Number.isFinite(rate)) continue;
    history.etf.csi300Krx[day] = { aum: round(aumKrw * rate) };
  }

  // csi300Us (CHAU): implied shares outstanding (today's Nasdaq AUM ÷ today's
  // close) applied across the historical close-price series, then to CNY —
  // an approximation for days before this scraper ran; see the file header.
  history.etf.csi300Us = { ...(history.etf.csi300Us ?? {}) };
  if (Number.isFinite(chauAum)) {
    const chauDays = Object.keys(chauCloses).sort();
    const latestClose = chauCloses[chauDays.at(-1)];
    if (Number.isFinite(latestClose) && latestClose > 0) {
      const impliedShares = chauAum / latestClose;
      for (const day of chauDays) {
        const rate = fxOnOrBefore(usdCny, day);
        const price = chauCloses[day];
        if (!Number.isFinite(rate) || !Number.isFinite(price)) continue;
        history.etf.csi300Us[day] = { aum: round(impliedShares * price * rate), approx: true };
      }
    }
  }

  saveHistory(history);
  return assemble(history);
}

const METRIC_KEYS = ['balance', 'purchase', 'repay', 'lendVolume', 'lendBalance', 'totalBalance'];
// Display units, applied at the very end: balances are trillion-yuan scale,
// the daily purchase/repay/lending-balance flows are billion-yuan scale, and
// lending volume is a share count, not money.
const METRIC_SCALE = {
  balance: YUAN_T, purchase: YUAN_B, repay: YUAN_B,
  lendVolume: SHARES_M, lendBalance: YUAN_B, totalBalance: YUAN_T,
};
// The three metrics the page charts as stacked SSE/SZSE layers.
const STACK_KEYS = ['balance', 'lendBalance', 'totalBalance'];

/**
 * One exchange's own series, carried forward through its own gaps
 * independently of the other exchange — unlike the combined totals above
 * (which require both sides before counting a day at all), a stacked layer
 * should keep showing its own last-known height through a reporting gap
 * rather than vanishing just because the other exchange hasn't posted yet.
 */
function assembleExchange(history, dates, exchange) {
  const last = {};
  const out = Object.fromEntries(STACK_KEYS.map(k => [k, []]));
  for (const day of dates) {
    for (const key of STACK_KEYS) {
      const v = history[day]?.[exchange]?.[key];
      if (Number.isFinite(v)) last[key] = v;
      out[key].push(Number.isFinite(last[key]) ? round2(last[key] / METRIC_SCALE[key]) : null);
    }
  }
  return out;
}

/**
 * Fold the four products' own-currency-converted AUM into one CNY total and a
 * latest-snapshot fund table — the same shape koreaLeverage.js's `assemble`
 * builds for its ETF layer. Each product's AUM is rebuilt from its own last
 * known value rather than only counting days every product reported, so one
 * product's reporting lag doesn't invent a drop in the total; a product only
 * starts counting from the day it first appears.
 */
function assembleEtf(history) {
  const keys = ETF_PRODUCTS.map(p => p.key);
  const dates = [...new Set(keys.flatMap(key => Object.keys(history.etf?.[key] ?? {})))].sort();

  const lastAum = {};
  const lastApprox = {};
  const totalByDay = {};
  for (const day of dates) {
    for (const key of keys) {
      const row = history.etf?.[key]?.[day];
      if (Number.isFinite(row?.aum)) { lastAum[key] = row.aum; lastApprox[key] = !!row.approx; }
    }
    const known = keys.filter(key => Number.isFinite(lastAum[key]));
    if (known.length) totalByDay[day] = known.reduce((sum, key) => sum + lastAum[key], 0);
  }

  let last = null;
  let carried = null;
  const total = [];
  for (const day of dates) {
    const v = totalByDay[day];
    if (Number.isFinite(v)) { last = v; carried = null; }
    else if (Number.isFinite(last) && carried == null) carried = day;
    total.push(Number.isFinite(last) ? round2(last / YUAN_B) : null);
  }

  const fundsDate = [...dates].reverse().find(day => keys.some(key => history.etf?.[key]?.[day]));
  const funds = ETF_PRODUCTS
    .filter(p => Number.isFinite(lastAum[p.key]))
    .map(p => ({
      key: p.key,
      label: p.label,
      code: p.code,
      market: p.market,
      aum: round2(lastAum[p.key] / YUAN_B),
      approx: !!lastApprox[p.key],
    }))
    .sort((a, b) => b.aum - a.aum);

  return {
    dates,
    total, // billions of CNY
    carriedFrom: carried,
    funds,
    fundsDate: fundsDate ?? null,
  };
}

/**
 * Turn the history blob into the payload the page draws. Each metric carries
 * forward through a gap (one exchange posting late, a holiday mismatch)
 * rather than letting the combined total collapse to whichever side reported;
 * `carriedFrom` names the first carried day so the page can say so.
 */
function assemble(history) {
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const raw = Object.fromEntries(METRIC_KEYS.map(k => [k, []]));
  const last = {};
  const carried = Object.fromEntries(METRIC_KEYS.map(k => [k, null]));

  for (const day of dates) {
    for (const key of METRIC_KEYS) {
      const sseV = history[day]?.sse?.[key];
      const szseV = history[day]?.szse?.[key];
      const v = (Number.isFinite(sseV) && Number.isFinite(szseV)) ? sseV + szseV : null;
      if (Number.isFinite(v)) { last[key] = v; carried[key] = null; }
      else if (Number.isFinite(last[key]) && carried[key] == null) carried[key] = day;
      raw[key].push(Number.isFinite(last[key]) ? last[key] : null);
    }
  }

  const series = Object.fromEntries(METRIC_KEYS.map(key => [
    key,
    raw[key].map(v => (Number.isFinite(v) ? round2(v / METRIC_SCALE[key]) : null)),
  ]));

  const i = dates.length - 1;
  const latest = {
    date: dates[i] ?? null,
    ...Object.fromEntries(METRIC_KEYS.map(key => [key, series[key][i] ?? null])),
  };

  const etf = assembleEtf(history);
  const bySse = assembleExchange(history, dates, 'sse');
  const bySzse = assembleExchange(history, dates, 'szse');

  return {
    dates,
    ...series,
    bySse,
    bySzse,
    latest,
    carriedFrom: carried,
    etf,
    updatedAt: new Date().toISOString(),
  };
}

function readChinaLeverage() { return assemble(loadHistory()); }

module.exports = { getChinaLeverage, readChinaLeverage, _test: { assemble, assembleEtf } };
