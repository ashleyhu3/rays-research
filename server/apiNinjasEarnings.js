'use strict';

// API Ninjas' earnings calendar: one free request returns up to ~50 quarters
// of a ticker's past earnings announcements, each carrying the report `date`.
// That's all the Price Return tab needs — it buckets each call into the
// calendar quarter it landed in — and unlike Alpha Vantage's EARNINGS endpoint
// this isn't behind a 25-request/day cap, so the whole watchlist can be
// backfilled to full 10-year depth in a single pass.
//
// Foreign private issuers (ADRs like TSM/UMC/ASML) occasionally carry a filing
// date rather than the call date here — the same quirk earningsDates.js guards
// against for the options report — but for the Price Return grid the report
// date is used as-is; the vast majority of the watchlist is US-listed and
// unaffected.

const API_URL = 'https://api.api-ninjas.com/v1/earningscalendar';

function apiKey() {
  return process.env.NINJAS_API_KEY || '';
}

// Every past earnings-announcement date for one ticker, most recent first.
//
// Around a just-happened report API Ninjas often carries two or three extra
// rows on adjacent days (shifting estimate placeholders) with no actuals — e.g.
// GOOG's Q2 2026 call shows up on 07-21, 07-22 and 07-23, but only the 07-22
// row carries the real EPS/revenue. Keeping only rows that report an actual
// EPS or revenue collapses each event to its true announcement date and drops
// those placeholders. (If a pull somehow has no actuals at all we fall back to
// every dated row rather than returning nothing.)
async function getEarningsReportDates(ticker) {
  const key = apiKey();
  if (!key) throw new Error('NINJAS_API_KEY is not set');

  const url = new URL(API_URL);
  url.searchParams.set('ticker', ticker);
  const res = await fetch(url, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`API Ninjas HTTP ${res.status}`);

  const payload = await res.json();
  if (!Array.isArray(payload)) throw new Error('API Ninjas returned an unexpected response');

  const today = new Date().toISOString().slice(0, 10);
  const dated = payload.filter(row =>
    /^\d{4}-\d{2}-\d{2}$/.test(row?.date || '') && row.date <= today); // settled reports only, never a future estimate
  const withActuals = dated.filter(row => row.actual_eps != null || row.actual_revenue != null);

  return (withActuals.length ? withActuals : dated)
    .map(row => row.date)
    .sort((a, b) => b.localeCompare(a));
}

module.exports = { getEarningsReportDates };
