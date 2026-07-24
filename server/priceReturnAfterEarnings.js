'use strict';

const path = require('path');
const storage = require('./storage');
const apiNinjas = require('./apiNinjasEarnings');
const { DEFAULT_TICKERS } = require('./scripts/generateDailyOptionsReport');

// SOXX is the semiconductor index ETF, not a company — it has no earnings
// call to measure a reaction to (same reasoning as its pinned/excluded
// treatment elsewhere on the Alerts page; see Alerts.jsx).
const PRICE_RETURN_TICKERS = DEFAULT_TICKERS.filter(t => t !== 'SOXX');

// Trading-session offsets for the tab's three sub-views. "1 week" is 5
// trading sessions, not 7 calendar days.
const OFFSETS = { oneDay: 1, threeDay: 3, oneWeek: 5 };

const QUARTERS_SHOWN = 40; // ~10 years of quarterly calls

// NOTE: this blob must stay registered in server.js STORAGE_BLOBS, or init()
// won't preload it from Mongo and every restart starts the backfill over.
const BLOB = {
  name: 'priceReturnAfterEarnings',
  file: path.join(__dirname, 'data', 'priceReturnAfterEarnings.json'),
};

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
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Calendar quarter in which the earnings call happened — "2026-04-15" ->
// "2026 Q2". Bucketing by the report date rather than the fiscal-period-end
// date lines every ticker up by reporting season: a column then holds each
// company's call from the same three-month window regardless of its fiscal
// calendar, so ~25% of names (NVDA, AVGO, AMAT, ADI, CSCO, ...) whose fiscal
// quarters don't end in Mar/Jun/Sep/Dec still sit alongside everyone else that
// reported that season instead of being shifted a column.
function quarterLabel(reportedDate) {
  const m = /^(\d{4})-(\d{2})/.exec(reportedDate || '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return `${year} Q${Math.ceil(month / 3)}`;
}

// Sortable key so quarter labels compare chronologically regardless of string order.
function quarterSortKey(label) {
  const m = /^(\d{4}) Q(\d)$/.exec(label || '');
  return m ? Number(m[1]) * 4 + Number(m[2]) : -Infinity;
}

async function fetchPriceSeries(ticker, start, end) {
  const chart = await withRetry(() => getYF().chart(ticker, { period1: start, period2: end, interval: '1d' }));
  return (chart?.quotes ?? [])
    .filter(q => q.date && q.close != null)
    .map(q => ({ date: isoDate(q.date), close: q.close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Cumulative close-to-close return from the session right before the report
// to `offset` sessions after it. The report date itself counts as the first
// post-report session when it falls on a trading day (the common case for an
// after-market-close call); if it lands on a weekend/holiday, the next open
// session stands in. Historical earnings dates carry no bmo/amc flag (Alpha
// Vantage's EARNINGS endpoint doesn't report it), so this is a single
// uniform convention rather than one branch per report time.
function returnAfter(prices, reportDate, offset) {
  if (!prices.length) return null;
  const reportIndex = prices.findIndex(p => p.date >= reportDate);
  if (reportIndex <= 0) return null; // no prior session to baseline against, or report is newer than all known prices
  const baseIndex = reportIndex - 1;
  const targetIndex = baseIndex + offset;
  if (targetIndex >= prices.length) return null; // not enough trading history yet (recent report)
  const base = prices[baseIndex].close;
  const target = prices[targetIndex].close;
  if (!Number.isFinite(base) || !Number.isFinite(target) || base === 0) return null;
  return target / base - 1;
}

async function computeTicker(ticker) {
  const reportDates = await apiNinjas.getEarningsReportDates(ticker);
  const recent = reportDates.slice(0, QUARTERS_SHOWN);
  if (!recent.length) return null;

  const earliestReport = recent[recent.length - 1];
  const start = addDays(earliestReport, -10);
  const end = isoDate(new Date());
  const prices = await fetchPriceSeries(ticker, start, end);

  const quarters = {};
  for (const reportedDate of recent) {
    const label = quarterLabel(reportedDate);
    if (!label) continue;
    // A ticker that reported twice inside one calendar quarter (a timing shift
    // between years) would collide on the same label; keep the earlier of the
    // two so the column stays chronologically stable rather than flipping to a
    // mid-quarter re-report.
    if (quarters[label] && quarters[label].date <= reportedDate) continue;
    quarters[label] = {
      date: reportedDate,
      oneDay: returnAfter(prices, reportedDate, OFFSETS.oneDay),
      threeDay: returnAfter(prices, reportedDate, OFFSETS.threeDay),
      oneWeek: returnAfter(prices, reportedDate, OFFSETS.oneWeek),
    };
  }
  return quarters;
}

function readCache() {
  const blob = storage.read(BLOB.name, BLOB.file);
  if (!blob.tickers) blob.tickers = {};
  return blob;
}

function writeCache(state) {
  storage.write(BLOB.name, BLOB.file, state);
}

// Ticker-by-ticker rather than parallel: each ticker is one API Ninjas request
// plus one Yahoo Finance history pull, and running them sequentially keeps well
// clear of both providers' rate limits without needing a pacer. Writing after
// every ticker means a crash or a transient provider error partway through a
// run keeps whatever finished rather than losing the whole batch.
async function backfill(tickers = PRICE_RETURN_TICKERS) {
  const state = readCache();
  state.tickers ??= {};
  for (const ticker of tickers) {
    try {
      const quarters = await computeTicker(ticker);
      if (quarters && Object.keys(quarters).length) {
        state.tickers[ticker] = quarters;
        console.log(`[price-return] ${ticker}: ${Object.keys(quarters).length} quarters`);
      } else {
        console.warn(`[price-return] ${ticker}: no earnings history available yet`);
      }
    } catch (e) {
      console.warn(`[price-return] ${ticker} failed: ${e.message}`);
    }
    state.updatedAt = new Date().toISOString();
    writeCache(state);
  }
  return state;
}

// What the Alerts page's Price Return tab reads: a synchronous, no-network
// call so the request never blocks on API Ninjas or Yahoo Finance.
function getTable() {
  const state = readCache();
  const byTicker = state.tickers ?? {};

  const labelSet = new Set();
  for (const quarters of Object.values(byTicker)) {
    for (const label of Object.keys(quarters)) labelSet.add(label);
  }
  const quarters = [...labelSet]
    .sort((a, b) => quarterSortKey(b) - quarterSortKey(a))
    .slice(0, QUARTERS_SHOWN);
  const quarterSet = new Set(quarters);

  const rows = PRICE_RETURN_TICKERS
    .filter(ticker => byTicker[ticker])
    .map(ticker => ({
      ticker,
      cells: Object.fromEntries(
        Object.entries(byTicker[ticker]).filter(([label]) => quarterSet.has(label)),
      ),
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  return { quarters, rows, updatedAt: state.updatedAt ?? null };
}

module.exports = {
  BLOB,
  OFFSETS,
  PRICE_RETURN_TICKERS,
  QUARTERS_SHOWN,
  backfill,
  computeTicker,
  getTable,
  quarterLabel,
  returnAfter,
};
