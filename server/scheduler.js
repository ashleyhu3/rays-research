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
  customsDrones:    () => require('./scrapers/customsTrade').getDroneExports(),
  koreaLeverage:    () => require('./scrapers/koreaLeverage').getKoreaLeverage(),
  taiwanLeverage:   () => require('./scrapers/taiwanLeverage').getTaiwanLeverage(),
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
  customsDrones: 24 * 3600000,  // daily   — Taiwan customs UAV exports publish monthly; daily poll picks up new months
  koreaLeverage:  6 * 3600000,  // 6-hourly — ETF net assets move with the KRX session; KOFIA publishes once, 1–3 days late
  taiwanLeverage: 6 * 3600000,  // 6-hourly — TWSE posts the margin balance late evening; the ETF feed is a live snapshot
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
  // 12:00 UTC (21:00 KST) is the run that lands after the KRX close, so the
  // day's ETF net assets settle on the closing price rather than an intraday one.
  cron.schedule('0 */6 * * *', () => refreshAll(['docker', 'openrouterRanks', 'dram', 'nand', 'aws', 'cpu', 'koreaLeverage', 'taiwanLeverage']));

  // Daily at 03:00 UTC: aggregate stats whose sources only publish once per day
  cron.schedule('0 3 * * *', () => refreshAll(['gpu', 'tftLcd', 'tpu', 'epochRevenue', 'sentiment', 'pypi', 'github', 'eia', 'mops', 'githubCommits', 'npm', 'huggingface', 'mcp', 'sec', 'webTraffic', 'customsDrones']));

  // Options: warm every 6h, plus once shortly after boot so the RAG has data fast
  cron.schedule('30 */6 * * *', () => warmOptions());
  setTimeout(() => warmOptions().catch(e => console.warn('[warmOptions] startup warm failed:', e.message)), 20000);

  // Tech-sector earnings calendar (Alerts page Calendar view): FMP re-seeds the
  // display window for free on the first run after it rolls over, then a small Alpha
  // Vantage batch fills in whatever FMP's capped feed doesn't cover — spread
  // across days rather than done all at once, since ~60 tickers would burst
  // past Alpha Vantage's 25-request daily cap. See techEarningsCalendar.js.
  cron.schedule('0 4 * * *', async () => {
    try {
      const { runDailyBatch } = require('./techEarningsCalendar');
      const state = await runDailyBatch();
      console.log(`[tech-earnings-calendar] ${state.range ?? state.month}: ${Object.keys(state.events).length} events, ${state.pending.length} pending`);
    } catch (e) {
      console.error('[tech-earnings-calendar] daily batch failed:', e.message);
    }
  }, { timezone: 'Asia/Hong_Kong' });
  setTimeout(() => {
    require('./techEarningsCalendar').runDailyBatch()
      .then(state => console.log(`[tech-earnings-calendar] startup batch: ${state.range ?? state.month}, ${Object.keys(state.events).length} events, ${state.pending.length} pending`))
      .catch(e => console.warn('[tech-earnings-calendar] startup batch failed:', e.message));
  }, 25000);

  // Daily options report: scrape options data and generate the web-visible
  // report at 7:45am Hong Kong time. The GitHub workflow runs the same task for
  // sleeping deployments.
  cron.schedule('45 7 * * *', async () => {
    try {
      const { generateAndStoreDailyOptions } = require('./optionsReportStore');
      const report = await generateAndStoreDailyOptions();
      console.log(`[options-report] stored ${report.date} (${report.tickers.join(', ')}) — ${report.charts} charts`);
    } catch (e) {
      console.error('[options-report] daily generation failed:', e.message);
    }
  }, { timezone: 'Asia/Hong_Kong' });
}

module.exports = { setup, refreshAll, scrapers, TTL, warmOptions };
