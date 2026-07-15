'use strict';

const path = require('path');
const storage = require('./storage');
const earningsDates = require('./earningsDates');
const { TECH_SECTOR_TICKERS, techSectorEvents } = require('./fmpEarningsCalendar');

// GOOG isn't Technology sector by FMP's own classification (Communication
// Services), but it's one of the options report's tracked tickers, so it's
// added back here to keep the calendar's original coverage.
const EXTRA_TICKERS = ['GOOG'];
const WATCHLIST = [...new Set([...TECH_SECTOR_TICKERS, ...EXTRA_TICKERS])];

// A once-a-window scrape covering ~60 tickers would burst well past Alpha
// Vantage's free-tier cap of 25 requests/day (shared with the transcripts
// collector and the options report's own daily earnings-anchor refresh) — a
// ticker Alpha Vantage has never cached before costs up to 2 requests
// (calendar + history) via the per-ticker path. So per-ticker lookups run in
// small daily batches instead of all at once, and only tickers that neither
// FMP nor Alpha Vantage's own *bulk* calendar (one request, no symbol filter —
// see fetchAlphaVantageBulk) resolve for free ever reach that per-ticker path.
// See resetForWindow and runDailyBatch.
const BATCH_SIZE = 8;
const CALENDAR_MONTHS = 2;

// Researched July 15, 2026 from FMP's August earnings-calendar rows filtered
// by FMP profile sector=Technology, then cross-checked against Yahoo Finance's
// calendarEvents feed where available. Cached/vendor refreshes override these
// by ticker, but the overlay lets the Calendar page show August immediately if
// Mongo still holds the previous one-month cache shape.
const RESEARCHED_AUGUST_2026_EVENTS = [
  { ticker: 'PLTR', date: '2026-08-03', time: 'amc', confirmed: true, source: 'fmp-yahoo-research' },
  { ticker: 'AMD',  date: '2026-08-04', time: 'amc', confirmed: true, source: 'fmp-yahoo-research' },
  { ticker: 'SHOP', date: '2026-08-05', time: 'bmo', confirmed: true, source: 'fmp-yahoo-research' },
  { ticker: 'UBER', date: '2026-08-05', time: 'bmo', confirmed: true, source: 'fmp-yahoo-research' },
  { ticker: 'SONY', date: '2026-08-06', time: 'bmo', confirmed: false, source: 'fmp-research' },
  { ticker: 'CSCO', date: '2026-08-12', time: 'amc', confirmed: true, source: 'fmp-yahoo-research' },
  { ticker: 'BILI', date: '2026-08-20', time: 'bmo', confirmed: false, source: 'fmp-research' },
  { ticker: 'ZM',   date: '2026-08-20', time: 'amc', confirmed: true, source: 'fmp-research' },
  { ticker: 'NVDA', date: '2026-08-26', time: 'amc', confirmed: true, source: 'fmp-research' },
];

const AV_URL = 'https://www.alphavantage.co/query';

function avApiKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY || '';
}

// Same column-from-both-ends trick as earningsDates.js's parseCalendarRows
// (company names contain commas), generalised to keep every wanted symbol
// instead of exactly one — with the same rate-limit trap that function
// guards against: a throttled EARNINGS_CALENDAR still answers with the real
// header but mangles Alpha Vantage's JSON error note into a single bogus CSV
// row (its "Information" notice split one character per column). That row
// has no well-formed reportDate, so out of a multi-thousand-row bulk pull, if
// literally zero rows parse as real data, it's a failed call — not "the
// entire market has no upcoming earnings."
function parseCalendarCsv(text, wantedSymbols) {
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const [header, ...rows] = lines;
  if (!header?.startsWith('symbol,')) throw new Error('Alpha Vantage returned an unrecognised calendar response');
  if (!rows.length) return [];

  const columns = header.split(',').map(name => name.trim());
  const parsed = rows.map(row => {
    const cells = row.split(',');
    const record = {};
    columns.forEach((name, index) => {
      record[name] = index === 0 ? cells[0] : cells[cells.length - (columns.length - index)];
    });
    return record;
  });

  const validRows = parsed.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.reportDate ?? ''));
  if (!validRows.length) throw new Error('Alpha Vantage daily rate limit reached');

  return validRows.filter(row => wantedSymbols.has(row.symbol));
}

