/** Rebuilds a CME-FedWatch-style "Target Rate Probabilities" table without
 * the (paid, subscription-only) CME FedWatch API. Same idea as the official
 * tool: back out the market-implied probability of each possible Fed Funds
 * target-rate outcome from 30-Day Fed Funds futures (CME symbol ZQ)
 * settlement prices, one contract per FOMC meeting month.
 *
 * Methodology (day-weighted average, propagated meeting to meeting):
 *   - A ZQ contract for month M settles at 100 - (average daily EFFR over M).
 *   - If exactly one FOMC decision falls in month M on day d of an N-day
 *     month, then avg(M) = (d*preRate + (N-d)*postRate) / N, where preRate is
 *     the (possibly probability-weighted) rate entering the meeting and
 *     postRate is what we solve for. Decisions are assumed to take effect the
 *     day *after* the meeting, so day d itself still accrues at preRate.
 *   - Solving for E[postRate] and comparing it to the entry distribution
 *     gives the expected rate move at that meeting. That expectation is then
 *     split between the two neighboring 25bp outcomes by linear interpolation
 *     (e.g. an expected +12.5bp move implies 50/50 hold vs +25bp hike) and
 *     propagated as a recombining lattice into the next meeting.
 *
 * This assumes only 25bp-spaced outcomes and that the interpolated
 * hold/move split is uniform across every path into a meeting — a
 * simplification CME's own model refines with more outcome buckets. Treat
 * this as a close approximation, not a reproduction of CME's proprietary
 * table. Futures prices come from Yahoo Finance's public (unauthenticated)
 * chart API, which does not require a market-data subscription.
 */
'use strict';

const FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 Signal Macro Dashboard';
const STEP = 0.25; // Fed's standard target-rate increment, in percentage points

// FOMC decision (2nd meeting day) dates, confirmed against the Fed's published
// 2026 calendar. Extend this list once the Fed announces its next tentative
// schedule (typically released each August, ~18 months ahead).
const FOMC_MEETINGS = [
  { date: '2026-01-28', label: 'Jan 27-28, 2026' },
  { date: '2026-03-18', label: 'Mar 17-18, 2026' },
  { date: '2026-04-29', label: 'Apr 28-29, 2026' },
  { date: '2026-06-17', label: 'Jun 16-17, 2026' },
  { date: '2026-07-29', label: 'Jul 28-29, 2026' },
  { date: '2026-09-16', label: 'Sep 15-16, 2026' },
  { date: '2026-10-28', label: 'Oct 27-28, 2026' },
  { date: '2026-12-09', label: 'Dec 8-9, 2026' },
];

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];

function futuresSymbol(year, month) {
  return `ZQ${MONTH_CODES[month - 1]}${String(year).slice(-2)}.CBT`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function fetchText(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': UA } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFredLatest(fredId) {
  const text = await fetchText(`${FRED_CSV_URL}?id=${fredId}`);
  const lines = text.trim().split('\n').slice(1);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const [date, raw] = lines[i].split(',');
    if (!raw || raw === '.') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return { value, date };
  }
  throw new Error(`FRED returned no data for ${fredId}`);
}

async function fetchFuturesClose(year, month) {
  const symbol = futuresSymbol(year, month);
  const raw = await fetchText(`${YAHOO_CHART_URL}/${symbol}?range=1mo&interval=1d`);
  const result = JSON.parse(raw)?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result?.timestamp ?? [];
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(closes[i])) {
      return { symbol, price: closes[i], date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10) };
    }
  }
  throw new Error(`No settlement price found for ${symbol}`);
}

