/**
 * Rotation → Global → Breadth: for each Phase-1 index, the % of constituents
 * trading above BOTH their 50-day and 200-day SMA (vs. below both), and the
 * % up on the day. No free pre-computed source exists for this (MacroMicro
 * tracks it but gates the numbers behind a paid plan; StockCharts renders it
 * as an anonymous-view image, not data — both confirmed directly) so this
 * computes it from each index's own constituents.
 *
 * Storage design (deliberately NOT "keep every ticker's full history
 * forever"): each index gets its own small rolling raw-price cache — just
 * enough trailing trading days to compute a 200-day SMA — pruned back down
 * to that window every run. Only the tiny derived daily aggregate
 * (%-above/below/up) is kept forever, in one shared blob across all indices.
 *
 * Constituent sources (confirmed during planning):
 *   sp500/ndx/hsi/csi300 — yfiua/index-constituents GitHub Pages CSVs
 *     (free, monthly-updated, already Yahoo-format tickers).
 *   sox                  — Wikipedia's PHLX Semiconductor Sector page (a
 *                          plain <ul> list, "Company Name, ..., TICKER").
 *   nikkei225            — topforeignstocks.com's constituent table
 *                          (column-3 holds Yahoo-format "NNNN.T" tickers).
 *   chinext              — cnindex.com.cn sample-detail API for index 399006
 *                          (the 100 index members; seccode → "NNNNNN.SZ").
 *   taiex                — TWSE's own STOCK_DAY_ALL open API, filtered to
 *                          4-digit common-stock codes (the ~1,000 TWSE-listed
 *                          names; excludes ETFs/warrants/OTC → "NNNN.TW").
 *   kospi200             — Wikipedia's KOSPI 200 constituents table
 *                          (the 200 members; Symbol → "NNNNNN.KS").
 *   topix                — JPX's official listed-issues workbook, rows whose
 *                          "Size (New Index Series)" names a TOPIX tier (the
 *                          ~1,600 index members; Local Code → "NNNN.T").
 */
'use strict';

const cheerio = require('cheerio');
const XLSX = require('@e965/xlsx');
const path = require('path');
const storage = require('../storage');
const { isoDaysAgo } = require('./persistedSeries');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'], fetchOptions: { headers: { 'User-Agent': BROWSER_UA } } });
  }
  return _yf;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      const rateLimited = e.message?.includes('429') || /Too Many Requests|crumb/i.test(e.message ?? '');
      if (i === tries || !rateLimited) throw e;
      await sleep(1500 * i);
    }
  }
}

function isoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return out;
}

const round2 = v => Math.round(v * 100) / 100;

/* ── Constituent list fetchers ────────────────────────────────────────── */

