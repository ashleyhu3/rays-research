/**
 * Rotation → Global tab: daily price history for all 10 indices (feeds the
 * Technical/RSI chart, client-side) plus turnover where a direct source
 * exists (feeds the Turnover chart directly; SOX/Nikkei225 get their
 * turnover from indexBreadth.js instead — see mergeTurnover below).
 *
 * Sourcing (confirmed directly during planning — see the plan doc):
 *   - Yahoo Finance covers S&P500 (^GSPC), Nasdaq100 (^NDX), SOX (^SOX),
 *     Hang Seng (^HSI), TAIEX (^TWII), KOSPI200 (^KS200), Nikkei225 (^N225)
 *     directly, and TOPIX via the 1306.T ETF proxy (^TPX itself returns 0
 *     quotes on Yahoo — no chart history at all).
 *   - CSI300 and ChiNext have no Yahoo chart history either (confirmed —
 *     same failure mode as ^VIXEQ, handled the same way as that ticker:
 *     sourced from East Money's generic kline API instead, which this
 *     codebase already uses in chinaLiquidity.js/hkChinaPerformance.js).
 *   - Turnover uses direct East Money `amount` where available, constituent
 *     close×volume for SOX/Nikkei225, and Yahoo volume×close as the resilient
 *     fallback for the remaining Yahoo-priced indices (including the TOPIX
 *     1306.T ETF proxy).
 */
'use strict';

const path = require('path');
const { createPersistedSeries, isoDaysAgo } = require('./persistedSeries');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      fetchOptions: { headers: { 'User-Agent': BROWSER_UA } },
    });
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

function yyyymmdd(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }

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

// Internal keys are stable identifiers independent of the underlying
// ticker/secid, so switching a source later (e.g. if TOPIX gets a real
// index feed) doesn't orphan persisted history keyed by the old symbol.
const TICKERS = [
  { ticker: 'sp500',     label: 'S&P 500',    name: 'S&P 500' },
  { ticker: 'ndx',       label: 'Nasdaq 100', name: 'Nasdaq 100' },
  { ticker: 'sox',       label: 'SOX',        name: 'PHLX Semiconductor' },
  { ticker: 'hsi',       label: 'Hang Seng',  name: 'Hang Seng Index' },
  { ticker: 'csi300',    label: 'CSI 300',    name: 'CSI 300' },
  { ticker: 'chinext',   label: 'ChiNext',    name: 'ChiNext Index' },
  { ticker: 'taiex',     label: 'TAIEX',      name: 'Taiwan Weighted Index' },
  { ticker: 'kospi200',  label: 'KOSPI 200',  name: 'KOSPI 200' },
  { ticker: 'nikkei225', label: 'Nikkei 225', name: 'Nikkei 225' },
  { ticker: 'topix',     label: 'TOPIX',      name: 'TOPIX' },
];

const YAHOO_SYMBOL = {
  sp500: '^GSPC', ndx: '^NDX', sox: '^SOX', hsi: '^HSI',
  taiex: '^TWII', kospi200: '^KS200', nikkei225: '^N225', topix: '1306.T',
};
// Yahoo now supplies volume for these index/proxy symbols. Zero-volume
// in-progress observations remain null so they cannot overwrite settled data.
const YAHOO_VOLUME_TURNOVER_KEYS = new Set(Object.keys(YAHOO_SYMBOL));

// CSI300/ChiNext have no Yahoo chart history at all, so this is both their
// price AND turnover source. Hang Seng/TAIEX price fine on Yahoo, but Yahoo's
// volume for them is 0 — so their turnover is fetched from East Money
// separately (below) and merged onto the Yahoo-sourced price series.
const EASTMONEY_SECID = { csi300: '1.000300', chinext: '0.399006' };
const EASTMONEY_TURNOVER_ONLY_SECID = { hsi: '100.HSI', taiex: '100.TWII' };
const EASTMONEY_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const SINA_SYMBOL = { csi300: 'sh000300', chinext: 'sz399006' };
const SINA_URL = 'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData';

const HISTORY = createPersistedSeries({
  blob: 'globalIndicesHistory',
  file: path.join(__dirname, '..', 'data', 'globalIndicesHistory.json'),
  tickers: TICKERS,
  fields: ['closes', 'adjCloses', 'turnover'],
});

