/**
 * Shipping — Strait of Hormuz throughput plus tanker, dry-bulk and container
 * freight indices.
 *
 * Sources, per series (no single provider publishes all of them for free):
 *   • Hormuz throughput  — hormuzstraitmonitor.com's own /api/throughput feed.
 *   • BDI / SCFI / WCI   — Trading Economics market charts (already used by the
 *                          Commodity page), which carry multi-year history.
 *   • Capesize, Panamax, Supramax, dirty & clean tanker — StockQ, which
 *                          republishes the Baltic Exchange settlements. The
 *                          English site's chart data file carries ~5 years of
 *                          daily closes per index, so a normal refresh keeps
 *                          the whole window current on its own.
 *   • CCFI               — Shanghai Shipping Exchange. It is the only publisher
 *                          of CCFI that does not sit behind a subscription, and
 *                          it refuses connections from outside mainland China,
 *                          so this leg is expected to fail from a dev machine
 *                          and is reported as an error rather than throwing.
 *
 * `referenceUrl` on each series records the page the index was requested from.
 * Do not "fix" a series by scraping it: Investing.com blocks non-browser
 * clients outright, and its Baltic tanker/Capesize/Panamax/Supramax pages have
 * been frozen since 31 Mar 2024 (Dirty Tanker still reads 1,107) — StockQ is
 * both reachable and current, and its BDI ties out to Trading Economics to the
 * point.
 *
 * Every value lands in one date-keyed blob, so a refresh only ever tops up the
 * accumulated history rather than replacing it.
 */
'use strict';

const path = require('path');
const { decodeChartPayload } = require('./macro');
const storage = require('../storage');

const BLOB = 'shippingHistory';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'shippingHistory.json');

const HORMUZ_URL = 'https://hormuzstraitmonitor.com/api/throughput';
const TE_TOKEN_PAGE = 'https://tradingeconomics.com/commodity/baltic';
const TE_DATA = 'https://d3ii0wo49og5mi.cloudfront.net';
const TE_KEY = 'tradingeconomics-charts-core-api-key';
const STOCKQ_INDEX = code => `https://www.stockq.org/index/${code}.php`;
// StockQ's English pages hand their Google Charts data to the browser as a
// static JS file holding the full plotted series — ~5 years of daily closes in
// one request, versus the ~20 sessions the HTML table shows.
const STOCKQ_CHART = code => `https://en.stockq.org/index/js/${code}_sma.js`;
// One board carrying the latest close for every index on this page.
const STOCKQ_BOARD = 'https://www.stockq.org/market/freight.php';
const SSE_INDEX = type => `https://www.sse.net.cn/index/singleIndex?indexType=${type}`;
const UA = 'Mozilla/5.0 Signal Shipping Dashboard';

const HORMUZ = {
  id: 'hormuz',
  group: 'hormuz',
  name: 'Strait Throughput — % of Pre-War Baseline',
  unit: '% of pre-war baseline',
  frequency: 'Daily',
  source: 'Hormuz Strait Monitor',
  sourceUrl: 'https://hormuzstraitmonitor.com/',
};

/** Trading Economics market tickers. `deepSpans` seeds an empty blob and is
 *  queried oldest-first, so the daily window overwrites the coarser weekly one
 *  where the two overlap. Routine refreshes use the ladder below instead. */