async function fetchGithubCsvConstituents(slug) {
  const res = await fetch(`https://yfiua.github.io/index-constituents/constituents-${slug}.csv`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`index-constituents ${slug} HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/).slice(1); // skip "Symbol,Name" header
  const tickers = lines.map(line => line.split(',')[0]?.trim()).filter(Boolean);
  if (!tickers.length) throw new Error(`index-constituents ${slug}: no rows parsed`);
  return tickers;
}

async function fetchSoxConstituents() {
  const res = await fetch('https://en.wikipedia.org/wiki/PHLX_Semiconductor_Sector', {
    headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`SOX Wikipedia HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  // "The Index contains the following components as updated on <date>:" is
  // immediately followed by the <ul> of constituents, each item ending in
  // "..., TICKER" — the ticker is reliably the last comma-separated token.
  const marker = $('p').filter((_, p) => /components as updated/i.test($(p).text())).first();
  const list = marker.nextAll('ul').first();
  const tickers = [];
  list.find('> li').each((_, li) => {
    const parts = $(li).text().trim().split(',');
    const ticker = parts.at(-1)?.trim();
    if (ticker) tickers.push(ticker);
  });
  if (!tickers.length) throw new Error('SOX Wikipedia: no components parsed');
  return tickers;
}

async function fetchNikkei225Constituents() {
  const res = await fetch('https://topforeignstocks.com/indices/the-components-of-the-nikkei-225-index/', {
    headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Nikkei225 constituents HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const tickers = [];
  $('table.tablepress tbody tr').each((_, tr) => {
    const ticker = $(tr).find('td.column-3').text().trim();
    if (ticker) tickers.push(ticker);
  });
  if (!tickers.length) throw new Error('Nikkei225: no components parsed');
  return tickers;
}

// ── ChiNext (创业板指, 399006): cnindex publishes the 100 index members ──
// as JSON. `rows` (not `pageSize`) is the working page-size param; request 200
// to be safe and dedupe. Codes are Shenzhen-listed → ".SZ".
async function fetchChinextConstituents() {
  const res = await fetch(
    'https://www.cnindex.com.cn/sample-detail/detail?indexcode=399006&dateStr=&rows=200',
    { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) throw new Error(`ChiNext cnindex HTTP ${res.status}`);
  const body = await res.json();
  const rows = body?.data?.rows ?? [];
  const tickers = rows
    .map(r => String(r.seccode ?? '').replace(/\D/g, ''))
    .filter(code => /^\d{6}$/.test(code))
    .map(code => `${code}.SZ`);
  if (!tickers.length) throw new Error('ChiNext cnindex: no members parsed');
  return [...new Set(tickers)];
}

// ── TAIEX (^TWII): the Taiwan Weighted Index is every TWSE-listed common ──
// stock. TWSE's STOCK_DAY_ALL report lists every security traded in the latest
// session as CSV (date, code, name, …); 4-digit codes not starting with 0 are
// the common stocks (00xx = ETFs, 6-digit = warrants, OTC/TPEx names never
// appear here). All TWSE-listed → ".TW". (The openapi.twse.com.tw JSON mirror
// resets Node's TLS connection, so this uses the www CSV report instead.)
async function fetchTaiexConstituents() {
  const res = await fetch('https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json', {
    headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`TAIEX TWSE HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/).slice(1); // drop CSV header row
  const tickers = lines
    .map(line => (line.split(',')[1] ?? '').replace(/["=\s]/g, ''))
    .filter(code => /^[1-9]\d{3}$/.test(code))
    .map(code => `${code}.TW`);
  if (!tickers.length) throw new Error('TAIEX TWSE: no common stocks parsed');
  return [...new Set(tickers)];
}

// ── KOSPI 200 (^KS200): Wikipedia keeps the full 200-name constituents ──
// table. Pick whichever wikitable carries a Symbol/Code column and the most
// rows. Codes are 6-digit KRX numbers → ".KS".
async function fetchKospi200Constituents() {
  const res = await fetch('https://en.wikipedia.org/wiki/KOSPI_200', {
    headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`KOSPI 200 Wikipedia HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  let best = [];
  $('table.wikitable').each((_, table) => {
    const headers = $(table).find('tr').first().find('th, td')
      .map((_, cell) => $(cell).text().trim().toLowerCase()).get();
    const symbolIndex = headers.findIndex(h => /symbol|code|ticker/.test(h));
    if (symbolIndex === -1) return;
    const rows = [];
    $(table).find('tr').slice(1).each((_, tr) => {
      const code = $($(tr).find('td')[symbolIndex]).text().replace(/\D/g, '');
      if (/^\d{4,6}$/.test(code)) rows.push(`${code.padStart(6, '0')}.KS`);
    });
    if (rows.length > best.length) best = rows;
  });
  if (!best.length) throw new Error('KOSPI 200 Wikipedia: no constituents parsed');
  return [...new Set(best)];
}

// ── TOPIX (^TPX): every TSE Prime common stock in the "New Index Series". ──
// JPX's official listed-issues workbook tags each row's TOPIX tier in the
// "Size (New Index Series)" column (Core30/Large70/Mid400/Small 1/Small 2);
// any tier means TOPIX membership. Local Code is 4 digits → ".T".
async function fetchTopixConstituents() {
  const res = await fetch(
    'https://www.jpx.co.jp/english/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_e.xls',
    { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(45000) },
  );
  if (!res.ok) throw new Error(`TOPIX JPX HTTP ${res.status}`);
  const book = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: false });
  const header = (rows[0] ?? []).map(cell => String(cell));
  const codeIndex = header.findIndex(h => /Local Code/i.test(h));
  const sizeIndex = header.findIndex(h => /Size \(New Index Series\)/i.test(h));
  if (codeIndex === -1 || sizeIndex === -1) throw new Error('TOPIX JPX: unexpected workbook layout');
  const tickers = rows.slice(1)
    .filter(r => /TOPIX/i.test(String(r[sizeIndex] ?? '')) && /^\d{4}$/.test(String(r[codeIndex] ?? '').trim()))
    .map(r => `${String(r[codeIndex]).trim()}.T`);
  if (!tickers.length) throw new Error('TOPIX JPX: no constituents parsed');
  return [...new Set(tickers)];
}

const INDEX_CONFIGS = [
  { key: 'sp500',     label: 'S&P 500',    fetchConstituents: () => fetchGithubCsvConstituents('sp500') },
  { key: 'ndx',       label: 'Nasdaq 100', fetchConstituents: () => fetchGithubCsvConstituents('nasdaq100') },
  { key: 'hsi',       label: 'Hang Seng',  fetchConstituents: () => fetchGithubCsvConstituents('hsi') },
  { key: 'csi300',    label: 'CSI 300',    fetchConstituents: () => fetchGithubCsvConstituents('csi300') },
  { key: 'sox',       label: 'SOX',        fetchConstituents: fetchSoxConstituents },
  { key: 'nikkei225', label: 'Nikkei 225', fetchConstituents: fetchNikkei225Constituents },
  { key: 'chinext',   label: 'ChiNext',    fetchConstituents: fetchChinextConstituents },
  { key: 'taiex',     label: 'TAIEX',      fetchConstituents: fetchTaiexConstituents },
  { key: 'kospi200',  label: 'KOSPI 200',  fetchConstituents: fetchKospi200Constituents },
  { key: 'topix',     label: 'TOPIX',      fetchConstituents: fetchTopixConstituents },
];

// SOX/Nikkei225 have no direct turnover source (see globalIndices.js) — this
// index's turnover is derived here as a byproduct: sum(close × volume)
// across constituents, merged into globalIndicesHistory.
const TURNOVER_BYPRODUCT_KEYS = new Set(['sox', 'nikkei225']);

/* ── Rolling raw-price cache (per index, pruned every run) ───────────── */

const SMA_SHORT = 50;
const SMA_LONG = 200;
// The old cache pruned at 300 *calendar* days, leaving only ~196–205 market
// sessions. That produced zero to six valid SMA200 observations for several
// indices. Bootstrap two calendar years, then retain a fixed number of actual
// market observations so every refresh has enough input for the long average.
const BOOTSTRAP_WINDOW_DAYS = 730;
const ROLLING_WINDOW_OBSERVATIONS = SMA_LONG + 60;

const RAW_BLOB = {
  sp500: 'breadthRawSp500History',
  ndx: 'breadthRawNdxHistory',
  hsi: 'breadthRawHsiHistory',
  csi300: 'breadthRawCsi300History',
  sox: 'breadthRawSoxHistory',
  nikkei225: 'breadthRawNikkei225History',
  chinext: 'breadthRawChinextHistory',
  taiex: 'breadthRawTaiexHistory',
  kospi200: 'breadthRawKospi200History',
  topix: 'breadthRawTopixHistory',
};
function rawFile(key) { return path.join(__dirname, '..', 'data', `${RAW_BLOB[key]}.json`); }

// Shape: { [date]: { [ticker]: { close, volume } } } — date-keyed so pruning
// old dates is a plain object-key delete, no array-realignment bookkeeping.
function loadRaw(key) { return storage.read(RAW_BLOB[key], rawFile(key)); }
function saveRaw(key, history) { storage.write(RAW_BLOB[key], rawFile(key), history); }

function mergeRawPoints(history, ticker, points) {
  for (const p of points) {
    const row = history[p.date] ?? (history[p.date] = {});
    row[ticker] = { close: p.close, volume: p.volume };
  }
}

function pruneRaw(history, maxObservations = ROLLING_WINDOW_OBSERVATIONS) {
  const dates = Object.keys(history).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  for (const date of dates.slice(0, Math.max(0, dates.length - maxObservations))) delete history[date];
}

function needsBootstrap(history) {
  return Object.keys(history).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).length
    < ROLLING_WINDOW_OBSERVATIONS;
}

async function fetchConstituentOhlc(yf, ticker, start, end) {
  const chart = await withRetry(() => yf.chart(ticker, { period1: start, period2: end, interval: '1d' }));
  const quotes = (chart?.quotes ?? []).filter(q => q.date && q.close != null);
  return quotes.map(q => ({ date: isoDate(q.date), close: q.close, volume: q.volume ?? null }));
}

/* ── SMA / aggregate computation ──────────────────────────────────────── */

// Same "N valid values, gaps don't reset the window" semantics as the
// client-side rollingAverage() in UsPerformance.jsx.
function rollingAverage(values, windowSize) {
  const window = [];
  let sum = 0;
  return values.map(v => {
    if (v == null || !Number.isFinite(v)) return null;
    window.push(v);
    sum += v;
    if (window.length > windowSize) sum -= window.shift();
    return window.length === windowSize ? sum / windowSize : null;
  });
}

function computeAggregates(dates, closesByTicker) {
  const tickers = Object.keys(closesByTicker);
  const sma50ByTicker = {};
  const sma200ByTicker = {};
  for (const t of tickers) {
    sma50ByTicker[t] = rollingAverage(closesByTicker[t], SMA_SHORT);
    sma200ByTicker[t] = rollingAverage(closesByTicker[t], SMA_LONG);
  }

  const pctAboveBoth = [];
  const pctBelowBoth = [];
  const pctUp = [];
  for (let i = 0; i < dates.length; i += 1) {
    let above = 0, below = 0, maTotal = 0;
    let upCount = 0, upTotal = 0;
    for (const t of tickers) {
      const close = closesByTicker[t][i];
      const sma50 = sma50ByTicker[t][i];
      const sma200 = sma200ByTicker[t][i];
      if (close != null && sma50 != null && sma200 != null) {
        maTotal += 1;
        if (close > sma50 && close > sma200) above += 1;
        else if (close < sma50 && close < sma200) below += 1;
      }
      const prevClose = i > 0 ? closesByTicker[t][i - 1] : null;
      if (close != null && prevClose != null) {
        upTotal += 1;
        if (close > prevClose) upCount += 1;
      }
    }
    pctAboveBoth.push(maTotal ? round2((above / maTotal) * 100) : null);
    pctBelowBoth.push(maTotal ? round2((below / maTotal) * 100) : null);
    pctUp.push(upTotal ? round2((upCount / upTotal) * 100) : null);
  }
  return { dates, pctAboveBoth, pctBelowBoth, pctUp };
}

/* ── Small forever-growing aggregate blob (all indices share it) ───────── */

const BREADTH_BLOB = 'indexBreadthHistory';
const BREADTH_FILE = path.join(__dirname, '..', 'data', 'indexBreadthHistory.json');

function loadBreadthHistory() { return storage.read(BREADTH_BLOB, BREADTH_FILE); }
function saveBreadthHistory(h) { storage.write(BREADTH_BLOB, BREADTH_FILE, h); }

function mergeBreadthDaily(history, key, computed) {
  history[key] = history[key] ?? {};
  for (let i = 0; i < computed.dates.length; i += 1) {
    history[key][computed.dates[i]] = {
      pctAboveBoth: computed.pctAboveBoth[i],
      pctBelowBoth: computed.pctBelowBoth[i],
      pctUp: computed.pctUp[i],
    };
  }
}

function assembleBreadth(history, key) {
  const byDate = history[key] ?? {};
  const dates = Object.keys(byDate).sort();
  return {
    dates,
    pctAboveBoth: dates.map(d => byDate[d]?.pctAboveBoth ?? null),
    pctBelowBoth: dates.map(d => byDate[d]?.pctBelowBoth ?? null),
    pctUp: dates.map(d => byDate[d]?.pctUp ?? null),
  };
}

function assembleAllBreadth() {
  const history = loadBreadthHistory();
  const out = {};
  for (const config of INDEX_CONFIGS) out[config.key] = assembleBreadth(history, config.key);
  return out;
}

/* ── Top-level per-index update ───────────────────────────────────────── */

async function updateIndexBreadth(indexKey, { forceBootstrap = false } = {}) {
  const config = INDEX_CONFIGS.find(c => c.key === indexKey);
  if (!config) throw new Error(`Unknown breadth index: ${indexKey}`);

  const tickers = await config.fetchConstituents();
  const rawHistory = loadRaw(indexKey);
  const isBootstrap = forceBootstrap || needsBootstrap(rawHistory);
  // Steady-state updates only need to overlap the retained observations. A
  // calendar year safely covers 260 sessions across all supported markets.
  const windowDays = isBootstrap ? BOOTSTRAP_WINDOW_DAYS : 365;
  const end = new Date();
  const start = new Date(isoDaysAgo(windowDays));

  const yf = getYF();
  const results = await mapLimit(tickers, 6, async ticker => {
    try {
      const points = await fetchConstituentOhlc(yf, ticker, start, end);
      return { ticker, points, error: null };
    } catch (e) {
      return { ticker, points: [], error: e.message };
    }
  });
  for (const r of results) {
    if (r.points.length) mergeRawPoints(rawHistory, r.ticker, r.points);
    else console.warn(`[indexBreadth:${indexKey}] ${r.ticker}: ${r.error}`);
  }

  // Compute the aggregate from the FULL just-fetched window (all of it on a
  // bootstrap run) before pruning — pruning first would throw away the
  // bootstrap history before it's ever used to compute anything.
  const dates = Object.keys(rawHistory).sort();
  const closesByTicker = {};
  for (const t of tickers) closesByTicker[t] = dates.map(d => rawHistory[d]?.[t]?.close ?? null);
  const aggregated = computeAggregates(dates, closesByTicker);

  const breadthHistory = loadBreadthHistory();
  mergeBreadthDaily(breadthHistory, indexKey, aggregated);
  saveBreadthHistory(breadthHistory);

  if (TURNOVER_BYPRODUCT_KEYS.has(indexKey)) {
    const turnover = dates.map((d, i) => {
      let sum = 0;
      let any = false;
      for (const t of tickers) {
        const close = closesByTicker[t][i];
        const volume = rawHistory[d]?.[t]?.volume;
        if (close != null && volume != null) { sum += close * volume; any = true; }
      }
      return any ? sum : null;
    });
    const { mergeTurnover } = require('./globalIndices');
    mergeTurnover(indexKey, config.label, config.label, dates, turnover);
  }

  // Only now shrink the raw cache down to the steady-state rolling window —
  // this run's aggregate has already been computed and saved above.
  pruneRaw(rawHistory);
  saveRaw(indexKey, rawHistory);

  return assembleBreadth(breadthHistory, indexKey);
}

async function updateAllIndexBreadth() {
  for (const config of INDEX_CONFIGS) {
    try {
      await updateIndexBreadth(config.key);
    } catch (e) {
      console.warn(`[indexBreadth] ${config.key}: ${e.message}`);
    }
  }
  return assembleAllBreadth();
}

function readIndexBreadth() { return assembleAllBreadth(); }

module.exports = {
  updateIndexBreadth,
  updateAllIndexBreadth,
  readIndexBreadth,
  INDEX_CONFIGS,
  _test: {
    computeAggregates, rollingAverage, mergeRawPoints, pruneRaw,
    needsBootstrap,
    fetchGithubCsvConstituents, fetchSoxConstituents, fetchNikkei225Constituents,
    fetchChinextConstituents, fetchTaiexConstituents, fetchKospi200Constituents, fetchTopixConstituents,
    assembleBreadth, mergeBreadthDaily,
  },
};
