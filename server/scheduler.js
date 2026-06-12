const cron = require('node-cron');
const cache = require('./cache');

const scrapers = {
  pypi:          () => require('./scrapers/pypi').getPypiHistory(),
  trends:        () => require('./scrapers/trends').getTrendsData(),
  reddit:        () => require('./scrapers/reddit').getRedditData(),
  jobs:          () => require('./scrapers/jobs').getJobsData(),
  gpu:           () => require('./scrapers/gpu').getGpuPrices(),
  github:        () => require('./scrapers/github').getGitHubData(),
  openrouter:    () => require('./scrapers/openrouter').getOpenRouterData(),
  eia:           () => require('./scrapers/eia').getEiaRates(),
  mops:          () => require('./scrapers/mops').getMopsRevenue(),
  githubCommits: () => require('./scrapers/githubActivity').getGitHubActivity(),
  docker:        () => require('./scrapers/docker').getDockerData(),
  hn:            () => require('./scrapers/hn').getHNData(),
  wikipedia:        () => require('./scrapers/wikipedia').getWikipediaData(),
  openrouterRanks:  () => require('./scrapers/openrouterRankings').getOpenRouterRankings(),
  dram:             () => require('./scrapers/dram').getDramSpot(),
  npm:              () => require('./scrapers/npm').getNpmHistory(),
  stackoverflow:    () => require('./scrapers/stackoverflow').getStackOverflowData(),
  huggingface:      () => require('./scrapers/huggingface').getHuggingFaceData(),
};

// TTLs match each source's natural update frequency.
// Dashboards not listed here (Web Traffic, Datacenter, Electricity) use
// static research data (SimilarWeb/IEA/CBRE) that has no public API —
// those values are updated manually when new reports are published.
const TTL = {
  pypi:          24 * 3600000,  // daily   — pypistats.org aggregates weekly; intraday changes irrelevant
  trends:        24 * 3600000,  // daily   — Google Trends resolution is one data point per day
  reddit:         6 * 3600000,  // 6-hourly — social mention counts fluctuate throughout the day
  jobs:           6 * 3600000,  // 6-hourly — job listings open and close continuously
  gpu:           24 * 3600000,  // daily   — persisted as one median snapshot per UTC day
  github:        24 * 3600000,  // daily   — dependent repo counts grow slowly
  openrouter:     1 * 3600000,  // hourly  — new models and price changes published frequently
  eia:           24 * 3600000,  // daily   — EIA publishes monthly/annual revisions; daily poll is sufficient
  mops:          24 * 3600000,  // daily   — MOPS monthly revenue filings update once per month; daily poll is sufficient
  githubCommits: 24 * 3600000,  // daily
  docker:         6 * 3600000,  // 6-hourly
  hn:             1 * 3600000,  // hourly
  wikipedia:        24 * 3600000,  // daily
  openrouterRanks:   6 * 3600000,  // 6-hourly — daily granularity but rankings shift through day
  dram:              6 * 3600000,  // 6-hourly — TrendForce spot sessions update through the trading day
  npm:           24 * 3600000,  // daily   — api.npmjs.org reports complete days only
  stackoverflow: 24 * 3600000,  // daily   — tag counts move slowly; respects SE API quota
  huggingface:   24 * 3600000,  // daily   — all-time download totals grow slowly
};

// Hard cap per scraper so one hung source can never wedge a refresh
const SCRAPE_TIMEOUT = 5 * 60000;
function withTimeout(promise, ms, key) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${key} scrape timed out after ${ms / 1000}s`)), ms).unref?.()),
  ]);
}

async function refreshAll(keys = Object.keys(scrapers)) {
  console.log(`[refresh] Starting: ${keys.join(', ')}`);
  const results = await Promise.allSettled(keys.map(k => withTimeout(scrapers[k](), SCRAPE_TIMEOUT, k)));
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
  // Hourly: model listings and discussion flow change continuously
  cron.schedule('0 * * * *', () => refreshAll(['openrouter', 'hn']));

  // Every 6 hours: social signals and business data updated throughout the day
  cron.schedule('0 */6 * * *', () => refreshAll(['reddit', 'jobs', 'docker', 'openrouterRanks', 'dram']));

  // Daily at 03:00 UTC: aggregate stats whose sources only publish once per day
  cron.schedule('0 3 * * *', () => refreshAll(['gpu', 'pypi', 'trends', 'github', 'eia', 'mops', 'githubCommits', 'wikipedia', 'npm', 'stackoverflow', 'huggingface']));
}

module.exports = { setup, refreshAll, scrapers, TTL };
