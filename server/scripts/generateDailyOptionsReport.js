'use strict';

const fs = require('fs');
const path = require('path');
const storage = require('../storage');
const { getOptionsData } = require('../scrapers/options');
const { getEarningsAnchors } = require('../earningsDates');

// Full-chain volume takes one aggregate request per contract. Prior-cycle history
// is settled, while the current chain gains one new daily total per run, so both are
// cached here instead of re-scraping thousands of contracts every morning. Each
// prior chain is fetched with months of forward headroom; each current chain is
// backfilled once and then extended from the day's already-fetched snapshot.
// NOTE: this blob must stay registered in server.js STORAGE_BLOBS, or init()
// won't preload it from Mongo and every restart re-scrapes from an empty file.
const PRIOR_BLOB = {
  name: 'optionsPriorYearVolume',
  file: path.join(__dirname, '..', 'data', 'optionsPriorYearVolume.json'),
};
const PRIOR_LOOKAHEAD_DAYS = 120;
// Current + two comparison cycles, two sides, three expirations, and a rolling
// roster of tickers. This remains comfortably below Mongo's blob limit while
// retaining active chains long enough to avoid churn as expirations roll.
const PRIOR_CACHE_MAX = 1200;

// The report tracks the three nearest expirations. A caller that only needs the
// front one (a one-chart export) can say so and skip two thirds of the chain
// history — every contract in an expiration costs a request the first time it is
// seen, so the count is the run's dominant cost.
const EXPIRATION_COUNT = 3;

const DEFAULT_TICKERS = [
  'TSM', 'ASML', 'INTC', 'TXN', 'STM', 'TEL', 'GOOG', 'NOK', 'SOXX',
  // Added 2026-07 (semis, semicap, EMS/interconnect, mega-cap software). Their
  // current + prior-cycle chains are seeded by backfillOptionsReportTickers.js,
  // so the daily run re-pairs cached prior chains rather than re-scraping them.
  'QRVO', 'UMC', 'STX', 'RMBS', 'KLAC', 'TER', 'LRCX', 'NXPI', 'FLEX', 'APH',
  'GLW', 'FORM', 'AMKR', 'SANM', 'CLS', 'ARM', 'CDNS', 'MSFT', 'META',
  // Added 2026-08 (broader semis/analog, networking/optical, systems &
  // distribution, telecom/cloud). Same seeding pattern via
  // backfillOptionsReportTickers.js. TSM, ASML already present above.
  'AAPL', 'AMD', 'SWKS', 'QCOM', 'NVDA', 'MRVL', 'AVGO', 'TSEM', 'GFS', 'WDC',
  'SNDK', 'MU', 'ONTO', 'AMAT', 'KEYS', 'VIAV', 'CAMT', 'NVMI', 'ALGM', 'MCHP',
  'MPWR', 'POWI', 'ON', 'ADI', 'IFNNY', 'VRT', 'TTMI', 'FN', 'LITE', 'COHR',
  'MTSI', 'ALAB', 'CSCO', 'ANET', 'CRDO', 'AXTI', 'CIEN', 'ASX', 'SMCI', 'DELL',
  'HPQ', 'HPE', 'JBL', 'SNPS', 'ARW', 'AVT', 'ORCL', 'PLTR', 'AMZN', 'NFLX',
  'APP', 'T', 'VZ', 'TMUS', 'ERIC', 'CALX',
];
const BASE = 'https://api.massive.com';
const CALL_COLOR = '#059669';
const PUT_COLOR = '#dc2626';
const CALL_SOFT = '#bfe8d8';
const PUT_SOFT = '#f3c7c7';
const PRICE_COLOR = '#111827';
const PRIOR_YEAR_COLOR = '#6366f1';
const PRIOR_QUARTER_COLOR = '#d97706';

// The two comparison lines. Both are the same measure — total chain volume — read
// at the equivalent point of an earlier earnings cycle, so they are separated by
// line style and marker shape as well as hue: nothing here is carried by colour
// alone. Solid/diamond is the nearer cycle, dashed/circle the further one.
const CYCLES = [
  { key: 'quarter', color: PRIOR_QUARTER_COLOR, dash: null, marker: 'diamond', label: 'last qtr' },
  { key: 'year', color: PRIOR_YEAR_COLOR, dash: '5 4', marker: 'circle', label: '1 yr ago' },
];

// Only used when a ticker's earnings dates can't be established. Shifting by 52
// weeks rather than a calendar year at least lands each point on the same weekday
// as the bar it sits above — option volume is strongly day-of-week seasonal.
const YEAR_SHIFT_DAYS = 364;
const PRIOR_CONCURRENCY = 6;
const PRIOR_EXPIRY_WINDOW_DAYS = 21;
// How many neighbouring expirations to try before settling, and the share of the
// compared sessions a chain must have traded to be accepted outright.
const MAX_CHAIN_CANDIDATES = 3;
const MIN_CHAIN_COVERAGE = 0.5;
const CHART_SESSIONS = 10;
const MAX_RETRIES = 9;

function getKey() {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error('MASSIVE_API_KEY is not set');
  return key;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Summing whole prior-cycle chains costs thousands of aggregate calls per run, which
// is a sustained load against Massive's per-minute cap rather than a burst against
// it. Retrying into a wall just converts throttling into a slow, lossy run, so
// instead pace every request through one gate. The gate widens when the API pushes
// back and creeps back down when it stops, which self-tunes to whatever the plan
// allows.
const MIN_INTERVAL_FLOOR_MS = 60_000 / 600;   // ceiling of ~600 req/min
const MIN_INTERVAL_CEIL_MS = 60_000 / 60;     // never crawl below ~60 req/min
let minIntervalMs = MIN_INTERVAL_FLOOR_MS;
let nextSlot = 0;

async function rateLimitSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + minIntervalMs;
  if (slot > now) await sleep(slot - now);
}

function throttleBack() {
  minIntervalMs = Math.min(MIN_INTERVAL_CEIL_MS, minIntervalMs * 1.6);
  nextSlot = Math.max(nextSlot, Date.now() + minIntervalMs);
}

// Easing back has to be much slower than backing off. Two comparison cycles doubled
// the call volume, so a run now spends long stretches at the cap; recovering at 2%
// per success rebounded into the limit within a hundred calls and burned the retry
// budget of whatever request happened to be next in line — which is how a single
// one-off call (a session calendar) ended up being the thing that failed.
function throttleEase() {
  minIntervalMs = Math.max(MIN_INTERVAL_FLOOR_MS, minIntervalMs * 0.995);
}

// Summing whole prior-cycle chains means thousands of aggregate calls per run, which
// is enough to trip Massive's per-minute cap. A 429 is a "come back shortly", not
// a failure, so back off and retry rather than letting an empty result through —
// an empty result silently reshapes the chart it feeds. The retry budget has to
// outlast a *sustained* squeeze, not just a momentary one: with two cycles in flight
// the cap can stay shut for a minute or more.
async function massiveGet(pathname, params = {}, attempt = 0) {
  const url = new URL(pathname, BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  await rateLimitSlot();
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getKey()}`, Accept: 'application/json' },
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    throttleBack();
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30_000, 600 * (2 ** attempt)) + Math.floor(Math.random() * 400);
    await sleep(waitMs);
    return massiveGet(pathname, params, attempt + 1);
  }
  throttleEase();
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Massive ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function parseArgs(argv) {
  const args = { tickers: DEFAULT_TICKERS, date: today(), out: null, format: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tickers' && argv[i + 1]) {
      args.tickers = argv[i + 1]
        .split(',')
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--date' && argv[i + 1]) {
      args.date = argv[i + 1];
      i += 1;
    } else if (arg === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if (arg === '--format' && argv[i + 1]) {
      args.format = argv[i + 1].trim().toLowerCase();
      i += 1;
    }
  }
  return args;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeMd(value) {
  return String(value ?? '-').replaceAll('|', '\\|');
}

function htmlAttr(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

function fmtUsd(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `$${Number(value).toFixed(2)}`;
}

function fmtNum(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('en-US');
}

function fmtIv(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(1)}%`;
}

function fmtRatio(volume, openInterest) {
  if (!volume || !openInterest) return '-';
  return (volume / openInterest).toFixed(2);
}

