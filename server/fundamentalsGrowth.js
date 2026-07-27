'use strict';

const path = require('path');
const storage = require('./storage');
const { SOXX_CONSTITUENTS, computeIndexCandles, QUARTERS_SHOWN } = require('./priceReturnAfterEarnings');

// Same roster as the Price Return page's "SOXX Index" view — the tracked
// tickers that are also iShares SOXX holdings. Kept as a re-export rather than
// a second literal list so the two pages can never drift apart.
const FUNDAMENTALS_TICKERS = SOXX_CONSTITUENTS;

// The four sidebar views. Each is a growth rate derived from the same two
// quarterly income-statement lines, so one fetch per ticker fills all four.
const METRICS = ['revenueYoY', 'revenueQoQ', 'netIncomeYoY', 'netIncomeQoQ'];

// Source: Alpha Vantage INCOME_STATEMENT. Yahoo Finance publishes the same two
// lines (spot-checked identical to the dollar for NVDA/TSM/ASML), but its free
// fundamentals-timeseries endpoint only serves the trailing FIVE quarters —
// enough for a single YoY point, nowhere near the ~10-year grid this page
// mirrors from Price Return. Alpha Vantage returns ~81 quarters per ticker and
// covers the foreign ADRs (TSM, ASML, ASX, UMC) that SEC XBRL does not file
// quarterly. Its cost is a hard 25-request/day cap on the free tier, which is
// why backfill is a resumable per-ticker loop rather than one bulk pull.
const AV_URL = 'https://www.alphavantage.co/query';
const DAILY_REQUEST_BUDGET = 24; // one spare below Alpha Vantage's 25/day cap

function avApiKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY || '';
}

// NOTE: this blob must stay registered in server/storageBlobs.js, or init()
// won't preload it from Mongo and every restart starts the backfill over.
const BLOB = {
  name: 'fundamentalsGrowth',
  file: path.join(__dirname, 'data', 'fundamentalsGrowth.json'),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The calendar quarter a fiscal period actually covers, taken from its
// midpoint rather than its end date. A quarter ending 2026-01-31 spans
// Nov–Jan, so it belongs above the 2025 Q4 column, not 2026 Q1; stepping back
// ~45 days from the period end lands mid-period and picks the right one. This
// is what lets off-cycle reporters (NVDA, AMAT, MU, ADI) line up with the
// calendar-quarter SOXX candles and with each other.
function fiscalQuarterLabel(periodEnd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd || '');
  if (!m) return null;
  const mid = new Date(`${periodEnd}T00:00:00Z`);
  mid.setUTCDate(mid.getUTCDate() - 45);
  return `${mid.getUTCFullYear()} Q${Math.ceil((mid.getUTCMonth() + 1) / 3)}`;
}

// Sortable key so quarter labels compare chronologically regardless of string order.
function quarterSortKey(label) {
  const m = /^(\d{4}) Q(\d)$/.exec(label || '');
  return m ? Number(m[1]) * 4 + Number(m[2]) : -Infinity;
}

