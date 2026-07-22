const zlib = require('zlib');

const BASE = 'https://tradingeconomics.com';
const DEFAULT_DATA_SOURCE = 'https://d3ii0wo49og5mi.cloudfront.net';
const OBFUSCATION_KEY = 'tradingeconomics-charts-core-api-key';

// Trading Economics page slugs are kept here (instead of opaque API symbols)
// so every series remains traceable to the public source page shown in the UI.
const SERIES = {
  // Sovereign yields. The 10-year benchmarks use Trading Economics' standard
  // government-bond page; the other maturities have dedicated pages.
  us2yYield: ['united-states', '2-year-note-yield'],
  us10yYield: ['united-states', 'government-bond-yield'],
  us30yYield: ['united-states', '30-year-bond-yield'],
  cn10yYield: ['china', 'government-bond-yield'],
  cn30yYield: ['china', '30-year-bond-yield'],
  jp10yYield: ['japan', 'government-bond-yield'],
  jp30yYield: ['japan', '30-year-bond-yield'],
  uk10yYield: ['united-kingdom', 'government-bond-yield'],
  uk30yYield: ['united-kingdom', '30-year-bond-yield'],
  de10yYield: ['germany', 'government-bond-yield'],
  de30yYield: ['germany', '30-year-bond-yield'],
  usCpiYoy: ['united-states', 'inflation-cpi'],
  usCoreCpiYoy: ['united-states', 'core-inflation-rate'],
  usCpiMom: ['united-states', 'inflation-rate-mom'],
  usCoreCpiMom: ['united-states', 'core-inflation-rate-mom'],
  usPpiYoy: ['united-states', 'producer-prices-change'],
  usCorePpiYoy: ['united-states', 'core-producer-prices-yoy'],
  usPpiMom: ['united-states', 'producer-price-inflation-mom'],
  usCorePpiMom: ['united-states', 'core-producer-prices-mom'],
  usPceYoy: ['united-states', 'pce-price-index-annual-change'],
  usCorePceYoy: ['united-states', 'core-pce-price-index-annual-change'],
  usPceMom: ['united-states', 'pce-price-index-monthly-change'],
  usCorePceMom: ['united-states', 'core-pce-price-index-mom'],
  usNfp: ['united-states', 'non-farm-payrolls'],
  usAdpMonthly: ['united-states', 'adp-employment-change'],
  usAdpWeekly: ['united-states', 'adp-employment-change-weekly'],
  usJoblessClaims: ['united-states', 'jobless-claims'],
  usUnemployment: ['united-states', 'unemployment-rate'],
  usEarningsMom: ['united-states', 'average-hourly-earnings'],
  usEarningsYoy: ['united-states', 'average-hourly-earnings-yoy'],
  usIsmMfg: ['united-states', 'business-confidence'],
  usIsmMfgEmployment: ['united-states', 'ism-manufacturing-employment'],
  usIsmMfgOrders: ['united-states', 'ism-manufacturing-new-orders'],
  usIsmMfgPrices: ['united-states', 'ism-manufacturing-prices'],
  usIsmServices: ['united-states', 'non-manufacturing-pmi'],
  usIsmServicesEmployment: ['united-states', 'ism-non-manufacturing-employment'],
  usIsmServicesOrders: ['united-states', 'ism-non-manufacturing-new-orders'],
  usIsmServicesPrices: ['united-states', 'ism-non-manufacturing-prices'],
  usSpMfg: ['united-states', 'manufacturing-pmi'],
  usSpServices: ['united-states', 'services-pmi'],
  usMichigan: ['united-states', 'consumer-confidence'],
  usRetailSales: ['united-states', 'retail-sales'],
  usPersonalSpending: ['united-states', 'personal-spending'],
  usExistingHomes: ['united-states', 'existing-home-sales'],
  cnCpiYoy: ['china', 'inflation-cpi'],
  cnCpiMom: ['china', 'inflation-rate-mom'],
  cnPpiYoy: ['china', 'producer-prices-change'],
  cnPpiMom: ['china', 'producer-price-inflation-mom'],
  cnNbsMfg: ['china', 'business-confidence'],
  cnNbsNonMfg: ['china', 'non-manufacturing-pmi'],
  cnRatingDogMfg: ['china', 'manufacturing-pmi'],
  cnRatingDogServices: ['china', 'services-pmi'],
  cnExportsYoy: ['china', 'exports-yoy'],
  cnImportsYoy: ['china', 'imports-yoy'],
  cnRetailSales: ['china', 'retail-sales-annual'],
  cnIndustrialProduction: ['china', 'industrial-production'],
  cnFixedAssetInvestment: ['china', 'fixed-asset-investment'],
  cnNewLoans: ['china', 'new-bank-loans'],
};

function match(html, pattern, fallback = '') {
  return html.match(pattern)?.[1]?.replace(/&amp;/g, '&') ?? fallback;
}

function decodeChartPayload(encoded, key) {
  const bytes = Buffer.from(typeof encoded === 'string' ? encoded : String(encoded), 'base64');
  const keyBytes = Buffer.from(key);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= keyBytes[i % keyBytes.length];
  return JSON.parse(zlib.unzipSync(bytes).toString('utf8'));
}

