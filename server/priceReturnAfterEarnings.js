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

// The fiscal quarter a report covers — i.e. the most recently completed
// calendar quarter as of the report date, which is the report's calendar
// quarter shifted back one. A Jul–Sep report covers Q2 (a company reporting on
// 2026-07-23 is reporting its Q2 2026 results); a Jan–Mar report covers the
// prior year's Q4. Every ticker shifts back by the same one quarter, so this
// only relabels the columns — it doesn't change which tickers share a column.
function quarterLabel(reportedDate) {
  const m = /^(\d{4})-(\d{2})/.exec(reportedDate || '');
  if (!m) return null;
  let year = Number(m[1]);
  let quarter = Math.ceil(Number(m[2]) / 3) - 1;
  if (quarter === 0) { quarter = 4; year -= 1; }
  return `${year} Q${quarter}`;
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

// A report reacts on a different session depending on timing: a before-open
// ("bmo") report moves the stock that same day, an after-close ("amc") report
// moves it the next session. Historical dates carry no bmo/amc flag, so timing
// is inferred from the prices — the earnings reaction is almost always the
// single largest move around the announcement. Returns the report's index in
// the price series plus the size of the report-day and next-day moves; the
// larger of the two is the reaction. `strong` marks quarters where one move
// clearly dominates (so its timing is trustworthy on its own); ambiguous
// quarters — both sessions moved a lot — defer to the ticker's usual timing.
const AMBIGUOUS_RATIO = 1.6;

function reactionAt(prices, reportDate) {
  const ri = prices.findIndex(p => p.date >= reportDate);
  if (ri <= 0) return null; // no prior session to baseline against, or newer than all known prices
  if (ri + 1 >= prices.length) return { ri, timing: 'bmo', strong: false }; // no next session yet ⇒ assume report-day
  const bmoMove = Math.abs(prices[ri].close / prices[ri - 1].close - 1);
  const amcMove = Math.abs(prices[ri + 1].close / prices[ri].close - 1);
  const hi = Math.max(bmoMove, amcMove);
  const lo = Math.min(bmoMove, amcMove) || 1e-9;
  return { ri, timing: amcMove > bmoMove ? 'amc' : 'bmo', strong: hi / lo >= AMBIGUOUS_RATIO };
}

// Cumulative close-to-close return from the last pre-reaction close to `offset`
// sessions later. `timing` fixes which session is the baseline: bmo baselines
// on the close before the report day, amc on the report day's own close.
function returnFrom(prices, ri, timing, offset) {
  const baseIndex = timing === 'amc' ? ri : ri - 1;
  const targetIndex = baseIndex + offset;
  if (baseIndex < 0 || targetIndex >= prices.length) return null;
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

  // First pass: locate each report and read its timing off the prices.
  const events = {};
  for (const reportedDate of recent) {
    const label = quarterLabel(reportedDate);
    if (!label) continue;
    // Two dates mapping to the same fiscal quarter (e.g. an ADR whose earnings
    // call and later SEC filing both appear) collide on one label; keep the
    // earliest, which is the actual earnings call the market reacted to rather
    // than a weeks-later filing. Dates arrive newest-first, so overwrite only
    // when this one is earlier.
    if (events[label] && events[label].date <= reportedDate) continue;
    const reaction = reactionAt(prices, reportedDate);
    if (reaction) events[label] = { date: reportedDate, ...reaction };
  }

  // A company's report timing is consistent quarter to quarter (US large-caps
  // report after close, foreign ADRs like TSM/ASML before the US open), so the
  // quarters where one session clearly dominated vote on the ticker's timing,
  // and that verdict is applied uniformly to every quarter — including the
  // ambiguous ones and any lone quarter whose own move happened to point the
  // other way from a coincidental non-earnings swing. Only a ticker with no
  // decisive quarter at all falls back to per-quarter inference. Ties default
  // to amc, the majority timing across the watchlist.
  let amcVotes = 0;
  let bmoVotes = 0;
  for (const e of Object.values(events)) {
    if (!e.strong) continue;
    if (e.timing === 'amc') amcVotes++; else bmoVotes++;
  }
  const hasVerdict = amcVotes + bmoVotes > 0;
  const tickerTiming = amcVotes >= bmoVotes ? 'amc' : 'bmo';

  const quarters = {};
  for (const [label, e] of Object.entries(events)) {
    const timing = hasVerdict ? tickerTiming : e.timing;
    quarters[label] = {
      date: e.date,
      oneDay: returnFrom(prices, e.ri, timing, OFFSETS.oneDay),
      threeDay: returnFrom(prices, e.ri, timing, OFFSETS.threeDay),
      oneWeek: returnFrom(prices, e.ri, timing, OFFSETS.oneWeek),
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
  reactionAt,
  returnFrom,
};
