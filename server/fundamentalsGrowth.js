'use strict';

const path = require('path');
const storage = require('./storage');
const { SOXX_CONSTITUENTS, CSP_TICKERS, computeIndexCandles, QUARTERS_SHOWN } = require('./priceReturnAfterEarnings');
const { DEFAULT_TICKERS } = require('./scripts/generateDailyOptionsReport');

// The page's sections, mirroring the Price Return page's ticker-scope views:
// the tracked iShares SOXX holdings, and the hyperscaler cloud service
// providers that buy from them. Kept as re-exports rather than second literal
// lists so the pages can never drift apart.
const SOXX_SECTION = SOXX_CONSTITUENTS;
const CSP_SECTION = CSP_TICKERS;
// Everything else the Alerts page tracks (DEFAULT_TICKERS) that isn't already
// in one of the two curated sections above, so newly-added Alerts tickers
// show up here automatically instead of needing a second hand-maintained list.
const EXTENDED_SECTION = DEFAULT_TICKERS.filter(
  t => t !== 'SOXX' && !SOXX_SECTION.includes(t) && !CSP_SECTION.includes(t),
);
const FUNDAMENTALS_TICKERS = [...SOXX_SECTION, ...CSP_SECTION, ...EXTENDED_SECTION];

// The sidebar views. The first four are growth rates derived from the same two
// quarterly income-statement lines, so one fetch per ticker fills all four.
// freeCashFlow is a level rather than a growth rate — the raw dollar figure —
// and comes from the same SEC filing, so it costs no extra request either.
const METRICS = ['revenueYoY', 'revenueQoQ', 'netIncomeYoY', 'netIncomeQoQ', 'freeCashFlow'];

