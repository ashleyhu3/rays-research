'use strict';

/**
 * Backfill the last four fiscal quarters of earnings-call transcripts for every ticker on
 * the Alerts page, into the Mongo `normalized_transcripts` collection — the same store
 * prepareEarningsInputs.js reads, so the earnings-review skill can be pointed at any of
 * them without a live fetch.
 *
 *   node --env-file=.env server/scripts/backfillAlertsTranscripts.js --plan
 *   node --env-file=.env server/scripts/backfillAlertsTranscripts.js --budget 20
 *   node --env-file=.env server/scripts/backfillAlertsTranscripts.js --ticker NVDA
 *
 * Alpha Vantage's free tier allows 25 requests/day, and the full job is ~340 requests, so
 * this is built to be run repeatedly: it skips what is already stored, spends at most
 * --budget requests per run, and stops the moment the daily cap is hit. Re-run it daily
 * (or on a schedule) until --plan reports nothing outstanding.
 *
 * Two things this avoids wasting requests on:
 *
 *   1. Wrong period labels. Alpha Vantage's `quarter` parameter is the company's own
 *      FISCAL label — NVDA's "2026Q1" is the quarter ended April 2025, not March 2026.
 *      Guessing calendar quarters would fetch the wrong call for every off-calendar name
 *      (most of the semis here). Labels are derived from SEC EDGAR — free, keyless and
 *      unmetered — and cached on disk, so re-runs never re-resolve them.
 *   2. Symbols with no transcripts at all — ETFs and most ADRs return an empty array.
 *      A confirmed-empty symbol is recorded and never retried.
 *
 * Env: ALPHA_VANTAGE_API_KEY, MONGODB_URI. (Fiscal labels come from SEC EDGAR — no key.)
 */

const fs = require('fs');
const path = require('path');

const { collectFromAlphaVantage } = require('../transcripts/alphavantage');
const { saveTranscript } = require('../transcripts/store');
const { DEFAULT_TICKERS } = require('./generateDailyOptionsReport');

const QUARTERS_BACK = 4;
const DEFAULT_BUDGET = 20;          // under the 25/day cap, leaving room for manual runs
const ALPHA_VANTAGE_GAP_MS = 1600;  // the free tier asks for ≤1 request/second
const EDGAR_GAP_MS = 150;   // SEC asks for <10 requests/second

// Symbols that structurally never have an earnings call. Hardcoded rather than
// discovered, because server/data is not persisted on a CI runner — without this the
// scheduled run would re-spend four requests on each of them every single day.
const KNOWN_NO_TRANSCRIPT = new Set(['SOXX']);

const STATE_DIR = path.join(__dirname, '..', 'data');
const PERIODS_FILE = path.join(STATE_DIR, 'transcriptFiscalPeriods.json');
const NO_TRANSCRIPT_FILE = path.join(STATE_DIR, 'transcriptUnavailable.json');

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};
const PLAN_ONLY = process.argv.includes('--plan');
const ONLY_TICKER = (argValue('--ticker') || '').toUpperCase();
const BUDGET = Number(argValue('--budget') || DEFAULT_BUDGET);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// Every {ticker}:{fiscal_period} already in Mongo, in one query. store.readTranscript()
// opens its own client per call, which would be several hundred connections for a job
// this size — this is the same answer for the price of one.
async function storedKeys() {
  if (!process.env.MONGODB_URI) return new Set();
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const documents = await client.db(process.env.MONGODB_DB || undefined)
      .collection('normalized_transcripts')
      .find({}, { projection: { ticker: 1, fiscal_period: 1, _id: 0 } })
      .toArray();
    return new Set(documents.map(doc => `${doc.ticker}:${doc.fiscal_period}`));
  } finally {
    await client.close().catch(() => {});
  }
}

// ── Fiscal-quarter labels, from SEC EDGAR ───────────────────────────────────
// EDGAR is free, keyless and unmetered (10 req/s), which matters because the only other
// sources are the two APIs whose quota this job is trying to conserve. FMP's
// income-statement is 402-restricted to a handful of mega-caps on our plan, and Yahoo's
// fundamentals submodules have returned almost nothing since Nov 2024.
const EDGAR_HEADERS = { 'User-Agent': 'rays-research ashley_hu1@brown.edu' };
let edgarTickerMap = null;

async function edgarCik(ticker) {
  if (!edgarTickerMap) {
    const response = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: EDGAR_HEADERS });
    if (!response.ok) throw new Error(`SEC ticker map HTTP ${response.status}`);
    const rows = await response.json();
    edgarTickerMap = new Map(Object.values(rows).map(row => [row.ticker, String(row.cik_str).padStart(10, '0')]));
  }
  return edgarTickerMap.get(ticker) || null;
}

