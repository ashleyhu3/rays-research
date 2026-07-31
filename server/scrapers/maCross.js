/**
 * Liquidity → Technical → MA Cross: for every S&P 500 constituent, the 5-day
 * and 20-day simple moving average of the closing price, and the names whose
 * two averages crossed on the most recent session.
 *
 * No new scraping: indexBreadth.js already maintains a rolling raw-price cache
 * for the S&P 500 (`breadthRawSp500History`, shape
 * `{ [date]: { [ticker]: { close, volume } } }`, ~260 trailing sessions) in
 * order to compute its 50/200-day breadth aggregates. A 20-day average needs
 * far less history than that, so this module is a pure read over the same blob
 * and adds no storage of its own — consistent with the "rolling cache only,
 * never hoard raw per-ticker history" rule the breadth pipeline follows.
 *
 * "Crossed" is evaluated between the last two sessions on which a ticker has
 * both averages defined:
 *   golden — SMA5 was at or below SMA20, and is now above it.
 *   death  — SMA5 was at or above SMA20, and is now below it.
 * Because the set is recomputed from the latest session every time the breadth
 * job refreshes the cache, the returned names change from day to day.
 */
'use strict';

const path = require('path');
const storage = require('../storage');

const SMA_SHORT = 5;
const SMA_LONG = 20;

// Trailing sessions returned per crossing ticker for the detail chart. Enough
// to show the two averages converging into the cross with context around it,
// while keeping the payload to the crossing names only (typically 20-40).
const CHART_WINDOW = 120;

const RAW_BLOB = 'breadthRawSp500History';
const RAW_FILE = path.join(__dirname, '..', 'data', 'breadthRawSp500History.json');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function loadRaw() { return storage.read(RAW_BLOB, RAW_FILE); }

function sortedDates(history) {
  return Object.keys(history ?? {}).filter(date => ISO_DATE.test(date)).sort();
}

// Same "N valid values, gaps don't reset the window" semantics as the rolling
// averages in indexBreadth.js and GlobalPerformance.jsx, so a ticker that did
// not trade on a session shared with another market keeps its window intact.
function rollingAverage(values, windowSize) {
  const window = [];
  let sum = 0;
  return values.map(v => {
    if (v == null || !Number.isFinite(v)) return null;
    window.push(v);
    sum += v;
    if (window.length > windowSize) sum -= window.shift();
    return window.length === windowSize ? sum / windowSize : null;
  });
}

const round2 = v => (v == null ? null : Math.round(v * 100) / 100);

/**
 * Direction of the crossing at the end of a ticker's series, or null.
 *
 * The comparison uses the last two indices at which BOTH averages are defined
 * rather than the last two calendar rows: a ticker that is missing from the
 * final session (delisted mid-window, or a data gap) must not be read as a
 * cross, and a ticker with a one-day hole must still be compared against its
 * true previous observation.
 */
function detectCross(sma5, sma20, dates) {
  const defined = [];
  for (let i = dates.length - 1; i >= 0 && defined.length < 2; i -= 1) {
    if (sma5[i] != null && sma20[i] != null) defined.push(i);
  }
  if (defined.length < 2) return null;
  const [current, previous] = defined;
  const nowDiff = sma5[current] - sma20[current];
  const prevDiff = sma5[previous] - sma20[previous];
  if (prevDiff <= 0 && nowDiff > 0) return { direction: 'golden', index: current };
  if (prevDiff >= 0 && nowDiff < 0) return { direction: 'death', index: current };
  return null;
}

/**
 * Compute the latest session's crossings across the whole index.
 *
 * Returns `{ asOf, tickerCount, crosses }`, where each cross carries the
 * trailing close/SMA5/SMA20 series needed to render its chart. Tickers come
 * from the most recent session's row, which the breadth job populates from the
 * current constituent list — so names that have left the index age out on
 * their own rather than needing a second constituent fetch here.
 */
function computeMaCross(history) {
  const dates = sortedDates(history);
  if (!dates.length) return { asOf: null, tickerCount: 0, crosses: [] };

  const asOf = dates.at(-1);
  const tickers = Object.keys(history[asOf] ?? {}).sort();
  const chartStart = Math.max(0, dates.length - CHART_WINDOW);
  const chartDates = dates.slice(chartStart);
  const crosses = [];

  for (const ticker of tickers) {
    const closes = dates.map(date => history[date]?.[ticker]?.close ?? null);
    const sma5 = rollingAverage(closes, SMA_SHORT);
    const sma20 = rollingAverage(closes, SMA_LONG);
    const cross = detectCross(sma5, sma20, dates);
    // Only report a cross that happened on the session being reported, not a
    // stale one carried by a ticker that stopped updating days ago.
    if (!cross || dates[cross.index] !== asOf) continue;

    crosses.push({
      ticker,
      direction: cross.direction,
      close: round2(closes[cross.index]),
      sma5: round2(sma5[cross.index]),
      sma20: round2(sma20[cross.index]),
      dates: chartDates,
      closes: closes.slice(chartStart).map(round2),
      sma5Series: sma5.slice(chartStart).map(round2),
      sma20Series: sma20.slice(chartStart).map(round2),
    });
  }

  // Golden crosses first, then alphabetical — a stable order so the ticker
  // strip does not reshuffle between reads of the same session.
  crosses.sort((a, b) =>
    a.direction === b.direction ? a.ticker.localeCompare(b.ticker) : a.direction === 'golden' ? -1 : 1);

  return { asOf, tickerCount: tickers.length, crosses };
}

function readMaCross() {
  return computeMaCross(loadRaw());
}

module.exports = {
  readMaCross,
  RAW_BLOB,
  _test: { computeMaCross, detectCross, rollingAverage },
};
