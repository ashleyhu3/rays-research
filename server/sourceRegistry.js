'use strict';

/**
 * Source Metadata & Reliability Registry — the "ground truth" for the Data
 * Validity Terminal (/api/validity/status, src/pages/sources page).
 *
 * Keys match the scraper keys in server/scheduler.js. Each entry describes the
 * UPSTREAM data feed, not our scrape loop. In particular:
 *
 *   ourCadenceMs        — how often WE poll the source (from scheduler TTL).
 *   sourceCadence       — how often the SOURCE itself publishes new data.
 *   upstreamLagMs/Text  — the INHERENT lag of the source's data due to HOW it
 *                         collects/produces it (e.g. a feed that aggregates
 *                         yesterday's complete day is ~1 day behind reality, no
 *                         matter how often we poll). This is the number traders
 *                         care about — "how far behind real life is this value".
 *   upstreamLagNote     — the collection method that causes that lag.
 *   criticalLagThresholdMs — if OUR last successful pull is older than this, the
 *                         row flags STALE (a pipeline problem on our side).
 */

// Friendlier reliability grades, kept qualitative on purpose.
const SOURCE_REGISTRY = {
  // ── Developer signals ───────────────────────────────────────────────
  pypi: {
    name: 'PyPI Downloads', provider: 'pypistats.org (Google BigQuery download logs)',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 30 * 3600e3, upstreamLagText: '~1–1.5 days',
    upstreamLagNote: 'pypistats aggregates PyPI download logs from the public Google BigQuery dataset, which only finalizes a UTC day after it completes. The newest fully-counted day is yesterday, so the freshest figure is always ~24–36h behind real time.',
    reliabilityGrade: 'B+', reliabilityNote: 'Stable, but the BigQuery export occasionally stalls a day; counts for the latest day are provisional.',
    ragScope: 'SDK adoption — openai/anthropic/google-genai PyPI download trends.',
    fallback: 'Last committed weekly snapshot; RAG cites the prior complete week.',
    endpointUrl: 'https://pypistats.org/api/packages/openai/recent',
  },
  npm: {
    name: 'npm Downloads', provider: 'api.npmjs.org/downloads',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 30 * 3600e3, upstreamLagText: '~1 day',
    upstreamLagNote: 'npm reports only COMPLETE UTC days. The download counter for the current day is withheld until the day closes, so the latest available point is yesterday.',
    reliabilityGrade: 'A-', reliabilityNote: 'Official npm registry endpoint; very stable.',
    ragScope: 'JS/TS SDK adoption — openai, @anthropic-ai/sdk, langchain, ai.',
    fallback: 'Last complete weekly series held in cache.',
    endpointUrl: 'https://api.npmjs.org/downloads/range',
  },
  github: {
    name: 'GitHub SDK Stars & Dependents', provider: 'GitHub REST API + dependents graph',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Real-time', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 5 * 60e3, upstreamLagText: '~minutes',
    upstreamLagNote: 'Star counts are live from the REST API. The dependents graph is rebuilt by GitHub asynchronously, lagging real merges by minutes to a few hours.',
    reliabilityGrade: 'A', reliabilityNote: 'First-party GitHub API; dependents page is scraped HTML and can shift format.',
    ragScope: 'Repo popularity — anthropic/openai/google SDK stars and dependent repos.',
    fallback: 'Daily snapshot store; trend continues from last poll.',
    endpointUrl: 'https://api.github.com/repos/openai/openai-python',
  },
  trends: {
    name: 'Google Trends', provider: 'Google Trends (google-trends-api)',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily', criticalLagThresholdMs: 48 * 3600e3,
    upstreamLagMs: 42 * 3600e3, upstreamLagText: '~1.5–2 days',
    upstreamLagNote: 'Trends interest is a normalized SAMPLE of searches; Google finalizes a day only after re-weighting, so the last 1–2 days are provisional and revised. Effective settled lag ~36–48h.',
    reliabilityGrade: 'B', reliabilityNote: 'Unofficial endpoint; subject to throttling and occasional index re-normalization that shifts historical points.',
    ragScope: 'Brand/API search interest — Claude, ChatGPT, Gemini keywords.',
    fallback: 'Cached 84-day window; provisional tail flagged.',
    endpointUrl: 'https://trends.google.com/trends/api',
  },

  // ── Pricing & marketplace ───────────────────────────────────────────
  gpu: {
    name: 'GPU Spot Prices', provider: 'vast.ai marketplace API',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Live (continuous)', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 5 * 60e3, upstreamLagText: '~minutes (live)',
    upstreamLagNote: 'vast.ai exposes live marketplace listings; each offer reflects a host\'s current asking price. Inherent lag is just listing propagation (seconds–minutes). We snapshot one median per UTC day.',
    reliabilityGrade: 'A-', reliabilityNote: 'Live and reliable; prices are noisy by nature (per-host bids).',
    ragScope: 'GPU rental economics — H100/H200/B200/A100 $/hr and availability.',
    fallback: 'Daily median series; last snapshot persists.',
    endpointUrl: 'https://console.vast.ai/api/v0/bundles',
  },
  openrouter: {
    name: 'OpenRouter Model Pricing', provider: 'OpenRouter API (/v1/models)',
    ourCadenceMs: 1 * 3600e3, sourceCadence: 'On price change', criticalLagThresholdMs: 4 * 3600e3,
    upstreamLagMs: 10 * 60e3, upstreamLagText: '~minutes (live catalog)',
    upstreamLagNote: 'The /models endpoint is OpenRouter\'s live catalog: per-token prices and context windows update as providers change them. The figure you see is what OpenRouter would charge right now.',
    reliabilityGrade: 'A-', reliabilityNote: 'First-party, well-maintained; the catalog is large and reshuffles as models launch/retire.',
    ragScope: 'API pricing & context windows across providers (marketplace rates).',
    fallback: 'Last hourly snapshot of the catalog.',
    endpointUrl: 'https://openrouter.ai/api/v1/models',
  },
  openrouterRanks: {
    name: 'OpenRouter Usage Rankings', provider: 'OpenRouter rankings (gateway telemetry)',
    ourCadenceMs: 6 * 3600e3, sourceCadence: 'Intraday refresh, weekly buckets', criticalLagThresholdMs: 40 * 3600e3,
    upstreamLagMs: 12 * 3600e3, upstreamLagText: '~partial week (intraday refresh)',
    upstreamLagNote: 'OpenRouter logs every generation event at its gateway in real time, then aggregates token volume into weekly UTC buckets. The CURRENT week is a partial, still-growing bucket refreshed through the day — so the newest week understates true volume until it closes.',
    reliabilityGrade: 'A-', reliabilityNote: 'Authoritative for real LLM usage share; only covers traffic routed through OpenRouter, and the live week is incomplete by construction.',
    ragScope: 'Real model/provider usage share by weekly token throughput.',
    fallback: 'Stored payload (≤36h) served on cold start; last complete week used.',
    endpointUrl: 'https://openrouter.ai/rankings',
  },
  litellm: {
    name: 'LLM API Token Pricing', provider: 'LiteLLM cost map (BerriAI, GitHub)',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'On model launch / price change', criticalLagThresholdMs: 48 * 3600e3,
    upstreamLagMs: 24 * 3600e3, upstreamLagText: '~hours–2 days after a change',
    upstreamLagNote: 'A community-maintained JSON of official provider list prices. It updates when a contributor commits a change, usually within hours–2 days of a provider announcement — not continuously.',
    reliabilityGrade: 'B+', reliabilityNote: 'MIT, actively maintained, day-0 for big launches; thinner/slower on minor Chinese-model updates.',
    ragScope: 'Official (provider list) token prices, US + Chinese flagships.',
    fallback: 'Committed snapshot served if the raw file is unreachable.',
    endpointUrl: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  },
  dram: {
    name: 'DRAM Spot Prices', provider: 'TrendForce DRAMeXchange',
    ourCadenceMs: 6 * 3600e3, sourceCadence: 'Per trading session', criticalLagThresholdMs: 18 * 3600e3,
    upstreamLagMs: 8 * 3600e3, upstreamLagText: '~same session (hours)',
    upstreamLagNote: 'TrendForce publishes spot quotes per trading session as it polls the spot market; a session\'s "average × change" settles only after that session, so intraday you see the prior session until the new one posts.',
    reliabilityGrade: 'B', reliabilityNote: 'Scraped from TrendForce pages; layout changes can interrupt parsing.',
    ragScope: 'Memory cost — DDR4/DDR5 spot and the mainstream DRAM index.',
    fallback: 'Daily history file; last session persists.',
    endpointUrl: 'https://www.trendforce.com/price/dram/dram_spot',
  },
  aws: {
    name: 'AWS Accelerator Spot', provider: 'AWS Spot Advisor + EC2 spot price history',
    ourCadenceMs: 6 * 3600e3, sourceCadence: 'Several times/day', criticalLagThresholdMs: 18 * 3600e3,
    upstreamLagMs: 8 * 3600e3, upstreamLagText: '~hours',
    upstreamLagNote: 'EC2 spot prices update near real time, but the Spot Advisor savings/interruption ratings are recomputed by AWS only a few times per day from a trailing window — so the interruption signal lags by hours.',
    reliabilityGrade: 'A-', reliabilityNote: 'First-party AWS data; advisor refresh cadence is undocumented but stable.',
    ragScope: 'AWS H100/H200/Trainium/Inferentia spot economics.',
    fallback: 'EC2 history backfill continued by the advisor; last value held.',
    endpointUrl: 'https://aws.amazon.com/ec2/spot/instance-advisor/',
  },
  cloudGpu: {
    name: 'Cloud GPU List Prices', provider: 'Azure/Oracle/Nebius feeds + curated table',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily snapshot', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 12 * 3600e3, upstreamLagText: 'live feeds ~hours; curated ~days',
    upstreamLagNote: 'Azure Retail Prices / Oracle / Nebius expose live list prices (hours-fresh). Where a provider publishes no public $/hr (e.g. CoreWeave), a hand-maintained fallback table is used, which is only as fresh as its last manual edit.',
    reliabilityGrade: 'B', reliabilityNote: 'Mixed live + curated; live feeds override the table whenever they return a value.',
    ragScope: 'On-demand $/GPU/hr across AWS/Azure/GCP/CoreWeave/Nebius/Oracle.',
    fallback: 'Curated FALLBACK list price table.',
    endpointUrl: 'https://prices.azure.com/api/retail/prices',
  },

  // ── Macro / infrastructure ──────────────────────────────────────────
  eia: {
    name: 'US Electricity Rates', provider: 'US EIA (Energy Information Administration)',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Monthly (revised)', criticalLagThresholdMs: 72 * 3600e3,
    upstreamLagMs: 55 * 24 * 3600e3, upstreamLagText: '~2 months',
    upstreamLagNote: 'EIA collects retail electricity data from utilities on a monthly survey cycle; a month\'s figures publish ~8 weeks later and are revised for several months after. Inherent lag is structural, not a pipeline issue.',
    reliabilityGrade: 'A', reliabilityNote: 'Authoritative government source; slow but rock-solid.',
    ragScope: 'Residential ¢/kWh by state — datacenter power cost context.',
    fallback: 'Multi-year cached series; static between monthly releases.',
    endpointUrl: 'https://api.eia.gov/v2/electricity',
  },
  mops: {
    name: 'Taiwan Supply-Chain Revenue', provider: 'TWSE MOPS via FinMind',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Monthly filings', criticalLagThresholdMs: 72 * 3600e3,
    upstreamLagMs: 30 * 24 * 3600e3, upstreamLagText: 'up to ~1 month',
    upstreamLagNote: 'Taiwan-listed firms must file the prior month\'s revenue by the 10th of the next month. So a given month only appears ~10 days after it ends — the freshest data point is always up to a month behind.',
    reliabilityGrade: 'B+', reliabilityNote: 'FinMind mirrors official MOPS filings; free tier is rate-limited (300/hr).',
    ragScope: 'Optics/fiber/PCB/MLCC supplier monthly revenue & YoY/MoM.',
    fallback: 'Cached monthly history; new month appears after the filing window.',
    endpointUrl: 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue',
  },

  // ── Consumer / community ────────────────────────────────────────────
  huggingface: {
    name: 'HuggingFace Demand', provider: 'HuggingFace Hub API',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 24 * 3600e3, upstreamLagText: '~1 day',
    upstreamLagNote: 'Download totals are cumulative counters HF updates on a daily batch; per-day attribution settles after the day closes, so family/model totals are ~1 day behind.',
    reliabilityGrade: 'A-', reliabilityNote: 'First-party Hub API; download accounting changed methodology historically.',
    ragScope: 'Open-model demand — downloads by family, model creation rate.',
    fallback: 'Daily snapshot of family download totals.',
    endpointUrl: 'https://huggingface.co/api/models',
  },
  docker: {
    name: 'Docker Hub Pulls', provider: 'Docker Hub API',
    ourCadenceMs: 6 * 3600e3, sourceCadence: '~Hourly', criticalLagThresholdMs: 18 * 3600e3,
    upstreamLagMs: 3 * 3600e3, upstreamLagText: '~hours',
    upstreamLagNote: 'Pull counts are cumulative and updated by Docker Hub periodically (roughly hourly), so the displayed total trails live pulls by up to a few hours.',
    reliabilityGrade: 'A-', reliabilityNote: 'Stable public API; counts are coarse (cumulative only).',
    ragScope: 'Infra image adoption — PyTorch, CUDA, Ollama, vLLM pulls.',
    fallback: 'Cumulative snapshot; monotonic so safe to hold.',
    endpointUrl: 'https://hub.docker.com/v2/repositories',
  },
  hn: {
    name: 'Hacker News Volume', provider: 'HN Algolia Search API',
    ourCadenceMs: 1 * 3600e3, sourceCadence: 'Real-time', criticalLagThresholdMs: 4 * 3600e3,
    upstreamLagMs: 5 * 60e3, upstreamLagText: '~minutes',
    upstreamLagNote: 'Algolia indexes HN stories within seconds–minutes of posting. The only lag is search-index propagation; story counts are effectively live.',
    reliabilityGrade: 'A', reliabilityNote: 'Fast, free, very reliable index.',
    ragScope: 'AI discussion volume by term (ChatGPT/Claude/LLM/AI agents).',
    fallback: 'Weekly counts cached; last hour held.',
    endpointUrl: 'https://hn.algolia.com/api/v1/search_by_date',
  },
  wikipedia: {
    name: 'Wikipedia Pageviews', provider: 'Wikimedia REST pageviews API',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily', criticalLagThresholdMs: 48 * 3600e3,
    upstreamLagMs: 36 * 3600e3, upstreamLagText: '~1–2 days',
    upstreamLagNote: 'Wikimedia computes pageview aggregates in a daily batch; a day\'s counts are published the following day (and the API does not return today). Effective lag ~24–48h.',
    reliabilityGrade: 'A', reliabilityNote: 'Official Wikimedia analytics; very dependable.',
    ragScope: 'Public attention — ChatGPT/LLM/Claude/Gemini article pageviews.',
    fallback: 'Weekly aggregated series; latest complete day used.',
    endpointUrl: 'https://wikimedia.org/api/rest_v1/metrics/pageviews',
  },

  // ── Ecosystem / filings ─────────────────────────────────────────────
  githubCommits: {
    name: 'GitHub Commit Velocity', provider: 'GitHub REST stats API',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Weekly buckets', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 12 * 3600e3, upstreamLagText: '~hours (current week partial)',
    upstreamLagNote: 'GitHub\'s commit_activity stats are weekly buckets that GitHub computes asynchronously (the first request may 202-compute). The current week grows through the week, so its count is partial until the week ends.',
    reliabilityGrade: 'A-', reliabilityNote: 'First-party but cached/async; occasionally returns an empty computing state.',
    ragScope: 'OSS AI repo commit velocity + new-LLM-repo creation rate.',
    fallback: 'Weekly history; last complete week.',
    endpointUrl: 'https://api.github.com/repos/{repo}/stats/commit_activity',
  },
  mcp: {
    name: 'MCP Ecosystem Growth', provider: 'GitHub Search API',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Near real-time', criticalLagThresholdMs: 36 * 3600e3,
    upstreamLagMs: 2 * 3600e3, upstreamLagText: '~minutes–hours',
    upstreamLagNote: 'Repo counts come from GitHub code/repo search, whose index lags repo creation by minutes to a couple of hours. Counts are otherwise live.',
    reliabilityGrade: 'A-', reliabilityNote: 'Subject to the GitHub search rate limit (30/min); occasional throttling.',
    ragScope: 'Agent-economy growth — "mcp server" repo counts and creation rate.',
    fallback: 'Daily snapshot of repo counts.',
    endpointUrl: 'https://api.github.com/search/repositories',
  },
  sec: {
    name: 'SEC Filing AI Mentions', provider: 'SEC EDGAR full-text search',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily index', criticalLagThresholdMs: 48 * 3600e3,
    upstreamLagMs: 24 * 3600e3, upstreamLagText: '~same day–1 day',
    upstreamLagNote: 'A filing is searchable shortly after EDGAR accepts it, but the full-text index is rebuilt daily, so trailing-90-day mention counts settle on a ~1-day cycle.',
    reliabilityGrade: 'A-', reliabilityNote: 'Authoritative SEC source; FTS endpoint is occasionally slow.',
    ragScope: 'Enterprise AI adoption — 10-K/10-Q AI-term mention counts.',
    fallback: 'Daily snapshot of trailing-90d counts.',
    endpointUrl: 'https://efts.sec.gov/LATEST/search-index',
  },

  // ── Derived / composite ─────────────────────────────────────────────
  sentiment: {
    name: 'StockTwits Sentiment Analysis', provider: 'StockTwits + Yahoo Finance (derived)',
    ourCadenceMs: 24 * 3600e3, sourceCadence: 'Daily recompute', criticalLagThresholdMs: 48 * 3600e3,
    upstreamLagMs: 24 * 3600e3, upstreamLagText: 'posts live; prices EOD; recomputed daily',
    upstreamLagNote: 'StockTwits messages are scraped near real time, but the volume↔price analysis joins them to Yahoo daily CLOSES (settled end-of-day, ~15-min delayed intraday) and is recomputed once per day. So the analysis is a 1-day-resolution product, not live.',
    reliabilityGrade: 'B', reliabilityNote: 'Derived: StockTwits scraping + self-reported (poster-supplied) bull/bear labels and EOD prices.',
    ragScope: 'Supply-chain ticker posting volume, sentiment, and price correlations.',
    fallback: 'Committed sentiment.json snapshot (≤3 days) served on cold start.',
    endpointUrl: 'https://stocktwits.com/',
  },
};

module.exports = { SOURCE_REGISTRY };
