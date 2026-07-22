const zlib = require('zlib');

const BASE = 'https://tradingeconomics.com';
const DEFAULT_DATA_SOURCE = 'https://d3ii0wo49og5mi.cloudfront.net';
const OBFUSCATION_KEY = 'tradingeconomics-charts-core-api-key';

// Trading Economics page slugs are kept here (instead of opaque API symbols)
// so every series remains traceable to the public source page shown in the UI.
const SERIES = {
  usCpiYoy: ['united-states', 'inflation-cpi'],
  usCoreCpiYoy: ['united-states', 'core-inflation-rate'],
  usCpiMom: ['united-states', 'inflation-rate-mom'],
  usCoreCpiMom: ['united-states', 'core-inflation-rate-mom'],
  usPpiYoy: ['united-states', 'producer-prices-change'],
  usCorePpiYoy: ['united-states', 'core-producer-prices'],
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
  const params = new URLSearchParams({ span: '10y' });
  if (lastUpdate) params.set('v', `${lastUpdate}00`);
  const chartUrl = `${dataSource}/economics/${encodeURIComponent(symbol.toLowerCase())}?${params}`;
  const raw = await fetchText(chartUrl, { headers: token ? { 'x-api-key': token } : {} });
  const decoded = decodeChartPayload(JSON.parse(raw), key);
  const serie = decoded?.[0]?.series?.[0]?.serie;
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
    data: serie.data.map(row => ({
      date: String(serie.frequency).toLowerCase().includes('week')
        ? new Date(row[1] * 1000).toISOString().slice(0, 10)
        : row[3] || new Date(row[1] * 1000).toISOString().slice(0, 10),
      value: row[0],
    })),
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

module.exports = { getMacroData, fetchSeries, SERIES, decodeChartPayload, mergeMacroData };
