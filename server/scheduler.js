const cron = require('node-cron');
const cache = require('./cache');

const scrapers = {
  pypi:       () => require('./scrapers/pypi').getPypiHistory(),
  trends:     () => require('./scrapers/trends').getTrendsData(),
  reddit:     () => require('./scrapers/reddit').getRedditData(),
  appstore:   () => require('./scrapers/appstore').getAppRankings(),
  jobs:       () => require('./scrapers/jobs').getJobsData(),
  gpu:        () => require('./scrapers/gpu').getGpuPrices(),
  github:     () => require('./scrapers/github').getGitHubData(),
  openrouter: () => require('./scrapers/openrouter').getOpenRouterData(),
  eia:        () => require('./scrapers/eia').getEiaRates(),
  mops:       () => require('./scrapers/mops').getMopsRevenue(),
};

// TTLs match each source's natural update frequency.
// Dashboards not listed here (Web Traffic, Datacenter, Electricity) use
// static research data (SimilarWeb/IEA/CBRE) that has no public API —
// those values are updated manually when new reports are published.
const TTL = {
  pypi:        24 * 3600000,  // daily   — pypistats.org aggregates weekly; intraday changes irrelevant
  trends:      24 * 3600000,  // daily   — Google Trends resolution is one data point per day
  reddit:       6 * 3600000,  // 6-hourly — social mention counts fluctuate throughout the day
  appstore:     6 * 3600000,  // 6-hourly — App Store rankings update multiple times per day
  jobs:         6 * 3600000,  // 6-hourly — job listings open and close continuously
  gpu:          1 * 3600000,  // hourly  — spot prices change minute-to-minute on vast.ai/Lambda
  github:      24 * 3600000,  // daily   — dependent repo counts grow slowly
  openrouter:   1 * 3600000,  // hourly  — new models and price changes published frequently
  eia:         24 * 3600000,  // daily   — EIA publishes monthly/annual revisions; daily poll is sufficient
  mops:        24 * 3600000,  // daily   — MOPS monthly revenue filings update once per month; daily poll is sufficient
};

async function refreshAll(keys = Object.keys(scrapers)) {
  console.log(`[refresh] Starting: ${keys.join(', ')}`);
  const results = await Promise.allSettled(keys.map(k => scrapers[k]()));
  keys.forEach((k, i) => {
    if (results[i].status === 'fulfilled' && results[i].value != null) {
      cache.set(k, results[i].value, TTL[k]);
      console.log(`[refresh] ✓ ${k}`);
    } else {
      console.warn(`[refresh] ✗ ${k}:`, results[i].reason?.message ?? 'null result');
    }
  });
}

function setup() {
  // Hourly: market prices and model listings change continuously
  cron.schedule('0 * * * *', () => refreshAll(['gpu', 'openrouter']));

  // Every 6 hours: social signals and business data updated throughout the day
  cron.schedule('0 */6 * * *', () => refreshAll(['reddit', 'appstore', 'jobs']));

  // Daily at 03:00 UTC: aggregate stats whose sources only publish once per day
  cron.schedule('0 3 * * *', () => refreshAll(['pypi', 'trends', 'github', 'eia', 'mops']));
}

module.exports = { setup, refreshAll, scrapers, TTL };
