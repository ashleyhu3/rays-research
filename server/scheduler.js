const cron = require('node-cron');
const cache = require('./cache');
const history = require('./history');
const snapshotStore = require('./snapshotStore');

const scrapers = {
  pypi:          () => require('./scrapers/pypi').getPypiHistory(),
  gpu:           () => require('./scrapers/gpu').getGpuPrices(),
  github:        () => require('./scrapers/github').getGitHubData(),
  openrouter:    () => require('./scrapers/openrouter').getOpenRouterData(),
  eia:           () => require('./scrapers/eia').getEiaRates(),
  mops:          () => require('./scrapers/mops').getMopsRevenue(),
  githubCommits: () => require('./scrapers/githubActivity').getGitHubActivity(),
  docker:        () => require('./scrapers/docker').getDockerData(),
  hn:            () => require('./scrapers/hn').getHNData(),
  openrouterRanks:  () => require('./scrapers/openrouterRankings').getOpenRouterRankings(),
  dram:             () => require('./scrapers/dram').getDramSpot(),
  nand:             () => require('./scrapers/nand').getNandData(),
  tftLcd:           () => require('./scrapers/tftLcd').getTftLcdData(),
  npm:              () => require('./scrapers/npm').getNpmHistory(),
  huggingface:      () => require('./scrapers/huggingface').getHuggingFaceData(),
  mcp:              () => require('./scrapers/mcp').getMcpData(),
  sec:              () => require('./scrapers/sec').getSecData(),
  aws:              () => require('./scrapers/aws').getAwsData(),
  cpu:              () => require('./scrapers/cpu').getCpuData(),
  tpu:              () => require('./scrapers/tpu').getTpuData(),
  epochRevenue:     () => require('./scrapers/epochRevenue').getEpochRevenueData(),
  sentiment:        () => require('./scrapers/sentiment').getSentimentData(),
  webTraffic:       () => require('./scrapers/webTraffic').getWebTrafficData(),
};

// TTLs match each source's natural update frequency.
// Dashboards not listed here (Web Traffic, Datacenter, Electricity) use
// static research data (SimilarWeb/IEA/CBRE) that has no public API —
// those values are updated manually when new reports are published.
const TTL = {
  pypi:          24 * 3600000,  // daily   — pypistats.org aggregates weekly; intraday changes irrelevant
  trends:        24 * 3600000,  // daily   — Google Trends resolution is one data point per day
  gpu:           24 * 3600000,  // daily   — persisted as one median snapshot per UTC day
  github:        24 * 3600000,  // daily   — dependent repo counts grow slowly
  openrouter:     1 * 3600000,  // hourly  — new models and price changes published frequently
  eia:           24 * 3600000,  // daily   — EIA publishes monthly/annual revisions; daily poll is sufficient
  mops:          24 * 3600000,  // daily   — MOPS monthly revenue filings update once per month; daily poll is sufficient
  githubCommits: 24 * 3600000,  // daily
  docker:         6 * 3600000,  // 6-hourly
  hn:             1 * 3600000,  // hourly
  openrouterRanks:   6 * 3600000,  // 6-hourly — daily granularity but rankings shift through day
  dram:              6 * 3600000,  // 6-hourly — TrendForce spot sessions update through the trading day
  nand:              6 * 3600000,  // 6-hourly — TrendForce spot sessions update through the trading day
  tftLcd:           24 * 3600000,  // daily   — TrendForce panel prices update monthly/half-monthly
  npm:           24 * 3600000,  // daily   — api.npmjs.org reports complete days only
  huggingface:   24 * 3600000,  // daily   — all-time download totals grow slowly
  mcp:           24 * 3600000,  // daily   — repo-creation counts; respects GitHub search quota
  sec:           24 * 3600000,  // daily   — EDGAR full-text index updates daily
  aws:            6 * 3600000,  // 6-hourly — AWS Spot Advisor refreshes a few times per day
  cpu:            6 * 3600000,  // 6-hourly — same AWS Spot Advisor feed as aws; CPU savings shift through day
  tpu:           24 * 3600000,  // daily   — GCP TPU preemptible rates; reference rates change rarely
  epochRevenue:  24 * 3600000,  // daily   — Epoch AI CSV is updated as new disclosures appear
  sentiment:     24 * 3600000,  // daily   — StockTwits posting/sentiment vs price; recomputed once per day
  webTraffic:    24 * 3600000,  // daily   — SimilarWeb monthly visit estimates via Apify; one snapshot per day
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
      history.snapshot(k, results[i].value);
      snapshotStore.put(k, results[i].value);
      try { cache.recordSuccess(k, Buffer.byteLength(JSON.stringify(results[i].value))); } catch { cache.recordSuccess(k, 0); }
      console.log(`[refresh] ✓ ${k}`);
    } else {
      const msg = results[i].reason?.message ?? 'null result';
      const status = /\b429\b|rate.?limit|too many requests/i.test(msg) ? 'RATE-LIMITED' : 'DOWN';
      cache.recordFailure(k, status, msg);
      console.warn(`[refresh] ✗ ${k}:`, msg);
    }
  });
}

