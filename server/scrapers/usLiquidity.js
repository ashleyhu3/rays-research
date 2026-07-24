/** US Fed/Treasury liquidity history, sourced from FRED (fredgraph.csv — no
 * API key required). Page reads are storage-only; scheduled collection owns
 * all upstream calls and persists through storage.js. */
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

function seriesUrl(fredId) { return `https://fred.stlouisfed.org/series/${fredId}`; }

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
  if (settled.every(result => result.status === 'rejected')) {
    throw new Error(`US liquidity refresh failed: ${Object.values(errors).join('; ')}`);
  }
  history.updatedAt = new Date().toISOString();
  history.errors = errors;
  storage.write(BLOB, HISTORY_FILE, history);
  return assemble(history);
}

function readUsLiquidity() { return assemble(loadHistory()); }

module.exports = {
  updateUsLiquidity,
  readUsLiquidity,
  _test: { fetchFredSeries, assemble, bpsSpread, SERIES_META },
};
