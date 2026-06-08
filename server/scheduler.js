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
};

const TTL = {
  pypi:       24 * 3600000,
  trends:     24 * 3600000,
  reddit:      4 * 3600000,
  appstore:    4 * 3600000,
  jobs:       24 * 3600000,
  gpu:         1 * 3600000,
  github:     24 * 3600000,
  openrouter: 24 * 3600000,
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
  // Daily at 03:00 AM
  cron.schedule('0 3 * * *', () => refreshAll());
  // Reddit and GPU refresh every 4 h / 1 h respectively  — drive by the same daily job
  // (we rely on the TTL to serve stale data otherwise; the next request re-fetches if expired)
}

module.exports = { setup, refreshAll, scrapers, TTL };
