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

// Primary source: the SEC Company Facts API. It is free, needs no API key, and
// gives the long quarterly history this page needs. Yahoo's public fundamentals
// endpoint only exposes the trailing five quarters, while Alpha Vantage's free
// key is shared with other jobs and has a hard 25-request/day cap. The four
// foreign private issuers without quarterly SEC facts therefore retain Alpha
// Vantage as a fallback; the other 20 constituents no longer depend on that
// scarce quota.
const SEC_COMPANY_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts';
const SEC_CIK = {
  AMD: '0000002488',
  NVDA: '0001045810',
  MU: '0000723125',
  AVGO: '0001730168',
  INTC: '0000050863',
  AMAT: '0000006951',
  KLAC: '0000319201',
  LRCX: '0000707549',
  TXN: '0000097476',
  MRVL: '0001835632',
  ADI: '0000006281',
  NXPI: '0001413447',
  MPWR: '0001280452',
  QCOM: '0000804328',
  TER: '0000097210',
  MCHP: '0000827054',
  ALAB: '0001736297',
  ON: '0001097864',
  CRDO: '0001807794',
  MTSI: '0001493594',
};
const SEC_REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'Revenues',
];
const SEC_NET_INCOME_CONCEPTS = [
  'NetIncomeLoss',
  'ProfitLoss',
  'NetIncomeLossAvailableToCommonStockholdersBasic',
];
const AV_URL = 'https://www.alphavantage.co/query';
const FMP_INCOME_STATEMENT_URL = 'https://financialmodelingprep.com/stable/income-statement';
const DAILY_REQUEST_BUDGET = 24; // one spare below Alpha Vantage's 25/day cap

function avApiKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY || '';
}

function fmpApiKey() {
  return process.env.FMP_API_KEY || '';
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

function daysBetween(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 86_400_000 + 1 : null;
}

function latestByPeriod(entries) {
  const byPeriod = new Map();
  for (const entry of entries) {
    // Keep the same duration when it appears in both a 10-Q and a later 10-K.
    // The 10-K comparative copy otherwise wins on filing date, then gets
    // discarded by the direct-quarter filter and leaves a false gap.
    const key = `${entry.start}:${entry.end}:${entry.form}`;
    const current = byPeriod.get(key);
    // Later filings contain restatements of prior comparative periods. Prefer
    // those over the value as originally filed.
    if (!current || (entry.filed ?? '') > (current.filed ?? '')) byPeriod.set(key, entry);
  }
  return [...byPeriod.values()];
}

// Convert one SEC duration concept into discrete fiscal quarters. 10-Q facts
// include both three-month and year-to-date values, so only ~quarter-duration
// rows are direct observations. A 10-K supplies the missing fourth quarter as
// full-year value less the three earlier quarters within the same fiscal year.
function secQuarterSeries(units) {
  const facts = latestByPeriod((units?.USD ?? []).filter(entry =>
    (entry.form === '10-Q' || entry.form === '10-K') &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.start ?? '') &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.end ?? '') &&
    Number.isFinite(Number(entry.val)),
  ));

  const direct = facts.filter(entry => {
    const days = daysBetween(entry.start, entry.end);
    return entry.form === '10-Q' && days >= 70 && days <= 120;
  });
  const annual = facts.filter(entry => {
    const days = daysBetween(entry.start, entry.end);
    return entry.form === '10-K' && days >= 300 && days <= 420;
  });

  const byEnd = new Map();
  for (const entry of direct) {
    const current = byEnd.get(entry.end);
    if (!current || (entry.filed ?? '') > (current.filed ?? '')) {
      byEnd.set(entry.end, { periodEnd: entry.end, value: Number(entry.val), filed: entry.filed });
    }
  }

  for (const year of annual) {
    const firstThree = direct
      .filter(q => q.start >= year.start && q.end < year.end)
      .sort((a, b) => a.end.localeCompare(b.end));
    const unique = new Map();
    for (const q of firstThree) {
      const current = unique.get(q.end);
      if (!current || (q.filed ?? '') > (current.filed ?? '')) unique.set(q.end, q);
    }
    const quarters = [...unique.values()].sort((a, b) => a.end.localeCompare(b.end));
    if (quarters.length !== 3) continue;
    const value = Number(year.val) - quarters.reduce((sum, q) => sum + Number(q.val), 0);
    if (!Number.isFinite(value)) continue;
    const current = byEnd.get(year.end);
    if (!current || (year.filed ?? '') > (current.filed ?? '')) {
      byEnd.set(year.end, { periodEnd: year.end, value, filed: year.filed });
    }
  }

  return byEnd;
}

function secMetricSeries(usGaap, concepts) {
  const merged = new Map();
  for (const concept of concepts) {
    const series = secQuarterSeries(usGaap?.[concept]?.units);
    for (const [periodEnd, row] of series) {
      // Concepts are ordered from most current/specific to legacy fallbacks.
      if (!merged.has(periodEnd)) merged.set(periodEnd, row.value);
    }
  }
  return merged;
}

function reportsFromSecCompanyFacts(body) {
  const usGaap = body?.facts?.['us-gaap'];
  if (!usGaap) return [];
  const revenue = secMetricSeries(usGaap, SEC_REVENUE_CONCEPTS);
  const netIncome = secMetricSeries(usGaap, SEC_NET_INCOME_CONCEPTS);
  const periodEnds = [...new Set([...revenue.keys(), ...netIncome.keys()])].sort();
  return periodEnds.map(periodEnd => ({
    periodEnd,
    revenue: revenue.get(periodEnd) ?? null,
    netIncome: netIncome.get(periodEnd) ?? null,
  }));
}