function toNumber(value) {
  if (value == null || value === 'None' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Percent change with a sign-aware guard. A growth rate off a negative or zero
// base is not interpretable — "net income went from -$1bn to -$0.5bn" is a
// +50% move by the arithmetic and a 50% improvement in reality, and the two
// disagree the moment the base flips sign. Loss-making bases return null and
// render as an empty cell instead of a number that reads backwards.
function growth(current, prior) {
  if (current == null || prior == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (prior <= 0) return null;
  return current / prior - 1;
}

async function fetchIncomeStatement(ticker) {
  const key = avApiKey();
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY is not set');

  const url = new URL(AV_URL);
  url.searchParams.set('function', 'INCOME_STATEMENT');
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('apikey', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const body = await res.json();

  // A throttled call answers 200 with an {Information: …} notice and no
  // reports array. Surfacing it as its own error lets the batch runner stop
  // early and keep the remaining tickers pending for tomorrow, rather than
  // burning through the roster recording "no data" for every one of them.
  if (!Array.isArray(body?.quarterlyReports)) {
    const note = body?.Information ?? body?.Note ?? body?.['Error Message'] ?? '';
    if (/rate limit|higher API call|premium/i.test(note)) throw new Error('RATE_LIMIT');
    throw new Error(note || 'Alpha Vantage returned no quarterly reports');
  }

  return body.quarterlyReports
    .map(r => ({
      periodEnd: r.fiscalDateEnding,
      revenue: toNumber(r.totalRevenue),
      netIncome: toNumber(r.netIncome),
    }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.periodEnd ?? ''))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)); // oldest first
}

// Growth is computed off the ticker's OWN period sequence (index -1 for QoQ,
// -4 for YoY), not off the calendar labels, so a company that skipped a filing
// or shifted its fiscal year never silently compares two non-adjacent
// quarters. Labels are applied only afterwards, to place the result in a column.
function computeGrowth(reports) {
  const quarters = {};
  for (let i = 0; i < reports.length; i++) {
    const cur = reports[i];
    const label = fiscalQuarterLabel(cur.periodEnd);
    if (!label) continue;
    const prevQ = reports[i - 1];
    const prevY = reports[i - 4];
    // A gap in the sequence means index -4 isn't a year back. Verify against
    // the dates (a year ± 45 days) before trusting it as the YoY base.
    const yearBack = prevY && Math.abs(
      (Date.parse(cur.periodEnd) - Date.parse(prevY.periodEnd)) / 86_400_000 - 365,
    ) <= 45 ? prevY : null;

    quarters[label] = {
      periodEnd: cur.periodEnd,
      revenue: cur.revenue,
      netIncome: cur.netIncome,
      revenueQoQ: prevQ ? growth(cur.revenue, prevQ.revenue) : null,
      revenueYoY: yearBack ? growth(cur.revenue, yearBack.revenue) : null,
      netIncomeQoQ: prevQ ? growth(cur.netIncome, prevQ.netIncome) : null,
      netIncomeYoY: yearBack ? growth(cur.netIncome, yearBack.netIncome) : null,
    };
  }
  return quarters;
}

async function computeTicker(ticker) {
  const reports = await fetchIncomeStatement(ticker);
  if (!reports.length) return null;
  return computeGrowth(reports);
}

function readCache() {
  const blob = storage.read(BLOB.name, BLOB.file);
  if (!blob.tickers) blob.tickers = {};
  return blob;
}

function writeCache(state) {
  storage.write(BLOB.name, BLOB.file, state);
}

// Ticker-by-ticker, writing after each one, for the same reason Price Return
// does it: a run cut short by a provider error or the daily cap keeps whatever
// finished instead of losing the batch. Stops as soon as Alpha Vantage reports
// the cap so the untouched tickers stay for the next run.
async function backfill(tickers = FUNDAMENTALS_TICKERS, { pause = 900 } = {}) {
  const state = readCache();
  state.tickers ??= {};

  // The SOXX candles come from Yahoo, cost one request, and are shared by every
  // metric view — computed first so the loop's incremental writes can't land
  // after a final candle write and clobber it. On failure keep what's cached.
  try {
    state.soxx = await computeIndexCandles();
    console.log(`[fundamentals] SOXX: ${Object.keys(state.soxx).length} quarterly candles`);
  } catch (e) {
    console.warn(`[fundamentals] SOXX candles failed: ${e.message}`);
  }

  for (const ticker of tickers) {
    try {
      const quarters = await computeTicker(ticker);
      if (quarters && Object.keys(quarters).length) {
        state.tickers[ticker] = quarters;
        console.log(`[fundamentals] ${ticker}: ${Object.keys(quarters).length} quarters`);
      } else {
        console.warn(`[fundamentals] ${ticker}: no quarterly income statement available`);
      }
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        console.warn(`[fundamentals] Alpha Vantage daily cap reached at ${ticker} — stopping, ${tickers.length - tickers.indexOf(ticker)} ticker(s) left for the next run`);
        break;
      }
      console.warn(`[fundamentals] ${ticker} failed: ${e.message}`);
    }
    state.updatedAt = new Date().toISOString();
    writeCache(state);
    if (pause) await sleep(pause); // Alpha Vantage also asks for ≤1 request/sec
  }

  return state;
}

// Scheduled entry point. The roster is small enough to fit inside one day's
// request budget, but the run is still ordered stalest-first so that if the
// budget is ever shared with another Alpha Vantage job, the tickers that got
// skipped are the ones that go first next time.
async function runDailyBatch() {
  const state = readCache();
  const staleness = ticker => state.tickers?.[ticker]?.__fetchedAt ?? '';
  const ordered = [...FUNDAMENTALS_TICKERS].sort((a, b) => staleness(a).localeCompare(staleness(b)));
  return backfill(ordered.slice(0, DAILY_REQUEST_BUDGET));
}

// What the Fundamentals page reads: a synchronous, no-network cache read so the
// request never blocks on Alpha Vantage or Yahoo Finance.
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

  const rows = FUNDAMENTALS_TICKERS
    .filter(ticker => byTicker[ticker])
    .map(ticker => ({
      ticker,
      cells: Object.fromEntries(
        Object.entries(byTicker[ticker]).filter(([label]) => quarterSet.has(label)),
      ),
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const soxx = Object.fromEntries(
    quarters.filter(label => state.soxx?.[label]).map(label => [label, state.soxx[label]]),
  );

  return {
    quarters,
    rows,
    soxx,
    metrics: METRICS,
    updatedAt: state.updatedAt ?? null,
  };
}

module.exports = {
  BLOB,
  FUNDAMENTALS_TICKERS,
  METRICS,
  QUARTERS_SHOWN,
  backfill,
  computeGrowth,
  computeTicker,
  fiscalQuarterLabel,
  getTable,
  growth,
  runDailyBatch,
};