function inclusiveEndDate(endDate) {
  const end = new Date(endDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function fetchYahooIndex(yf, key, start, end) {
  const chart = await withRetry(() => yf.chart(YAHOO_SYMBOL[key], { period1: start, period2: end, interval: '1d' }));
  const quotes = (chart?.quotes ?? []).filter(q => q.date && q.close != null);
  return quotes.map(q => ({
    date: isoDate(q.date),
    close: q.close,
    adjClose: q.adjclose ?? q.close,
    turnover: YAHOO_VOLUME_TURNOVER_KEYS.has(key) && q.volume > 0 ? q.volume * q.close : null,
  }));
}

async function fetchEastMoneyIndex(key, start, end, secidOverride = null) {
  const params = new URLSearchParams({
    secid: secidOverride ?? EASTMONEY_SECID[key], ut: '7eea3edcaed734bea9cbfc24409ed989',
    fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101', fqt: '0', beg: yyyymmdd(start), end: yyyymmdd(end),
  });
  const res = await fetch(`${EASTMONEY_URL}?${params}`, {
    headers: { 'user-agent': BROWSER_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`East Money ${key} HTTP ${res.status}`);
  const json = await res.json();
  const points = [];
  for (const line of json?.data?.klines ?? []) {
    // date,open,close,high,low,volume,amount,amplitude,pctChange,change,turnoverRate
    const [date, , close, , , , amount] = String(line).split(',');
    const closeNum = Number(close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(closeNum)) continue;
    points.push({ date, close: closeNum, adjClose: closeNum, turnover: Number(amount) || null });
  }
  return points;
}

function parseSinaKlines(text, start, end) {
  const match = String(text).match(/var\s+_data=\((\[[\s\S]*\])\)\s*;?/);
  if (!match) throw new Error('Sina kline response contained no data array');
  const startIso = isoDate(start);
  const endIso = isoDate(end);
  return JSON.parse(match[1]).map(row => {
    const close = Number(row.close);
    const volume = Number(row.volume);
    return {
      date: row.day,
      close,
      adjClose: close,
      // Sina exposes volume but not amount for this endpoint. Match the
      // volume×close proxy already used for the US index turnover series.
      turnover: Number.isFinite(volume) ? volume * close : null,
    };
  }).filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date)
    && Number.isFinite(point.close)
    && (!startIso || point.date >= startIso)
    && (!endIso || point.date <= endIso));
}

async function fetchSinaIndex(key, start, end) {
  const symbol = SINA_SYMBOL[key];
  if (!symbol) throw new Error(`No Sina fallback symbol for ${key}`);
  const params = new URLSearchParams({ symbol, scale: '240', ma: 'no', datalen: '1023' });
  const res = await fetch(`${SINA_URL}?${params}`, {
    headers: { 'user-agent': BROWSER_UA, Referer: 'https://finance.sina.com.cn/' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sina ${key} HTTP ${res.status}`);
  return parseSinaKlines(await res.text(), start, end);
}

async function fetchChinaIndex(key, start, end) {
  try {
    return await fetchEastMoneyIndex(key, start, end);
  } catch (error) {
    console.warn(`[globalIndices] East Money ${key}: ${error.message}; using Sina fallback`);
    return fetchSinaIndex(key, start, end);
  }
}

async function getGlobalIndices(startDate, endDate = new Date()) {
  const yf = getYF();
  const end = inclusiveEndDate(endDate);
  const start = new Date(startDate);

  const results = await mapLimit(TICKERS, 4, async meta => {
    try {
      const points = YAHOO_SYMBOL[meta.ticker]
        ? await fetchYahooIndex(yf, meta.ticker, start, end)
        : await fetchChinaIndex(meta.ticker, start, end);
      return { ...meta, points, error: null };
    } catch (e) {
      return { ...meta, points: [], error: e.message };
    }
  });

  // Separate turnover-only fetch for indices priced on Yahoo but whose Yahoo
  // volume is 0 (Hang Seng, TAIEX) — real turnover comes from East Money.
  const turnoverOnlyEntries = await mapLimit(Object.keys(EASTMONEY_TURNOVER_ONLY_SECID), 4, async ticker => {
    try {
      const points = await fetchEastMoneyIndex(ticker, start, end, EASTMONEY_TURNOVER_ONLY_SECID[ticker]);
      return [ticker, new Map(points.map(p => [p.date, p.turnover]))];
    } catch (e) {
      console.warn(`[globalIndices] East Money turnover for ${ticker}: ${e.message}`);
      return [ticker, new Map()];
    }
  });
  const turnoverOnlyByTicker = new Map(turnoverOnlyEntries);

  const dateSet = new Set();
  for (const r of results) for (const p of r.points) dateSet.add(p.date);
  for (const byDate of turnoverOnlyByTicker.values()) for (const d of byDate.keys()) dateSet.add(d);
  const dates = [...dateSet].sort();

  const series = results.map(r => {
    const byClose = new Map(r.points.map(p => [p.date, p.close]));
    const byAdj = new Map(r.points.map(p => [p.date, p.adjClose]));
    const directTurnover = turnoverOnlyByTicker.get(r.ticker);
    const byTurnover = directTurnover?.size
      ? directTurnover
      : new Map(r.points.map(p => [p.date, p.turnover]));
    return {
      ticker: r.ticker,
      label: r.label,
      name: r.name,
      closes: dates.map(d => byClose.get(d) ?? null),
      adjCloses: dates.map(d => byAdj.get(d) ?? null),
      turnover: dates.map(d => byTurnover.get(d) ?? null),
      error: r.error,
    };
  });

  return { start: dates[0] ?? isoDate(start), end: dates[dates.length - 1] ?? isoDate(endDate), dates, series };
}

async function updateGlobalIndices(days = 45) {
  const end = new Date().toISOString().slice(0, 10);
  HISTORY.merge(await getGlobalIndices(isoDaysAgo(days), end));
  return HISTORY.assemble();
}

function readGlobalIndices(startDate, endDate) {
  return HISTORY.assemble(startDate, endDate);
}

// indexBreadth.js computes SOX/Nikkei225 turnover as a byproduct of its own
// constituent fetch (sum(close×volume)) and merges it in here, so all 10
// indices' turnover ends up in one place regardless of source.
function mergeTurnover(ticker, label, name, dates, turnoverValues) {
  HISTORY.merge({
    dates,
    series: [{ ticker, label, name, turnover: turnoverValues }],
  });
}

module.exports = {
  getGlobalIndices,
  updateGlobalIndices,
  readGlobalIndices,
  mergeTurnover,
  TICKERS,
  _test: { parseSinaKlines },
};
