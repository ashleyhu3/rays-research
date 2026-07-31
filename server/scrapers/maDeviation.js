/**
 * Liquidity → Technical → Deviation: how far each index the Breadth page covers
 * — plus gold — trades above or below its own 200-day moving average, as a
 * percentage of that average.
 *
 *   deviation = (close / 200-day SMA − 1) × 100
 *
 * A positive reading means price sits above its long average (the blue band on
 * the chart), a negative one below it (the red band). The −10% line is the
 * conventional "discount" marker: historically a level indices only reach in a
 * broad drawdown.
 *
 * Sourcing, in keeping with the "no duplicate raw history" rule the breadth
 * pipeline follows:
 *   - The ten indices reuse globalIndicesHistory, the index close series that
 *     already feeds the RSI and index-level MA Cross charts. Nothing new is
 *     stored for them; the deviation is derived on read.
 *   - Gold has no index feed here, so this module owns one small blob of its
 *     own (`goldPriceHistory`, one close per day from COMEX gold futures).
 *
 * A 200-day average needs 200 traded sessions of warm-up, so the first ~10
 * months of any series carry a null deviation. Markets keep their own
 * calendars, so the payload is assembled on the union of all trading dates and
 * a market that was closed on a given date carries a null there — the rolling
 * average skips those rather than resetting its window, matching maCross.js.
 */
'use strict';

const path = require('path');
const { createPersistedSeries, isoDaysAgo } = require('./persistedSeries');
const { readGlobalIndices } = require('./globalIndices');
const { INDEX_CONFIGS } = require('./indexBreadth');

const MA_WINDOW = 200;

// Matches the depth of globalIndicesHistory, so every series on the chart
// starts around the same date rather than gold running years past the indices.
const DEFAULT_BACKFILL_DAYS = 1825;

// Cron top-up window. Wide enough that a few missed runs (or a late revision)
// still get picked up, small enough to stay a cheap request.
const DEFAULT_UPDATE_DAYS = 45;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// COMEX front-month gold. Yahoo carries it back past 2015 with a daily close,
// which is what the 200-day average needs; the GLD ETF was the alternative but
// its NAV drifts from spot by the fund's accrued fees.
const GOLD = { ticker: 'gold', label: 'Gold', name: 'Gold Futures (COMEX)' };
const GOLD_SYMBOL = 'GC=F';

const GOLD_HISTORY = createPersistedSeries({
  blob: 'goldPriceHistory',
  file: path.join(__dirname, '..', 'data', 'goldPriceHistory.json'),
  tickers: [GOLD],
  fields: ['closes'],
});

/** The ten Breadth indices, in the Breadth page's order, then gold. */
const DEVIATION_SERIES = [
  ...INDEX_CONFIGS.map(({ key, label }) => ({ key, label })),
  { key: GOLD.ticker, label: GOLD.label },
];

const DEFAULT_SERIES = DEVIATION_SERIES[0].key;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      fetchOptions: { headers: { 'User-Agent': BROWSER_UA } },
    });
  }
  return _yf;
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/* ── Gold close history (the only series this module stores) ─────────── */

async function getGoldPrices(startDate, endDate = new Date()) {
  const end = new Date(endDate);
  end.setUTCDate(end.getUTCDate() + 1); // Yahoo's period2 is exclusive
  const chart = await getYF().chart(GOLD_SYMBOL, {
    period1: new Date(startDate),
    period2: end,
    interval: '1d',
  });

  const points = (chart?.quotes ?? [])
    .map(quote => ({ date: isoDate(quote.date), close: quote.close }))
    .filter(point => ISO_DATE.test(point.date ?? '') && Number.isFinite(point.close));

  const dates = [...new Set(points.map(point => point.date))].sort();
  const byDate = new Map(points.map(point => [point.date, point.close]));
  return {
    dates,
    series: [{ ...GOLD, closes: dates.map(date => byDate.get(date) ?? null) }],
  };
}

async function updateGoldPrice(days = DEFAULT_UPDATE_DAYS) {
  GOLD_HISTORY.merge(await getGoldPrices(isoDaysAgo(days)));
  return GOLD_HISTORY.assemble();
}

/* ── Deviation from the 200-day average ─────────────────────────────── */

// Same "N valid values, gaps don't reset the window" semantics as maCross.js
// and indexBreadth.js: a market closed on a session another market traded keeps
// its window intact instead of starting the 200-day warm-up again.
function rollingAverage(values, windowSize) {
  const window = [];
  let sum = 0;
  return values.map(value => {
    if (value == null || !Number.isFinite(value)) return null;
    window.push(value);
    sum += value;
    if (window.length > windowSize) sum -= window.shift();
    return window.length === windowSize ? sum / windowSize : null;
  });
}