// Fiscal quarter of a period-end date, given the company's fiscal-year-end month. The
// fiscal year is named for the calendar year the year ENDS in, which is the convention
// every filer in this universe uses (NVDA's FY2026 ended Jan 2026, MSFT's ended Jun 2026).
function labelForDate(dateStr, fiscalYearEndMonth) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const monthsIn = ((month - (fiscalYearEndMonth % 12) - 1) + 12) % 12;
  const quarter = Math.floor(monthsIn / 3) + 1;
  return { year: month > fiscalYearEndMonth ? year + 1 : year, quarter };
}

const stepBack = ({ year, quarter }, steps) => {
  const zero = year * 4 + (quarter - 1) - steps;
  return `${Math.floor(zero / 4)}Q${(zero % 4) + 1}`;
};

// The last `QUARTERS_BACK` fiscal-quarter labels, newest first, in Alpha Vantage's
// `{fiscalYear}{period}` form. Cached — past fiscal labels never change, so a ticker is
// resolved once, ever. Anything already in the cache (including the FMP-sourced entries
// this was originally seeded from) is treated as ground truth and never recomputed.
async function resolveFiscalPeriods(ticker, cache) {
  if (cache[ticker]?.length) return cache[ticker];

  // Foreign private issuers file 20-F/6-K rather than 10-Q/10-K, so there is no domestic
  // filing to read a fiscal calendar off. Every one of them in this universe reports on
  // the calendar year, which makes the calendar quarter the fiscal label.
  const calendarFallback = () => {
    const now = new Date();
    const current = { year: now.getUTCFullYear(), quarter: Math.floor(now.getUTCMonth() / 3) + 1 };
    return Array.from({ length: QUARTERS_BACK }, (_, index) => stepBack(current, index + 1));
  };

  const cik = await edgarCik(ticker);
  if (!cik) {
    cache[ticker] = calendarFallback();
    return cache[ticker];
  }

  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: EDGAR_HEADERS });
  if (!response.ok) throw new Error(`SEC submissions HTTP ${response.status}`);
  const submissions = await response.json();
  const fiscalYearEndMonth = Number(String(submissions.fiscalYearEnd || '1231').slice(0, 2)) || 12;

  // Newest period end across 10-Q *and* 10-K: a Q4 never gets a 10-Q (it is reported in
  // the annual report), so looking only at 10-Qs would skip every fourth quarter.
  const recent = submissions.filings?.recent || {};
  let newest = null;
  for (let index = 0; index < (recent.form?.length || 0); index += 1) {
    if (!['10-Q', '10-K'].includes(recent.form[index])) continue;
    const reportDate = recent.reportDate?.[index];
    if (reportDate && (!newest || reportDate > newest)) newest = reportDate;
  }
  if (!newest) {
    cache[ticker] = calendarFallback();
    return cache[ticker];
  }

  let current = labelForDate(newest, fiscalYearEndMonth);

  // A filing lags its earnings call by weeks, so right after a company reports, the call
  // we want exists but its 10-Q does not yet. If the quarter *after* the newest filed one
  // ended long enough ago that its call has certainly happened, step the window forward.
  const QUARTER_MS = 91 * 24 * 3600 * 1000;
  const REPORTING_LAG_MS = 30 * 24 * 3600 * 1000;
  const nextQuarterEnd = new Date(`${newest}T00:00:00Z`).getTime() + QUARTER_MS;
  if (Date.now() - nextQuarterEnd >= REPORTING_LAG_MS) {
    const zero = current.year * 4 + current.quarter; // one step forward
    current = { year: Math.floor(zero / 4), quarter: (zero % 4) + 1 };
  }

  const periods = Array.from({ length: QUARTERS_BACK }, (_, index) => stepBack(current, index));
  cache[ticker] = periods;
  return periods;
}