// Primary source: the SEC Company Facts API. It is free, needs no API key, and
// gives the long quarterly history this page needs. Yahoo's public fundamentals
// endpoint only exposes the trailing five quarters, while Alpha Vantage's free
// key is shared with other jobs and has a hard 25-request/day cap. Foreign
// private issuers that only file annually (Form 20-F/40-F, no quarterly SEC
// facts) retain Alpha Vantage as a fallback; every domestic 10-Q filer below —
// verified against SEC EDGAR's full-text search and each CIK's own filing
// history — no longer depends on that scarce quota.
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
  ENTG: '0001101302',
  // CSP section. All four are domestic filers with full quarterly SEC facts,
  // so the section costs no Alpha Vantage quota.
  AMZN: '0001018724',
  GOOG: '0001652044', // Alphabet Inc. — one filer for both share classes
  MSFT: '0000789019',
  META: '0001326801',
  // Extended section — domestic 10-Q filers only. Remaining Extended tickers
  // (NOK, TSEM, GFS, CAMT, IFNNY, ERIC, STM, ARM, NVMI) file annually (20-F)
  // and stay on Alpha Vantage.
  AAPL: '0000320193',
  CSCO: '0000858877',
  ORCL: '0001341439',
  T: '0000732717',
  VZ: '0000732712',
  TMUS: '0001283699',
  NFLX: '0001065280',
  ANET: '0001596532',
  PLTR: '0001321655',
  SNPS: '0000883241',
  JBL: '0000898293',
  ARW: '0000007536',
  AVT: '0000008858',
  CDNS: '0000813672',
  GLW: '0000024741',
  APH: '0000820313',
  DELL: '0001571996',
  HPQ: '0000047217',
  HPE: '0001645590',
  CIEN: '0000936395',
  SMCI: '0001375365',
  KEYS: '0001601046',
  QRVO: '0001604778',
  WDC: '0000106040',
  SWKS: '0000004127',
  FLEX: '0000866374',
  SANM: '0000897723',
  CLS: '0001030894',
  APP: '0001751008',
  FORM: '0001039399',
  CALX: '0001406666',
  VIAV: '0000912093',
  ONTO: '0000704532',
  VRT: '0001674101',
  RMBS: '0000917273',
  POWI: '0000833640',
  TTMI: '0001116942',
  AXTI: '0001051627',
  STX: '0001137789',
  ALGM: '0000866291',
  COHR: '0000820318',
  LITE: '0001633978',
  AMKR: '0001047127',
  TEL: '0001385157',
  SNDK: '0002023554',
  FN: '0001408710',
};
// The tickers each source is responsible for. Anything without a CIK above
// falls through to Alpha Vantage, whose free key is capped at 25 requests a day
// and shared with the transcript jobs — so callers that must not spend that
// quota can filter on METERED_TICKERS rather than hand-maintaining a list.
const SEC_BACKED_TICKERS = Object.keys(SEC_CIK);
const METERED_TICKERS = FUNDAMENTALS_TICKERS.filter(ticker => !SEC_CIK[ticker]);

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
// Free cash flow = cash from operations less capital expenditure. Both legs come
// off the cash-flow statement, which most filers tag only year-to-date, so these
// go through secCumulativeQuarterSeries rather than the income-statement path.
const SEC_OPERATING_CASH_FLOW_CONCEPTS = [
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
];
// Amazon has historically also used productive-asset tags for this line. Keep
// the standard PP&E tag first, then fill periods it does not cover from those
// broader fallbacks.
const SEC_CAPEX_CONCEPTS = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
  'PaymentsForProceedsFromProductiveAssets',
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

  // Quarter-length rows are direct observations wherever they appear. Most come
  // from a 10-Q, but a 10-K routinely tags the fourth quarter outright, and some
  // filers (Broadcom's fiscal 2017) tag the first quarter only in the annual
  // report. Restricting this to 10-Q dropped both, which then also starved the
  // year-less-three-quarters fallback below of the three quarters it needs — so
  // those companies lost their Q4 column entirely rather than gaining it.
  const direct = facts.filter(entry => {
    const days = daysBetween(entry.start, entry.end);
    return (entry.form === '10-Q' || entry.form === '10-K') && days >= 70 && days <= 120;
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

// Cash-flow-statement equivalent of secQuarterSeries. The income statement is
// reliably tagged per-quarter, but the cash-flow statement usually is not:
// Alphabet and Meta publish only year-to-date cash flows in their 10-Qs (Q1 is
// the sole three-month duration), so the direct-quarter filter would leave three
// of every four quarters blank. Anything longer than a quarter is therefore
// differenced against the same fiscal year's previous cumulative fact — a
// six-month figure less the three-month one is Q2, and the 10-K's full year less
// the nine-month YTD is Q4. Filers that do tag three-month cash flows (Microsoft,
// Amazon) keep those as-is; the differencing only fills what they leave out.
function secCumulativeQuarterSeries(units) {
  const facts = latestByPeriod((units?.USD ?? []).filter(entry =>
    (entry.form === '10-Q' || entry.form === '10-K') &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.start ?? '') &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.end ?? '') &&
    Number.isFinite(Number(entry.val)),
  ));

  const isQuarterLong = days => days != null && days >= 70 && days <= 120;
  const byEnd = new Map();
  const set = (periodEnd, value, filed) => {
    const current = byEnd.get(periodEnd);
    if (!current || (filed ?? '') > (current.filed ?? '')) byEnd.set(periodEnd, { periodEnd, value, filed });
  };

  for (const entry of facts) {
    if (isQuarterLong(daysBetween(entry.start, entry.end))) set(entry.end, Number(entry.val), entry.filed);
  }

  // Second pass so a directly reported quarter always wins over a derived one.
  for (const entry of facts) {
    const span = daysBetween(entry.start, entry.end);
    if (isQuarterLong(span) || span == null || span > 420) continue;
    if (byEnd.has(entry.end)) continue;
    // The cumulative fact one quarter shorter, from the same period start. Any
    // such pair differences to the same quarter, so a trailing-twelve-month
    // fact works here exactly as a year-to-date one does.
    const prior = facts.find(other =>
      other.start === entry.start &&
      other.end < entry.end &&
      isQuarterLong(daysBetween(other.end, entry.end)),
    );
    if (!prior) continue;
    const value = Number(entry.val) - Number(prior.val);
    if (Number.isFinite(value)) set(entry.end, value, entry.filed);
  }

  return byEnd;
}

