/**
 * Shipping — Strait of Hormuz throughput plus tanker, dry-bulk and container
 * freight indices.
 *
 * Sources, per series (no single provider publishes all of them for free):
 *   • Hormuz throughput  — hormuzstraitmonitor.com's own /api/throughput feed.
 *   • BDI / SCFI / WCI   — Trading Economics market charts (already used by the
 *                          Commodity page), which carry multi-year history.
 *   • Capesize, Panamax, Supramax, dirty & clean tanker — StockQ, which
 *                          republishes the Baltic Exchange settlements. Each
 *                          index page carries a rolling ~20-session table, so
 *                          the long history comes from the persisted blob (see
 *                          scripts/backfillShipping.js for the one-off seed).
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

/** Trading Economics market tickers. `spans` are queried oldest-first so the
 *  daily window overwrites the coarser weekly one where the two overlap. */
const TE_SERIES = [
  {
    id: 'bdi', group: 'dry-bulk', ticker: 'bdiy:ind', spans: ['10y', '3y'],
    name: 'Baltic Dry Index', unit: 'index points', frequency: 'Daily',
    source: 'Baltic Exchange via Trading Economics',
    sourceUrl: 'https://tradingeconomics.com/commodity/baltic',
    referenceUrl: 'https://www.investing.com/indices/baltic-dry',
  },
  {
    id: 'scfi', group: 'container', ticker: 'spscfi:com', spans: ['10y'],
    name: 'SCFI — Shanghai Containerized Freight Index', unit: 'index points', frequency: 'Weekly',
    source: 'Shanghai Shipping Exchange via Trading Economics',
    sourceUrl: 'https://www.sse.net.cn/index/singleIndex?indexType=scfi',
    referenceUrl: 'https://www.sse.net.cn/index/singleIndex?indexType=scfi',
  },
  {
    id: 'wci', group: 'container', ticker: 'wci:com', spans: ['3y'],
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
    id: 'bdti', group: 'tankers', code: 'BDTI',
    name: 'Baltic Dirty Tanker Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-dirty-tanker',
  },
  {
    id: 'bcti', group: 'tankers', code: 'BCTI',
    name: 'Baltic Clean Tanker Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-clean-tanker',
  },
  {
    id: 'bdi', group: 'dry-bulk', code: 'BDI',
    name: 'Baltic Dry Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-dry',
  },
  {
    id: 'bci', group: 'dry-bulk', code: 'BCI',
    name: 'Baltic Capesize Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-capesize',
  },
  {
    id: 'bpi', group: 'dry-bulk', code: 'BPI',
    name: 'Baltic Panamax Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-panamax',
  },
  {
    id: 'bsi', group: 'dry-bulk', code: 'BSI',
    name: 'Baltic Supramax Index', unit: 'index points', frequency: 'Daily',
    referenceUrl: 'https://www.investing.com/indices/baltic-supramax',
  },
  {
    id: 'scfi', group: 'container', code: 'SCFI',
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

async function fetchTe(context, meta) {
  const values = {};
  const failures = [];
  // Longer spans come back weekly; the shorter daily span is applied last so it
  // wins wherever the two overlap.
  for (const span of meta.spans) {
    try { Object.assign(values, await fetchTeSpan(context, meta.ticker, span)); }
    catch (error) { failures.push(`${span}: ${error.message}`); }
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

async function fetchStockq(meta) {
  const values = parseStockqIndexPage(await fetchText(STOCKQ_INDEX(meta.code)));
  if (!Object.keys(values).length) throw new Error(`no rows parsed from StockQ ${meta.code}`);
  return values;
}

/** StockQ's daily market snapshots (one page per session, back to 2007) list
 *  every index with its own as-of date, which is what the backfill walks. */
function parseStockqDailyPage(html, pageDate) {
  const pattern = /href="\/index\/([A-Z]+)\.php"[^>]*>[^<]*<\/a>\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>(?:\s*<td[^>]*>[^<]*<\/td>){2}\s*<td[^>]*>\s*(\d{2})\/(\d{2})\s*<\/td>/g;
  const out = {};
  const pageYear = Number(pageDate.slice(0, 4));
  const pageMonth = Number(pageDate.slice(5, 7));
  for (const match of html.matchAll(pattern)) {
    const meta = STOCKQ_SERIES.find(series => series.code === match[1]);
    const value = finite(match[2]);
    if (!meta || value == null) continue;
    const month = Number(match[3]);
    // Rows carry only MM/DD. A December row on a January page belongs to the
    // previous year — nothing else can move the row past its own page date.
    const year = pageMonth === 1 && month === 12 ? pageYear - 1 : pageYear;
    const date = `${year}-${match[3]}-${match[4]}`;
    if (!isIsoDate(date) || date > pageDate) continue;
    out[date] = { ...(out[date] ?? {}), [meta.id]: value };
  }
  return out;
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

async function updateShipping() {
  const bySeries = {};
  const errors = {};
  let annotations = loadHistory()._annotations ?? [];

  try {
    const hormuz = await fetchHormuz();
    // The monitor's payload is already date-keyed with extra per-day fields, so
    // it is merged straight in rather than through toPatches.
    bySeries.__hormuz = hormuz.rows;
    annotations = hormuz.annotations.length ? hormuz.annotations : annotations;
  } catch (error) {
    errors.hormuz = `Hormuz Strait Monitor: ${error.message}`;
  }

  let teContext = null;
  try {
    teContext = await fetchTeChartContext();
  } catch (error) {
    for (const meta of TE_SERIES) errors[meta.id] = `Trading Economics: ${error.message}`;
  }
  if (teContext) {
    for (const meta of TE_SERIES) {
      try { bySeries[meta.id] = { ...(bySeries[meta.id] ?? {}), ...await fetchTe(teContext, meta) }; }
      catch (error) { errors[meta.id] = `Trading Economics: ${error.message}`; }
    }
  }

  for (const meta of STOCKQ_SERIES) {
    try {
      bySeries[meta.id] = { ...(bySeries[meta.id] ?? {}), ...await fetchStockq(meta) };
      delete errors[meta.id];
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

  const history = storage.mergeDatedRows(BLOB, HISTORY_FILE, patches);
  // Field writes rather than a whole-blob write: a collector run can overlap a
  // warm web process, and replacing the document would erase the other's rows.
  storage.writeField(BLOB, HISTORY_FILE, '_updatedAt', new Date().toISOString());
  storage.writeField(BLOB, HISTORY_FILE, '_errors', errors);
  storage.writeField(BLOB, HISTORY_FILE, '_annotations', annotations);

  if (!Object.keys(patches).length && !Object.keys(history).filter(isIsoDate).length) {
    throw new Error(`Shipping refresh returned nothing: ${Object.values(errors).join('; ')}`);
  }
  return assemble(history);
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
    parseHormuz, parseTeSeries, parseStockqIndexPage, parseStockqDailyPage,
    parseSseIndexPage, toPatches, assemble,
    SERIES_ORDER, GROUPS, SERIES_META, STOCKQ_SERIES, TE_SERIES,
  },
};