function fmtX(value) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}x`;
}

function fmtDeltaPct(todayValue, priorValue) {
  if (!priorValue) return '-';
  const pct = ((todayValue - priorValue) / priorValue) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function fmtShort(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return Math.round(n).toLocaleString('en-US');
}

function fmtChange(value, pct) {
  if (value == null || pct == null) return '';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}

function fmtExpiry(dateStr) {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${month}/${day}`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// An expiration, named the way a chain is spoken about: "Apr 17". A prior cycle in
// another year carries one — "Jul 18 '25" — since that is exactly where the two
// chains being compared are easiest to confuse.
function fmtExpiryShort(dateStr, relativeTo) {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  const label = `${MONTHS_SHORT[month - 1]} ${day}`;
  const baseYear = Number(String(relativeTo ?? '').slice(0, 4));
  return year === baseYear ? label : `${label} '${String(year).slice(2)}`;
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysApart(a, b) {
  const ms = new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`);
  return Math.abs(ms) / 86_400_000;
}

// Signed: how far `date` sits after `from`, in calendar days.
function daysBetween(from, date) {
  return Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000);
}

// Sessions between today and a date that hasn't arrived yet (an expiration, an
// earnings call) can't be read off a calendar that doesn't exist yet, so the forward
// leg is counted in weekdays. A market holiday inside that window would overstate it
// by one session; the alternative — a hard-coded holiday table — goes stale silently,
// and being one session out shifts every point of both lines equally, which does not
// change the comparison the chart is making.
function weekdaysUntil(from, to) {
  let count = 0;
  let cursor = from;
  while (cursor < to) {
    cursor = addDays(cursor, 1);
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

// Bounded-concurrency map: the year-ago totals need one aggregate call per strike
// in the chain (~60-300 per side), so they have to be issued in parallel without
// opening a socket per contract.
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
  // Let every worker settle before propagating an error. Otherwise one rejected
  // contract leaves sibling requests running after the caller has cleared caches or
  // closed storage, and a partial backfill can race the next generation.
  const settled = await Promise.allSettled(workers);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return out;
}

// Several of a ticker's expirations routinely resolve to the *same* year-ago chain
// (a monthly-only name like STM maps all three to 2025-07-18), so the identical
// per-contract history would otherwise be fetched once per expiration. Memoising
// for the run keeps us well under the per-minute cap.
const dailyVolumeCache = new Map();

function dailyVolumePromise(contractSymbol, start, end) {
  if (!contractSymbol) return Promise.resolve([]);
  const key = `${contractSymbol}|${start}|${end}`;
  if (dailyVolumeCache.has(key)) return dailyVolumeCache.get(key);

  const promise = (async () => {
    const pathname = `/v2/aggs/ticker/${encodeURIComponent(contractSymbol)}/range/1/day/${start}/${end}`;
    const resp = await massiveGet(pathname, { adjusted: 'true', sort: 'asc', limit: 5000 });
    return (resp.results ?? [])
      .map(row => ({ date: new Date(row.t).toISOString().slice(0, 10), volume: row.v ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  })();

  // A rejected promise must be retried by the next caller, not retained as data.
  promise.catch(() => {
    if (dailyVolumeCache.get(key) === promise) dailyVolumeCache.delete(key);
  });
  dailyVolumeCache.set(key, promise);
  return promise;
}

// Prior comparison series are best-effort: one unavailable contract should not
// remove the entire line. Current full-chain bars are stricter and call the required
// variant below, because persisting a failed request as a real zero would corrupt all
// future bars for that expiration.
async function fetchDailyVolume(contractSymbol, start, end) {
  try {
    return await dailyVolumePromise(contractSymbol, start, end);
  } catch (error) {
    console.warn(`[options-report] history unavailable for ${contractSymbol}: ${error.message}`);
    return [];
  }
}

function fetchDailyVolumeRequired(contractSymbol, start, end) {
  return dailyVolumePromise(contractSymbol, start, end);
}

// Every contract of one side that was listed against the equivalent expiration in an
// earlier cycle, as candidate chains ranked by how close their expiration lands to
// the target. Expirations have no exact twin in the past (a Jul 17 2026 expiry has no
// 2025 counterpart), and the window is wide enough to reach the neighbouring monthly:
// names like STM list monthlies only, so the nearest match can be a fortnight off.
//
// Candidates rather than a single answer, because the *nearest* expiration is not
// always one that was trading during the sessions being compared. STM's 2026-07-31
// expiry targets 2026-05-01 a quarter back, whose nearest listing is the 2026-05-08
// weekly — but that weekly had not been listed yet during the run-up to the April
// call, so its volume there is nil and the line silently vanishes. The chain that
// actually traded through the window is the right comparison even if a neighbouring
// one sits marginally closer on the calendar.
const priorChainCache = new Map();

async function fetchPriorChains(ticker, side, targetExpiry) {
  const key = `${ticker}|${side}|${targetExpiry}`;
  if (!priorChainCache.has(key)) {
    const promise = resolvePriorChains(ticker, side, targetExpiry);
    promise.catch(() => priorChainCache.delete(key));
    priorChainCache.set(key, promise);
  }
  return priorChainCache.get(key);
}

async function resolvePriorChains(ticker, side, targetExpiry) {
  const resp = await massiveGet('/v3/reference/options/contracts', {
    underlying_ticker: ticker,
    contract_type: side,
    'expiration_date.gte': addDays(targetExpiry, -PRIOR_EXPIRY_WINDOW_DAYS),
    'expiration_date.lte': addDays(targetExpiry, PRIOR_EXPIRY_WINDOW_DAYS),
    // A contract that has not expired yet is absent from the expired listing, and
    // the last-quarter target can still be live when a tracked expiration sits far
    // enough past the upcoming call.
    expired: targetExpiry < today() ? 'true' : 'false',
    limit: 1000,
  });

  const byExpiration = new Map();
  for (const contract of resp.results ?? []) {
    if (contract.underlying_ticker !== ticker || !contract.ticker) continue;
    const bucket = byExpiration.get(contract.expiration_date) ?? [];
    bucket.push(contract.ticker);
    byExpiration.set(contract.expiration_date, bucket);
  }

  return [...byExpiration.keys()]
    .sort((a, b) => daysApart(a, targetExpiry) - daysApart(b, targetExpiry))
    .map(expiration => ({ expiration, contracts: byExpiration.get(expiration) }));
}

function readPriorCache() {
  const blob = storage.read(PRIOR_BLOB.name, PRIOR_BLOB.file);
  if (!blob.chains) blob.chains = {};
  return blob;
}

let priorCacheDirty = false;

function savePriorChain(key, entry) {
  const blob = readPriorCache();
  blob.chains[key] = entry;

  const keys = Object.keys(blob.chains);
  if (keys.length > PRIOR_CACHE_MAX) {
    const stale = keys
      .sort((a, b) => (blob.chains[a].fetchedAt ?? '').localeCompare(blob.chains[b].fetchedAt ?? ''))
      .slice(0, keys.length - PRIOR_CACHE_MAX);
    for (const old of stale) delete blob.chains[old];
  }

  blob.updatedAt = new Date().toISOString();
  priorCacheDirty = true;
}

// The cache is one Mongo/file blob. Mutate it throughout a generation, then issue a
// single whole-blob write so concurrent call/put completions cannot race and leave
// the database with an older partial snapshot.
function persistPriorCache() {
  if (!priorCacheDirty) return;
  const blob = readPriorCache();
  storage.write(PRIOR_BLOB.name, PRIOR_BLOB.file, blob);
  priorCacheDirty = false;
}

// One scrape of a prior-cycle chain, summed to a date -> volume map, together with the
// bar -> session pairing that chain implies. The window runs months past the dates
// needed today: the range costs nothing extra per contract (it is one aggregates call
// either way), and it buys every later run a cache hit.
//
// Candidates are tried nearest-expiration first and the search stops at the first one
// that actually traded through the sessions being compared, so a chain that had not
// been listed yet back then does not win on calendar proximity alone. If none clears
// the bar, the best-covered candidate is kept anyway — that is the honest answer, and
// caching it stops the next run from re-scraping the same dead chains.
//
// Which sessions are compared depends on which candidate wins, because a bar is
// matched to the past by its distance from its own expiration — so the pairing is
// computed per candidate rather than handed in.
async function scrapePriorChain(ticker, side, expirationDate, targetExpiry, dte, chartDates) {
  const candidates = await fetchPriorChains(ticker, side, targetExpiry);
  if (!candidates?.length) return null;

  let best = null;
  for (const chain of candidates.slice(0, MAX_CHAIN_CANDIDATES)) {
    const pairs = await pairsForExpiry(ticker, expirationDate, chain.expiration, dte, chartDates);
    if (!pairs.length) continue;

    const neededDates = pairs.map(pair => pair.date);
    const rangeStart = addDays(neededDates[0], -5);
    const lookahead = addDays(neededDates[neededDates.length - 1], PRIOR_LOOKAHEAD_DAYS);
    const rangeEnd = lookahead < today() ? lookahead : today();

    const histories = await mapLimit(
      chain.contracts,
      PRIOR_CONCURRENCY,
      symbol => fetchDailyVolume(symbol, rangeStart, rangeEnd),
    );

    const totals = sumDailyVolumes(histories);

    const covered = neededDates.filter(date => totals[date] > 0).length;
    const entry = {
      expiration: chain.expiration,
      contractCount: chain.contracts.length,
      rangeStart,
      rangeEnd,
      totals,
      coverage: covered / neededDates.length,
      fetchedAt: new Date().toISOString(),
    };

    if (!best || entry.coverage > best.entry.coverage) best = { entry, pairs };
    if (entry.coverage >= MIN_CHAIN_COVERAGE) break;
  }

  return best;
}

// Sum daily contract volume across every option symbol in one side of one expiry.
// A missing symbol/day contributes zero; the stock-session calendar decides which
// zeroes are rendered, rather than the sparse option aggregates endpoint.
function sumDailyVolumes(histories) {
  const totals = {};
  for (const history of histories ?? []) {
    for (const day of history ?? []) {
      totals[day.date] = (totals[day.date] ?? 0) + (day.volume ?? 0);
    }
  }
  return totals;
}

function addDailyTotals(target, addition) {
  for (const [date, volume] of Object.entries(addition ?? {})) {
    target[date] = (target[date] ?? 0) + (volume ?? 0);
  }
  return target;
}

function uniqueSymbols(symbols) {
  return [...new Set((symbols ?? []).filter(Boolean))].sort();
}

// Turn a cached full-chain history plus today's full snapshot into chart rows. The
// contracts all belong to the same side and expiration; callers deliberately pass
// the complete chain, not the three rows retained for the detail table.
function currentRowsFromTotals(contracts, chartDates, effectiveDate, totals = {}) {
  const currentVolume = (contracts ?? []).reduce((sum, row) => sum + (row.volume ?? 0), 0);
  return (chartDates ?? []).map(date => ({
    date,
    volume: date === effectiveDate ? currentVolume : (totals[date] ?? 0),
  }));
}

// Full current-chain volume for one side/expiration. On the first encounter (or
// after a missed reporting day), backfill the window contract-by-contract. Normal
// daily runs hit the persisted range and append only the snapshot total, keeping the
// report within the same request budget as the former top-three bars.
async function buildCurrentChainRows(
  ticker,
  side,
  expirationDate,
  contracts,
  chartDates,
  effectiveDate,
  reportDate,
  dependencies = {},
) {
  const key = `${ticker}|${side}|${expirationDate}|current`;
  const symbols = uniqueSymbols((contracts ?? []).map(row => row.contractSymbol));
  const priorDates = (chartDates ?? []).filter(date => date < effectiveDate);
  const firstDate = priorDates[0] ?? effectiveDate;
  const lastDate = priorDates[priorDates.length - 1] ?? effectiveDate;
  const readEntry = dependencies.readEntry
    ?? (cacheKey => readPriorCache().chains[cacheKey]);
  const saveEntry = dependencies.saveEntry ?? savePriorChain;
  const fetchHistory = dependencies.fetchHistory ?? fetchDailyVolumeRequired;
  let entry = readEntry(key);
  const cachedSymbols = Array.isArray(entry?.symbols) ? uniqueSymbols(entry.symbols) : [];
  const covers = entry
    && Array.isArray(entry.symbols)
    && entry.rangeStart <= firstDate
    && entry.rangeEnd >= lastDate;
  let changed = false;

  if (!covers) {
    // Match fetchContractVolumeHistory's range exactly, so the top-three table rows
    // already in the in-run cache do not cost a second request during a backfill.
    const rangeStart = addDays(reportDate, -45);
    // Preserve contracts that were present earlier in the expiration's life even if
    // a later snapshot omits them; their historical volume still belongs in the bar.
    const trackedSymbols = uniqueSymbols([...cachedSymbols, ...symbols]);
    const histories = await mapLimit(
      trackedSymbols,
      PRIOR_CONCURRENCY,
      symbol => fetchHistory(symbol, rangeStart, reportDate),
    );
    const totals = sumDailyVolumes(histories);
    entry = {
      expiration: expirationDate,
      contractCount: symbols.length,
      symbols: trackedSymbols,
      rangeStart,
      // Only claim coverage through the snapshot's actual market session. The
      // report date can be a weekend or one calendar day ahead in Hong Kong.
      rangeEnd: effectiveDate,
      totals,
      coverage: priorDates.length
        ? priorDates.filter(date => Object.hasOwn(totals, date)).length / priorDates.length
        : 1,
      fetchedAt: new Date().toISOString(),
    };
    changed = true;
  } else {
    // Do not mutate an object held by a prior asynchronous storage write.
    entry = { ...entry, symbols: [...cachedSymbols], totals: { ...(entry.totals ?? {}) } };

    // Live chains routinely gain strikes. Backfill only the newly observed symbols;
    // a sorted symbol roster catches additions even when the total count is unchanged.
    const cachedSymbolSet = new Set(cachedSymbols);
    const addedSymbols = symbols.filter(symbol => !cachedSymbolSet.has(symbol));
    if (addedSymbols.length) {
      const histories = await mapLimit(
        addedSymbols,
        PRIOR_CONCURRENCY,
        symbol => fetchHistory(symbol, entry.rangeStart, reportDate),
      );
      addDailyTotals(entry.totals, sumDailyVolumes(histories));
      entry.symbols = uniqueSymbols([...cachedSymbols, ...addedSymbols]);
      changed = true;
    }
  }

  const currentVolume = (contracts ?? []).reduce((sum, row) => sum + (row.volume ?? 0), 0);
  if (entry.totals[effectiveDate] !== currentVolume
      || entry.contractCount !== symbols.length
      || entry.rangeEnd < effectiveDate) {
    entry.totals[effectiveDate] = currentVolume;
    entry.contractCount = symbols.length;
    if (entry.rangeEnd < effectiveDate) entry.rangeEnd = effectiveDate;
    entry.fetchedAt = new Date().toISOString();
    changed = true;
  }

  entry.coverage = priorDates.length
    ? priorDates.filter(date => Object.hasOwn(entry.totals, date)).length / priorDates.length
    : 1;

  if (changed) {
    entry.fetchedAt = new Date().toISOString();
    saveEntry(key, entry);
  }
  return currentRowsFromTotals(contracts, chartDates, effectiveDate, entry.totals);
}

// Total contract volume across the *entire* prior-cycle chain for this side — not
// the top three. The pairing says which past session each bar is compared with, so a
// point always sits above the bar it corresponds to. Sessions the chain never traded
// simply have no marker; whatever is available is drawn rather than dropping the
// series.
//
// A cached chain is re-paired rather than re-scraped: the pairing follows from the
// chain's expiration, which the cache records, so the sessions can be recomputed for
// nothing while the thousands of per-contract requests behind them are not.
async function buildPriorSeries(ticker, side, expirationDate, cycle, targetExpiry, dte, chartDates) {
  const key = `${ticker}|${side}|${expirationDate}|${cycle}`;

  try {
    let entry = readPriorCache().chains[key];
    let pairs = entry?.expiration
      ? await pairsForExpiry(ticker, expirationDate, entry.expiration, dte, chartDates)
      : [];
    const covers = pairs.length
      && entry.rangeStart <= pairs[0].date
      && entry.rangeEnd >= pairs[pairs.length - 1].date;

    if (!covers) {
      const scraped = await scrapePriorChain(
        ticker, side, expirationDate, targetExpiry, dte, chartDates,
      );
      if (!scraped) return null;
      ({ entry, pairs } = scraped);
      savePriorChain(key, entry);
    }

    const points = pairs
      .map(pair => ({ ...pair, volume: entry.totals[pair.date] }))
      .filter(point => point.volume > 0);
    if (!points.length) return null;

    return {
      expiration: entry.expiration,
      contractCount: entry.contractCount,
      points,
    };
  } catch (error) {
    console.warn(`[options-report] ${cycle} ${side} volume unavailable for ${ticker} ${expirationDate}: ${error.message}`);
    return null;
  }
}

// How many sessions each bar sits before the chain expires. The known leg (bar ->
// today) is read off the trading calendar the bars were drawn from; the unknown leg
// (today -> expiration) is counted in weekdays.
function sessionsToExpiry(chartDates, effectiveDate, expirationDate) {
  const forward = weekdaysUntil(effectiveDate, expirationDate);
  return chartDates.map((_, index) => forward + (chartDates.length - 1 - index));
}

// Which past session each bar is compared with, given the prior chain it is compared
// against. A bar sits N sessions before its own expiration, so its counterpart is the
// session N before the prior chain's expiration.
//
// Distance-to-expiry rather than distance-to-earnings, because the bars are the same
// ten sessions in every one of a ticker's expiration charts: an earnings-relative
// pairing therefore produces the identical past sessions in all of them, however
// differently each chain is placed around the call. INTC's Jul 15 and Jul 20 chains
// are five sessions apart in their lives — two days to run versus five — and now read
// history that far apart too. Earnings still decides *which* chain is compared (the
// prior expiry is picked at the same offset from its own call), so a chain that is
// "the weekly before earnings" stays that in every cycle.
function pairsFromSessions(sessions, priorExpiry, dte, chartDates) {
  // The expiration itself can fall on a non-trading day, so count back from the last
  // session on or before it.
  const upToExpiry = (sessions ?? []).filter(date => date <= priorExpiry);
  if (!upToExpiry.length) return [];
  const expiryIndex = upToExpiry.length - 1;

  return chartDates
    .map((barDate, index) => ({ barDate, index: expiryIndex - dte[index] }))
    .filter(pair => pair.index >= 0)
    .map(pair => ({ barDate: pair.barDate, date: upToExpiry[pair.index] }));
}

async function pairsForExpiry(ticker, expirationDate, priorExpiry, dte, chartDates) {
  const deepest = Math.max(...dte, 0);
  const sessions = await fetchSessions(ticker, addDays(priorExpiry, -(deepest * 2) - 30), priorExpiry)
    .catch(error => {
      console.warn(`[options-report] session calendar unavailable for ${ticker} to ${priorExpiry}: ${error.message}`);
      return [];
    });

  const pairs = pairsFromSessions(sessions, priorExpiry, dte, chartDates);
  if (pairs.length) return pairs;

  // No calendar to count back through (a rate-limit squeeze, usually). Shifting every
  // bar by the gap between the two expirations still lines the chains up on their own
  // expiries, to within the holidays that separate them, so a line is still drawn.
  const shift = daysBetween(priorExpiry, expirationDate);
  return chartDates.map(barDate => ({ barDate, date: addDays(barDate, -shift) }));
}

// Which chain each cycle compares against.
//
// The tracked expiration is placed at the same distance from its own earnings call in
// every cycle, so a chain that is "the weekly after earnings" stays that a quarter and
// a year ago. Options volume ramps into an earnings date, so comparing a chain that
// expires the day before the call with one that expired a week after it compares two
// different points of the ramp — and the calls move by a week or more most years, so
// a plain calendar shift lands on the wrong side of one often enough to matter.
//
// Returns null when the ticker's earnings dates can't be established, and the caller
// falls back to the plain 52-week calendar shift.
//
// The anchors (next / last-quarter / year-ago call dates) are a property of the
// ticker, not the expiration, but buildCycleAlignment runs once per expiration
// (3×/ticker). earningsDates.js already caches across days — weekly for the
// estimate, quarterly for settled history — so the daily job rarely hits the
// network here; this per-run memo just avoids re-reading and re-deriving the
// same anchors three times within a single run.
const earningsAnchorMemo = new Map();

function clearEarningsAnchorMemo() {
  earningsAnchorMemo.clear();
}

function memoizedEarningsAnchors(ticker) {
  if (!earningsAnchorMemo.has(ticker)) {
    const promise = getEarningsAnchors(ticker);
    // Don't let a rejection stick in the memo — a later expiration can retry.
    promise.catch(() => earningsAnchorMemo.delete(ticker));
    earningsAnchorMemo.set(ticker, promise);
  }
  return earningsAnchorMemo.get(ticker);
}

async function buildCycleAlignment(ticker, expirationDate) {
  let anchors;
  try {
    anchors = await memoizedEarningsAnchors(ticker);
  } catch (error) {
    console.warn(`[options-report] earnings dates unavailable for ${ticker}: ${error.message}`);
    return null;
  }
  if (!anchors?.next) return null;

  const expiryOffset = daysBetween(anchors.next, expirationDate);

  const alignment = {};
  for (const { key } of CYCLES) {
    const call = anchors[key];
    if (!call) continue;
    alignment[key] = { call, targetExpiry: addDays(call, expiryOffset) };
  }

  if (!Object.keys(alignment).length) return null;

  return { anchors, alignment };
}

// The pre-earnings-alignment behaviour, kept for tickers whose earnings dates can't
// be read: the year-ago line only, against the chain expiring 52 weeks earlier.
function fallbackAlignment(expirationDate) {
  return {
    anchors: null,
    alignment: {
      year: { call: null, targetExpiry: addDays(expirationDate, -YEAR_SHIFT_DAYS) },
    },
  };
}

function topByVolume(contracts) {
  return [...(contracts ?? [])]
    .filter(contract => (contract.volume ?? 0) > 0)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 3);
}

function contractLabel(row, side) {
  return `${side.toUpperCase()} ${fmtUsd(row.strike)}`;
}

function historyMap(history) {
  return new Map(history.map(day => [day.date, day.volume]));
}

async function fetchContractVolumeHistory(contractSymbol, reportDate) {
  const history = await fetchDailyVolume(contractSymbol, addDays(reportDate, -45), reportDate);
  return history.filter(row => row.date < reportDate);
}

// The aggregates endpoint emits no bar for a day a contract didn't trade, so the
// dates a contract *has* are not the days the market was *open*. Taking the axis
// from the contracts themselves therefore silently drops sessions and lets a chart
// collapse to three or four bars that look adjacent but are weeks apart. The
// underlying stock trades every session, so its bars give the true calendar.
const sessionCache = new Map();

async function fetchSessionsDirect(ticker, start, end) {
  const key = `${ticker}|${start}|${end}`;
  if (sessionCache.has(key)) return sessionCache.get(key);

  const promise = (async () => {
    const pathname = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${start}/${end}`;
    const resp = await massiveGet(pathname, { adjusted: 'true', sort: 'asc', limit: 5000 });
    return (resp.results ?? [])
      .map(row => new Date(row.t).toISOString().slice(0, 10))
      .filter(date => date >= start && date <= end)
      .sort();
  })();

  // A failed calendar must not be cached, and must not be swallowed into a
  // one-bar axis — the caller falls back to the contracts' own dates instead.
  promise.catch(() => sessionCache.delete(key));
  sessionCache.set(key, promise);
  return promise;
}