const TE_SERIES = [
  {
    id: 'bdi', group: 'dry-bulk', ticker: 'bdiy:ind', deepSpans: ['10y', '3y'],
    name: 'Baltic Dry Index', unit: 'index points', frequency: 'Daily',
    source: 'Baltic Exchange via Trading Economics',
    sourceUrl: 'https://tradingeconomics.com/commodity/baltic',
    referenceUrl: 'https://www.investing.com/indices/baltic-dry',
  },
  {
    // TE resamples every span shorter than 10y to one point per calendar day.
    // SCFI prints weekly, so a short span repeats the last reading across the
    // days between publications — invented data. This series is therefore only
    // read at its native 10y span; routine top-ups come from StockQ.
    id: 'scfi', group: 'container', ticker: 'spscfi:com', deepSpans: ['10y'], resampledByTe: true,
    name: 'SCFI — Shanghai Containerized Freight Index', unit: 'index points', frequency: 'Weekly',
    source: 'Shanghai Shipping Exchange via Trading Economics',
    sourceUrl: 'https://www.sse.net.cn/index/singleIndex?indexType=scfi',
    referenceUrl: 'https://www.sse.net.cn/index/singleIndex?indexType=scfi',
  },
  {
    id: 'wci', group: 'container', ticker: 'wci:com', deepSpans: ['3y'],
    name: 'Drewry World Container Index', unit: 'USD per 40ft container', frequency: 'Weekly',
    source: 'Drewry via Trading Economics',
    sourceUrl: 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry',
    referenceUrl: 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry',
  },
];

/** StockQ index pages. BDI and SCFI are listed here as well: their Trading
 *  Economics history is longer, but StockQ settles a day or two earlier. */
const STOCKQ_SERIES = [
  {
    id: 'bdti', group: 'tankers', code: 'BDTI', cadenceDays: 1,
    name: 'Baltic Dirty Tanker Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-dirty-tanker',
  },
  {
    id: 'bcti', group: 'tankers', code: 'BCTI', cadenceDays: 1,
    name: 'Baltic Clean Tanker Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-clean-tanker',
  },
  {
    id: 'bdi', group: 'dry-bulk', code: 'BDI', cadenceDays: 1,
    name: 'Baltic Dry Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-dry',
  },
  {
    id: 'bci', group: 'dry-bulk', code: 'BCI', cadenceDays: 1,
    name: 'Baltic Capesize Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-capesize',
  },
  {
    id: 'bpi', group: 'dry-bulk', code: 'BPI', cadenceDays: 1,
    name: 'Baltic Panamax Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-panamax',
  },
  {
    id: 'bsi', group: 'dry-bulk', code: 'BSI', cadenceDays: 1,
    name: 'Baltic Supramax Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-supramax',
  },
  {
    id: 'scfi', group: 'container', code: 'SCFI', cadenceDays: 7,
    name: 'SCFI — Shanghai Containerized Freight Index', unit: 'index points', frequency: 'Weekly',
    referenceUrl: 'https://www.sse.net.cn/index/singleIndex?indexType=scfi',
  },
];

const SSE_SERIES = [
  {
    id: 'ccfi', group: 'container', indexType: 'ccfi',
    name: 'CCFI — China Containerized Freight Index', unit: 'index points', frequency: 'Weekly',
    source: 'Shanghai Shipping Exchange',
    sourceUrl: SSE_INDEX('ccfi'),
    referenceUrl: SSE_INDEX('ccfi'),
  },
];