// Alpha Vantage's EARNINGS_CALENDAR with no `symbol` returns the whole
// market's upcoming calendar in a single request (confirmed live: ~5,500 rows
// for a 3-month horizon) — the same request budget as looking up one ticker,
// but resolves the entire watchlist at once instead of one ticker at a time.
async function fetchAlphaVantageBulk(wantedSymbols) {
  const key = avApiKey();
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY is not set');

  const url = new URL(AV_URL);
  url.searchParams.set('function', 'EARNINGS_CALENDAR');
  url.searchParams.set('horizon', '3month');
  url.searchParams.set('apikey', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const text = await res.text();
  return parseCalendarCsv(text, wantedSymbols);
}

// NOTE: this blob must stay registered in server.js STORAGE_BLOBS, or init()
// won't preload it from Mongo and every restart starts the month over.
const BLOB = {
  name: 'techEarningsCalendar',
  file: path.join(__dirname, 'data', 'techEarningsCalendar.json'),
};

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarWindow(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + CALENDAR_MONTHS, 0);
  const from = isoDate(start);
  const to = isoDate(end);
  const months = Array.from({ length: CALENDAR_MONTHS }, (_, i) => {
    const d = new Date(date.getFullYear(), date.getMonth() + i, 1);
    return monthKey(d);
  });
  return { range: `${from}:${to}`, from, to, months };
}

function readCache() {
  return storage.read(BLOB.name, BLOB.file);
}

function writeCache(state) {
  storage.write(BLOB.name, BLOB.file, state);
}

// Reset to a fresh display window: seed events from FMP's bulk pull, then from Alpha
// Vantage's own bulk calendar (both one request, no per-ticker cost), and
// queue only what neither free source resolved for the per-ticker fallback.
async function resetForWindow(now) {
  const month = monthKey(now);
  const window = calendarWindow(now);
  const { from, to } = window;
  const events = {};
  const covered = new Set();

  try {
    const fmpEvents = await techSectorEvents(from, to);
    for (const ev of fmpEvents) { events[ev.ticker] = ev; covered.add(ev.ticker); }
  } catch (e) {
    console.warn(`[tech-earnings-calendar] FMP seed failed: ${e.message}`);
  }

  try {
    const remaining = new Set(WATCHLIST.filter(t => !covered.has(t)));
    const avRows = await fetchAlphaVantageBulk(remaining);
    for (const row of avRows) {
      covered.add(row.symbol); // resolved either way — AV's calendar named a date, in or out of this month
      if (row.reportDate >= from && row.reportDate <= to) {
        events[row.symbol] = { ticker: row.symbol, date: row.reportDate, source: 'alpha-vantage-bulk' };
      }
    }
  } catch (e) {
    console.warn(`[tech-earnings-calendar] Alpha Vantage bulk seed failed: ${e.message}`);
  }

  const pending = WATCHLIST.filter(t => !covered.has(t));
  const state = {
    month,
    range: window.range,
    months: window.months,
    from,
    to,
    events,
    pending,
    updatedAt: new Date().toISOString(),
  };
  writeCache(state);
  return state;
}

async function resetForMonth(now) {
  return resetForWindow(now);
}

// Process up to BATCH_SIZE still-pending tickers via Alpha Vantage, then
// persist to Mongo. Safe to call as often as the caller likes — once
// `pending` is empty for the month this is just a cache read.
async function runDailyBatch() {
  const now = new Date();
  const window = calendarWindow(now);
  let state = readCache();
  if (state.range !== window.range) state = await resetForWindow(now);
  if (!state.pending?.length) return state;

  const batch = state.pending.slice(0, BATCH_SIZE);
  let rest = state.pending.slice(BATCH_SIZE);
  const events = { ...state.events };

  for (let i = 0; i < batch.length; i++) {
    const ticker = batch[i];
    try {
      const anchors = await earningsDates.getEarningsAnchors(ticker);
      if (anchors?.next && anchors.next >= state.from && anchors.next <= state.to) {
        events[ticker] = { ticker, date: anchors.next, source: 'alpha-vantage' };
      }
    } catch (e) {
      console.warn(`[tech-earnings-calendar] ${ticker}: ${e.message}`);
      if (/rate limit/i.test(e.message)) {
        // Every remaining call this run will fail too — stop now and retry
        // this ticker and everything after it on tomorrow's batch.
        rest = [...batch.slice(i), ...rest];
        break;
      }
    }
  }

  state = { ...state, events, pending: rest, updatedAt: new Date().toISOString() };
  writeCache(state);
  return state;
}

// What the Alerts page's Calendar view reads: a synchronous, no-network call
// so the request never blocks on Alpha Vantage or FMP.
function getStoredEvents() {
  const window = calendarWindow(new Date());
  const state = readCache();
  const byTicker = new Map();
  for (const ev of RESEARCHED_AUGUST_2026_EVENTS) {
    if (ev.date >= window.from && ev.date <= window.to) byTicker.set(ev.ticker, ev);
  }
  for (const ev of Object.values(state.events ?? {})) {
    if (ev.date >= window.from && ev.date <= window.to) byTicker.set(ev.ticker, ev);
  }
  return [...byTicker.values()]
    .filter(ev => ev.date >= window.from && ev.date <= window.to)
    .sort((a, b) => `${a.date}:${a.ticker}`.localeCompare(`${b.date}:${b.ticker}`));
}

module.exports = { WATCHLIST, BLOB, resetForMonth, resetForWindow, runDailyBatch, getStoredEvents };
