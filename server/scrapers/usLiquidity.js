/** US Fed/Treasury liquidity history, sourced from FRED (fredgraph.csv — no
 * API key required), plus the daily closing prices the Credit view compares
 * against the spreads (HYG, MSCI World, S&P 500) from Yahoo Finance. Page
 * reads are storage-only; scheduled collection owns all upstream calls and
 * persists through storage.js. */
'use strict';

const path = require('path');
const storage = require('../storage');

const BLOB = 'usLiquidityHistory';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'usLiquidityHistory.json');
const FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const UA = 'Mozilla/5.0 Signal Liquidity Dashboard';

// Internal key -> FRED series id / display metadata. Values keep their native
// FRED units (millions for the balance-sheet series, billions for ON RRP,
// percent for rates/spreads); unit conversion happens in the derived series
// built in assemble().
const SERIES_META = {
  totalAssets: { fredId: 'WALCL', name: 'Fed Total Assets', unit: 'USD millions', frequency: 'Weekly' },
  tga: { fredId: 'WTREGEN', name: 'Treasury General Account (TGA)', unit: 'USD millions', frequency: 'Weekly' },
  onRrp: { fredId: 'RRPONTSYD', name: 'ON RRP Award Volume', unit: 'USD billions', frequency: 'Daily' },
  hySpread: { fredId: 'BAMLH0A0HYM2', name: 'ICE BofA US High Yield Index OAS', unit: '%', frequency: 'Daily' },
  igSpread: { fredId: 'BAMLC0A0CM', name: 'ICE BofA US Corporate Index OAS', unit: '%', frequency: 'Daily' },
  sofr: { fredId: 'SOFR', name: 'Secured Overnight Financing Rate', unit: '%', frequency: 'Daily' },
  iorb: { fredId: 'IORB', name: 'Interest on Reserve Balances Rate', unit: '%', frequency: 'Daily' },
  effr: { fredId: 'EFFR', name: 'Effective Federal Funds Rate', unit: '%', frequency: 'Daily' },
};

// Daily closes that give the credit spreads a price counterpart: the
// high-yield ETF itself, plus the two equity benchmarks credit stress shows
// up in. The MSCI World index is Yahoo's own index feed (^990100-USD-STRD),
// not an ETF proxy — its chart `meta` block is missing fields the client
// validates, so those symbols are fetched with validation disabled and the
// parsed quotes are checked here instead.
const PRICE_START = '2015-01-01';
const PRICE_META = {
  hygPrice: { symbol: 'HYG', name: 'HYG — iShares iBoxx $ High Yield Corporate Bond ETF', unit: 'USD' },
  msciWorldPrice: { symbol: '^990100-USD-STRD', name: 'MSCI World Index', unit: 'Index' },
  spxPrice: { symbol: '^GSPC', name: 'S&P 500', unit: 'Index' },
};

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

function seriesUrl(fredId) { return `https://fred.stlouisfed.org/series/${fredId}`; }