// Presentation metadata, keyed by series id. Where a series has more than one
// upstream (BDI, SCFI), the entry names the provider that supplies its history.
const SERIES_META = {
  hormuz: HORMUZ,
  bdti: {
    id: 'bdti', group: 'tankers', name: 'Baltic Dirty Tanker Index', unit: 'index points',
    frequency: 'Daily', source: 'Baltic Exchange via StockQ', sourceUrl: STOCKQ_INDEX('BDTI'),
    referenceUrl: 'https://www.investing.com/indices/baltic-dirty-tanker',
  },
  bcti: {
    id: 'bcti', group: 'tankers', name: 'Baltic Clean Tanker Index', unit: 'index points',
    frequency: 'Daily', source: 'Baltic Exchange via StockQ', sourceUrl: STOCKQ_INDEX('BCTI'),
    referenceUrl: 'https://www.investing.com/indices/baltic-clean-tanker',
  },
  bdi: {
    id: 'bdi', group: 'dry-bulk', name: 'Baltic Dry Index', unit: 'index points',
    frequency: 'Daily', source: 'Baltic Exchange via Trading Economics & StockQ',
    sourceUrl: 'https://tradingeconomics.com/commodity/baltic',
    referenceUrl: 'https://www.investing.com/indices/baltic-dry',
  },
  bci: {
    id: 'bci', group: 'dry-bulk', name: 'Baltic Capesize Index', unit: 'index points',
    frequency: 'Daily', source: 'Baltic Exchange via StockQ', sourceUrl: STOCKQ_INDEX('BCI'),
    referenceUrl: 'https://www.investing.com/indices/baltic-capesize',
  },
  bpi: {
    id: 'bpi', group: 'dry-bulk', name: 'Baltic Panamax Index', unit: 'index points',
    frequency: 'Daily', source: 'Baltic Exchange via StockQ', sourceUrl: STOCKQ_INDEX('BPI'),
    referenceUrl: 'https://www.investing.com/indices/baltic-panamax',
  },
  bsi: {
    id: 'bsi', group: 'dry-bulk', name: 'Baltic Supramax Index', unit: 'index points',
    frequency: 'Daily', source: 'Baltic Exchange via StockQ', sourceUrl: STOCKQ_INDEX('BSI'),
    referenceUrl: 'https://www.investing.com/indices/baltic-supramax',
  },
  scfi: {
    id: 'scfi', group: 'container', name: 'SCFI — Shanghai Containerized Freight Index',
    unit: 'index points', frequency: 'Weekly',
    source: 'Shanghai Shipping Exchange via Trading Economics',
    sourceUrl: SSE_INDEX('scfi'), referenceUrl: SSE_INDEX('scfi'),
  },
  ccfi: SSE_SERIES[0],
  wci: TE_SERIES[2],
};

// Chart order on the page. Groups render as headed sections.
const SERIES_ORDER = ['hormuz', 'bdti', 'bcti', 'bdi', 'bci', 'bpi', 'bsi', 'scfi', 'ccfi', 'wci'];

const GROUPS = [
  { key: 'hormuz', label: 'Hormuz Throughput' },
  { key: 'tankers', label: 'Tankers' },
  { key: 'dry-bulk', label: 'Dry Bulk' },
  { key: 'container', label: 'Container' },
];

/* ── helpers ──────────────────────────────────────────────────────────── */

function finite(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* ── incremental refresh ──────────────────────────────────────────────
   Every upstream here publishes a fixed window rather than a "since" query,
   so the only lever is which window to ask for. A routine refresh already
   holds all but the last session or two, so it asks for the shortest window
   that still overlaps what is stored; a blob with no usable history (a fresh
   deploy) falls back to the deep seed. Overlap matters — a window that merely
   reached the stored end date would drop anything published in between. */

// Trading Economics span → the calendar days it covers, shortest first.
const TE_SPAN_LADDER = [
  ['1w', 7], ['1m', 31], ['3m', 92], ['6m', 183], ['1y', 365], ['3y', 1095], ['10y', 3650],
];
// StockQ's rolling index table lists ~20 trading sessions; past that the blob
// would gap, so the refresh has to pay for the full chart file instead.
const STOCKQ_TABLE_DAYS = 25;
// Slack added to every gap so a long weekend, a holiday, or a source that
// publishes a few days late can never land outside the requested window.
const WINDOW_MARGIN_DAYS = 7;
// How far back StockQ's rolling table reaches for a weekly index: ~20 rows at
// one per week, kept conservative. Past this a resampled series has to come
// from Trading Economics' native span instead.
const RESAMPLED_STOCKQ_REACH_DAYS = 100;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(iso) {
  if (!isIsoDate(iso)) return Infinity;
  const elapsed = Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86400000);
  return Number.isFinite(elapsed) ? Math.max(elapsed, 0) : Infinity;
}