// Every ticker in the report is a US-listed equity, ADR or ETF, so they all
// trade the same NYSE/Nasdaq sessions: the set of open days in a date range is
// identical no matter which ticker we ask about. Rather than pay a Massive
// stock-aggregate call for each (ticker, range) pair — which, across ~80
// tickers × 3 expirations × the current axis + two prior-cycle pairings, is
// dozens of identical-answer calls — fetch the calendar ONCE per run from a
// single liquid reference symbol and slice it for everyone. Falls back to a
// direct per-ticker fetch whenever the shared calendar can't answer, so the
// behaviour is never worse than before.
const MARKET_CALENDAR_SYMBOL = process.env.OPTIONS_REPORT_CALENDAR_SYMBOL || 'SPY';
const MARKET_CALENDAR_LOOKBACK_DAYS = 460; // spans the year-ago prior-cycle pairings
let marketCalendar = null; // { start, end, sessions } for the current run

function resetMarketCalendar() {
  marketCalendar = null;
}

// Fetch the shared calendar for [reportDate-460d, reportDate] up front. A liquid
// ETF trades every session, so a short/empty result means the pull was throttled
// or the symbol isn't on the plan — don't cache a broken calendar for the whole
// run in that case, just leave callers on the per-ticker path.
async function primeMarketCalendar(reportDate) {
  const start = addDays(reportDate, -MARKET_CALENDAR_LOOKBACK_DAYS);
  try {
    const sessions = await fetchSessionsDirect(MARKET_CALENDAR_SYMBOL, start, reportDate);
    if (sessions.length > 30) marketCalendar = { start, end: reportDate, sessions };
    else console.warn(`[options-report] shared market calendar too sparse (${sessions.length} sessions) — using per-ticker calendars`);
  } catch (error) {
    console.warn(`[options-report] shared market calendar unavailable (${error.message}) — using per-ticker calendars`);
  }
}