function quoteUrl(symbol) { return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`; }

async function fetchYahooCloses(symbol) {
  const chart = await getYF().chart(
    symbol,
    { period1: PRICE_START, interval: '1d' },
    { validateResult: false },
  );
  const out = {};
  for (const quote of chart?.quotes ?? []) {
    const date = quote.date instanceof Date ? quote.date.toISOString().slice(0, 10) : null;
    const close = Number(quote.close);
    if (date && Number.isFinite(close) && close > 0) out[date] = close;
  }
  if (!Object.keys(out).length) throw new Error(`Yahoo returned no closes for ${symbol}`);
  return out;
}

async function fetchFredSeries(fredId) {
  const response = await fetch(`${FRED_CSV_URL}?id=${fredId}`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`FRED HTTP ${response.status} for ${fredId}`);
  const text = await response.text();
  const out = {};
  for (const line of text.trim().split('\n').slice(1)) {
    const [date, raw] = line.split(',');
    // FRED marks non-trading-day / not-yet-published observations with "."
    // (and, for some series, a blank field) — Number('') is 0 in JS, so an
    // empty raw value must be rejected explicitly rather than parsed.
    if (!raw) continue;
    const value = Number(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && raw !== '.' && Number.isFinite(value)) out[date] = value;
  }
  if (!Object.keys(out).length) throw new Error(`FRED returned no data for ${fredId}`);
  return out;
}

function loadHistory() {
  const history = storage.read(BLOB, HISTORY_FILE);
  for (const key of Object.keys(SERIES_META)) history[key] = history[key] ?? {};
  for (const key of Object.keys(PRICE_META)) history[key] = history[key] ?? {};
  return history;
}

function toPoints(values) {
  return Object.keys(values ?? {}).sort().map(date => ({ date, value: values[date] }));
}

// Minuend/subtrahend spread of two raw-percent series, expressed in basis
// points (SOFR-IORB and EFFR-IORB are conventionally quoted that way — the
// raw percentage-point gap is too small to read on a chart axis).
function bpsSpread(history, minuendKey, subtrahendKey, name) {
  const minuend = history[minuendKey] ?? {};
  const subtrahend = history[subtrahendKey] ?? {};
  const values = {};
  for (const date of Object.keys(minuend)) {
    const a = minuend[date];
    const b = subtrahend[date];
    if (Number.isFinite(a) && Number.isFinite(b)) values[date] = Math.round((a - b) * 10000) / 100;
  }
  return {
    name, unit: 'bps', frequency: 'Daily',
    source: `Calculated from FRED (${SERIES_META[minuendKey].fredId} − ${SERIES_META[subtrahendKey].fredId})`,
    sourceUrl: seriesUrl(SERIES_META[minuendKey].fredId),
    data: toPoints(values),
  };
}

function assemble(history) {
  const series = {};
  for (const [key, meta] of Object.entries(SERIES_META)) {
    series[key] = {
      name: meta.name, unit: meta.unit, frequency: meta.frequency,
      source: 'FRED (Federal Reserve Bank of St. Louis)',
      sourceUrl: seriesUrl(meta.fredId),
      data: toPoints(history[key]),
    };
  }

  // Net Assets = Total Assets − TGA − ON RRP, all aligned to WALCL/WTREGEN's
  // weekly (Wednesday) cadence and normalized to USD millions.
  const totalAssets = history.totalAssets ?? {};
  const tga = history.tga ?? {};
  const onRrp = history.onRrp ?? {};
  const netAssetsValues = {};
  for (const date of Object.keys(totalAssets)) {
    const assets = totalAssets[date];
    const tgaValue = tga[date];
    const rrpValue = onRrp[date];
    if (Number.isFinite(assets) && Number.isFinite(tgaValue) && Number.isFinite(rrpValue)) {
      netAssetsValues[date] = assets - tgaValue - rrpValue * 1000;
    }
  }
  series.netAssets = {
    name: 'Fed Net Liquidity (Total Assets − TGA − ON RRP)', unit: 'USD millions', frequency: 'Weekly',
    source: 'Calculated from FRED (WALCL, WTREGEN, RRPONTSYD)',
    sourceUrl: seriesUrl(SERIES_META.totalAssets.fredId),
    data: toPoints(netAssetsValues),
  };

  for (const [key, meta] of Object.entries(PRICE_META)) {
    series[key] = {
      name: meta.name, unit: meta.unit, frequency: 'Daily',
      source: 'Yahoo Finance', sourceUrl: quoteUrl(meta.symbol),
      data: toPoints(history[key]),
    };
  }

  series.sofrIorbSpread = bpsSpread(history, 'sofr', 'iorb', 'SOFR − IORB Spread');
  series.effrIorbSpread = bpsSpread(history, 'effr', 'iorb', 'EFFR − IORB Spread');

  return { series, updatedAt: history.updatedAt ?? null, errors: history.errors ?? {} };
}

async function updateUsLiquidity() {
  const history = loadHistory();
  const entries = Object.entries(SERIES_META);
  const settled = await Promise.allSettled(entries.map(([, meta]) => fetchFredSeries(meta.fredId)));
  const errors = {};
  settled.forEach((result, index) => {
    const [key] = entries[index];
    // Each fetch returns FRED's complete observation history for that series
    // (not an incremental window), so a full replace is correct here — it also
    // means a fixed parser or a corrected upstream value self-heals on the
    // next successful run instead of a stale bad entry lingering forever via
    // merge. Only a failed fetch keeps the previous snapshot.
    if (result.status === 'fulfilled') history[key] = result.value;
    else errors[key] = result.reason?.message || 'FRED fetch failed';
  });
  // A total FRED outage is a failed run; the Yahoo price series are checked
  // separately so a Yahoo hiccup only marks those series in errors.
  if (settled.every(result => result.status === 'rejected')) {
    throw new Error(`US liquidity refresh failed: ${Object.values(errors).join('; ')}`);
  }

  const priceEntries = Object.entries(PRICE_META);
  const priceSettled = await Promise.allSettled(priceEntries.map(([, meta]) => fetchYahooCloses(meta.symbol)));
  priceSettled.forEach((result, index) => {
    const [key] = priceEntries[index];
    // Same full-replace rationale as the FRED series above: each chart call
    // returns the complete window from PRICE_START.
    if (result.status === 'fulfilled') history[key] = result.value;
    else errors[key] = result.reason?.message || 'Yahoo Finance fetch failed';
  });

  history.updatedAt = new Date().toISOString();
  history.errors = errors;
  storage.write(BLOB, HISTORY_FILE, history);
  return assemble(history);
}

function readUsLiquidity() { return assemble(loadHistory()); }

module.exports = {
  updateUsLiquidity,
  readUsLiquidity,
  _test: { fetchFredSeries, fetchYahooCloses, assemble, bpsSpread, SERIES_META, PRICE_META },
};