function secMetricSeries(usGaap, concepts, seriesFn = secQuarterSeries) {
  const merged = new Map();
  for (const concept of concepts) {
    const series = seriesFn(usGaap?.[concept]?.units);
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
  const operatingCashFlow = secMetricSeries(usGaap, SEC_OPERATING_CASH_FLOW_CONCEPTS, secCumulativeQuarterSeries);
  const capex = secMetricSeries(usGaap, SEC_CAPEX_CONCEPTS, secCumulativeQuarterSeries);
  // Cash-flow periods are only reported alongside income-statement ones, so
  // they never widen the quarter set; a quarter missing either leg is left null
  // rather than being shown as if capex were zero.
  const periodEnds = [...new Set([...revenue.keys(), ...netIncome.keys()])].sort();
  return periodEnds.map(periodEnd => {
    const ocf = operatingCashFlow.get(periodEnd);
    const capitalExpenditure = capex.get(periodEnd);
    return {
      periodEnd,
      revenue: revenue.get(periodEnd) ?? null,
      netIncome: netIncome.get(periodEnd) ?? null,
      freeCashFlow: ocf != null && capitalExpenditure != null ? ocf - capitalExpenditure : null,
    };
  });
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

// How stale the newest SEC quarter has to look before it's worth asking FMP
// whether a newer one exists. A company reporting on schedule is ~90 days past
// its last period end, so 45 days is comfortably inside "might have reported by
// now" without querying every ticker on every run.
const SEC_STALE_DAYS = 45;

// SEC Company Facts only sees a quarter once the 10-Q is filed AND its XBRL has
// propagated — Meta's Q2 2026 numbers were public in the 8-K press release the
// evening of July 29 but absent from companyfacts, and NXPI's 10-Q sat filed for
// two days before its facts appeared. The earnings release itself is no help:
// its financials live in an untagged HTML exhibit, and companyfacts carries no
// 8-K facts at all.
//
// FMP publishes the figures within hours of the release, so it covers exactly
// that gap. Only quarters strictly newer than anything SEC has are taken, and
// only when SEC already looks stale — FMP's free tier rejects most of the
// roster as premium-only symbols, and this way those rejections are limited to
// the few tickers actually waiting on a filing. Values are provisional: they
// carry no cash-flow legs (so freeCashFlow stays null rather than reading as
// zero), and the next run after the 10-Q lands overwrites them from XBRL.
async function topUpFromFmp(ticker, reports) {
  if (!fmpApiKey() || !reports.length) return reports;

  const newestSec = reports[reports.length - 1].periodEnd;
  const staleDays = (Date.now() - Date.parse(`${newestSec}T00:00:00Z`)) / 86_400_000;
  if (staleDays < SEC_STALE_DAYS) return reports;

  let fresh;
  try {
    fresh = await fetchFmpIncomeStatement(ticker);
  } catch {
    return reports; // premium-only symbol, or FMP is down — SEC's series stands
  }

  const added = fresh
    .filter(row => row.periodEnd > newestSec && row.revenue != null)
    .map(row => ({ ...row, freeCashFlow: null, provisional: true }));
  if (!added.length) return reports;

  console.log(`[fundamentals] ${ticker}: +${added.length} provisional quarter(s) from FMP (${added.map(a => a.periodEnd).join(', ')}) — SEC has only through ${newestSec}`);
  return [...reports, ...added];
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
      // A level, not a growth rate — the CSP free-cash-flow view shows it raw.
      freeCashFlow: cur.freeCashFlow ?? null,
      // Set only on vendor figures standing in until the filing lands, so a
      // later run can tell an unofficial number from a settled one.
      ...(cur.provisional ? { provisional: true } : {}),
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
    reports = await topUpFromFmp(ticker, await fetchSecIncomeStatement(ticker));
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

// Scheduled entry point. Only the handful of tickers without SEC facts spend
// Alpha Vantage quota, so the budget is applied to those alone — SEC-backed
// tickers are free and all of them run every day. Both groups are ordered
// stalest-first, so if the budget is ever shared with another Alpha Vantage
// job, the tickers that got skipped are the ones that go first next time.
async function runDailyBatch() {
  const state = readCache();
  const staleness = ticker => state.fetchedAt?.[ticker] ?? ''; // never-fetched sorts first
  const ordered = [...FUNDAMENTALS_TICKERS].sort((a, b) => staleness(a).localeCompare(staleness(b)));
  const free = ordered.filter(t => SEC_CIK[t]);
  const metered = ordered.filter(t => !SEC_CIK[t]).slice(0, DAILY_REQUEST_BUDGET);
  // Interleave back into staleness order so an early rate-limit break still
  // leaves the run having touched the stalest tickers first.
  const batch = new Set([...free, ...metered]);
  return backfill(ordered.filter(t => batch.has(t)));
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
    soxxTickers: SOXX_SECTION,
    cspTickers: CSP_SECTION,
    extendedTickers: EXTENDED_SECTION,
    updatedAt: state.updatedAt ?? null,
  };
}

module.exports = {
  BLOB,
  FUNDAMENTALS_TICKERS,
  METERED_TICKERS,
  SEC_BACKED_TICKERS,
  SOXX_SECTION,
  CSP_SECTION,
  EXTENDED_SECTION,
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
