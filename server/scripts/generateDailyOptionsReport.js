'use strict';

const fs = require('fs');
const path = require('path');
const storage = require('../storage');
const { getOptionsData } = require('../scrapers/options');
const { getEarningsAnchors } = require('../earningsDates');

// Prior-cycle chain volume is settled history — it can never change — so it is
// scraped once and kept. Each chain is fetched with months of forward headroom,
// so as the ten-session window slides forward day by day it keeps landing inside
// an already-stored range and the daily run scrapes only today.
// NOTE: this blob must stay registered in server.js STORAGE_BLOBS, or init()
// won't preload it from Mongo and every restart re-scrapes from an empty file.
const PRIOR_BLOB = {
  name: 'optionsPriorYearVolume',
  file: path.join(__dirname, '..', 'data', 'optionsPriorYearVolume.json'),
};
const PRIOR_LOOKAHEAD_DAYS = 120;
const PRIOR_CACHE_MAX = 600;

const DEFAULT_TICKERS = ['TSM', 'ASML', 'INTC', 'TXN', 'STM', 'TEL', 'GOOG', 'NOK', 'SOXX'];
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

// Sessions between today and an earnings call that hasn't happened yet can't be
// read off a calendar that doesn't exist yet, so the forward leg is counted in
// weekdays. A market holiday inside that window would overstate it by one session;
// the alternative — a hard-coded holiday table — goes stale silently, and being one
// session out shifts every point of both lines equally, which does not change the
// comparison the chart is making.
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
  await Promise.all(workers);
  return out;
}

// Several of a ticker's expirations routinely resolve to the *same* year-ago chain
// (a monthly-only name like STM maps all three to 2025-07-18), so the identical
// per-contract history would otherwise be fetched once per expiration. Memoising
// for the run keeps us well under the per-minute cap.
const dailyVolumeCache = new Map();