/** Most recent stored date carrying a real value for one series. */
function latestDateFor(history, id) {
  let latest = null;
  for (const date of Object.keys(history)) {
    if (!isIsoDate(date) || !Number.isFinite(history[date]?.[id])) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

/** The board carries exactly one close per index, so it can only close a gap
 *  of at most one publication. A daily index is measured in weekday sessions
 *  (so a normal Monday refresh stays on the cheap path); a weekly one is
 *  measured against its own cadence. */
function boardCoversGap(meta, iso) {
  if (!isIsoDate(iso)) return false;
  return (meta.cadenceDays ?? 1) >= 7
    ? daysSince(iso) <= (meta.cadenceDays ?? 7) * 2 - 1
    : pendingSessions(iso) <= 1;
}

/** Weekday sessions that could have printed since `iso`. Counting weekdays
 *  rather than calendar days keeps a normal Monday refresh cheap. Holidays
 *  only ever make this over-count, which errs toward fetching more. */
function pendingSessions(iso) {
  if (!isIsoDate(iso)) return Infinity;
  const cursor = new Date(`${iso}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let count = 0;
  while (cursor < today && count <= 32) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/** Spans to request for one series, or `null` to skip Trading Economics this
 *  run. Returns the shortest window that still overlaps stored history. */
function teSpansFor(meta, staleDays) {
  if (!Number.isFinite(staleDays)) return meta.deepSpans;
  const needed = staleDays + WINDOW_MARGIN_DAYS;
  const match = TE_SPAN_LADDER.find(([, covers]) => covers >= needed);
  if (!match) return meta.deepSpans;
  if (meta.resampledByTe) {
    // Short spans would invent daily points for this weekly series, so skip TE
    // while StockQ's ~20 weekly rows can still close the gap, and pay for the
    // native span only once it cannot.
    return staleDays > RESAMPLED_STOCKQ_REACH_DAYS ? meta.deepSpans : null;
  }
  return [match[0]];
}

async function fetchText(url, { headers = {}, timeout = 25000 } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.text();
}

/* ── Hormuz Strait Monitor ────────────────────────────────────────────── */

/** The monitor's feed carries the % of the pre-war baseline plus the transit
 *  count and an occasional event note, all of which the chart surfaces. */
function parseHormuz(payload) {
  const rows = {};
  for (const point of payload?.history ?? []) {
    const value = finite(point?.percentOfBaseline);
    if (!isIsoDate(point?.date) || value == null) continue;
    rows[point.date] = {
      hormuz: value,
      ...(finite(point.vessels) == null ? {} : { hormuzVessels: finite(point.vessels) }),
      ...(point.note ? { hormuzNote: String(point.note) } : {}),
    };
  }
  const annotations = (payload?.annotations ?? [])
    .filter(item => isIsoDate(item?.date) && item?.label)
    .map(item => ({ date: item.date, label: String(item.label) }));
  return { rows, annotations };
}

async function fetchHormuz() {
  return parseHormuz(JSON.parse(await fetchText(HORMUZ_URL)));
}

/* ── Trading Economics ────────────────────────────────────────────────── */

async function fetchTeChartContext() {
  const html = await fetchText(TE_TOKEN_PAGE);
  const pick = (pattern, fallback = '') => html.match(pattern)?.[1] ?? fallback;
  return {
    token: pick(/var TEChartsToken = '([^']+)'/),
    key: pick(/var TEObfuscationkey = '([^']+)'/, TE_KEY),
    dataSource: pick(/var TEChartsDatasource = '([^']+)'/, TE_DATA),
  };
}

/** The chart host currently serves these tickers unauthenticated, so start
 *  without a key and skip TE's ~380 KB commodity page entirely. If a request
 *  ever fails, scrape that page once per run for a real token and retry. */
function createTeContext() {
  let context = { token: null, key: TE_KEY, dataSource: TE_DATA };
  let upgrading = null;
  return {
    current: () => context,
    upgraded: () => Boolean(upgrading),
    upgrade() {
      upgrading = upgrading ?? fetchTeChartContext().then(fresh => { context = fresh; return fresh; });
      return upgrading;
    },
  };
}

/** TE returns `[epochSeconds, close, …]` rows; only the close is charted. */
function parseTeSeries(rows = []) {
  const out = {};
  for (const row of rows) {
    const seconds = Number(row?.[0]);
    const close = finite(row?.[1]);
    if (!Number.isFinite(seconds) || close == null) continue;
    out[new Date(seconds * 1000).toISOString().slice(0, 10)] = close;
  }
  return out;
}

async function fetchTeSpan(context, ticker, span) {
  const url = `${context.dataSource}/markets/${encodeURIComponent(ticker)}?span=${span}&ohlc=1`;
  const raw = await fetchText(url, { headers: context.token ? { 'x-api-key': context.token } : {} });
  const decoded = decodeChartPayload(JSON.parse(raw), context.key);
  const values = parseTeSeries(decoded?.series?.[0]?.data);
  if (!Object.keys(values).length) throw new Error(`no ${span} history for ${ticker}`);
  return values;
}

async function fetchTe(teContext, meta, spans) {
  const values = {};
  const failures = [];
  // Longer spans come back weekly; the shorter daily span is applied last so it
  // wins wherever the two overlap.
  for (const span of spans) {
    try {
      Object.assign(values, await fetchTeSpan(teContext.current(), meta.ticker, span));
    } catch (error) {
      // A tokenless request is the normal path; a failure is the cue to fetch
      // a real token (once) and try that span again before giving up on it.
      try {
        await teContext.upgrade();
        Object.assign(values, await fetchTeSpan(teContext.current(), meta.ticker, span));
      } catch (retry) {
        failures.push(`${span}: ${retry.message}`);
      }
    }
  }
  if (!Object.keys(values).length) throw new Error(failures.join('; ') || 'no history returned');
  return values;
}

/* ── StockQ ───────────────────────────────────────────────────────────── */

/** Each index page ends with a two-column "date / close" table covering the
 *  last ~20 published sessions. */
function parseStockqIndexPage(html) {
  const values = {};
  const pattern = /(\d{4})\/(\d{2})\/(\d{2})\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>/g;
  for (const match of html.matchAll(pattern)) {
    const value = finite(match[4]);
    if (value == null) continue;
    values[`${match[1]}-${match[2]}-${match[3]}`] = value;
  }
  return values;
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** `[new Date('Jul 2, 2026'), 1850.00, …]` rows out of the chart's JS. The file
 *  declares one table per range button (1M…5Y); the longest one is the history
 *  worth keeping. Dates are parsed by month name rather than handed to `Date`,
 *  so the result cannot shift with the host's locale or timezone. */
function parseStockqChartJs(source) {
  const tables = [...String(source ?? '').matchAll(
    /var\s+\w+\s*=\s*google\.visualization\.arrayToDataTable\(\[([\s\S]*?)\]\s*\)\s*;/g,
  )];
  let best = {};
  for (const [, body] of tables) {
    const values = {};
    for (const match of body.matchAll(/new Date\('([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})'\)\s*,\s*([\d.]+)/g)) {
      const month = MONTHS[match[1].toLowerCase()];
      const value = finite(match[4]);
      if (!month || value == null) continue;
      values[`${match[3]}-${month}-${match[2].padStart(2, '0')}`] = value;
    }
    if (Object.keys(values).length > Object.keys(best).length) best = values;
  }
  return best;
}

/** `deep` pulls the ~5-year chart file (~125 KB); otherwise the rolling
 *  ~20-session table (~27 KB) is enough to close a routine gap. The chart file
 *  also stands in as the fallback whenever the table yields nothing. */
async function fetchStockq(meta, { deep = false } = {}) {
  if (!deep) {
    try {
      const recent = parseStockqIndexPage(await fetchText(STOCKQ_INDEX(meta.code)));
      if (Object.keys(recent).length) return recent;
    } catch { /* fall through to the chart file */ }
  }
  try {
    const charted = parseStockqChartJs(await fetchText(STOCKQ_CHART(meta.code), { timeout: 40000 }));
    if (Object.keys(charted).length) return charted;
  } catch { /* fall through to the index page */ }
  const values = parseStockqIndexPage(await fetchText(STOCKQ_INDEX(meta.code)));
  if (!Object.keys(values).length) throw new Error(`no rows parsed from StockQ ${meta.code}`);
  return values;
}

/** Rows on StockQ's multi-index listings — the per-session archive pages and
 *  the live "freight & currency" board — share a shape: a link naming the
 *  index, its close in the first cell after it, then a varying number of
 *  change/range columns, and the row's own as-of date as the last MM/DD cell.
 *  Matching that shape rather than a fixed column count lets one parser read
 *  both boards, which carry different column sets.
 *
 *  `asOf` is the newest date the page can legitimately describe; rows carry
 *  only MM/DD, so it also supplies the year. */
function parseStockqBoard(html, asOf) {
  const out = {};
  const asOfYear = Number(asOf.slice(0, 4));
  const asOfMonth = Number(asOf.slice(5, 7));
  for (const row of String(html ?? '').split(/<tr[^>]*>/i)) {
    const code = row.match(/href="\/index\/([A-Z]+)\.php"/)?.[1];
    const meta = STOCKQ_SERIES.find(series => series.code === code);
    if (!meta) continue;
    const value = finite(row.match(/<\/a>\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>/)?.[1]);
    const stamps = [...row.matchAll(/<td[^>]*>\s*(\d{2})\/(\d{2})\s*<\/td>/g)];
    const stamp = stamps[stamps.length - 1];
    if (value == null || !stamp) continue;
    // A December row on a January board belongs to the previous year; nothing
    // else can push a row past the board's own date.
    const year = asOfMonth === 1 && Number(stamp[1]) === 12 ? asOfYear - 1 : asOfYear;
    const date = `${year}-${stamp[1]}-${stamp[2]}`;
    if (!isIsoDate(date) || date > asOf) continue;
    out[date] = { ...(out[date] ?? {}), [meta.id]: value };
  }
  return out;
}

// Retained name for the per-session archive pages the deep backfill walks.
const parseStockqDailyPage = parseStockqBoard;

/** One request covering every StockQ-sourced index at its latest close — the
 *  cheapest possible top-up when the blob is only missing today's print. */
async function fetchStockqBoard() {
  const html = await fetchText(STOCKQ_BOARD);
  const rows = parseStockqBoard(html, todayIso());
  if (!Object.keys(rows).length) throw new Error('no rows parsed from the StockQ freight board');
  return rows;
}

async function fetchStockqDay(pageDate) {
  const [year, month, day] = pageDate.split('-');
  const url = `https://www.stockq.org/stock/history/${year}/${month}/${year}${month}${day}_tc.php`;
  return parseStockqDailyPage(await fetchText(url), pageDate);
}

/* ── Shanghai Shipping Exchange (CCFI) ────────────────────────────────── */

/** SSE renders its index chart from data embedded in the page. Three shapes
 *  have to be tolerated because the exchange rewrites this page periodically:
 *  paired `[date, value]` tuples, a categories array beside a values array, and
 *  a plain HTML table. */
function parseSseIndexPage(html) {
  const values = {};
  const addPoint = (rawDate, rawValue) => {
    const date = String(rawDate).trim().replace(/[/.]/g, '-');
    const value = finite(rawValue);
    if (isIsoDate(date) && value != null) values[date] = value;
  };

  for (const match of html.matchAll(/\[\s*["'](\d{4}[-/.]\d{2}[-/.]\d{2})["']\s*,\s*([\d.]+)\s*\]/g)) {
    addPoint(match[1], match[2]);
  }
  if (Object.keys(values).length) return values;

  for (const match of html.matchAll(/\{[^{}]*?["'](?:date|indexDate|dataDate|reportDate)["']\s*:\s*["'](\d{4}[-/.]\d{2}[-/.]\d{2})[^"']*["'][^{}]*?["'](?:value|indexValue|price|data)["']\s*:\s*["']?([\d.]+)/g)) {
    addPoint(match[1], match[2]);
  }
  if (Object.keys(values).length) return values;

  const dateList = html.match(/\[\s*(?:["']\d{4}[-/.]\d{2}[-/.]\d{2}["']\s*,\s*){3,}["']\d{4}[-/.]\d{2}[-/.]\d{2}["']\s*\]/);
  if (dateList) {
    const dates = dateList[0].match(/\d{4}[-/.]\d{2}[-/.]\d{2}/g) ?? [];
    const after = html.slice(dateList.index + dateList[0].length);
    const numberList = after.match(/\[\s*(?:[\d.]+\s*,\s*){3,}[\d.]+\s*\]/);
    const numbers = numberList ? (numberList[0].match(/[\d.]+/g) ?? []) : [];
    if (dates.length && dates.length === numbers.length) {
      dates.forEach((date, index) => addPoint(date, numbers[index]));
      if (Object.keys(values).length) return values;
    }
  }

  for (const match of html.matchAll(/(\d{4}[-/.]\d{2}[-/.]\d{2})\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>/g)) {
    addPoint(match[1], match[2]);
  }
  return values;
}

async function fetchSse(meta) {
  const values = parseSseIndexPage(await fetchText(SSE_INDEX(meta.indexType), { timeout: 30000 }));
  if (!Object.keys(values).length) throw new Error(`no rows parsed from SSE ${meta.indexType}`);
  return values;
}

/* ── persistence ──────────────────────────────────────────────────────── */

function loadHistory() {
  return storage.read(BLOB, HISTORY_FILE);
}

/** Turn `{ id: { date: value } }` into the date-keyed patches the blob stores. */
function toPatches(bySeries) {
  const patches = {};
  for (const [id, values] of Object.entries(bySeries)) {
    for (const [date, value] of Object.entries(values)) {
      if (!isIsoDate(date)) continue;
      patches[date] = { ...(patches[date] ?? {}), [id]: value };
    }
  }
  return patches;
}

function assemble(history, meta = {}) {
  const dates = Object.keys(history).filter(isIsoDate).sort();
  const series = {};
  for (const id of SERIES_ORDER) {
    const data = dates
      .filter(date => Number.isFinite(history[date]?.[id]))
      .map(date => ({
        date,
        value: history[date][id],
        ...(id === 'hormuz' && history[date].hormuzVessels != null ? { vessels: history[date].hormuzVessels } : {}),
        ...(id === 'hormuz' && history[date].hormuzNote ? { note: history[date].hormuzNote } : {}),
      }));
    series[id] = { ...SERIES_META[id], data };
  }
  return {
    groups: GROUPS,
    order: SERIES_ORDER,
    series,
    annotations: meta.annotations ?? history._annotations ?? [],
    updatedAt: meta.updatedAt ?? history._updatedAt ?? null,
    errors: meta.errors ?? history._errors ?? {},
  };
}

/* ── entry points ─────────────────────────────────────────────────────── */

/** `deep` forces every source's full window — used to seed an empty blob or to
 *  repair one, and taken automatically per series whose stored history is too
 *  stale for the short window to overlap it. */
async function updateShipping({ deep = false } = {}) {
  const bySeries = {};
  const errors = {};
  const history = loadHistory();
  let annotations = history._annotations ?? [];
  // Snapshot coverage before any merging, so each source's window is chosen
  // against what was actually stored at the start of this run.
  const latest = Object.fromEntries(
    SERIES_ORDER.map(id => [id, deep ? null : latestDateFor(history, id)]),
  );
  const staleness = Object.fromEntries(
    SERIES_ORDER.map(id => [id, daysSince(latest[id])]),
  );

  try {
    const hormuz = await fetchHormuz();
    // The monitor's payload is already date-keyed with extra per-day fields, so
    // it is merged straight in rather than through toPatches. It publishes the
    // whole timeline in ~2 KB, so there is no shorter window worth asking for.
    bySeries.__hormuz = hormuz.rows;
    annotations = hormuz.annotations.length ? hormuz.annotations : annotations;
  } catch (error) {
    errors.hormuz = `Hormuz Strait Monitor: ${error.message}`;
  }

  const teContext = createTeContext();
  for (const meta of TE_SERIES) {
    const spans = teSpansFor(meta, staleness[meta.id]);
    if (!spans) continue;  // StockQ covers this series' routine top-up
    try { bySeries[meta.id] = { ...(bySeries[meta.id] ?? {}), ...await fetchTe(teContext, meta, spans) }; }
    catch (error) { errors[meta.id] = `Trading Economics: ${error.message}`; }
  }

  // Cheapest StockQ tier first: while every index is at most one session
  // behind, a single board request tops all of them up. Anything still short
  // after that falls back to its own page (~20 sessions) or chart file (~5y).
  const boardCovers = STOCKQ_SERIES.filter(meta => !deep && boardCoversGap(meta, latest[meta.id]));
  if (boardCovers.length) {
    try {
      const board = await fetchStockqBoard();
      for (const meta of boardCovers) {
        const values = {};
        for (const [date, row] of Object.entries(board)) {
          if (row[meta.id] != null) values[date] = row[meta.id];
        }
        if (Object.keys(values).length) {
          bySeries[meta.id] = { ...(bySeries[meta.id] ?? {}), ...values };
          delete errors[meta.id];
        }
      }
    } catch (error) {
      // Not fatal: every series the board would have covered is re-fetched
      // individually below.
      errors.stockqBoard = `StockQ board: ${error.message}`;
    }
  }

  for (const meta of STOCKQ_SERIES) {
    if (bySeries[meta.id] && boardCovers.includes(meta)) continue;
    try {
      const useChart = staleness[meta.id] > STOCKQ_TABLE_DAYS;
      bySeries[meta.id] = { ...(bySeries[meta.id] ?? {}), ...await fetchStockq(meta, { deep: useChart }) };
      delete errors[meta.id];
      delete errors.stockqBoard;
    } catch (error) {
      if (!bySeries[meta.id]) errors[meta.id] = `StockQ: ${error.message}`;
    }
  }

  for (const meta of SSE_SERIES) {
    try { bySeries[meta.id] = { ...(bySeries[meta.id] ?? {}), ...await fetchSse(meta) }; }
    catch (error) { errors[meta.id] = `Shanghai Shipping Exchange: ${error.message}`; }
  }

  const { __hormuz: hormuzRows, ...indexSeries } = bySeries;
  const patches = toPatches(indexSeries);
  for (const [date, row] of Object.entries(hormuzRows ?? {})) {
    patches[date] = { ...(patches[date] ?? {}), ...row };
  }

  const merged = storage.mergeDatedRows(BLOB, HISTORY_FILE, patches);
  // Field writes rather than a whole-blob write: a collector run can overlap a
  // warm web process, and replacing the document would erase the other's rows.
  storage.writeField(BLOB, HISTORY_FILE, '_updatedAt', new Date().toISOString());
  storage.writeField(BLOB, HISTORY_FILE, '_errors', errors);
  storage.writeField(BLOB, HISTORY_FILE, '_annotations', annotations);

  if (!Object.keys(patches).length && !Object.keys(merged).filter(isIsoDate).length) {
    throw new Error(`Shipping refresh returned nothing: ${Object.values(errors).join('; ')}`);
  }
  return assemble(merged);
}

function readShipping() {
  return assemble(loadHistory());
}

module.exports = {
  updateShipping,
  readShipping,
  fetchStockqDay,
  BLOB,
  HISTORY_FILE,
  _test: {
    parseHormuz, parseTeSeries, parseStockqIndexPage, parseStockqChartJs, parseStockqDailyPage,
    parseSseIndexPage, toPatches, assemble,
    latestDateFor, daysSince, pendingSessions, teSpansFor, parseStockqBoard, STOCKQ_TABLE_DAYS,
    SERIES_ORDER, GROUPS, SERIES_META, STOCKQ_SERIES, TE_SERIES,
  },
};
