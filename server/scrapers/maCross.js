/**
 * Liquidity → Technical → MA Cross: for every constituent of each index the
 * Breadth page tracks, the 5-day and 20-day simple moving average of the
 * closing price, and the names whose two averages crossed on the most recent
 * session.
 *
 * No new scraping: indexBreadth.js already maintains a rolling raw-price cache
 * per index (`breadthRaw<Index>History`, shape
 * `{ [date]: { [ticker]: { close, volume } } }`, ~260 trailing sessions) in
 * order to compute its 50/200-day breadth aggregates. A 20-day average needs
 * far less history than that, so this module is a pure read over those blobs
 * and adds no storage of its own — consistent with the "rolling cache only,
 * never hoard raw per-ticker history" rule the breadth pipeline follows.
 *
 * "Crossed" is evaluated between the last two sessions on which a ticker has
 * both averages defined:
 *   golden — SMA5 was at or below SMA20, and is now above it.
 *   death  — SMA5 was at or above SMA20, and is now below it.
 * Because the set is recomputed from the latest session every time the breadth
 * job refreshes a cache, the returned names change from day to day.
 *
 * One index is served per call. The raw caches are large (the S&P 500's alone
 * is ~5 MB, TOPIX's more), so the route loads only the blob it was asked for
 * rather than every index at once.
 */
'use strict';

const path = require('path');
const storage = require('../storage');
const { INDEX_CONFIGS } = require('./indexBreadth');

const SMA_SHORT = 5;
const SMA_LONG = 20;

// Trailing sessions returned per crossing ticker for the detail chart. Enough
// to show the two averages converging into the cross with context around it,
// while keeping the payload to the crossing names only.
const CHART_WINDOW = 120;

// Keyed off indexBreadth's own config so the two stay in sync: every index
// with a breadth series has an MA Cross view, in the same order.
const RAW_BLOB_BY_KEY = {
  sp500: 'breadthRawSp500History',
  ndx: 'breadthRawNdxHistory',
  hsi: 'breadthRawHsiHistory',
  csi300: 'breadthRawCsi300History',
  sox: 'breadthRawSoxHistory',
  nikkei225: 'breadthRawNikkei225History',
  chinext: 'breadthRawChinextHistory',
  taiex: 'breadthRawTaiexHistory',
  kospi200: 'breadthRawKospi200History',
  topix: 'breadthRawTopixHistory',
};

/** [{ key, label, blob }] for every index the Breadth page covers. */
const MA_CROSS_INDEXES = INDEX_CONFIGS.map(({ key, label }) => ({
  key,
  label,
  blob: RAW_BLOB_BY_KEY[key],
}));

const DEFAULT_INDEX = 'sp500';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function rawFile(blobName) {
  return path.join(__dirname, '..', 'data', `${blobName}.json`);
}

function isKnownIndex(key) {
  return Object.prototype.hasOwnProperty.call(RAW_BLOB_BY_KEY, key);
}

function loadRaw(indexKey) {
  const blob = RAW_BLOB_BY_KEY[indexKey];
  return storage.read(blob, rawFile(blob));
}

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
 * Round the two averages for display, keeping their ordering visible.
 *
 * A crossing is decided on unrounded values, so the gap on the crossing day can
 * be smaller than a cent — at which point both averages round to the same
 * number and the summary reads "5-day dropped below the 20-day … 39.33 / 39.33",
 * which contradicts itself. Widen the precision just enough for the two to
 * differ (seen on thinly-priced TAIEX names).
 */