// Options chains are otherwise fetched only on-demand by the Markets tab and
// cached under `options:<ticker>:nearest`. The RAG's buildOptions() reads those
// keys, so on a cold server it has zero options data until a user happens to
// open that tab. Proactively warm a default AI-relevant basket so the Ask tab
// can always answer options-flow questions. Include the sentiment universe so
// the Markets tab's combined options+sentiment view has data on first load.
const AI_MEGACAPS = ['NVDA', 'AMD', 'TSM', 'AVGO', 'MSFT', 'AAPL', 'AMZN', 'META'];
const SENTIMENT_TICKERS = (() => {
  try { return Object.values(require('./scrapers/sentiment').CATEGORIES).flat(); }
  catch { return []; }
})();
const OPTIONS_BASKET = [...new Set([...AI_MEGACAPS, ...SENTIMENT_TICKERS])];
const OPTIONS_TTL    = 6 * 3600000;

async function warmOptions(tickers = OPTIONS_BASKET) {
  const { getOptionsData } = require('./scrapers/options');
  let ok = 0;
  for (const ticker of tickers) {
    try {
      const data = await getOptionsData(ticker);
      if (data) { cache.set(`options:${ticker}:nearest`, data, OPTIONS_TTL); ok++; }
    } catch (e) {
      console.warn(`[warmOptions] ${ticker} failed:`, e.message);
    }
  }
  console.log(`[warmOptions] warmed ${ok}/${tickers.length} tickers`);
}

function setup() {
  // Hourly: model listings and discussion flow change continuously
  cron.schedule('0 * * * *', () => refreshAll(['openrouter', 'hn']));

  // Every 6 hours: social signals and business data updated throughout the day
  cron.schedule('0 */6 * * *', () => refreshAll(['docker', 'openrouterRanks', 'dram', 'nand', 'aws', 'cpu']));

  // Daily at 03:00 UTC: aggregate stats whose sources only publish once per day
  cron.schedule('0 3 * * *', () => refreshAll(['gpu', 'tftLcd', 'tpu', 'epochRevenue', 'sentiment', 'pypi', 'github', 'eia', 'mops', 'githubCommits', 'npm', 'huggingface', 'mcp', 'sec', 'webTraffic']));

  // Options: warm every 6h, plus once shortly after boot so the RAG has data fast
  cron.schedule('30 */6 * * *', () => warmOptions());
  setTimeout(() => warmOptions().catch(e => console.warn('[warmOptions] startup warm failed:', e.message)), 20000);

  // Options-volume email alerts: once per weekday at 4:30pm New York time, so
  // daylight saving changes do not shift the run an hour away from market close.
  cron.schedule('30 16 * * 1-5', async () => {
    try {
      const { run } = require('./alertsEngine');
      const summary = await run();
      const emailed = summary.notifications.filter(n => n.sent).length;
      console.log(`[alerts] cycle done — ${summary.subscribers} subs, ${emailed} emailed`);
    } catch (e) {
      console.error('[alerts] daily cycle failed:', e.message);
    }
  }, { timezone: 'America/New_York' });
}

module.exports = { setup, refreshAll, scrapers, TTL, warmOptions };