async function fetchSecIncomeStatement(ticker) {
  const cik = SEC_CIK[ticker];
  if (!cik) return null;
  const res = await fetch(`${SEC_COMPANY_FACTS_URL}/CIK${cik}.json`, {
    headers: {
      // SEC fair-access policy requires an identifying User-Agent. Deployments
      // can provide a real contact through SEC_USER_AGENT without code changes.
      'User-Agent': process.env.SEC_USER_AGENT || 'rays-research fundamentals research@localhost',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`SEC Company Facts HTTP ${res.status}`);
  const reports = reportsFromSecCompanyFacts(await res.json());
  if (!reports.length) throw new Error('SEC Company Facts returned no quarterly reports');
  return reports;
}

// Sign-aware percent change. Dividing the change by the magnitude of the prior
// period preserves ordinary growth for positive bases while making movements
// around losses read intuitively:
//   -100 -> -50  = +50% improvement
//   -50  -> -75  = -50% deterioration
//   -50  ->  25  = +150% improvement / return to profit
// A zero base remains undefined because no finite percentage can describe it.
function growth(current, prior) {
  if (current == null || prior == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (prior === 0) return null;
  return (current - prior) / Math.abs(prior);
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

// FMP's configured free plan exposes five quarterly statements. That is enough
// for current QoQ plus one YoY observation, making it a useful immediate
// fallback when Alpha Vantage's daily quota is gone. A later successful Alpha
// Vantage run merges in the longer history.
async function fetchFmpIncomeStatement(ticker) {
  const key = fmpApiKey();
  if (!key) throw new Error('FMP_API_KEY is not set');

  const url = new URL(FMP_INCOME_STATEMENT_URL);
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('period', 'quarter');
  url.searchParams.set('limit', '5');
  url.searchParams.set('apikey', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`FMP income statement HTTP ${res.status}`);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(text.slice(0, 180) || 'FMP returned an invalid response'); }
  if (!Array.isArray(body)) {
    throw new Error(body?.['Error Message'] || 'FMP returned no quarterly reports');
  }
  return body
    .map(row => ({
      periodEnd: row.date,
      revenue: toNumber(row.revenue),
      netIncome: toNumber(row.netIncome),
    }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.periodEnd ?? ''))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
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
  let reports;
  if (SEC_CIK[ticker]) {
    reports = await fetchSecIncomeStatement(ticker);
  } else {
    try {
      reports = await fetchIncomeStatement(ticker);
    } catch (alphaError) {
      try {
        reports = await fetchFmpIncomeStatement(ticker);
      } catch (fmpError) {
        if (alphaError.message === 'RATE_LIMIT') throw alphaError;
        throw new Error(`Alpha Vantage: ${alphaError.message}; FMP: ${fmpError.message}`);
      }
    }
  }
  if (!reports.length) return null;
  return computeGrowth(reports);
}

function readCache() {
  const blob = storage.read(BLOB.name, BLOB.file);
  if (!blob.tickers) blob.tickers = {};
  if (!blob.fetchedAt) blob.fetchedAt = {};
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
  state.fetchedAt ??= {};

  // The SOXX candles come from Yahoo, cost one request, and are shared by every
  // metric view — computed first so the loop's incremental writes can't land
  // after a final candle write and clobber it. On failure keep what's cached.
  // Persisted immediately rather than waiting on the loop's per-ticker write:
  // Alpha Vantage's cap can break out of the loop on the very first ticker, and
  // the chart shouldn't be held hostage to a quota that has nothing to do with it.
  try {
    state.soxx = await computeIndexCandles();
    state.updatedAt = new Date().toISOString();
    writeCache(state);
    console.log(`[fundamentals] SOXX: ${Object.keys(state.soxx).length} quarterly candles`);
  } catch (e) {
    console.warn(`[fundamentals] SOXX candles failed: ${e.message}`);
  }

  let alphaVantageRateLimited = false;
  for (const ticker of tickers) {
    if (alphaVantageRateLimited && !SEC_CIK[ticker]) {
      console.warn(`[fundamentals] ${ticker}: deferred — Alpha Vantage daily cap already reached`);
      continue;
    }
    try {
      const quarters = await computeTicker(ticker);
      if (quarters && Object.keys(quarters).length) {
        // Retain deeper history if a quota-limited provider only returns a
        // recent top-up window; same-label current values replace stale ones.
        state.tickers[ticker] = { ...(state.tickers[ticker] ?? {}), ...quarters };
        state.fetchedAt[ticker] = new Date().toISOString();
        console.log(`[fundamentals] ${ticker}: ${Object.keys(state.tickers[ticker]).length} quarters`);
      } else {
        console.warn(`[fundamentals] ${ticker}: no quarterly income statement available`);
      }
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        alphaVantageRateLimited = true;
        console.warn(`[fundamentals] ${ticker}: Alpha Vantage daily cap reached — continuing with SEC-backed tickers`);
        continue;
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
  const staleness = ticker => state.fetchedAt?.[ticker] ?? ''; // never-fetched sorts first
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
  reportsFromSecCompanyFacts,
  runDailyBatch,
  secQuarterSeries,
};
