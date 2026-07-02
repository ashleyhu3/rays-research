/**
 * ────────────────────────────────────────────────────────────────────────
 *  CHART NAMES & DESCRIPTIONS  —  edit chart titles and subtitles here.
 * ────────────────────────────────────────────────────────────────────────
 * One entry per chart, keyed by its `chartId`. `title` is the heading shown
 * on the card; `subtitle` is the description line beneath it.
 *
 * Keep titles as plain, logical chart labels. Subtitles should only explain
 * what the metric is or call out a notable change in the data — never how the
 * data was collected (source and cadence live in chartSources.js).
 *
 * To rename a chart or reword its description, edit the strings below — you
 * do NOT need to touch the view files. (A handful of charts whose title or
 * description is computed from live data keep that text in the view and are
 * intentionally omitted here.)
 *
 * Source/frequency live in   chartSources.js
 * Insight & footnote text in chartInsights.js
 */
export const CHART_TEXT = {
  // ── Developer signals · PyPI / npm (view: pypi) ──────────────────────
  'pypi-installs': {
    title: 'Python SDK Weekly Downloads',
    subtitle: "Weekly PyPI downloads for each AI provider's Python SDK.",
  },
  'pypi-share': {
    title: 'Anthropic vs OpenAI Install Share',
    subtitle: "Anthropic's share of combined installs has nearly doubled in 6 months.",
  },
  'pypi-npm': {
    title: 'JavaScript/TypeScript SDK Weekly Downloads',
    subtitle: "Weekly npm downloads. OpenAI still leads, but Anthropic is closing.",
  },
  // ── Developer signals · GitHub (view: github) ─────────────────────────
  'github-stars': {
    title: 'GitHub Stars by SDK',
    subtitle: 'Cumulative stars per repository; a rising slope signals accelerating adoption.',
  },
  'github-deps': {
    title: 'Repositories Depending on Each SDK',
    subtitle: 'How many public repos depend on each SDK — a production-adoption signal.',
  },

  // ── Consumer signals · HuggingFace (view: hf) ─────────────────────────
  'hf-downloads': {
    title: 'Most-Downloaded Models',
    subtitle: 'Top 10 models on the Hub by cumulative downloads.',
  },
  'hf-families': {
    title: 'Open-Model Demand by Family',
    // subtitle is computed from live data in the view
  },
  'hf-categories': {
    title: 'Top Model Categories',
    subtitle: 'Pipeline tags across the current top-30 most-downloaded models.',
  },
  'hf-uploads': {
    title: 'Model Creation Rate',
    // subtitle is computed from live data in the view
  },

  // ── Infrastructure & OSS · Docker (view: docker) ──────────────────────
  'docker-pulls': {
    title: 'AI Image Pull Counts',
    subtitle: 'Cumulative pulls proxy how widely each image is deployed; CUDA and PyTorch dominate.',
  },
  'docker-stars': {
    title: 'AI Image Stars',
    subtitle: 'Community approval; newer inference images (Ollama, vLLM) are gaining fast.',
  },

  // ── Community · Hacker News (view: community) ─────────────────────────
  'hn-volume': {
    title: 'Weekly AI Story Volume on Hacker News',
    subtitle: 'A leading indicator — technical early adopters discuss here before the mainstream.',
  },
  'hn-terms': {
    title: 'HN Mentions by Term',
    subtitle: 'Which AI brands and concepts dominate Hacker News discussion.',
  },

  // ── Infrastructure & OSS · GitHub commit activity (view: github-commits)
  'github-commit-velocity': {
    title: 'Weekly Commit Velocity',
    subtitle: 'Commit cadence tracks development intensity; spikes often precede major releases.',
  },
  'github-commit-totals': {
    // title is computed from the time window in the view
    subtitle: 'Total commits in the tracked window — shows which projects are most actively maintained.',
  },

  // ── Token consumption · Chinese LLMs (view: chinese) ──────────────────
  'cn-tokens': {
    title: 'Chinese LLM Weekly Token Consumption',
    subtitle: "Weekly token throughput for Chinese models in OpenRouter's top 10 — real production traffic.",
  },
  'cn-market': {
    title: 'China Enterprise LLM Market Share',
    subtitle: 'iFlytek leads at 9.4%, Zhipu second at 6.6%; the market is highly fragmented.',
  },
  'cn-pricing': {
    title: 'Input Token Pricing — Frontier Models',
    subtitle: 'Input $/M tokens across major providers (US, Chinese, and open models). Chinese and open models cluster near $0.30/M; Western flagships range to $15/M.',
  },
  'cn-mau': {
    title: 'MiniMax Consumer App MAU',
    subtitle: 'Talkie reached 20M MAU in the first 9 months of 2025 — among the fastest-growing AI apps globally.',
  },
  'cn-revenue': {
    title: 'Zhipu AI Annual Revenue',
    subtitle: 'Revenue grew 132% YoY to ¥724M (~$99M) in 2025, led by enterprise AI agent deployments.',
  },
  'cn-bench': {
    title: 'SWE-bench Verified — Chinese vs US Frontier Models',
    subtitle: 'GLM-5 at 77.8% and MiniMax M2.5 at 80.2% now approach Claude Opus 4.6 at 80.9%.',
  },

  // ── Infrastructure · US datacenter build (view: datacenter) ───────────
  'dc-capex': {
    title: 'Hyperscaler Datacenter Capex ($B)',
    subtitle: 'The top 5 tech firms alone exceeded $400B in 2025; IEA projects a further 75% rise in 2026.',
  },
  'dc-capacity': {
    title: 'US Datacenter Capacity Under Construction (GW)',
    subtitle: 'AI datacenter capacity tripled in the past 18 months; ~⅓ of the 240 GW announced is under active construction.',
  },
  'dc-state': {
    title: 'Permitted Capacity by US State (GW, top 8)',
    subtitle: 'Largest pipelines of permitted (not yet built) load. Virginia hosts 26% of US datacenter electricity use; Texas and Oregon grow fastest.',
  },
  'dc-grid': {
    title: 'Grid Interconnection Queue — Large Loads (GW, PJM + MISO)',
    subtitle: 'Datacenter load awaiting grid connection; PJM waits now exceed 8 years for 2025 approvals.',
  },
  'dc-btm': {
    title: 'Behind-the-Meter Generation (MW)',
    subtitle: 'On-site gas, solar, and nuclear deployed at datacenter sites to bypass grid interconnection delays.',
  },
  'dc-deals': {
    title: 'New Datacenter Deals per Quarter',
    subtitle: 'A leading indicator of construction starts; new deals fell 40%+ in Q4 2025 amid capital-crunch concerns.',
  },

  // ── Infrastructure · AI electricity demand (view: electricity) ────────
  'elec-consumption': {
    title: 'US Datacenter Electricity Consumption (TWh/yr)',
    subtitle: '183 TWh in 2024 (~4.4% of US electricity); IEA projects 325–580 TWh by 2028, driven almost entirely by AI.',
  },
  'elec-state': {
    title: 'State Share of Datacenter Electricity (%)',
    subtitle: 'Virginia alone consumes 26% of US datacenter electricity — a single-state concentration risk.',
  },
  'elec-ai-share': {
    title: 'AI Share of US Electricity (%)',
    subtitle: 'Under 1% in 2020; on track for 8–12% by 2028 in the high-growth scenario.',
  },
  'elec-rates': {
    title: 'Household Electricity Rate Impact (¢/kWh)',
    subtitle: "Datacenter grid upgrades are passed to ratepayers; Dominion proposed its first base-rate rise since 1992.",
  },
  'elec-mix': {
    title: 'Renewable vs Fossil Datacenter Power',
    subtitle: 'Renewables supply ~27% globally; PPAs are outpacing grid delivery, forcing gas-turbine bridging.',
  },
  'elec-pue': {
    title: 'Power Usage Effectiveness (PUE)',
    subtitle: 'Total facility power ÷ IT power (1.0 = ideal); hotter AI GPU clusters push PUE higher.',
  },

  // ── Pricing · GPU & memory spot (view: pricing) ───────────────────────
  'gpu-index': {
    title: 'Mainstream GPU Rental Benchmark ($/hr)',
    subtitle: 'Average on-demand $/hr across the tracked GPUs.',
  },
  'gpu-spot-combined': {
    title: 'GPU Spot Price by Model ($/hr)',
    subtitle: 'Interruptible spot price for each tracked GPU over time.',
  },
  'aws-chip-spot': {
    title: 'AWS AI-Chip Spot Price — Trainium / Inferentia ($/chip/hr)',
    subtitle: "Per-chip spot price for AWS's in-house AI accelerators (no third-party market equivalent).",
  },
  'cpu-spot-history': {
    title: 'CPU Instance Spot Price Over Time ($/hr)',
    subtitle: 'Daily spot price per AWS CPU instance type. History accumulates from first scrape.',
  },
  'tpu-spot-rates': {
    title: 'GCP TPU Preemptible Rates — On-Demand vs Spot ($/chip/hr)',
    subtitle: 'GCP TPU preemptible (spot) price per chip per hour. Reference rates from cloud.google.com/tpu/docs/pricing; live with GCP_BILLING_API_KEY.',
  },
  'tpu-spot-history': {
    title: 'GCP TPU Preemptible Price Over Time ($/chip/hr)',
    subtitle: 'Daily preemptible price per TPU chip per generation. History accumulates from first scrape.',
  },
  'gen-ai-revenue': {
    title: 'AI Company Annualized Revenue (USD billions)',
    subtitle: 'Annualized revenue run rates sourced from company disclosures and media reports. Each dot is a reported data point. Source: Epoch AI.',
  },
  'oa-revenue': {
    title: 'OpenAI Annualized Revenue (USD billions)',
    subtitle: 'Annualized revenue run rates from company disclosures and media reports. Source: Epoch AI.',
  },
  'ant-revenue': {
    title: 'Anthropic Annualized Revenue (USD billions)',
    subtitle: 'Annualized revenue run rates from company disclosures and media reports. Source: Epoch AI.',
  },
  'dram-index': {
    // The card shows a live title (index name + unit); this static title is the
    // fallback used in the overview "Customise" chart picker.
    title: 'Mainstream DRAM Spot Price Index',
    subtitle: 'Benchmark spot price for mainstream DRAM, at monthly resolution.',
  },
  'dram-chips': {
    title: 'DRAM & GDDR Spot Price by Model ($)',
    // subtitle is computed (methodology + as-of date) in the view
  },
  'dram-modules': {
    title: 'Memory Module Spot Price by Model ($)',
    // subtitle is computed in the view
  },
  // ── Sentiment (view: sentiment) — StockTwits posting volume & sentiment ─
  // Aggregate (default view)
  'sent-aggregate':    { title: 'StockTwits Sentiment — Bullish vs Bearish (weekly)' },
  'sent-cat-volprice': { title: 'Volume vs Price Level — Rolling Correlation by Category' },
  'sent-cat-volnext':  { title: 'Volume → Next-Day Return — Rolling Correlation by Category' },
  'sent-cat-sentnext': { title: 'Net Sentiment → Next-Day Return — Rolling Correlation by Category' },
  'sent-level-returns':{ title: 'Volume Correlation — Price Level vs Weekly Return' },
  'sent-significance': { title: 'Volume → Next-Day Return — Statistical Significance' },
  // Per-ticker (search view)
  'sent-tk-weekly-vp': { title: 'Weekly Posting Volume vs Price' },
  'sent-tk-sentiment': { title: 'Bullish vs Bearish (weekly)' },
  'sent-tk-leadlag':   { title: 'Daily Post Count vs Next-Day Return' },
  'sent-tk-rolling':   { title: 'Rolling 20-Day Correlations' },

  // ── Supply chain (views: ai-supply / ai-supply-optics / ai-supply-pcb) ─
  'supply-all-rev':    { title: 'Monthly Revenue — All Companies (NT$M)' },
  'supply-all-yoy':    { title: 'YoY Growth — All Companies (%)' },
  'supply-all-mom':    { title: 'MoM Growth — All Companies (%)' },
  'supply-total-rev':  { title: 'Total Monthly Revenue — All Companies (NT$M)' },
  'supply-optics-rev': { title: 'Monthly Revenue — Optics (NT$M)' },
  'supply-optics-yoy': { title: 'YoY Growth — Optics (%)' },
  'supply-optics-mom': { title: 'MoM Growth — Optics (%)' },
  'supply-fiber-rev':  { title: 'Monthly Revenue — Fiber (NT$M)' },
  'supply-fiber-yoy':  { title: 'YoY Growth — Fiber (%)' },
  'supply-fiber-mom':  { title: 'MoM Growth — Fiber (%)' },
  'supply-pcb-rev':    { title: 'Monthly Revenue — PCB (NT$M)' },
  'supply-pcb-yoy':    { title: 'YoY Growth — PCB (%)' },
  'supply-pcb-mom':    { title: 'MoM Growth — PCB (%)' },
  'supply-mlcc-rev':   { title: 'Monthly Revenue — MLCC (NT$M)' },
  'supply-mlcc-yoy':   { title: 'YoY Growth — MLCC (%)' },
  'supply-mlcc-mom':   { title: 'MoM Growth — MLCC (%)' },

  // ── Company · OpenAI / ChatGPT (view: demand-openai) ──────────────────
  'oa-sdk': {
    title: 'OpenAI SDK Weekly Downloads',
    subtitle: 'openai Python (PyPI) and JS/TS (npm) weekly installs.',
  },
  'oa-or-share': {
    title: 'OpenAI Share of OpenRouter Tokens (%)',
    subtitle: 'OpenAI models as a percentage of weekly OpenRouter token throughput.',
  },
  'oa-or-models': {
    title: 'OpenAI Models in OpenRouter Top 15',
    // subtitle is computed (latest week) in the view
  },
  'oa-stars': {
    title: 'openai-python GitHub Stars',
    subtitle: 'Cumulative stars; a rising slope signals accelerating adoption.',
  },
  'oa-pricing': {
    title: 'OpenAI Model Input Pricing ($/M tokens)',
    subtitle: "Input price per 1M tokens for OpenAI's models, tracked daily.",
  },
  // ── Company · Anthropic / Claude (view: demand-anthropic) ─────────────
  'an-sdk': {
    title: 'Anthropic SDK Weekly Downloads',
    subtitle: 'anthropic Python (PyPI) and @anthropic-ai/sdk (npm) weekly installs.',
  },
  'an-or-share': {
    title: 'Anthropic Share of OpenRouter Tokens (%)',
    subtitle: 'Anthropic models as a percentage of weekly OpenRouter token throughput.',
  },
  'an-or-models': {
    title: 'Anthropic Models in OpenRouter Top 15',
    // subtitle is computed (latest week) in the view
  },
  'an-stars': {
    title: 'anthropic-sdk-python GitHub Stars',
    subtitle: 'Cumulative stars; a rising slope signals accelerating adoption.',
  },
  'an-github': {
    title: 'anthropic-sdk-python Dependent Repos',
    subtitle: 'Public repos that depend on the SDK — a production-adoption signal.',
  },
  'an-pricing': {
    title: 'Anthropic Model Input Pricing ($/M tokens)',
    subtitle: "Input price per 1M tokens for Anthropic's Claude models, tracked daily.",
  },
  // ── Company · Google / Gemini (view: demand-google) ───────────────────
  'goo-sdk': {
    title: 'Google AI SDK Weekly Downloads',
    subtitle: 'google-genai Python (PyPI) and @google/genai (npm) weekly installs.',
  },
  'goo-or-share': {
    title: 'Google Share of OpenRouter Tokens (%)',
    subtitle: 'Google models as a percentage of weekly OpenRouter token throughput.',
  },
  'goo-or-models': {
    title: 'Google Models in OpenRouter Top 15',
    // subtitle is computed (latest week) in the view
  },
  'goo-stars': {
    title: 'google-genai GitHub Stars',
    subtitle: 'Cumulative stars; a rising slope signals accelerating adoption.',
  },
  'goo-github': {
    title: 'google-genai Dependent Repos',
    subtitle: 'Public repos that depend on the SDK — a production-adoption signal.',
  },
  'goo-hf': {
    title: 'Gemma HuggingFace Downloads',
    subtitle: 'Cumulative downloads of the Gemma model family.',
  },
  'goo-pricing': {
    title: 'Google Model Input Pricing ($/M tokens)',
    subtitle: "Input price per 1M tokens for Google's Gemini models, tracked daily.",
  },
  // ── Company · Zhipu AI / GLM (view: demand-zhipu) ─────────────────────
  'zh-or-share': {
    title: 'Zhipu AI Share of OpenRouter Tokens (%)',
    subtitle: 'Zhipu GLM models as a percentage of weekly OpenRouter token throughput.',
  },
  'zh-revenue': {
    title: 'Zhipu AI Annual Revenue (¥M)',
    subtitle: 'Revenue grew 132% YoY to ¥724M (~$99M) in 2025; enterprise AI agent deployments +249% YoY.',
  },
  'zh-market': {
    title: 'China Enterprise LLM Market Share (%)',
    subtitle: 'Zhipu holds 6.6% — second only to iFlytek; the market remains highly fragmented.',
  },
  'zh-hf': {
    title: 'GLM HuggingFace Downloads',
    subtitle: 'Cumulative downloads of the GLM family (zai-org).',
  },
  'zh-pricing': {
    title: 'GLM Model Input Pricing ($/M tokens)',
    subtitle: "Input price per 1M tokens for Zhipu's GLM models, tracked daily.",
  },
  'zh-bench': {
    title: 'SWE-bench Verified — GLM-5 vs Frontier Models',
    subtitle: 'GLM-5 scores 77.8% — within 3 points of Claude Opus; the capability gap has effectively closed.',
  },

  // ── Company · MiniMax (view: demand-minimax) ──────────────────────────
  'mm-or-share': {
    title: 'MiniMax Share of OpenRouter Tokens (%)',
    subtitle: 'MiniMax models as a percentage of weekly OpenRouter token throughput.',
  },
  'mm-hf': {
    title: 'MiniMax HuggingFace Downloads',
    subtitle: 'Cumulative downloads of MiniMaxAI models.',
  },
  'mm-mau': {
    title: 'MiniMax Consumer App MAU',
    subtitle: "Talkie/Xingye (AI companion) and Hailuo AI (video) are MiniMax's consumer anchors.",
  },
  'mm-pricing': {
    title: 'MiniMax Model Input Pricing ($/M tokens)',
    subtitle: "Input price per 1M tokens for MiniMax's models, tracked daily.",
  },
  'mm-bench': {
    title: 'SWE-bench Verified — MiniMax M2.5 vs Frontier Models',
    subtitle: 'MiniMax M2.5 scores 80.2% — essentially tied with Claude Opus 4.6 at 80.9%.',
  },

  // ── Market signals · Infrastructure & OSS (view: demand-general) ──────
  'gen-gpu': {
    title: 'GPU Spot Prices ($/hr)',
    subtitle: 'Spot pricing for the most-rented AI accelerators; H200 commands a premium over H100.',
  },
  'gen-gpu-avail': {
    title: 'GPU Marketplace Availability',
    subtitle: 'Scarcity signal: fewer rentable offers = demand outrunning supply.',
  },
  'gen-mcp': {
    title: 'MCP Ecosystem — Cumulative GitHub Repos',
    // subtitle is computed (servers-repo stars) in the view
  },
  'gen-sec': {
    title: 'SEC Filings Mentioning AI Terms',
    subtitle: 'Count of 10-K/10-Q filings mentioning each term in the trailing 90 days — an enterprise-adoption signal.',
  },
  'gen-commits': {
    title: 'AI OSS Commit Velocity (Last 4 Weeks)',
    subtitle: 'Total commits in the last 4 weeks across key open-source AI frameworks.',
  },
  'gen-docker': {
    title: 'AI Image Pull Counts',
    subtitle: 'Cumulative pulls for the most-used AI infrastructure container images.',
  },
  'gen-hn': {
    title: 'Weekly AI Story Volume on Hacker News',
    subtitle: 'AI, LLM, ChatGPT, Claude, or Gemini stories per week — a community-attention proxy.',
  },
  'gen-cnmarket': {
    title: 'China Enterprise LLM Market Share (%)',
    subtitle: 'Highly fragmented — the top 6 players hold only 37% combined.',
  },

  // ── Market signals · OpenRouter model rankings (view: openrouter-rankings)
  'or-top': {
    title: 'Top 10 Models by Weekly Token Volume',
    // subtitle is computed (latest week / as-of) in the view
  },
  'or-trend': {
    title: 'Top 8 Models — Weekly Token Trend',
    subtitle: 'Rising lines signal accelerating adoption; each point is one week of token throughput.',
  },
  'or-provstack': {
    title: 'Provider Token Volume (Stacked Weekly)',
    subtitle: 'Weekly tokens by provider — shows which companies are gaining or losing share.',
  },
  'or-provshare': {
    title: 'Provider Market Share (%)',
    subtitle: "Each line is a provider's percentage of total weekly OpenRouter traffic; crossing lines = share shifts.",
  },
  'or-combo': {
    title: 'Total Weekly Tokens vs YoY Growth',
    subtitle: 'Bars show total platform tokens (left axis); the line shows year-over-year growth in % (right axis).',
  },
  'or-growth': {
    title: 'Week-over-Week Token Growth — Top Models (%)',
    subtitle: '% change in weekly tokens vs the prior week; faded bars mark declining models.',
  },
  'dc-gw-annual': {
    title: 'Annual AI Capacity Deployments (GW)',
    subtitle: 'Incremental gigawatts coming online each year by operator type — peak 2027 at 32.3 GW.',
  },
  'dc-operators': {
    title: 'Total Planned AI Capacity by Operator (GW)',
    subtitle: 'Aggregate gigawatts announced across all projects; sorted largest first.',
  },
  'dc-geo': {
    title: 'Global AI Data Center Projects — Geographic Distribution',
    subtitle: 'Each bubble = one announced project; size scales with planned GW capacity.',
  },
  'dc-deploy-mix': {
    title: 'Incremental AI Capacity Deployment by Buyer (GW)',
    subtitle: 'Annual GW additions: OpenAI, the four hyperscaler CSPs (Oracle, Google, AWS, Microsoft — the aggregate CSP total split by capacity share), and all other operators.',
  },
  'dc-overview-gantt': {
    title: 'All AI Infrastructure Projects — Buildout Timeline',
    subtitle: 'Gantt view of every announced project. Hover for GW, investment, partners & notes. Bright bars = capacity confirmed; dim bars = investment-only.',
  },
  'dc-aws-gantt':    { title: 'Amazon AWS — Data Center Buildout Timeline' },
  'dc-google-gantt': { title: 'Google — Data Center Buildout Timeline' },
  'dc-msft-gantt':   { title: 'Microsoft — Data Center Buildout Timeline' },
  'dc-oracle-gantt': { title: 'Oracle — Data Center Buildout Timeline' },
  'dc-openai-gantt': { title: 'OpenAI — Infrastructure Buildout Timeline' },
  'dc-nebius-gantt': { title: 'Nebius — Data Center Buildout Timeline' },
  'dc-meta-gantt':   { title: 'Meta Platforms — Data Center Buildout Timeline' },

  // ── Web traffic (per-company line charts & overview stacked bar) ───────
  'oa-web-visits': {
    title: 'openai.com Monthly Website Visits',
    subtitle: 'Daily snapshots of SimilarWeb monthly visit estimates for openai.com via Apify.',
  },
  'an-web-visits': {
    title: 'anthropic.com Monthly Website Visits',
    subtitle: 'Daily snapshots of SimilarWeb monthly visit estimates for anthropic.com via Apify.',
  },
  'goo-web-visits': {
    title: 'gemini.google.com Monthly Website Visits',
    subtitle: 'Daily snapshots of SimilarWeb monthly visit estimates for gemini.google.com via Apify.',
  },
  'mm-web-visits': {
    title: 'hailuoai.com Monthly Website Visits',
    subtitle: 'Daily snapshots of SimilarWeb monthly visit estimates for hailuoai.com (MiniMax) via Apify.',
  },
  'zh-web-visits': {
    title: 'zhipuai.cn Monthly Website Visits',
    subtitle: 'Daily snapshots of SimilarWeb monthly visit estimates for zhipuai.cn via Apify.',
  },
  'web-visits-total': {
    title: 'AI Company Website Visits — Total Monthly (All 5)',
    subtitle: 'Stacked daily snapshot of SimilarWeb monthly visits across OpenAI, Anthropic, Google Gemini, MiniMax, and Zhipu.',
  },
};