const round2 = value => (value == null ? null : Math.round(value * 100) / 100);

/**
 * Per-date deviation for one close series.
 *
 * The average is carried forward across dates the series did not trade — the
 * deviation itself stays null there, so the chart shows a gap rather than a
 * flat segment implying a price that never printed.
 */
function computeDeviationSeries(closes) {
  const averages = rollingAverage(closes, MA_WINDOW);
  const ma = [];
  const deviation = [];
  let lastAverage = null;

  for (let i = 0; i < closes.length; i += 1) {
    if (averages[i] != null) lastAverage = averages[i];
    const close = closes[i];
    const average = lastAverage;
    const usable = close != null && Number.isFinite(close) && average != null && average !== 0;
    ma.push(usable ? average : null);
    deviation.push(usable ? (close / average - 1) * 100 : null);
  }
  return { ma, deviation };
}

/** Index of the last date at which `values` has a finite entry, or -1. */
function lastDefinedIndex(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] != null && Number.isFinite(values[i])) return i;
  }
  return -1;
}

/**
 * Assemble every series onto one date axis.
 *
 * `sources` is `{ [key]: { [date]: close } }`. Returns `{ dates, series }`,
 * where each series carries its full deviation history plus the latest
 * observation's close / average / deviation and the date it belongs to.
 */
function buildDeviationPayload(sources) {
  const dateSet = new Set();
  for (const byDate of Object.values(sources)) {
    for (const date of Object.keys(byDate)) if (ISO_DATE.test(date)) dateSet.add(date);
  }
  const allDates = [...dateSet].sort();

  const computed = DEVIATION_SERIES.map(({ key, label }) => {
    const byDate = sources[key] ?? {};
    const closes = allDates.map(date => {
      const close = byDate[date];
      return close != null && Number.isFinite(close) ? close : null;
    });
    return { key, label, closes, ...computeDeviationSeries(closes) };
  });

  // Trim the leading stretch where no series has cleared its 200-day warm-up.
  // Those rows would render as an empty band on every chart.
  const firstUsable = allDates.findIndex((_, i) => computed.some(series => series.deviation[i] != null));
  const start = firstUsable === -1 ? allDates.length : firstUsable;
  const dates = allDates.slice(start);

  const series = computed.map(({ key, label, closes, ma, deviation }) => {
    const trimmed = deviation.slice(start);
    const latest = lastDefinedIndex(trimmed);
    return {
      key,
      label,
      deviation: trimmed.map(round2),
      // The series' own most recent traded session, not the axis' last row:
      // markets that were shut on the newest date still report their own close.
      asOf: latest === -1 ? null : dates[latest],
      close: latest === -1 ? null : round2(closes.slice(start)[latest]),
      ma200: latest === -1 ? null : round2(ma.slice(start)[latest]),
      latest: latest === -1 ? null : round2(trimmed[latest]),
    };
  });

  return { dates, series };
}

/** `{ [date]: close }` for each index, from the shared index close history. */
function indexClosesByDate(payload) {
  const dates = payload?.dates ?? [];
  const out = {};
  for (const series of payload?.series ?? []) {
    const byDate = {};
    for (let i = 0; i < dates.length; i += 1) {
      const close = series.closes?.[i];
      if (close != null && Number.isFinite(close)) byDate[dates[i]] = close;
    }
    out[series.ticker] = byDate;
  }
  return out;
}

function goldClosesByDate() {
  const payload = GOLD_HISTORY.assemble();
  const dates = payload.dates ?? [];
  const closes = payload.series?.[0]?.closes ?? [];
  const byDate = {};
  for (let i = 0; i < dates.length; i += 1) {
    if (closes[i] != null && Number.isFinite(closes[i])) byDate[dates[i]] = closes[i];
  }
  return byDate;
}

/**
 * Every series' deviation history, in one payload.
 *
 * All eleven are returned together: one date axis plus ~1,100 rounded numbers
 * per series is a small response, and it lets the page switch between them
 * without a second request.
 */
function readMaDeviation() {
  const sources = indexClosesByDate(readGlobalIndices(null, null));
  sources[GOLD.ticker] = goldClosesByDate();
  const { dates, series } = buildDeviationPayload(sources);
  return { window: MA_WINDOW, start: dates[0] ?? null, end: dates.at(-1) ?? null, dates, series };
}

module.exports = {
  getGoldPrices,
  updateGoldPrice,
  readMaDeviation,
  DEVIATION_SERIES,
  DEFAULT_SERIES,
  DEFAULT_BACKFILL_DAYS,
  MA_WINDOW,
  _test: { rollingAverage, computeDeviationSeries, buildDeviationPayload },
};