async function fetchText(url, options = {}, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 Signal Macro Dashboard', ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSeries(id, [country, slug]) {
  const sourceUrl = `${BASE}/${country}/${slug}`;
  const html = await fetchText(sourceUrl);
  const symbol = match(html, /var TESymbol = '([^']+)'/);
  if (!symbol) throw new Error(`No chart symbol found at ${sourceUrl}`);

  const token = match(html, /var TEChartsToken = '([^']+)'/);
  const key = match(html, /var TEObfuscationkey = '([^']+)'/, OBFUSCATION_KEY);
  const dataSource = match(html, /var TEChartsDatasource = '([^']+)'/, DEFAULT_DATA_SOURCE);
  const lastUpdate = match(html, /TELastUpdate\s*=\s*'([^']+)'/);
  const chartType = match(html, /TEChart\s*=\s*'([^']+)'/);
  const marketTicker = match(html, /symbol\s*=\s*'([^']+:[^']+)'/);
  const params = new URLSearchParams({ span: '10y' });
  if (lastUpdate) params.set('v', `${lastUpdate}00`);
  const isMarketChart = chartType === 'MK';
  if (isMarketChart) params.set('ohlc', '0');
  const chartUrl = isMarketChart
    ? `${dataSource}/markets/${encodeURIComponent((marketTicker || `${symbol}:ind`).toLowerCase())}?${params}`
    : `${dataSource}/economics/${encodeURIComponent(symbol.toLowerCase())}?${params}`;
  const raw = await fetchText(chartUrl, { headers: token ? { 'x-api-key': token } : {} });
  const decoded = decodeChartPayload(JSON.parse(raw), key);
  const serie = isMarketChart ? decoded?.series?.[0] : decoded?.[0]?.series?.[0]?.serie;
  if (!serie?.data?.length) throw new Error(`No historical data returned for ${symbol}`);

  return {
    id,
    name: serie.shortname || serie.name || symbol,
    unit: serie.unit || '',
    frequency: serie.frequency || '',
    source: serie.source || 'Trading Economics',
    sourceUrl,
    // TE's reference-date field (row[3]) is normalized to the first of the
    // month even for weekly releases. Using it collapsed four/five ADP or
    // claims observations onto one x-axis label. Weekly series must use the
    // actual observation timestamp (row[1]); monthly series keep the cleaner
    // reference period supplied by TE.
    data: serie.data.map(row => isMarketChart
      ? {
          date: new Date(row[0] * 1000).toISOString().slice(0, 10),
          value: row[1],
        }
      : {
          date: String(serie.frequency).toLowerCase().includes('week')
            ? new Date(row[1] * 1000).toISOString().slice(0, 10)
            : row[3] || new Date(row[1] * 1000).toISOString().slice(0, 10),
          value: row[0],
        }),
  };
}

async function mapLimited(entries, limit, worker) {
  const results = new Array(entries.length);
  let cursor = 0;
  async function run() {
    while (cursor < entries.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(entries[index]) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, run));
  return results;
}

function calculateSpread(longSeries, shortSeries) {
  if (!longSeries?.data?.length || !shortSeries?.data?.length) return null;
  const shortByDate = new Map(shortSeries.data.map(point => [point.date, point.value]));
  const data = longSeries.data.flatMap(point => {
    const shortValue = shortByDate.get(point.date);
    return Number.isFinite(point.value) && Number.isFinite(shortValue)
      ? [{ date: point.date, value: point.value - shortValue }]
      : [];
  });
  if (!data.length) return null;
  return {
    id: 'us2y10ySpread',
    name: 'United States 2Y–10Y Treasury spread',
    unit: 'percentage points',
    frequency: longSeries.frequency || shortSeries.frequency || 'Daily',
    source: 'Calculated from Trading Economics',
    sourceUrl: longSeries.sourceUrl,
    data,
  };
}

async function getMacroData() {
  const entries = Object.entries(SERIES);
  // Trading Economics becomes unreliable when a cold worker opens a large
  // burst of chart requests. Keep concurrency conservative so the first group
  // (CPI/PPI) is not the group that consistently hits the 20-second timeout.
  const settled = await mapLimited(entries, 3, ([id, path]) => fetchSeries(id, path));
  const series = {};
  const errors = {};
  settled.forEach((result, index) => {
    const id = entries[index][0];
    if (result.status === 'fulfilled') series[id] = result.value;
    else errors[id] = result.reason?.message || 'Unknown error';
  });
  const spread = calculateSpread(series.us10yYield, series.us2yYield);
  if (spread) series.us2y10ySpread = spread;
  else if (series.us10yYield || series.us2yYield) errors.us2y10ySpread = 'Unable to align 2Y and 10Y observations';
  if (!Object.keys(series).length) throw new Error('Trading Economics returned no macro series');
  return { fetchedAt: new Date().toISOString(), series, errors };
}

function mergeMacroData(fresh, previous) {
  if (!previous?.series) return fresh;
  return {
    ...fresh,
    // A partial upstream refresh must never erase previously persisted series.
    // Fresh observations win; failed series retain their last-known history.
    series: { ...previous.series, ...fresh.series },
  };
}

module.exports = { getMacroData, fetchSeries, SERIES, decodeChartPayload, calculateSpread, mergeMacroData };