// Propagates a recombining 25bp lattice across `meetings`, calibrating each
// step's expected move to the corresponding ZQ contract's implied average
// rate. `currentEffr`/`currentTargetUpper` anchor the lattice (states are
// tracked in EFFR terms, since that's what the futures settle on) and are
// converted back to target-range labels via a constant basis offset.
function computeFedWatch(meetings, currentEffr, currentTargetUpper, futuresBySymbol) {
  const basis = currentTargetUpper - currentEffr;
  let dist = new Map([[0, 1]]); // lattice step (x STEP) from currentEffr -> probability
  const results = [];

  for (const meeting of meetings) {
    const [year, month, day] = meeting.date.split('-').map(Number);
    const n = daysInMonth(year, month);
    const daysPre = day;
    const daysPost = n - day;
    const futures = futuresBySymbol[meeting.date];

    if (!futures?.price || daysPost <= 0) {
      results.push({
        date: meeting.date, label: meeting.label,
        error: futures?.price ? 'meeting falls on the last day of its contract month' : (futures?.error || 'futures data unavailable'),
      });
      continue; // distribution carries forward unchanged — no info gained
    }

    const entryAvgEffr = [...dist].reduce((sum, [step, p]) => sum + (currentEffr + step * STEP) * p, 0);
    const impliedAvg = 100 - futures.price;
    const expectedMove = (impliedAvg - entryAvgEffr) * n / daysPost;

    const loSteps = Math.floor(expectedMove / STEP + 1e-9);
    const frac = expectedMove / STEP - loSteps;
    const nextDist = new Map();
    const add = (step, p) => nextDist.set(step, (nextDist.get(step) || 0) + p);
    for (const [step, p] of dist) {
      add(step + loSteps, p * (1 - frac));
      if (frac > 1e-9) add(step + loSteps + 1, p * frac);
    }
    dist = nextDist;

    const rows = [...dist.entries()]
      .filter(([, p]) => p > 0.001)
      .map(([step, p]) => {
        const upper = round(currentTargetUpper + step * STEP, 2);
        return { upper, lower: round(upper - STEP, 2), probability: round(p * 100, 1) };
      })
      .sort((a, b) => b.upper - a.upper);

    results.push({
      date: meeting.date,
      label: meeting.label,
      contractSymbol: futures.symbol,
      contractPrice: futures.price,
      contractAsOf: futures.date,
      impliedAvgRate: round(impliedAvg, 3),
      expectedMoveBp: round(expectedMove * 100, 1),
      rows,
    });
  }

  return { basis: round(basis, 3), meetings: results };
}

async function getFedWatchData() {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = FOMC_MEETINGS.filter(m => m.date >= today);
  if (!upcoming.length) throw new Error('No upcoming FOMC meetings in the hardcoded schedule — update FOMC_MEETINGS');

  const [effrResult, targetResult, ...futuresResults] = await Promise.allSettled([
    fetchFredLatest('EFFR'),
    fetchFredLatest('DFEDTARU'),
    ...upcoming.map(m => {
      const [year, month] = m.date.split('-').map(Number);
      return fetchFuturesClose(year, month);
    }),
  ]);

  if (effrResult.status !== 'fulfilled' || targetResult.status !== 'fulfilled') {
    throw new Error('Unable to fetch current EFFR/target rate from FRED');
  }

  const errors = {};
  const futuresBySymbol = {};
  upcoming.forEach((meeting, index) => {
    const result = futuresResults[index];
    if (result.status === 'fulfilled') futuresBySymbol[meeting.date] = result.value;
    else errors[meeting.date] = result.reason?.message || 'Futures fetch failed';
  });

  const { basis, meetings } = computeFedWatch(
    upcoming, effrResult.value.value, targetResult.value.value, futuresBySymbol,
  );

  return {
    fetchedAt: new Date().toISOString(),
    currentEffr: effrResult.value,
    currentTargetUpper: targetResult.value,
    basis,
    meetings,
    errors,
    methodologyNote: 'Derived from CME 30-Day Fed Funds futures (ZQ) settlement prices, not CME’s official FedWatch API. Approximate — see server/scrapers/fedWatch.js.',
  };
}

module.exports = {
  getFedWatchData, computeFedWatch, fetchFuturesClose, fetchFredLatest, futuresSymbol,
  FOMC_MEETINGS,
};