async function fetchDailyVolume(contractSymbol, start, end) {
  if (!contractSymbol) return [];
  const key = `${contractSymbol}|${start}|${end}`;
  if (dailyVolumeCache.has(key)) return dailyVolumeCache.get(key);

  const promise = (async () => {
    const pathname = `/v2/aggs/ticker/${encodeURIComponent(contractSymbol)}/range/1/day/${start}/${end}`;
    try {
      const resp = await massiveGet(pathname, { adjusted: 'true', sort: 'asc', limit: 5000 });
      return (resp.results ?? [])
        .map(row => ({ date: new Date(row.t).toISOString().slice(0, 10), volume: row.v ?? 0 }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
      console.warn(`[options-report] history unavailable for ${contractSymbol}: ${error.message}`);
      dailyVolumeCache.delete(key);
      return [];
    }
  })();

  dailyVolumeCache.set(key, promise);
  return promise;
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
  storage.write(PRIOR_BLOB.name, PRIOR_BLOB.file, blob);
}

// One scrape of a prior-cycle chain, summed to a date -> volume map. The window runs
// months past the dates needed today: the range costs nothing extra per contract
// (it is one aggregates call either way), and it buys every later run a cache hit.
//
// Candidates are tried nearest-expiration first and the search stops at the first one
// that actually traded through the sessions being compared, so a chain that had not
// been listed yet back then does not win on calendar proximity alone. If none clears
// the bar, the best-covered candidate is kept anyway — that is the honest answer, and
// caching it stops the next run from re-scraping the same dead chains.
async function scrapePriorChain(ticker, side, targetExpiry, firstDate, lastDate, neededDates) {
  const candidates = await fetchPriorChains(ticker, side, targetExpiry);
  if (!candidates?.length) return null;

  const rangeStart = addDays(firstDate, -5);
  const lookahead = addDays(lastDate, PRIOR_LOOKAHEAD_DAYS);
  const rangeEnd = lookahead < today() ? lookahead : today();

  let best = null;
  for (const chain of candidates.slice(0, MAX_CHAIN_CANDIDATES)) {
    const histories = await mapLimit(
      chain.contracts,
      PRIOR_CONCURRENCY,
      symbol => fetchDailyVolume(symbol, rangeStart, rangeEnd),
    );

    const totals = {};
    for (const history of histories) {
      for (const day of history) {
        totals[day.date] = (totals[day.date] ?? 0) + day.volume;
      }
    }

    const covered = neededDates.filter(date => totals[date] > 0).length;
    const entry = {
      expiration: chain.expiration,
      contractCount: chain.contracts.length,
      rangeStart,
      rangeEnd,
      totals,
      coverage: neededDates.length ? covered / neededDates.length : 0,
      fetchedAt: new Date().toISOString(),
    };

    if (!best || entry.coverage > best.coverage) best = entry;
    if (entry.coverage >= MIN_CHAIN_COVERAGE) break;
  }

  return best;
}

// Total contract volume across the *entire* prior-cycle chain for this side — not
// the top three. `pairs` already says which past session each bar is compared with,
// so a point always sits above the bar it corresponds to. Sessions the chain never
// traded simply have no marker; whatever is available is drawn rather than dropping
// the series.
async function buildPriorSeries(ticker, side, expirationDate, cycle, pairs, targetExpiry) {
  if (!pairs.length) return null;
  const neededDates = pairs.map(pair => pair.date);
  const firstDate = neededDates[0];
  const lastDate = neededDates[neededDates.length - 1];
  const key = `${ticker}|${side}|${expirationDate}|${cycle}`;

  try {
    let entry = readPriorCache().chains[key];
    const covers = entry && entry.rangeStart <= firstDate && entry.rangeEnd >= lastDate;

    // An entry cached before candidate selection existed carries no `coverage`. If it
    // also misses most of the sessions being compared, it is a chain that was picked
    // on calendar proximity alone and never traded through the window — re-resolve it
    // once against the neighbours. An entry that *has* a coverage figure has already
    // been through that search, so a low one is the real answer and is left alone.
    const guessed = covers && entry.coverage === undefined
      && neededDates.filter(date => (entry.totals[date] ?? 0) > 0).length
         < neededDates.length * MIN_CHAIN_COVERAGE;

    if (!covers || guessed) {
      entry = await scrapePriorChain(ticker, side, targetExpiry, firstDate, lastDate, neededDates);
      if (!entry) return null;
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

// What each bar is compared against, per cycle.
//
// The alignment is by position in the earnings cycle, not by calendar date: a bar
// four sessions before the upcoming call is paired with the session four before the
// previous call, and four before the call for the same quarter a year ago. Options
// volume ramps into an earnings date, so comparing 13 July with 13 July a year ago
// compares two different points of the ramp whenever the call moved — which it
// does, by a week or more, most years.
//
// Returns null when the ticker's earnings dates can't be established, and the
// caller falls back to the plain 52-week calendar shift.
async function buildCycleAlignment(ticker, expirationDate, chartDates, effectiveDate) {
  let anchors;
  try {
    anchors = await getEarningsAnchors(ticker);
  } catch (error) {
    console.warn(`[options-report] earnings dates unavailable for ${ticker}: ${error.message}`);
    return null;
  }
  if (!anchors) return null;

  // Sessions from each bar back to the upcoming call: the known leg (bar -> today)
  // comes off the real trading calendar, the unknown leg (today -> call) is counted
  // in weekdays.
  const toCall = weekdaysUntil(effectiveDate, anchors.next);
  const distances = chartDates.map((_, index) => toCall + (chartDates.length - 1 - index));
  const deepest = distances[0];

  // The expiration is placed at the same distance from its own call as the tracked
  // expiration sits from the upcoming one, so a chain that is "the weekly after
  // earnings" stays that in every cycle.
  const expiryOffset = daysBetween(anchors.next, expirationDate);

  // A cycle whose session calendar can't be fetched (a rate-limit squeeze usually)
  // is dropped on its own — losing the last-quarter line is not a reason to also
  // throw away a year-ago line that resolved fine.
  const alignment = {};
  for (const { key } of CYCLES) {
    const call = anchors[key];
    const sessions = await fetchSessions(ticker, addDays(call, -(deepest * 2) - 30), call)
      .catch(error => {
        console.warn(`[options-report] ${key} calendar unavailable for ${ticker}: ${error.message}`);
        return [];
      });

    // The call itself can land on a non-trading day, so count back from the last
    // session on or before it.
    const upToCall = sessions.filter(date => date <= call);
    if (!upToCall.length) continue;
    const callIndex = upToCall.length - 1;

    alignment[key] = {
      call,
      targetExpiry: addDays(call, expiryOffset),
      pairs: chartDates
        .map((barDate, index) => ({ barDate, index: callIndex - distances[index] }))
        .filter(pair => pair.index >= 0)
        .map(pair => ({ barDate: pair.barDate, date: upToCall[pair.index] })),
    };
  }

  // Nothing resolved at all: let the caller fall back to the plain 52-week shift,
  // which needs no calendar and so still draws something.
  if (!Object.keys(alignment).length) return null;

  return { anchors, alignment };
}

// The pre-earnings-alignment behaviour, kept for tickers whose earnings dates can't
// be read: the year-ago line only, shifted by 52 weeks.
function fallbackAlignment(expirationDate, chartDates) {
  return {
    anchors: null,
    alignment: {
      year: {
        call: null,
        targetExpiry: addDays(expirationDate, -YEAR_SHIFT_DAYS),
        pairs: chartDates.map(barDate => ({ barDate, date: addDays(barDate, -YEAR_SHIFT_DAYS) })),
      },
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

async function fetchSessions(ticker, start, end) {
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

async function fetchTradingDays(ticker, end, count) {
  const sessions = await fetchSessions(ticker, addDays(end, -(count * 3) - 10), end);
  // Today's own bar may not be published yet, but it is still the session the
  // report is about. Copy first: the cached array is shared.
  const days = [...sessions];
  if (!days.includes(end)) days.push(end);
  return days.slice(-count);
}

async function enrichExpirationData(data, reportDate) {
  const topCalls = topByVolume(data.calls).map(row => ({ ...row, side: 'call' }));
  const topPuts = topByVolume(data.puts).map(row => ({ ...row, side: 'put' }));
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

  const { anchors, alignment } =
    (await buildCycleAlignment(data.ticker, data.selectedDate, chartDates, effectiveDate))
    ?? fallbackAlignment(data.selectedDate, chartDates);

  // One series per side per cycle. A cycle with no alignment (the fallback has no
  // last-quarter anchor) is simply absent from the chart.
  async function priorSeriesFor(side) {
    const series = await Promise.all(CYCLES.map(async cycle => {
      const aligned = alignment[cycle.key];
      if (!aligned) return null;
      const built = await buildPriorSeries(
        data.ticker, side, data.selectedDate, cycle.key, aligned.pairs, aligned.targetExpiry,
      );
      return built ? { ...cycle, ...built, call: aligned.call } : null;
    }));
    return series.filter(Boolean);
  }

  const [priorCall, priorPut] = await Promise.all([priorSeriesFor('call'), priorSeriesFor('put')]);

  function chartFor(sideRows, color, softColor, priors, sideLabel) {
    return {
      rows: chartDates.map(date => {
        const volume = sideRows.reduce((sum, row) => {
          if (date === effectiveDate) return sum + (row.volume ?? 0);
          const hMap = historyMaps.get(row.contractSymbol) ?? new Map();
          return sum + (hMap.get(date) ?? 0);
        }, 0);
        return { date, volume };
      }),
      color,
      softColor,
      priors,
      sideLabel,
      nextEarnings: anchors?.next ?? null,
    };
  }

  return {
    ...data,
    earnings: anchors,
    tableCalls,
    tablePuts,
    volumeCharts: {
      call: chartFor(topCalls, CALL_COLOR, CALL_SOFT, priorCall, 'calls'),
      put: chartFor(topPuts, PUT_COLOR, PUT_SOFT, priorPut, 'puts'),
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

// Bars (top-3 contracts, this cycle) and the comparison lines (each the whole chain
// at the equivalent point of an earlier earnings cycle) are both contract counts —
// but they count very different things. For a name whose flow is spread thin across
// strikes, the chain runs tens of times the top three (INTC: a 3.3k bar against a
// 96.8k line), and on one shared scale that pins every bar flat to the axis, where a
// real session reads as a missing one. So each gets its own scale in its own band:
// lines in the top of the plot, bars below, never overlapping. The comparison the
// chart makes is shape against shape — is this cycle's ramp steeper than the last
// one's — and that survives the rebasing; a bar's height was never comparable with a
// line's anyway. The legend says the scales are separate so nobody reads them as one.
const BAR_BAND = 0.62;   // share of the plot the bars get, measured up from the axis
const LINE_BAND = 0.32;  // share the lines get, measured down from the top
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

  // The lines are scaled and placed first: whether any resolved decides how much of
  // the plot the bars get. With no line to make room for, the bars take all of it.
  const barIndexByDate = new Map(rows.map((row, index) => [row.date, index]));
  const priorMax = Math.max(1, ...priors.flatMap(prior => prior.points.map(point => point.volume ?? 0)));
  const lineFloor = margin.top + (chartHeight * LINE_BAND);
  const scaleY = value => lineFloor - ((value / priorMax) * (chartHeight * LINE_BAND));

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
  const barMax = Math.max(1, ...rows.map(row => row.volume ?? 0));
  const barBand = chartHeight * (series.length ? BAR_BAND : 1);

  const barGeom = rows.map((row, index) => {
    const value = row.volume ?? 0;
    const barHeight = value > 0 ? Math.max(5, (value / barMax) * barBand) : 5;
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

  const side = chart.sideLabel ?? 'contracts';
  const legendText = (x, text) =>
    `<text x="${x.toFixed(2)}" y="20" class="vc-muted" font-family="${MONO}" font-size="${fonts.legend}" font-weight="600">${escapeHtml(text)}</text>`;
  // Monospace, so a character advance is a reliable ~0.6em — no measuring needed.
  const textWidth = text => text.length * fonts.legend * 0.6;

  let cursor = margin.left;
  const legendItems = [
    `<rect x="${cursor}" y="8" width="12" height="9" rx="2" fill="${chart.color}"></rect>`
    + legendText(cursor + 19, `Top 3 ${side}`),
  ];
  cursor += 19 + textWidth(`Top 3 ${side}`) + 26;

  for (const prior of series) {
    const label = `All ${side}, ${prior.label}`;
    legendItems.push(`
      <line x1="${cursor}" y1="16" x2="${cursor + 26}" y2="16" stroke="${prior.color}" stroke-width="2"${prior.dash ? ` stroke-dasharray="${prior.dash}"` : ''}></line>
      ${markerShape(prior.marker, cursor + 13, 16, prior.color)}
      ${legendText(cursor + 33, label)}
    `);
    cursor += 33 + textWidth(label) + 26;
  }

  // Says what the lines are aligned on and that they carry their own scale, so the
  // chart explains its own comparison: every point sits the same number of sessions
  // from its cycle's call as the bar beneath it sits from the upcoming one, and a
  // point's height is only ever readable against the other points. The note shares the
  // legend's row, so it drops detail from the front as the legend eats the width — the
  // scale caveat is the last thing given up, being the one that prevents a misreading.
  let note = '';
  if (series.length) {
    const room = width - margin.right - cursor - 12;
    const date = chart.nextEarnings ? fmtDateShort(chart.nextEarnings) : null;
    const text = [
      date ? `aligned to earnings · next call ${date} · lines: own scale` : null,
      date ? `next call ${date} · lines: own scale` : null,
      'lines: own scale',
    ].find(candidate => candidate && textWidth(candidate) <= room);
    if (text) {
      note = `<text x="${width - margin.right}" y="20" text-anchor="end" class="vc-faint" font-family="${MONO}" font-size="${fonts.legend}" font-weight="600">${escapeHtml(text)}</text>`;
    }
  }

  // A hairline where the bars' band ends and the lines' begins: two scales in one
  // frame are only honest if the seam between them is visible.
  const divider = series.length
    ? `<line x1="${margin.left}" y1="${(baseline - (chartHeight * BAR_BAND)).toFixed(2)}" x2="${width - margin.right}" y2="${(baseline - (chartHeight * BAR_BAND)).toFixed(2)}" class="vc-seam" stroke-dasharray="2 6" stroke-width="1"></line>`
    : '';

  return `${legendItems.join('')}${note}${divider}${bars}${lines}${labels}`;
}

function buildVolumeChartSvg(chart) {
  if (!chart?.rows?.length) return '<div class="empty-chart">No chart data</div>';
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  return `
    <svg class="volume-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="daily contract volume, with total chain volume at the same point of the previous quarter's and last year's earnings cycle">
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

async function fetchTickerReport(ticker, reportDate) {
  const first = await getOptionsData(ticker);
  const expirations = (first.expirations ?? []).slice(0, 3);
  const byDate = [];

  for (const expiration of expirations) {
    let data;
    if (expiration === first.selectedDate) {
      data = first;
    } else {
      data = await getOptionsData(ticker, expiration);
    }
    byDate.push(await enrichExpirationData(data, reportDate));
  }

  return {
    ticker: first.ticker,
    expirations: byDate,
  };
}

async function generateDailyOptionsReport({ date = today(), tickers = DEFAULT_TICKERS, out = null, format = null } = {}) {
  const outPath = path.resolve(out ?? `daily-options-data-${date}.html`);
  const outputFormat = format ?? (path.extname(outPath).toLowerCase() === '.md' ? 'md' : 'html');
  const tickerReports = [];

  for (const ticker of tickers) {
    tickerReports.push(await fetchTickerReport(ticker, date));
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

// One contract row as pre-formatted display strings (the web app renders these
// verbatim, mirroring the PDF/email table exactly — no client-side math).
// Sum today's and the prior trading day's contract volume across every tracked
// expiration, split by side, so a ticker's day-over-day call/put flow surge can
// be detected downstream without re-parsing the formatted table cells.
function aggregateFlow(tickerReport) {
  const flow = { callToday: 0, callYesterday: 0, putToday: 0, putYesterday: 0 };
  for (const exp of tickerReport.expirations ?? []) {
    for (const row of exp.tableCalls ?? []) {
      flow.callToday += row.todayVolume ?? 0;
      flow.callYesterday += row.yesterdayVolume ?? 0;
    }
    for (const row of exp.tablePuts ?? []) {
      flow.putToday += row.todayVolume ?? 0;
      flow.putYesterday += row.yesterdayVolume ?? 0;
    }
  }
  return flow;
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
        // Raw call/put volume totals (today vs the prior trading day, summed across
        // the tracked expirations) so the web sidebar can flag day-over-day surges
        // in call or put flow with a coloured dot next to the ticker.
        flow: aggregateFlow(tickerReport),
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
  buildStructuredReport,
  buildVolumeChartSvg,
  generateDailyOptionsReport,
  renderHtml,
  renderMarkdown,
  today,
};
