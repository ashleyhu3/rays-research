'use strict';

// Alpha Vantage's EARNINGS endpoint as a *report-date* source, used only where
// API Ninjas comes up short.
//
// API Ninjas caps a ticker's history at 50 rows, and for foreign private
// issuers it spends several of those on duplicate rows (an ADR's earnings call
// and its later filing both appear) while omitting other quarters outright —
// TSM has no October row at all for 2017, 2018, 2019, 2020 or 2022, which left
// six holes in the Price Return grid. Alpha Vantage carries 113 quarters for
// the same ticker, back to 1998, including every one of those.
//
// This costs one request against the shared 25/day key, so callers are expected
// to cache the result in their blob and re-fetch only on demand: a settled
// earnings date never changes, and the daily refresh must not spend quota.
const AV_URL = 'https://www.alphavantage.co/query';

function apiKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY || '';
}

// Every settled earnings-announcement date for one ticker, most recent first.
async function getEarningsReportDates(ticker) {
  const key = apiKey();
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY is not set');

  const url = new URL(AV_URL);
  url.searchParams.set('function', 'EARNINGS');
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('apikey', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const body = await res.json();

  // A throttled call answers 200 with an {Information: …} notice and no
  // quarterlyEarnings array. Surface that as its own error so the caller can
  // tell "out of quota" from "this symbol has no history".
  if (!Array.isArray(body?.quarterlyEarnings)) {
    const note = body?.Information ?? body?.Note ?? body?.['Error Message'] ?? '';
    if (/rate limit|higher API call|premium/i.test(note)) throw new Error('RATE_LIMIT');
    throw new Error(note || 'Alpha Vantage returned no quarterly earnings');
  }

  const today = new Date().toISOString().slice(0, 10);
  return body.quarterlyEarnings
    .map(row => row.reportedDate)
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && date <= today)
    .sort((a, b) => b.localeCompare(a));
}

module.exports = { getEarningsReportDates };
