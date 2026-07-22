'use strict';

const path = require('path');
const storage = require('../storage');
const { isoDaysAgo } = require('./persistedSeries');

const SPOT_UT = 'bd1d9ddb04089700cf9c27f6f7426281';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PREMIUM_ETFS = [
  { ticker: '513310', name: '中韩半导体 ETF', color: '#3c8cdd' },
  { ticker: '513100', name: 'NASDAQ-100 ETF', color: '#da5a2f' },
];

const BLOB = 'chinaEtfPremiumHistory';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'chinaEtfPremiumHistory.json');

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(history) { storage.write(BLOB, HISTORY_FILE, history); }

let yahooFinance;
function getYahooFinance() {
  if (!yahooFinance) {
    const YahooFinance = require('yahoo-finance2').default;
    yahooFinance = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      fetchOptions: { headers: { 'User-Agent': BROWSER_UA } },
    });
  }
  return yahooFinance;
}

function finiteNumber(value) {
  if (value == null || value === '' || value === '-') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function premiumPct(marketPrice, nav) {
  if (!Number.isFinite(marketPrice) || !Number.isFinite(nav) || nav <= 0) return null;
  return ((marketPrice / nav) - 1) * 100;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { 'User-Agent': BROWSER_UA, ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`East Money returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function fetchText(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { 'User-Agent': BROWSER_UA, ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Tiantian Fund returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function fetchMarketCloses(ticker, start, end) {
  const inclusiveEnd = new Date(`${end}T00:00:00Z`);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() + 1);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const chart = await getYahooFinance().chart(`${ticker}.SS`, {
        period1: new Date(`${start}T00:00:00Z`),
        period2: inclusiveEnd,
        interval: '1d',
      });
      const quotes = chart?.quotes ?? [];
      const points = quotes
        .map(quote => ({
          date: quote.date ? new Date(quote.date).toISOString().slice(0, 10) : null,
          marketPrice: finiteNumber(quote.close),
        }))
        .filter(point => point.date && point.marketPrice != null);
      const missingDates = new Set(quotes
        .filter(quote => quote.date && finiteNumber(quote.close) == null)
        .map(quote => new Date(quote.date).toISOString().slice(0, 10)));

      // Yahoo occasionally emits a dated all-null placeholder for a real SSE
      // session (513310 on 2025-10-24 is one example). Fill only those explicit
      // holes from East Money instead of converting null to a zero-price tick.
      if (missingDates.size) {
        try {
          const fallback = await fetchEastmoneyMarketCloses(ticker, start, end);
          const byDate = new Map(points.map(point => [point.date, point]));
          for (const point of fallback) if (missingDates.has(point.date)) byDate.set(point.date, point);
          return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        } catch { /* retain the valid Yahoo points; never synthesize zero */ }
      }
      return points;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function fetchEastmoneyMarketCloses(ticker, start, end) {
  const params = new URLSearchParams({
    secid: `1.${ticker}`,
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101',
    fqt: '0',
    beg: start.replace(/-/g, ''),
    end: end.replace(/-/g, ''),
  });
  const json = await fetchJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`);
  return (json?.data?.klines ?? []).map(line => {
    const [date, , close] = line.split(',');
    return { date, marketPrice: finiteNumber(close) };
  }).filter(point => point.marketPrice != null);
}

async function fetchOfficialNav(ticker, start, end) {
  // The paginated f10 endpoint caps responses at 20 records. Tiantian's own
  // chart feed carries the same official unit-NAV history in one response.
  const body = await fetchText(`https://fund.eastmoney.com/pingzhongdata/${ticker}.js`, {
    headers: { Referer: `https://fund.eastmoney.com/${ticker}.html` },
  });
  const match = body.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error(`Could not parse NAV history for ${ticker}`);
  const rows = JSON.parse(match[1]);
  return rows
    // The feed timestamps Shanghai midnight as an epoch. Shift to Shanghai
    // before taking the calendar date; a raw UTC conversion lands one day early.
    .map(row => ({
      date: new Date(Number(row.x) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
      nav: finiteNumber(row.y),
    }))
    .filter(point => point.nav != null && point.date >= start && point.date <= end);
}

// East Money publishes live market price (f2), IOPV (f441), and its
// discount rate (f402) in one ETF snapshot. There is no public historical
// IOPV archive, so this live point complements official end-of-day NAV history.
async function fetchLiveSnapshots() {
  const params = new URLSearchParams({
    ut: SPOT_UT,
    fltt: '2',
    invt: '2',
    secids: PREMIUM_ETFS.map(etf => `1.${etf.ticker}`).join(','),
    fields: 'f2,f12,f14,f402,f441,f297,f124',
  });
  const json = await fetchJson(`https://push2.eastmoney.com/api/qt/ulist.np/get?${params}`);
  const wanted = new Set(PREMIUM_ETFS.map(etf => etf.ticker));
  return new Map((json?.data?.diff ?? [])
    .filter(row => wanted.has(row.f12))
    .map(row => {
      const marketPrice = finiteNumber(row.f2);
      const nav = finiteNumber(row.f441);
      const dateRaw = String(row.f297 ?? '');
      const date = /^\d{8}$/.test(dateRaw)
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : null;
      return [row.f12, {
        date,
        marketPrice,
        nav,
        premium: premiumPct(marketPrice, nav),
        quotedAt: Number.isFinite(Number(row.f124)) && Number(row.f124) > 0
          ? new Date(Number(row.f124) * 1000).toISOString()
          : null,
      }];
    }));
}

function mergePremiumHistory(closes, navs, live) {
  const navByDate = new Map(navs.map(point => [point.date, point.nav]));
  const points = closes.map(point => {
    const nav = navByDate.get(point.date);
    return {
      date: point.date,
      marketPrice: point.marketPrice,
      nav: nav ?? null,
      premium: premiumPct(point.marketPrice, nav),
      navSource: 'Official NAV',
    };
  }).filter(point => point.premium != null);

  if (live?.date && live.marketPrice != null && live.nav != null && live.premium != null) {
    const livePoint = { ...live, navSource: 'IOPV' };
    const existingIndex = points.findIndex(point => point.date === live.date);
    if (existingIndex >= 0) points[existingIndex] = livePoint;
    else points.push(livePoint);
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

async function getChinaEtfPremium(startDate, endDate = new Date().toISOString().slice(0, 10)) {
  let liveSnapshots = new Map();
  try { liveSnapshots = await fetchLiveSnapshots(); } catch { /* historical series still works */ }

  const series = [];
  for (const meta of PREMIUM_ETFS) {
    const [closes, navs] = await Promise.all([
      fetchMarketCloses(meta.ticker, startDate, endDate),
      fetchOfficialNav(meta.ticker, startDate, endDate),
    ]);
    const points = mergePremiumHistory(closes, navs, liveSnapshots.get(meta.ticker));
    series.push({ ...meta, points, latest: points[points.length - 1] ?? null });
  }

  return { start: startDate, end: endDate, series };
}

function mergePremiumPayload(payload) {
  const history = loadHistory();
  // Remove artifacts written by older versions that coerced missing quotes to
  // zero. A listed ETF cannot have a valid zero market price.
  for (const [date, row] of Object.entries(history)) {
    for (const [ticker, point] of Object.entries(row ?? {})) {
      if (!Number.isFinite(point?.marketPrice) || point.marketPrice <= 0) delete history[date][ticker];
    }
    if (Object.keys(history[date] ?? {}).length === 0) delete history[date];
  }
  for (const series of payload.series ?? []) {
    for (const point of series.points ?? []) {
      if (!point.date || point.premium == null) continue;
      history[point.date] = {
        ...(history[point.date] ?? {}),
        [series.ticker]: {
          marketPrice: point.marketPrice,
          nav: point.nav,
          premium: point.premium,
          navSource: point.navSource,
          quotedAt: point.quotedAt ?? null,
        },
      };
    }
  }
  saveHistory(history);
  return history;
}

function readChinaEtfPremium(startDate = null, endDate = null) {
  const history = loadHistory();
  const dates = Object.keys(history)
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .filter(date => (!startDate || date >= startDate) && (!endDate || date <= endDate))
    .sort();
  const series = PREMIUM_ETFS.map(meta => {
    const points = dates
      .filter(date => history[date]?.[meta.ticker])
      .map(date => ({ date, ...history[date][meta.ticker] }));
    return { ...meta, points, latest: points[points.length - 1] ?? null };
  });
  return { start: dates[0] ?? startDate, end: dates[dates.length - 1] ?? endDate, series };
}

async function updateChinaEtfPremium(days = 45) {
  const end = new Date().toISOString().slice(0, 10);
  mergePremiumPayload(await getChinaEtfPremium(isoDaysAgo(days), end));
  return readChinaEtfPremium();
}

module.exports = {
  PREMIUM_ETFS,
  getChinaEtfPremium,
  updateChinaEtfPremium,
  readChinaEtfPremium,
  mergePremiumPayload,
  mergePremiumHistory,
  premiumPct,
  finiteNumber,
};