function roundPairForDisplay(short, long) {
  if (short == null || long == null) return [round2(short), round2(long)];
  for (let decimals = 2; decimals <= 6; decimals += 1) {
    const factor = 10 ** decimals;
    const a = Math.round(short * factor) / factor;
    const b = Math.round(long * factor) / factor;
    if (a !== b) return [a, b];
  }
  return [short, long];
}

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
 * Compute the latest session's crossings across one index.
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

    // Chart series stay at 2dp — a sub-cent gap is invisible on a chart — but
    // the headline pair keeps enough precision to show which is above.
    const [sma5Display, sma20Display] = roundPairForDisplay(sma5[cross.index], sma20[cross.index]);
    crosses.push({
      ticker,
      direction: cross.direction,
      close: round2(closes[cross.index]),
      sma5: sma5Display,
      sma20: sma20Display,
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

/**
 * Read one index's crossings. `indexKey` must be one of MA_CROSS_INDEXES;
 * anything else throws rather than silently falling back, so a typo in the
 * query string surfaces instead of returning the wrong index's names.
 */
function readMaCross(indexKey = DEFAULT_INDEX) {
  if (!isKnownIndex(indexKey)) throw new Error(`Unknown MA cross index: ${indexKey}`);
  const meta = MA_CROSS_INDEXES.find(index => index.key === indexKey);
  return { index: indexKey, label: meta.label, ...computeMaCross(loadRaw(indexKey)) };
}

/* ── Index-level crossings (the index itself, not its constituents) ────── */

// Enough calendar span to fill CHART_WINDOW sessions and warm up the 20-day
// average ahead of them, across markets with differing holiday calendars.
const INDEX_LEVEL_LOOKBACK_DAYS = 400;

/**
 * The same 5/20-day test applied to each index's own level.
 *
 * Source is globalIndicesHistory — the index closes that already feed the RSI
 * chart — not the constituent caches. Every index is returned whether or not it
 * crossed, so the UI can mark the ones that did and still chart the ones that
 * did not.
 *
 * The payload uses one shared calendar across markets, so a market that was
 * closed on the newest date carries a null there. `asOf` is therefore each
 * index's own most recent traded session, not the calendar's last row.
 */
function computeIndexLevelCrosses(payload) {
  const dates = payload?.dates ?? [];
  const seriesByKey = new Map((payload?.series ?? []).map(series => [series.ticker, series]));

  return MA_CROSS_INDEXES.map(({ key, label }) => {
    const closes = seriesByKey.get(key)?.closes ?? [];
    const sma5 = rollingAverage(closes, SMA_SHORT);
    const sma20 = rollingAverage(closes, SMA_LONG);

    let latest = -1;
    for (let i = dates.length - 1; i >= 0; i -= 1) {
      if (sma5[i] != null && sma20[i] != null) { latest = i; break; }
    }
    if (latest === -1) return { key, label, asOf: null, direction: null };

    const cross = detectCross(sma5, sma20, dates);
    const chartStart = Math.max(0, dates.length - CHART_WINDOW);
    const [sma5Display, sma20Display] = roundPairForDisplay(sma5[latest], sma20[latest]);

    return {
      key,
      label,
      asOf: dates[latest],
      // null when the two averages are simply on the same side today.
      direction: cross ? cross.direction : null,
      close: round2(closes[latest]),
      sma5: sma5Display,
      sma20: sma20Display,
      // Which side the short average sits on, reported every day — useful even
      // on the days between crossings.
      stance: sma5[latest] > sma20[latest] ? 'above' : 'below',
      dates: dates.slice(chartStart),
      closes: closes.slice(chartStart).map(round2),
      sma5Series: sma5.slice(chartStart).map(round2),
      sma20Series: sma20.slice(chartStart).map(round2),
    };
  });
}

function readIndexLevelCrosses() {
  const { readGlobalIndices } = require('./globalIndices');
  const end = new Date();
  const start = new Date(end.getTime() - INDEX_LEVEL_LOOKBACK_DAYS * 86400000);
  const payload = readGlobalIndices(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  return { indexes: computeIndexLevelCrosses(payload) };
}

module.exports = {
  readMaCross,
  readIndexLevelCrosses,
  isKnownIndex,
  MA_CROSS_INDEXES,
  RAW_BLOB_BY_KEY,
  DEFAULT_INDEX,
  _test: { computeMaCross, computeIndexLevelCrosses, detectCross, rollingAverage },
};