async function fetchSessions(ticker, start, end) {
  // Serve from the shared calendar whenever it spans the requested range; the
  // answer is identical to a per-ticker fetch because the US calendar is shared.
  if (marketCalendar && start >= marketCalendar.start && end <= marketCalendar.end) {
    return marketCalendar.sessions.filter(date => date >= start && date <= end);
  }
  return fetchSessionsDirect(ticker, start, end);
}

async function fetchTradingDays(ticker, end, count) {
  const sessions = await fetchSessions(ticker, addDays(end, -(count * 3) - 10), end);
  // Today's own bar may not be published yet, but it is still the session the
  // report is about. Copy first: the cached array is shared.
  const days = [...sessions];
  if (!days.includes(end)) days.push(end);
  return days.slice(-count);
}

async function enrichExpirationData(data, reportDate, { skipPriors = false } = {}) {
  const allCalls = (data.calls ?? []).map(row => ({ ...row, side: 'call' }));
  const allPuts = (data.puts ?? []).map(row => ({ ...row, side: 'put' }));
  const topCalls = topByVolume(allCalls);
  const topPuts = topByVolume(allPuts);
  const rows = [...topCalls, ...topPuts];

  const histories = await Promise.all(rows.map(row => fetchContractVolumeHistory(row.contractSymbol, reportDate)));
  const historyBySymbol = new Map(rows.map((row, index) => [row.contractSymbol, histories[index]]));
  const historyMaps = new Map(rows.map(row => [row.contractSymbol, historyMap(historyBySymbol.get(row.contractSymbol) ?? [])]));
  const allHistoryDates = [...new Set(histories.flatMap(history => history.map(day => day.date)))].sort();
  const latestHistoryDate = allHistoryDates[allHistoryDates.length - 1] ?? null;
  const snapshotVolume = rows.reduce((sum, row) => sum + (row.volume ?? 0), 0);
  const latestHistoryVolume = latestHistoryDate
    ? rows.reduce((sum, row) => sum + (historyMaps.get(row.contractSymbol)?.get(latestHistoryDate) ?? 0), 0)
    : null;
  const effectiveDate = latestHistoryDate && latestHistoryVolume === snapshotVolume
    ? latestHistoryDate
    : reportDate;

  // Ten consecutive sessions, not ten days that happened to trade — a strike with
  // no trades on a session is a real zero, and belongs on the axis as one. If the
  // calendar can't be fetched, fall back to the dates the contracts themselves
  // traded rather than dropping to a single bar.
  const chartDates = await fetchTradingDays(data.ticker, effectiveDate, CHART_SESSIONS)
    .catch(error => {
      console.warn(`[options-report] trading calendar unavailable for ${data.ticker}: ${error.message}`);
      return [...allHistoryDates.filter(date => date < effectiveDate).slice(-(CHART_SESSIONS - 1)), effectiveDate];
    });
  const allPriorDates = chartDates.filter(date => date < effectiveDate);
  const previousDate = allPriorDates[allPriorDates.length - 1] ?? null;
  const averageDates = allPriorDates.slice(-5);

  function rowWithHistory(row) {
    const hMap = historyMaps.get(row.contractSymbol) ?? new Map();
    const todayVolume = row.volume ?? 0;
    const yesterdayVolume = previousDate ? (hMap.get(previousDate) ?? 0) : null;
    const avgBase = averageDates.length
      ? averageDates.reduce((sum, date) => sum + (hMap.get(date) ?? 0), 0) / averageDates.length
      : null;
    return {
      ...row,
      todayVolume,
      yesterdayVolume,
      dodPct: yesterdayVolume ? ((todayVolume - yesterdayVolume) / yesterdayVolume) * 100 : null,
      fiveDayMultiple: avgBase ? todayVolume / avgBase : null,
      contractLabel: contractLabel(row, row.side),
    };
  }

  const tableCalls = topCalls.map(rowWithHistory);
  const tablePuts = topPuts.map(rowWithHistory);

  // Stage-1 backfill of a newly tracked ticker draws bars + tables only, so it
  // skips the earnings-anchored prior cycles entirely — that leaves the whole
  // prior-chain scrape (thousands of Massive calls) and the Alpha Vantage
  // earnings lookup for the later line-plot pass. `nextEarnings` is null here,
  // so the chart carries no "next call" note until that pass runs.
  const { anchors, alignment } = skipPriors
    ? { anchors: null, alignment: {} }
    : ((await buildCycleAlignment(data.ticker, data.selectedDate))
      ?? fallbackAlignment(data.selectedDate));
  const dte = sessionsToExpiry(chartDates, effectiveDate, data.selectedDate);

  // One series per side per cycle. A cycle with no alignment (the fallback has no
  // last-quarter anchor) is simply absent from the chart.
  async function priorSeriesFor(side) {
    const series = await Promise.all(CYCLES.map(async cycle => {
      const aligned = alignment[cycle.key];
      if (!aligned) return null;
      const built = await buildPriorSeries(
        data.ticker, side, data.selectedDate, cycle.key, aligned.targetExpiry, dte, chartDates,
      );
      return built ? { ...cycle, ...built, call: aligned.call } : null;
    }));
    return series.filter(Boolean);
  }

  const seriesResults = await Promise.allSettled([
    skipPriors ? Promise.resolve([]) : priorSeriesFor('call'),
    skipPriors ? Promise.resolve([]) : priorSeriesFor('put'),
    buildCurrentChainRows(
      data.ticker, 'call', data.selectedDate, allCalls, chartDates, effectiveDate, reportDate,
    ),
    buildCurrentChainRows(
      data.ticker, 'put', data.selectedDate, allPuts, chartDates, effectiveDate, reportDate,
    ),
  ]);
  const seriesFailure = seriesResults.find(result => result.status === 'rejected');
  if (seriesFailure) throw seriesFailure.reason;
  const [priorCall, priorPut, currentCallRows, currentPutRows] = seriesResults.map(result => result.value);

  function chartFor(currentRows, color, softColor, priors, sideLabel) {
    return {
      rows: currentRows,
      color,
      softColor,
      priors,
      sideLabel,
      expiration: data.selectedDate,
      nextEarnings: anchors?.next ?? null,
    };
  }

  return {
    ...data,
    earnings: anchors,
    tableCalls,
    tablePuts,
    volumeCharts: {
      call: chartFor(currentCallRows, CALL_COLOR, CALL_SOFT, priorCall, 'calls'),
      put: chartFor(currentPutRows, PUT_COLOR, PUT_SOFT, priorPut, 'puts'),
    },
  };
}

