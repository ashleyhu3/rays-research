'use strict';

const path = require('path');
const storage = require('./storage');

// Earnings-call dates for the options report's comparison lines. The report needs
// three dates per ticker: the upcoming call, the previous quarter's call, and the
// call for the same fiscal quarter a year ago. Bars are then aligned to the point
// in each earnings cycle rather than to the calendar date — "four sessions before
// the call" compares with "four sessions before the last call".
//
// NOTE: this blob must stay registered in server.js STORAGE_BLOBS, or init() won't
// preload it from Mongo and every restart re-scrapes from an empty file.
const BLOB = {
  name: 'earningsDates',
  file: path.join(__dirname, 'data', 'earningsDates.json'),
};

const AV_URL = 'https://www.alphavantage.co/query';

// Alpha Vantage's free tier allows 25 requests/day across the whole key (the
// transcripts collector shares it), and the report covers eight tickers. Two things
// keep this well inside the budget.
//
// The two endpoints are refreshed on their own clocks, because they are not the same
// kind of data. The calendar's date is an *estimate* that firms up as the call nears,
// so it is re-read weekly. The history is *settled* — a call that happened cannot
// move — so it is fetched once and then only when a new quarter's call must exist,
// which is roughly four times a year. Steady state is therefore ~1 call/day, not the
// ~2.3 it would be if both were re-pulled on one TTL.
//
// And a failed refresh falls back to the cached entry rather than throwing: a date
// that is a week stale still aligns the chart correctly, whereas losing it drops both
// comparison lines. Running into the daily cap must not be able to blank the chart.
const CALENDAR_TTL_DAYS = 7;
const HISTORY_MAX_AGE_DAYS = 100;      // older than a quarter ⇒ a newer call exists
const HISTORY_MIN_REFETCH_DAYS = 3;    // don't re-ask daily while the vendor catches up
const MIN_INTERVAL_MS = 1500;

// Both offsets are whole weeks (13 and 52), so a projected date always lands on the
// same weekday as the call it is projected from — which is what earnings dates
// actually do.
const QUARTER_SHIFT_DAYS = 91;
const YEAR_SHIFT_DAYS = 364;

// How far a vendor-reported date may sit from where the company's own cadence puts
// it before we stop believing it. Real quarter-to-quarter drift is small (the worst
// across the tracked tickers is Alphabet at 7 days); the failure this catches is an
// order of magnitude larger — see pickAnchor.
const ANCHOR_TOLERANCE_DAYS = 14;

function apiKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY || '';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysApart(a, b) {
  return Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86_400_000;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Alpha Vantage rejects bursts, so every call from this module queues behind the
// last one. Only a cache miss pays this cost.
let nextSlot = 0;
async function paced() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

async function avGet(params) {
  const key = apiKey();
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY is not set');

  const url = new URL(AV_URL);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('apikey', key);

  await paced();
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  return res.text();
}

// A throttled or errored Alpha Vantage call still returns HTTP 200 with a JSON note.
// Letting that through would look like "this ticker has no earnings", which does not
// just drop the comparison lines — it gets *cached* as a fact for a week.
//
// The message body echoes the API key back, so it is never repeated into an error or
// a log line.
function assertNoServiceMessage(text) {
  if (!text.trim().startsWith('{')) return undefined;
  const payload = JSON.parse(text);
  const message = payload.Note || payload.Information || payload['Error Message'];
  if (message) throw new Error(rateLimited(message) ? RATE_LIMIT_MSG : 'Alpha Vantage rejected the request');
  return payload;
}

function rateLimited(message) {
  return /rate limit|higher API call|premium|frequency/i.test(String(message));
}

const RATE_LIMIT_MSG = 'Alpha Vantage daily rate limit reached';

// The CSV endpoint does not get its own error shape — Alpha Vantage mangles the JSON
// note *into the CSV*. A rate-limited EARNINGS_CALENDAR answers with the real header
// followed by one row: `I,n,f,o,r,m,a` — the word "Information" chopped to a
// character per column. That parses as a perfectly well-formed CSV with no matching
// symbol, i.e. "this ticker has no upcoming call", which is then cached as settled
// truth. So an empty result is only believed when the body carries no data rows at
// all; rows that exist but parse as nothing are treated as a failed call.
function parseCalendarRows(text, ticker) {
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const [header, ...rows] = lines;
  if (!header?.startsWith('symbol,')) throw new Error('Alpha Vantage returned an unrecognised calendar response');

  const columns = header.split(',').map(name => name.trim());
  if (!rows.length) return [];  // genuinely nothing scheduled inside the horizon

  const records = rows
    .map(row => {
      const cells = row.split(',');
      // The company-name field contains commas, so index from both ends: the trailing
      // columns are fixed in number and the symbol is always first.
      const record = {};
      columns.forEach((name, index) => {
        record[name] = index === 0 ? cells[0] : cells[cells.length - (columns.length - index)];
      });
      return record;
    })
    .filter(row => row.symbol === ticker && /^\d{4}-\d{2}-\d{2}$/.test(row.reportDate ?? ''));

  if (!records.length) throw new Error(RATE_LIMIT_MSG);
  return records;
}

// The upcoming call. This is the one date the vendors get right for every ticker,
// so it anchors everything else.
async function fetchUpcoming(ticker) {
  const text = await avGet({ function: 'EARNINGS_CALENDAR', symbol: ticker, horizon: '6month' });
  assertNoServiceMessage(text);

  const upcoming = parseCalendarRows(text, ticker)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .find(row => row.reportDate >= today());

  return upcoming
    ? { reportDate: upcoming.reportDate, fiscalDateEnding: upcoming.fiscalDateEnding ?? null }
    : null;
}

async function fetchHistory(ticker) {
  const text = await avGet({ function: 'EARNINGS', symbol: ticker });
  const payload = assertNoServiceMessage(text);
  return (payload?.quarterlyEarnings ?? [])
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.reportedDate ?? ''))
    .map(row => ({ fiscalDateEnding: row.fiscalDateEnding, reportedDate: row.reportedDate }))
    .sort((a, b) => b.reportedDate.localeCompare(a.reportedDate));
}

function readCache() {
  const blob = storage.read(BLOB.name, BLOB.file);
  if (!blob.tickers) blob.tickers = {};
  return blob;
}

function writeCache(ticker, entry) {
  const blob = readCache();
  blob.tickers[ticker] = entry;
  blob.updatedAt = new Date().toISOString();
  storage.write(BLOB.name, BLOB.file, blob);
}

function age(timestamp) {
  return timestamp ? daysApart(today(), timestamp.slice(0, 10)) : Infinity;
}

// The estimate is re-read weekly, and immediately once the date it names has passed —
// at that point it is naming a call that already happened.
function calendarStale(entry) {
  if (!entry?.upcoming?.reportDate) return true;
  if (entry.upcoming.reportDate < today()) return true;
  return age(entry.calendarFetchedAt) >= CALENDAR_TTL_DAYS;
}

// Settled data: only re-read when the newest call we know about is old enough that a
// newer one must exist. The floor stops us asking every day through the few days it
// takes the vendor to publish a call that has just happened.
function historyStale(entry) {
  if (!entry?.history?.length) return true;
  if (age(entry.historyFetchedAt) < HISTORY_MIN_REFETCH_DAYS) return false;
  return daysApart(today(), entry.history[0].reportedDate) > HISTORY_MAX_AGE_DAYS;
}