async function main() {
  const tickers = ONLY_TICKER ? [ONLY_TICKER] : DEFAULT_TICKERS;
  const periodCache = readJson(PERIODS_FILE, {});
  const unavailable = new Set([...KNOWN_NO_TRANSCRIPT, ...readJson(NO_TRANSCRIPT_FILE, [])]);
  const stored = await storedKeys();

  // ── Plan: resolve labels, then subtract what Mongo already has ──────────────
  const outstanding = [];
  let known = 0;
  let unresolved = 0;

  for (const ticker of tickers) {
    if (unavailable.has(ticker)) continue;

    let periods;
    try {
      const hadCache = Boolean(periodCache[ticker]?.length);
      periods = await resolveFiscalPeriods(ticker, periodCache);
      if (!hadCache) await wait(EDGAR_GAP_MS);
    } catch (error) {
      console.warn(`[backfill] ${ticker}: could not resolve fiscal quarters — ${error.message}`);
      unresolved += 1;
      continue;
    }
    if (!periods.length) {
      console.warn(`[backfill] ${ticker}: FMP returned no quarterly periods`);
      unresolved += 1;
      continue;
    }

    for (const period of periods) {
      if (stored.has(`${ticker}:${period}`)) known += 1;
      else outstanding.push({ ticker, period });
    }
  }
  writeJson(PERIODS_FILE, periodCache);

  console.log(
    `[backfill] ${tickers.length} tickers · ${known} transcripts already stored · `
    + `${outstanding.length} outstanding${unresolved ? ` · ${unresolved} unresolved` : ''}`,
  );
  if (unavailable.size) {
    console.log(`[backfill] skipping ${unavailable.size} symbol(s) with no transcript coverage: ${[...unavailable].join(', ')}`);
  }
  if (!outstanding.length) {
    console.log('[backfill] nothing to do — every ticker has its last four quarters.');
    return;
  }

  if (PLAN_ONLY) {
    const days = Math.ceil(outstanding.length / BUDGET);
    console.log(`[backfill] --plan: would fetch ${outstanding.length} transcripts (~${days} run(s) at ${BUDGET}/run)`);
    for (const item of outstanding.slice(0, 12)) console.log(`   ${item.ticker} ${item.period}`);
    if (outstanding.length > 12) console.log(`   … and ${outstanding.length - 12} more`);
    return;
  }

  // ── Fetch, within this run's budget ─────────────────────────────────────────
  let saved = 0;
  let empty = 0;
  let failed = 0;
  let spent = 0;

  for (const { ticker, period } of outstanding) {
    if (spent >= BUDGET) {
      console.log(`[backfill] budget of ${BUDGET} requests reached — re-run to continue.`);
      break;
    }

    const year = period.slice(0, 4);
    const quarter = period.slice(4);
    spent += 1;
    try {
      const transcript = await collectFromAlphaVantage({ ticker, quarter, year });
      const storage = await saveTranscript(transcript);
      stored.add(`${ticker}:${period}`);
      console.log(
        `[backfill] ✓ ${ticker} ${period}: ${transcript.stats.totalBlocks} blocks, `
        + `${transcript.stats.wordCount.toLocaleString('en-US')} words, mongo=${storage.mongoStored}`,
      );
      saved += 1;
    } catch (error) {
      // The daily cap ends the run: every further request would be spent for nothing.
      if (error.status === 429 || /\b25 requests per day|rate limit|higher API call/i.test(error.message)) {
        console.log(`[backfill] Alpha Vantage daily limit reached after ${spent} request(s) — re-run tomorrow.`);
        break;
      }
      // "No transcript was returned" for the newest quarter usually means the call simply
      // hasn't happened yet; for a symbol whose every quarter comes back empty (ETFs,
      // most ADRs) it means there is no coverage at all — recorded below.
      if (/No Alpha Vantage transcript/i.test(error.message)) {
        console.log(`[backfill] – ${ticker} ${period}: no transcript available`);
        empty += 1;
      } else {
        console.warn(`[backfill] ✗ ${ticker} ${period}: ${error.message}`);
        failed += 1;
      }
    }
    await wait(ALPHA_VANTAGE_GAP_MS);
  }

  // A symbol whose full set of quarters has now been tried and came back empty every time
  // has no transcript coverage; never spend requests on it again.
  const triedByTicker = new Map();
  for (const { ticker } of outstanding.slice(0, spent)) {
    triedByTicker.set(ticker, (triedByTicker.get(ticker) || 0) + 1);
  }
  for (const [ticker, tried] of triedByTicker) {
    const periods = periodCache[ticker] || [];
    if (tried < periods.length) continue;
    if (periods.every(period => !stored.has(`${ticker}:${period}`))) {
      unavailable.add(ticker);
      console.log(`[backfill] ${ticker}: no coverage on any of its last ${periods.length} quarters — will not retry`);
    }
  }
  writeJson(NO_TRANSCRIPT_FILE, [...unavailable]);

  console.log(
    `[backfill] run complete: ${saved} saved, ${empty} unavailable, ${failed} failed, `
    + `${spent} request(s) spent · ${outstanding.length - saved} still outstanding`,
  );
}

main().catch(error => {
  console.error('[backfill] fatal:', error.message);
  process.exit(1);
});