function buildOiPoints(data, side) {
  const price = data?.price;
  if (price == null) return [];
  const low = price * 0.7;
  const high = price * 1.3;
  return [...(data?.[side] ?? [])]
    .filter(contract => {
      const strike = contract.strike;
      return strike != null && strike >= low && strike <= high;
    })
    .map(contract => ({
      x: Number(contract.strike),
      y: Number(contract.openInterest ?? 0),
    }))
    .sort((a, b) => a.x - b.x);
}

function pathFrom(points, scaleX, scaleY) {
  if (!points.length) return '';
  return points.map((point, index) => {
    const command = index === 0 ? 'M' : 'L';
    return `${command}${scaleX(point.x).toFixed(2)},${scaleY(point.y).toFixed(2)}`;
  }).join(' ');
}

function tickValues(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const values = [];
  for (let i = 0; i < count; i += 1) {
    values.push(min + ((max - min) * i) / (count - 1));
  }
  return values;
}

function buildChartSvg(data) {
  const calls = buildOiPoints(data, 'calls');
  const puts = buildOiPoints(data, 'puts');
  const points = [...calls, ...puts];

  if (!points.length) {
    return '<div class="empty-chart">No chart data</div>';
  }

  const width = 1000;
  const height = 360;
  const margin = { top: 22, right: 26, bottom: 46, left: 64 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const maxY = Math.max(1, ...points.map(point => point.y));
  const xPad = minX === maxX ? Math.max(1, minX * 0.04) : (maxX - minX) * 0.03;
  const xMin = minX - xPad;
  const xMax = maxX + xPad;

  const scaleX = value => margin.left + ((value - xMin) / (xMax - xMin)) * chartWidth;
  const scaleY = value => margin.top + chartHeight - (value / maxY) * chartHeight;
  const xTicks = tickValues(xMin, xMax, 6);
  const yTicks = tickValues(0, maxY, 5);
  const priceX = data.price != null ? scaleX(data.price) : null;
  const callPath = pathFrom(calls, scaleX, scaleY);
  const putPath = pathFrom(puts, scaleX, scaleY);

  return `
    <svg class="oi-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(data.ticker)} open interest by strike">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${yTicks.map(value => {
        const y = scaleY(value);
        return `
          <line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${width - margin.right}" y2="${y.toFixed(2)}" class="grid-line"></line>
          <text x="${margin.left - 12}" y="${(y + 4).toFixed(2)}" text-anchor="end" class="axis-text">${fmtNum(Math.round(value))}</text>
        `;
      }).join('')}
      ${xTicks.map(value => {
        const x = scaleX(value);
        return `
          <line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${height - margin.bottom}" class="grid-line faint"></line>
          <text x="${x.toFixed(2)}" y="${height - 16}" text-anchor="middle" class="axis-text">${fmtUsd(value)}</text>
        `;
      }).join('')}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="axis-line"></line>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="axis-line"></line>
      ${priceX != null ? `
        <line x1="${priceX.toFixed(2)}" y1="${margin.top}" x2="${priceX.toFixed(2)}" y2="${height - margin.bottom}" class="price-line"></line>
      ` : ''}
      ${callPath ? `<path d="${callPath}" class="series calls"></path>` : ''}
      ${putPath ? `<path d="${putPath}" class="series puts"></path>` : ''}
      ${calls.map(point => `<circle cx="${scaleX(point.x).toFixed(2)}" cy="${scaleY(point.y).toFixed(2)}" r="2.2" class="dot call-dot"></circle>`).join('')}
      ${puts.map(point => `<circle cx="${scaleX(point.x).toFixed(2)}" cy="${scaleY(point.y).toFixed(2)}" r="2.2" class="dot put-dot"></circle>`).join('')}
    </svg>
  `;
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
// Three labelled series stacked over ten sessions need real vertical room: a column
// can hold a bar's number plus a point from each cycle, and the plot area is what
// keeps them off each other. The width stays as it was — calls and puts sit two to a
// row, so widening the viewBox only shrinks the rendered height — so the extra room
// is bought entirely in height.
const CHART_WIDTH = 860;
const CHART_HEIGHT = 460;

// Vertical breathing room for the stacked direct labels in one column.
const LABEL_GAP = 24;
const LABEL_TOP = 40;

// The same chart markup is embedded in the dark web app and in the light
// standalone HTML/SVG exports, so its neutrals — muted text and the ring that
// separates a marker from whatever sits behind it — are left to the host
// stylesheet. Series colours stay inline: they are legible on either surface.
// The web app's dark values live alongside `.or-chart` in src/index.css.
const CHART_CSS_LIGHT = '.vc-muted{fill:#6b7280}.vc-faint{fill:#8b93a1}.vc-ring{stroke:#ffffff}'
  + '.vc-seam{stroke:#d5d8dd}';

function markerShape(marker, x, y, color, title = '') {
  const attrs = `fill="${color}" class="vc-ring" stroke-width="2"`;
  const tip = title ? `<title>${escapeHtml(title)}</title>` : '';
  if (marker === 'diamond') {
    const r = 5.4;
    const d = `M${x.toFixed(2)},${(y - r).toFixed(2)} L${(x + r).toFixed(2)},${y.toFixed(2)} `
      + `L${x.toFixed(2)},${(y + r).toFixed(2)} L${(x - r).toFixed(2)},${y.toFixed(2)} Z`;
    return `<path d="${d}" ${attrs}>${tip}</path>`;
  }
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.5" ${attrs}>${tip}</circle>`;
}

// Stack one column's direct labels so none lands on another, and so none comes to
// rest on a marker — a label pushed clear of the label below it can otherwise land on
// another series' marker, which is how a diamond ends up sitting inside "19.0k".
// Labels are placed lowest first and only ever move up, away from the bars.
//
// The two kinds of label dodge differently, because they are not equally free to
// move. A line's label is one of several stacked above a point that already has its
// own marker, so it clears any marker it touches at all ('edge'). A bar's label is
// tied to its bar — lifting it on a graze would drag the whole column's stack tens of
// pixels up and leave the tallest bar's number floating in space — so it only steps
// aside when a marker's centre would land in the digits themselves ('centre').
// Everything else is handled by the halo the labels are drawn with.
function stackLabels(entries, markers, fontSize) {
  const glyph = fontSize * 0.72;  // the band a number occupies above its own baseline
  const clear = 2;
  const bands = markers.map(y => ({ top: y - 6.5, bottom: y + 6.5, center: y }));

  const hits = (band, y, mode) => (mode === 'centre'
    ? band.center > y - glyph && band.center < y
    : band.bottom > y - glyph - clear && band.top < y + clear);

  const ordered = [...entries].sort((a, b) => b.desiredY - a.desiredY);
  let ceiling = Infinity;
  for (const entry of ordered) {
    let y = Math.min(entry.desiredY, ceiling);
    // Clearing one marker can push a label into the next, so keep lifting.
    for (let guard = 0; guard <= bands.length; guard += 1) {
      const hit = bands.find(band => hits(band, y, entry.dodge));
      if (!hit) break;
      y = hit.top - clear;
    }
    entry.labelY = Math.max(LABEL_TOP, y);
    ceiling = entry.labelY - LABEL_GAP;
  }
  return ordered;
}

// Bars and comparison lines all count the full call/put chain for their matched
// expiration, so they are the same quantity and share one scale: a point above a
// bar means that cycle traded more contracts that session, and heights compare
// across the whole plot. Cycles can be an order of magnitude apart, which is the
// comparison the chart exists to make — a quiet cycle drawn low is the finding,
// not a defect. Both absolute totals stay printed for the cases where it is.
function volumeChartBody(chart, width, height, fonts) {
  const rows = chart?.rows ?? [];
  if (!rows.length) {
    return `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="vc-muted" font-family="system-ui, sans-serif" font-size="14">No chart data</text>`;
  }

  const margin = { top: 100, right: 22, bottom: 46, left: 22 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const priors = chart.priors ?? [];
  const baseline = margin.top + chartHeight;

  const step = chartWidth / rows.length;
  const barWidth = Math.min(86, step * 0.7);
  const centerX = index => margin.left + (step * index) + (step / 2);

  // One scale for everything drawn: the tallest mark in the frame, whether it is a
  // bar or a comparison point, sets the top of the plot.
  const barIndexByDate = new Map(rows.map((row, index) => [row.date, index]));
  const plotMax = Math.max(
    1,
    ...rows.map(row => row.volume ?? 0),
    ...priors.flatMap(prior => prior.points.map(point => point.volume ?? 0)),
  );
  const scaleY = value => baseline - ((value / plotMax) * chartHeight);

  const series = priors.map(prior => ({
    ...prior,
    coords: prior.points.flatMap(point => {
      const index = barIndexByDate.get(point.barDate);
      if (index === undefined) return [];
      return { ...point, x: centerX(index), y: scaleY(point.volume ?? 0) };
    }),
  })).filter(prior => prior.coords.length);

  // Every session gets a bar, whether or not a line has a point above it — a session
  // the prior chain never traded says nothing about what these strikes did today.
  const barGeom = rows.map((row, index) => {
    const value = row.volume ?? 0;
    const barHeight = value > 0 ? Math.max(5, (value / plotMax) * chartHeight) : 5;
    return {
      value,
      isToday: index === rows.length - 1,
      date: row.date,
      x: centerX(index) - (barWidth / 2),
      top: baseline - barHeight,
      height: barHeight,
      center: centerX(index),
    };
  });

  const bars = barGeom.map(bar => `
    <rect x="${bar.x.toFixed(2)}" y="${bar.top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${bar.height.toFixed(2)}" rx="4" fill="${bar.isToday ? chart.color : chart.softColor}"></rect>
    <text x="${bar.center.toFixed(2)}" y="${height - 16}" text-anchor="middle" ${bar.isToday ? `fill="${chart.color}"` : 'class="vc-faint"'} font-family="${MONO}" font-size="${fonts.date}" font-weight="${bar.isToday ? '700' : '500'}">${fmtDateShort(bar.date)}</text>
  `).join('');

  const lines = series.map(prior => `
    <path d="${prior.coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}"
      fill="none" stroke="${prior.color}" stroke-width="2"${prior.dash ? ` stroke-dasharray="${prior.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"></path>
    ${prior.coords.map(p =>
      markerShape(prior.marker, p.x, p.y, prior.color, `${p.date}: ${fmtNum(p.volume)} contracts`),
    ).join('')}
  `).join('');

  // All value text is drawn last, over the marks, so a marker or a dash can never
  // sit on top of a number. Each column's labels are stacked together, and each is
  // knocked out of whatever it sits on with a halo in the surface colour — with
  // three series a line passes behind a number often enough that without it the
  // digits read as struck through.
  const labels = barGeom.map((bar, index) => {
    const columnPoints = series.flatMap(prior => {
      const point = prior.coords.find(p => barIndexByDate.get(p.barDate) === index);
      return point ? { ...point, color: prior.color } : [];
    });
    const entries = [
      {
        desiredY: bar.top - 9,
        x: bar.center,
        text: fmtShort(bar.value),
        fill: bar.isToday ? chart.color : null,
        cls: bar.isToday ? 'vc-ring' : 'vc-muted vc-ring',
        weight: bar.isToday ? '800' : '700',
        dodge: 'centre',
      },
      ...columnPoints.map(point => ({
        desiredY: point.y - 12,
        x: point.x,
        text: fmtShort(point.volume ?? 0),
        fill: point.color,
        cls: 'vc-ring',
        weight: '700',
        dodge: 'edge',
      })),
    ];
    return stackLabels(entries, columnPoints.map(p => p.y), fonts.value).map(entry =>
      `<text x="${entry.x.toFixed(2)}" y="${entry.labelY.toFixed(2)}" text-anchor="middle" class="${entry.cls}"`
      + `${entry.fill ? ` fill="${entry.fill}"` : ''} paint-order="stroke" stroke-width="3.5" stroke-linejoin="round"`
      + ` font-family="${MONO}" font-size="${fonts.value}" font-weight="${entry.weight}">${entry.text}</text>`,
    ).join('');
  }).join('');

  // Each series is named by the expiration whose chain it sums, so the legend says
  // outright which chains are being held against each other — the one thing a reader
  // otherwise has to take on trust, and the thing that differs between two charts of
  // the same ticker drawn over the same ten sessions.
  const side = chart.sideLabel ?? 'contracts';
  const expiryName = date => (date ? fmtExpiryShort(date, chart.expiration) : `All ${side}`);
  const legendText = (x, text) =>
    `<text x="${x.toFixed(2)}" y="20" class="vc-muted" font-family="${MONO}" font-size="${fonts.legend}" font-weight="600">${escapeHtml(text)}</text>`;
  // Monospace, so a character advance is a reliable ~0.6em — no measuring needed.
  const textWidth = text => text.length * fonts.legend * 0.6;

  let cursor = margin.left;
  const currentLabel = `${expiryName(chart.expiration)}, current`;
  const legendItems = [
    `<rect x="${cursor}" y="8" width="12" height="9" rx="2" fill="${chart.color}"></rect>`
    + legendText(cursor + 19, currentLabel),
  ];
  cursor += 19 + textWidth(currentLabel) + 26;

  for (const prior of series) {
    const label = `${expiryName(prior.expiration)}, ${prior.label}`;
    legendItems.push(`
      <line x1="${cursor}" y1="16" x2="${cursor + 26}" y2="16" stroke="${prior.color}" stroke-width="2"${prior.dash ? ` stroke-dasharray="${prior.dash}"` : ''}></line>
      ${markerShape(prior.marker, cursor + 13, 16, prior.color)}
      ${legendText(cursor + 33, label)}
    `);
    cursor += 33 + textWidth(label) + 26;
  }

  // Says what the lines are aligned on: every point sits the same number of sessions
  // from its own expiration as the bar beneath it sits from this one, and the chains
  // themselves are matched around each cycle's earnings call. The note shares the
  // legend's row, so it drops detail from the front as the legend eats the width. No
  // scale caveat any more — the lines are on the bars' scale.
  let note = '';
  if (series.length) {
    const room = width - margin.right - cursor - 12;
    const date = chart.nextEarnings ? fmtDateShort(chart.nextEarnings) : null;
    const text = [
      date ? `matched by days to expiry · next call ${date}` : 'matched by days to expiry',
      date ? `next call ${date}` : null,
    ].find(candidate => candidate && textWidth(candidate) <= room);
    if (text) {
      note = `<text x="${width - margin.right}" y="20" text-anchor="end" class="vc-faint" font-family="${MONO}" font-size="${fonts.legend}" font-weight="600">${escapeHtml(text)}</text>`;
    }
  }

  return `${legendItems.join('')}${note}${bars}${lines}${labels}`;
}

function buildVolumeChartSvg(chart) {
  if (!chart?.rows?.length) return '<div class="empty-chart">No chart data</div>';
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  return `
    <svg class="volume-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="total daily chain volume for the current, previous-quarter, and prior-year earnings cycles">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${volumeChartBody(chart, width, height, { value: 17, date: 14, legend: 12 })}
    </svg>
  `;
}

function buildVolumeChartLayer(chart, width, height) {
  return volumeChartBody(chart, width, height, { value: 16, date: 15, legend: 13 });
}

function tableCellText(value, x, y, anchor = 'end', color = '#374151', weight = '500') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="${weight}">${escapeHtml(value)}</text>`;
}

function buildPanelSvg(data, side) {
  const chart = data.volumeCharts?.[side];
  const rows = side === 'call' ? (data.tableCalls ?? []) : (data.tablePuts ?? []);
  const typeColor = side === 'call' ? CALL_COLOR : PUT_COLOR;
  const width = 900;
  const chartHeight = CHART_HEIGHT;
  const tableY = chartHeight + 18;
  const headerH = 32;
  const rowH = 34;
  const visibleRows = rows.length ? rows : [null];
  const tableHeight = headerH + (visibleRows.length * rowH);
  const height = tableY + tableHeight + 12;
  const columns = [
    { label: 'Type', width: 82, align: 'start' },
    { label: 'Strike', width: 110 },
    { label: 'Today', width: 112 },
    { label: 'Yest.', width: 112 },
    { label: 'Delta DoD', width: 105 },
    { label: 'x5D Avg', width: 105 },
    { label: 'Vol/OI', width: 105 },
    { label: 'IV', width: 85 },
    { label: 'Money', width: 84, align: 'middle' },
  ];

  let x = 0;
  const header = columns.map(col => {
    const textX = col.align === 'start' ? x + 10 : col.align === 'middle' ? x + (col.width / 2) : x + col.width - 10;
    const anchor = col.align === 'start' ? 'start' : col.align === 'middle' ? 'middle' : 'end';
    const out = tableCellText(col.label, textX.toFixed(2), tableY + 21, anchor, '#6b7280', '700');
    x += col.width;
    return out;
  }).join('');

  const body = visibleRows.map((row, rowIndex) => {
    const y = tableY + headerH + (rowIndex * rowH);
    const textY = y + 22;
    if (!row) {
      return `
        <line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e5e7eb"></line>
        ${tableCellText('-', 10, textY, 'start', '#6b7280', '500')}
      `;
    }
    const values = [
      { value: row.side.toUpperCase(), color: typeColor, weight: '800', align: 'start' },
      { value: fmtUsd(row.strike) },
      { value: fmtNum(row.todayVolume) },
      { value: fmtNum(row.yesterdayVolume) },
      { value: fmtDeltaPct(row.todayVolume, row.yesterdayVolume) },
      { value: fmtX(row.fiveDayMultiple) },
      { value: fmtX(row.openInterest ? row.todayVolume / row.openInterest : null) },
      { value: fmtIv(row.impliedVolatility) },
      { value: row.inTheMoney ? 'ITM' : 'OTM', align: 'middle' },
    ];
    let cellX = 0;
    const cells = values.map((cell, index) => {
      const col = columns[index];
      const align = cell.align ?? col.align;
      const textX = align === 'start' ? cellX + 10 : align === 'middle' ? cellX + (col.width / 2) : cellX + col.width - 10;
      const anchor = align === 'start' ? 'start' : align === 'middle' ? 'middle' : 'end';
      const out = tableCellText(cell.value, textX.toFixed(2), textY, anchor, cell.color ?? '#374151', cell.weight ?? '500');
      cellX += col.width;
      return out;
    }).join('');
    return `
      <line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e5e7eb"></line>
      ${cells}
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(data.ticker)} ${side} option volume and table">
    <style>${CHART_CSS_LIGHT}</style>
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${buildVolumeChartLayer(chart, width, chartHeight)}
    <rect x="0" y="${tableY}" width="${width}" height="${tableHeight}" fill="#ffffff"></rect>
    <line x1="0" y1="${tableY}" x2="${width}" y2="${tableY}" stroke="#d1d5db"></line>
    ${header}
    ${body}
    <line x1="0" y1="${tableY + tableHeight}" x2="${width}" y2="${tableY + tableHeight}" stroke="#e5e7eb"></line>
  </svg>`;
}

function buildStandaloneChartSvg(data, side) {
  const chart = buildVolumeChartSvg(data.volumeCharts?.[side]).trim();

  if (!chart.startsWith('<svg')) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeHtml(data.ticker)} daily contract volume"><rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#ffffff"/><text x="${CHART_WIDTH / 2}" y="${CHART_HEIGHT / 2}" text-anchor="middle" fill="#6b7280" font-family="system-ui, sans-serif" font-size="14">No chart data</text></svg>`;
  }

  return chart
    .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" `)
    .replace('>', `><style>${CHART_CSS_LIGHT}</style>`);
}

function renderRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="8" class="empty-cell">-</td></tr>';
  }
  return rows.map(row => `
    <tr>
      <td><span class="contract-side ${row.side}">${row.side.toUpperCase()}</span> <strong>${fmtUsd(row.strike)}</strong></td>
      <td>${fmtNum(row.todayVolume)}</td>
      <td>${fmtNum(row.yesterdayVolume)}</td>
      <td>${fmtDeltaPct(row.todayVolume, row.yesterdayVolume)}</td>
      <td>${fmtX(row.fiveDayMultiple)}</td>
      <td>${fmtX(row.openInterest ? row.todayVolume / row.openInterest : null)}</td>
      <td>${fmtIv(row.impliedVolatility)}</td>
      <td>${row.inTheMoney ? 'ITM' : 'OTM'}</td>
    </tr>
  `).join('');
}

function renderContractTable(label, rows) {
  return `
    <div class="table-block ${label.toLowerCase()}">
      <h3>${escapeHtml(label)}</h3>
      <table>
        <thead>
          <tr>
            <th>Contract</th>
            <th>Today</th>
            <th>Yest.</th>
            <th>Δ DoD</th>
            <th>×5D Avg</th>
            <th>Vol/OI</th>
            <th>IV</th>
            <th>Money</th>
          </tr>
        </thead>
        <tbody>${renderRows(rows)}</tbody>
      </table>
    </div>
  `;
}

function renderExpirationBlock(data) {
  return `
    <div class="expiration-block">
      <h2>${escapeHtml(fmtExpiry(data.selectedDate))}</h2>
      <div class="tables">
        <div>
          ${buildVolumeChartSvg(data.volumeCharts?.call)}
          ${renderContractTable('Calls', data.tableCalls ?? [])}
        </div>
        <div>
          ${buildVolumeChartSvg(data.volumeCharts?.put)}
          ${renderContractTable('Puts', data.tablePuts ?? [])}
        </div>
      </div>
    </div>
  `;
}

function renderTickerSection(tickerReport) {
  const nearest = tickerReport.expirations[0];
  const change = fmtChange(nearest?.priceChange, nearest?.changePct);
  return `
    <section class="ticker-section">
      <header class="ticker-header">
        <div>
          <h1>${escapeHtml(tickerReport.ticker)}</h1>
          <div class="ticker-meta">
            <span>${fmtUsd(nearest?.price)}</span>
            ${change ? `<span class="${nearest.priceChange >= 0 ? 'up' : 'down'}">${escapeHtml(change)}</span>` : ''}
          </div>
        </div>
      </header>
      ${tickerReport.expirations.map(renderExpirationBlock).join('')}
    </section>
  `;
}

function renderHtml(report) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Daily Options Data</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --soft: #f9fafb;
      --calls: ${CALL_COLOR};
      --puts: ${PUT_COLOR};
      --price: ${PRICE_COLOR};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.35;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 28px 64px;
    }
    .report-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .report-header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 750;
      letter-spacing: 0;
    }
    .report-date {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .ticker-section {
      padding: 34px 0 42px;
      border-bottom: 1px solid var(--line);
      min-height: 100vh;
    }
    .ticker-section:last-child { border-bottom: 0; }
    .ticker-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 14px;
    }
    .ticker-header h1 {
      margin: 0;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .ticker-meta {
      display: flex;
      gap: 10px;
      color: var(--muted);
      font-size: 14px;
      margin-top: 2px;
    }
    .up { color: var(--calls); }
    .down { color: var(--puts); }
    .legend {
      display: flex;
      gap: 14px;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 5px;
      white-space: nowrap;
    }
    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .legend i {
      width: 20px;
      height: 3px;
      display: inline-block;
      border-radius: 999px;
    }
    .call-key { background: var(--calls); }
    .put-key { background: var(--puts); }
    .price-key { background: var(--price); }
    ${CHART_CSS_LIGHT}
    .oi-chart,
    .volume-chart {
      width: 100%;
      height: auto;
      display: block;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      margin-bottom: 26px;
    }
    .grid-line {
      stroke: #e5e7eb;
      stroke-width: 1;
    }
    .grid-line.faint { stroke: #f1f5f9; }
    .axis-line {
      stroke: #9ca3af;
      stroke-width: 1;
    }
    .axis-text {
      fill: #6b7280;
      font-size: 11px;
    }
    .series {
      fill: none;
      stroke-width: 2.6;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .series.calls { stroke: var(--calls); }
    .series.puts { stroke: var(--puts); }
    .dot { stroke: white; stroke-width: 1; }
    .call-dot { fill: var(--calls); }
    .put-dot { fill: var(--puts); }
    .price-line {
      stroke: var(--price);
      stroke-width: 1.4;
      stroke-dasharray: 5 5;
    }
    .expiration-block {
      padding: 16px 0 22px;
      border-bottom: 1px solid var(--line);
    }
    .expiration-block:last-child { border-bottom: 0; }
    .expiration-block h2 {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .tables {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    .table-block h3 {
      margin: 0 0 7px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .table-block.calls h3 { color: var(--calls); }
    .table-block.puts h3 { color: var(--puts); }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12px;
      background: var(--soft);
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 8px 9px;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      color: var(--muted);
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
    }
    th:first-child, td:first-child { text-align: left; }
    tr:last-child td { border-bottom: 0; }
    .empty-cell { color: var(--muted); text-align: center; }
    .contract-side {
      font-weight: 800;
      margin-right: 5px;
    }
    .contract-side.call { color: var(--calls); }
    .contract-side.put { color: var(--puts); }
    .empty-chart {
      padding: 120px 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      text-align: center;
      margin-bottom: 26px;
    }
    @media (max-width: 860px) {
      main { padding: 20px 16px 48px; }
      .ticker-section { min-height: auto; }
      .report-header, .ticker-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .tables { grid-template-columns: 1fr; }
      .legend { flex-wrap: wrap; }
    }
    @media print {
      main { max-width: none; padding: 18px; }
      .ticker-section {
        min-height: auto;
        page-break-before: always;
      }
      .ticker-section:first-of-type { page-break-before: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header class="report-header">
      <h1>Daily Options Data</h1>
      <div class="report-date">${escapeHtml(report.date)}</div>
    </header>
    ${report.tickers.map(renderTickerSection).join('')}
  </main>
</body>
</html>
`;
}

function mdTable(rows) {
  const header = '| Type | Strike | Today | Yest. | Δ DoD | ×5D Avg | Vol/OI | IV | Money |';
  const rule = '|:---|---:|---:|---:|---:|---:|---:|---:|:---|';
  if (!rows.length) return `${header}\n${rule}\n| - | - | - | - | - | - | - | - | - |`;

  const body = rows.map(row => {
    const color = row.side === 'call' ? CALL_COLOR : PUT_COLOR;
    return [
      `<span style="color:${color};font-weight:700">${row.side.toUpperCase()}</span>`,
      fmtUsd(row.strike),
      fmtNum(row.todayVolume),
      fmtNum(row.yesterdayVolume),
      fmtDeltaPct(row.todayVolume, row.yesterdayVolume),
      fmtX(row.fiveDayMultiple),
      fmtX(row.openInterest ? row.todayVolume / row.openInterest : null),
      fmtIv(row.impliedVolatility),
      row.inTheMoney ? 'ITM' : 'OTM',
    ].map(escapeMd).join(' | ');
  });

  return `${header}\n${rule}\n${body.map(row => `| ${row} |`).join('\n')}`;
}

function chartAndTableBlock(ticker, expiration, side, assetsDirName, chartName, rows) {
  const sideName = side === 'call' ? 'calls' : 'puts';
  return `![${ticker} ${expiration.selectedDate} ${sideName} volume and table](${assetsDirName}/${chartName})\n`;
}

function renderMarkdown(report, outPath) {
  const baseName = path.basename(outPath, path.extname(outPath));
  const assetsDirName = `${baseName}-assets`;
  const assetsDir = path.join(path.dirname(outPath), assetsDirName);
  fs.mkdirSync(assetsDir, { recursive: true });

  const lines = [`# Daily Options Data ${report.date}`, ''];

  for (const tickerReport of report.tickers) {
    const nearest = tickerReport.expirations[0];
    const change = fmtChange(nearest?.priceChange, nearest?.changePct);
    const tickerTitle = [`## ${tickerReport.ticker}`, fmtUsd(nearest?.price), change].filter(Boolean).join(' ');

    lines.push(tickerTitle);
    lines.push('');

    for (const expiration of tickerReport.expirations) {
      const callChartName = `${tickerReport.ticker.toLowerCase()}-${expiration.selectedDate}-calls-volume.svg`;
      const putChartName = `${tickerReport.ticker.toLowerCase()}-${expiration.selectedDate}-puts-volume.svg`;
      const callChartPath = path.join(assetsDir, callChartName);
      const putChartPath = path.join(assetsDir, putChartName);
      fs.writeFileSync(callChartPath, buildPanelSvg(expiration, 'call'));
      fs.writeFileSync(putChartPath, buildPanelSvg(expiration, 'put'));

      lines.push(`### ${fmtExpiry(expiration.selectedDate)}`);
      lines.push('');
      lines.push(chartAndTableBlock(tickerReport.ticker, expiration, 'call', assetsDirName, callChartName, expiration.tableCalls ?? []));
      lines.push(chartAndTableBlock(tickerReport.ticker, expiration, 'put', assetsDirName, putChartName, expiration.tablePuts ?? []));
      lines.push('');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

async function fetchTickerReport(ticker, reportDate, maxExpirations = EXPIRATION_COUNT, options = {}) {
  const first = await getOptionsData(ticker);
  const expirations = (first.expirations ?? []).slice(0, maxExpirations);
  const byDate = [];

  for (const expiration of expirations) {
    const startedAt = Date.now();
    console.log(`[options-report] ${ticker} ${expiration} start`);
    try {
      let data;
      if (expiration === first.selectedDate) {
        data = first;
      } else {
        data = await getOptionsData(ticker, expiration);
      }
      byDate.push(await enrichExpirationData(data, reportDate, options));
      console.log(`[options-report] ${ticker} ${expiration} done (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    } finally {
      persistPriorCache();
    }
  }

  return {
    ticker: first.ticker,
    expirations: byDate,
  };
}

async function generateDailyOptionsReport({
  date = today(), tickers = DEFAULT_TICKERS, out = null, format = null,
  maxExpirations = EXPIRATION_COUNT, skipPriors = false, onTickerDone = null,
} = {}) {
  const outPath = path.resolve(out ?? `daily-options-data-${date}.html`);
  const outputFormat = format ?? (path.extname(outPath).toLowerCase() === '.md' ? 'md' : 'html');
  const tickerReports = [];

  // Fetch the shared US trading calendar once for the whole run (see
  // fetchSessions). skipPriors runs don't draw prior-cycle lines but still need
  // the current axis, so this helps them too. Reset first so a long-lived server
  // process picks up each new trading day rather than reusing yesterday's.
  resetMarketCalendar();
  clearEarningsAnchorMemo();
  await primeMarketCalendar(date);

  try {
    for (const ticker of tickers) {
      const startedAt = Date.now();
      console.log(`[options-report] ${ticker} start`);
      try {
        tickerReports.push(await fetchTickerReport(ticker, date, maxExpirations, { skipPriors }));
        console.log(`[options-report] ${ticker} done (${Math.round((Date.now() - startedAt) / 1000)}s)`);
        // Publish the partial report so a long scrape doesn't leave the site with
        // nothing until every ticker finishes — see writeDailyReport in
        // optionsReportStore.js for the atomic-overwrite write this feeds.
        if (onTickerDone) await onTickerDone({ date, tickers: [...tickerReports] });
      } finally {
        // Persist after every ticker so a late failure does not make the next run
        // repeat all completed full-chain backfills.
        persistPriorCache();
        // Histories are memoized only to share work across one ticker's three
        // expirations. Persistent aggregate totals carry the useful state between
        // runs, so retaining thousands of per-contract arrays would only leak memory
        // in the long-running server process.
        dailyVolumeCache.clear();
        priorChainCache.clear();
        sessionCache.clear();
      }
    }
  } finally {
    // Keep successfully completed chain backfills even if a later ticker fails; the
    // next run can resume from them instead of starting the migration over.
    persistPriorCache();
  }

  const report = { date, tickers: tickerReports };
  const content = outputFormat === 'md'
    ? renderMarkdown(report, outPath)
    : renderHtml(report);
  fs.writeFileSync(outPath, content);

  return { outPath, format: outputFormat, report, content };
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await generateDailyOptionsReport(args);
  console.log(result.outPath);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

// Sum the latest two full-chain chart bars across every tracked expiration, split
// by side, so the sidebar's surge signal measures the same volume the charts show.
// The detail tables intentionally remain top-three and are no longer used here.
function aggregateFlow(tickerReport) {
  const flow = { callToday: 0, callYesterday: 0, putToday: 0, putYesterday: 0 };
  for (const exp of tickerReport.expirations ?? []) {
    for (const [side, todayKey, yesterdayKey] of [
      ['call', 'callToday', 'callYesterday'],
      ['put', 'putToday', 'putYesterday'],
    ]) {
      const rows = exp.volumeCharts?.[side]?.rows ?? [];
      if (rows.length < 2) continue;
      flow[todayKey] += rows[rows.length - 1]?.volume ?? 0;
      flow[yesterdayKey] += rows[rows.length - 2]?.volume ?? 0;
    }
  }
  return flow;
}

// The Alerts sidebar shows one dot for each of the last three sessions in the
// front expiration, colored by the day-over-day change in the call/put
// volume spread (see flowDotSide in Alerts.jsx). That comparison needs the
// session before the earliest shown day too, so this returns one extra day
// of buffer — count=4, not the 3 actually displayed.
function nearestExpirationFlowDays(tickerReport, count = 4) {
  const nearest = tickerReport.expirations?.[0];
  if (!nearest) return [];

  const byDate = new Map();
  function addRows(rows, key) {
    for (const row of rows ?? []) {
      if (!row?.date) continue;
      const entry = byDate.get(row.date) ?? { date: row.date, callVolume: 0, putVolume: 0 };
      entry[key] = Number(row.volume ?? 0);
      byDate.set(row.date, entry);
    }
  }

  addRows(nearest.volumeCharts?.call?.rows, 'callVolume');
  addRows(nearest.volumeCharts?.put?.rows, 'putVolume');

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-count)
    .map(day => {
      const netVolume = day.callVolume - day.putVolume;
      return {
        ...day,
        netVolume,
        leader: netVolume > 0 ? 'call' : netVolume < 0 ? 'put' : 'flat',
      };
    });
}

function structuredContractRow(row) {
  return {
    side: row.side,
    strike: fmtUsd(row.strike),
    today: fmtNum(row.todayVolume),
    yesterday: fmtNum(row.yesterdayVolume),
    dod: fmtDeltaPct(row.todayVolume, row.yesterdayVolume),
    fiveDay: fmtX(row.fiveDayMultiple),
    volOi: fmtX(row.openInterest ? row.todayVolume / row.openInterest : null),
    iv: fmtIv(row.impliedVolatility),
    money: row.inTheMoney ? 'ITM' : 'OTM',
  };
}

// Build a self-contained JSON payload (titles + embedded SVG charts + formatted
// table cells) so the web app can render the report natively — no PDF, no
// external asset files — and it persists cheaply in Mongo, keyed by date.
function buildStructuredReport(report, { generatedAt = new Date().toISOString(), timeZone = null } = {}) {
  return {
    date: report.date,
    generatedAt,
    timeZone,
    tickers: (report.tickers ?? []).map(tickerReport => {
      const nearest = tickerReport.expirations?.[0];
      return {
        ticker: tickerReport.ticker,
        priceText: fmtUsd(nearest?.price),
        change: fmtChange(nearest?.priceChange, nearest?.changePct),
        priceChange: nearest?.priceChange ?? null,
        // Raw call/put volume totals still drive the sidebar sort; flowDays drives
        // the three call-vs-put direction dots for the front expiration.
        flow: aggregateFlow(tickerReport),
        flowExpiration: nearest?.selectedDate ?? null,
        flowDays: nearestExpirationFlowDays(tickerReport),
        expirations: (tickerReport.expirations ?? []).map(exp => ({
          selectedDate: exp.selectedDate,
          expiryLabel: fmtExpiry(exp.selectedDate),
          callChartSvg: buildVolumeChartSvg(exp.volumeCharts?.call).trim(),
          putChartSvg: buildVolumeChartSvg(exp.volumeCharts?.put).trim(),
          tableCalls: (exp.tableCalls ?? []).map(structuredContractRow),
          tablePuts: (exp.tablePuts ?? []).map(structuredContractRow),
        })),
      };
    }),
  };
}

module.exports = {
  CYCLES,
  DEFAULT_TICKERS,
  LABEL_GAP,
  PRIOR_BLOB,
  aggregateFlow,
  buildCurrentChainRows,
  buildStructuredReport,
  buildVolumeChartSvg,
  currentRowsFromTotals,
  generateDailyOptionsReport,
  nearestExpirationFlowDays,
  pairsFromSessions,
  renderHtml,
  renderMarkdown,
  sessionsToExpiry,
  sumDailyVolumes,
  today,
};