// Each endpoint is fetched only if its own clock says so, and each failure is
// survivable on its own: whatever was already cached is kept. A ticker with a
// calendar but no history still aligns — pickAnchor projects from the cadence — so
// history is genuinely optional, and never worth failing the ticker over.
async function loadTicker(ticker) {
  const cached = readCache().tickers[ticker] ?? null;
  const wantCalendar = calendarStale(cached);
  const wantHistory = historyStale(cached);
  if (!wantCalendar && !wantHistory) return cached;

  const entry = { ...(cached ?? {}) };
  let fetched = false;

  if (wantCalendar) {
    try {
      entry.upcoming = await fetchUpcoming(ticker);
      entry.calendarFetchedAt = new Date().toISOString();
      fetched = true;
    } catch (error) {
      console.warn(`[earnings-dates] calendar refresh failed for ${ticker}: ${error.message}`);
      if (!cached?.upcoming) throw error;
    }
  }

  if (wantHistory) {
    try {
      entry.history = await fetchHistory(ticker);
      entry.historyFetchedAt = new Date().toISOString();
      fetched = true;
    } catch (error) {
      console.warn(`[earnings-dates] history refresh failed for ${ticker}: ${error.message}`);
      entry.history = cached?.history ?? [];
    }
  }

  if (fetched) writeCache(ticker, entry);
  return entry;
}

// Pick the historical call date for one cycle.
//
// `reportedDate` is a filing date rather than a call date for some foreign private
// issuers: Alpha Vantage (and API Ninjas, which shares the source) puts TSM's Q2
// 2025 call on 2025-08-14 — the date of the 6-K — when the call was 2025-07-17,
// four weeks earlier. Anchoring a year-ago line on that would compare the run-up to
// this quarter's call against a month *after* last year's. So a reported date is
// used only when it corroborates the cadence projected from the upcoming call, and
// the projection stands in when it doesn't. Across the eight tracked tickers this
// guard fires exactly once — on TSM — and lands on the true call date.
function pickAnchor(history, projected) {
  let best = null;
  for (const quarter of history) {
    const distance = daysApart(quarter.reportedDate, projected);
    if (!best || distance < best.distance) best = { distance, date: quarter.reportedDate };
  }
  return best && best.distance <= ANCHOR_TOLERANCE_DAYS
    ? { date: best.date, source: 'reported' }
    : { date: projected, source: 'cadence' };
}

// The three dates the report's comparison lines hang off, or null when they can't
// be established — in which case the caller falls back to a plain calendar shift.
async function getEarningsAnchors(ticker) {
  const entry = await loadTicker(ticker);
  const history = entry.history ?? [];

  // Without an upcoming call there is no "time until earnings" to align on. It can
  // still be projected from the most recent call when the calendar feed is empty
  // (Alpha Vantage drops a ticker from the calendar for a few days after it
  // reports), which keeps the lines up rather than blanking them for a week.
  let next = entry.upcoming?.reportDate ?? null;
  let nextSource = 'calendar';
  if (!next && history[0]) {
    next = addDays(history[0].reportedDate, QUARTER_SHIFT_DAYS);
    nextSource = 'cadence';
  }
  if (!next) return null;

  // A cached date the refresh couldn't replace — the daily cap, usually — can name a
  // call that has already happened. Roll it on by whole quarters rather than aligning
  // every bar to a call in the past, which would put "sessions until earnings" at
  // zero for the entire chart.
  while (next < today()) {
    next = addDays(next, QUARTER_SHIFT_DAYS);
    nextSource = 'cadence';
  }

  const quarter = pickAnchor(history, addDays(next, -QUARTER_SHIFT_DAYS));
  const year = pickAnchor(history, addDays(next, -YEAR_SHIFT_DAYS));

  return {
    ticker,
    next,
    quarter: quarter.date,
    year: year.date,
    sources: { next: nextSource, quarter: quarter.source, year: year.source },
  };
}

// The settled quarterly call-date history for one ticker, most recent first —
// used by the Price Return tab to line price data up against past calls. Goes
// through the same cache/staleness path as getEarningsAnchors, so it costs a
// vendor call only the first time a ticker is asked for (or once a quarter
// after that).
async function getHistory(ticker) {
  const entry = await loadTicker(ticker);
  return entry.history ?? [];
}

module.exports = {
  BLOB,
  CALENDAR_TTL_DAYS,
  HISTORY_MAX_AGE_DAYS,
  QUARTER_SHIFT_DAYS,
  YEAR_SHIFT_DAYS,
  addDays,
  calendarStale,
  getEarningsAnchors,
  getHistory,
  historyStale,
  parseCalendarRows,
  pickAnchor,
};
