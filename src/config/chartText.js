/**
 * ────────────────────────────────────────────────────────────────────────
 *  CHART NAMES & DESCRIPTIONS  —  edit chart titles and subtitles here.
 * ────────────────────────────────────────────────────────────────────────
 * One entry per chart, keyed by its `chartId`. `title` is the heading shown
 * on the card; `subtitle` is the description line beneath it.
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
  // ── Developer signals · PyPI / npm / Stack Overflow (view: pypi) ──────
  'pypi-installs': {
    title: 'PyPI weekly downloads — Python SDK installs',
    subtitle: "Weekly downloads for each AI provider's Python SDK. Zero cost, fully automatable.",
  },
  'pypi-share': {
    title: 'Anthropic vs OpenAI — share of combined installs',
    subtitle: "Anthropic's share of the combined install base has nearly doubled in 6 months.",
  },
  'pypi-npm': {
    title: 'npm weekly downloads — JS/TS SDKs',
    subtitle: "Node.js ecosystem. OpenAI's npm package still leads but Anthropic is closing.",
  },
  'pypi-so': {
    title: 'Stack Overflow questions (all time) by tag',
    subtitle: 'Cumulative question count per tag — measures ecosystem depth and developer mindshare.',
  },

  // ── Developer signals · GitHub (view: github) ─────────────────────────
  'github-stars': {
    title: 'GitHub stars per SDK repository — over time',
    subtitle: 'Developer mindshare. Stars accumulate; rising slope = accelerating adoption.',
  },
  'github-deps': {
    title: 'GitHub "Used By" — repositories depending on each SDK',
    subtitle: 'Production adoption signal — separates code that ships from code that demos.',
  },

  // ── Developer signals · Google Trends (view: trends) ──────────────────
  'trends-api': {
    title: 'Google Trends — relative search interest (0–100)',
    subtitle: 'Daily relative search volume in the US. Index 100 = peak of leading term in period.',
  },
  'trends-geo': {
    title: 'Search interest by metro — "Claude API" (US)',
    subtitle: 'Top US cities by relative Claude API search interest.',
  },
  'trends-brand': {
    title: '"Claude" vs "ChatGPT" — consumer brand search',
    subtitle: 'Brand awareness proxy. ChatGPT dominant but Claude closing at accelerating rate.',
  },

  // ── Consumer signals · HuggingFace (view: hf) ─────────────────────────
  'hf-downloads': {
    title: 'HuggingFace — most-downloaded models (all-time)',
    subtitle: 'Top 10 models on the Hub by cumulative downloads.',
  },
  'hf-families': {
    title: 'Open-model demand by family',
    // subtitle is computed from live data in the view
  },
  'hf-categories': {
    title: 'Top-model category breakdown',
    subtitle: 'Pipeline tags across the current top-30 most-downloaded models.',
  },
  'hf-uploads': {
    title: 'Model creation rate on the Hub',
    // subtitle is computed from live data in the view
  },

  // ── Infrastructure & OSS · Docker (view: docker) ──────────────────────
  'docker-pulls': {
    title: 'Docker Hub — all-time pull counts for AI infrastructure images',
    subtitle: 'Pull counts proxy how widely AI infrastructure is deployed. NVIDIA CUDA and PyTorch dominate; inference servers (vLLM, Ollama, HF TGI) show the inference tier.',
  },
  'docker-stars': {
    title: 'Docker Hub — star count by image',
    subtitle: 'Stars reflect community approval. Newer inference images (Ollama, vLLM) gaining fast relative to pulls.',
  },

  // ── Community · Hacker News & Wikipedia (view: community) ─────────────
  'hn-volume': {
    title: 'Hacker News — weekly AI story volume',
    subtitle: 'Stories matching "AI", "LLM", "ChatGPT", "Claude", or "Gemini". HN volume is a leading indicator — technically-minded early adopters discuss here before mainstream.',
  },
  'hn-terms': {
    title: 'HN mentions by term — last 4 weeks',
    subtitle: 'Which AI brands and concepts dominate HN discussion. ChatGPT leads volume; Claude and AI agents track developer mindshare.',
  },
  'wiki-views': {
    title: 'Wikipedia — weekly pageviews for AI articles',
    subtitle: 'Wikipedia pageviews measure public interest, not developer interest. Spikes follow news cycles. ChatGPT stays top; LLM views rise as the concept goes mainstream.',
  },

  // ── Infrastructure & OSS · GitHub commit activity (view: github-commits)
  'github-commit-velocity': {
    title: 'Weekly commit velocity — top AI OSS repositories',
    subtitle: 'Commit cadence tracks active development intensity. Spikes often precede major releases.',
  },
  'github-commit-totals': {
    // title is computed from the time window in the view
    subtitle: 'Total commits in the tracked window — shows which projects are most actively maintained.',
  },

  // ── Token consumption · Chinese LLMs (view: chinese) ──────────────────
  'cn-tokens': {
    title: 'Chinese LLM weekly token consumption on OpenRouter',
    subtitle: "Real weekly token throughput for Chinese models ranked in OpenRouter's top 10. Production developer traffic, not benchmark scores.",
  },
  'cn-market': {
    title: 'China domestic LLM market share (enterprise, %)',
    subtitle: "China's enterprise LLM market. iFlytek leads at 9.4%, Zhipu second at 6.6%. Market is highly fragmented — no single player dominates.",
  },
  'cn-pricing': {
    title: 'Input token pricing — Chinese vs US models ($/M tokens)',
    subtitle: 'The pricing gap driving developer adoption. Chinese models average $0.28–0.40/M input tokens vs $2.50–5.00/M for comparable US models. Near-parity quality at 10–17× lower cost.',
  },
  'cn-mau': {
    title: 'MiniMax consumer app MAU (millions)',
    subtitle: "Talkie/Xingye (AI companion) and Hailuo AI (video generation) are MiniMax's consumer anchors. Talkie reached 20M MAU in the first 9 months of 2025 — among the fastest-growing AI apps globally.",
  },
  'cn-revenue': {
    title: 'Zhipu AI revenue (million yuan)',
    subtitle: "Zhipu AI's annual revenue grew 132% YoY to 724M yuan (~$99M USD) in 2025 — driven by enterprise AI agent deployments (+249%) and its Model-as-a-Service platform across finance, manufacturing, and healthcare.",
  },
  'cn-bench': {
    title: 'SWE-bench Verified scores — Chinese vs US frontier models',
    subtitle: 'Software engineering benchmark as a quality proxy. Chinese models now approach or match US frontier models. GLM-5 scores 77.8%, MiniMax M2.5 at 80.2% — vs Claude Opus 4.6 at 80.9%.',
  },

  // ── Infrastructure · US datacenter build (view: datacenter) ───────────
  'dc-capex': {
    title: 'Hyperscaler capex committed to datacenter build ($B)',
    subtitle: 'Annual capital expenditure dedicated to AI datacenter construction. The top 5 tech companies alone exceeded $400B in 2025 — more than global oil & gas investment. IEA projects a further 75% increase in 2026.',
  },
  'dc-capacity': {
    title: 'US datacenter capacity under construction (GW)',
    subtitle: 'AI "factory" datacenter capacity actually breaking ground, per IEA satellite-based tracking. "AI factories" tripled in capacity in the past 18 months. Of 240 GW announced, roughly one-third are under active construction.',
  },
  'dc-state': {
    title: 'Permitted capacity by US state (GW, top 8)',
    subtitle: 'States with the largest pipeline of permitted (not yet built) datacenter load. Virginia hosts 26% of current US datacenter electricity consumption. Texas and Oregon are the fastest-growing.',
  },
  'dc-grid': {
    title: 'Grid interconnection queue — large loads (GW, PJM + MISO)',
    subtitle: 'New datacenter load applications waiting for grid connection. PJM queue wait is now 8+ years for projects approved in 2025. A rising queue = rising demand but also rising supply constraint.',
  },
  'dc-btm': {
    title: 'Behind-the-meter generation deployments (MW)',
    subtitle: 'On-site natural gas, solar, and nuclear power deployed directly at datacenter sites ("bring your own power"). Hyperscalers are bypassing the grid to avoid interconnection delays.',
  },
  'dc-deals': {
    title: 'New datacenter deals signed per quarter',
    subtitle: 'Leasing activity is a leading indicator — signed deals become construction starts 6–18 months later. New deals fell 40%+ in Q4 2025 amid capital crunch concerns.',
  },

  // ── Infrastructure · AI electricity demand (view: electricity) ────────
  'elec-consumption': {
    title: 'US datacenter electricity consumption (TWh / year)',
    subtitle: "Annual US datacenter electricity demand. At 183 TWh in 2024, datacenters consumed ~4.4% of total US electricity — equivalent to Pakistan's entire national demand. IEA projects 325–580 TWh by 2028, driven almost entirely by AI workloads.",
  },
  'elec-state': {
    title: 'State share of national datacenter electricity (%)',
    subtitle: "Virginia alone consumes 26% of US datacenter electricity — a single-state concentration risk. Northern Virginia is the world's largest datacenter cluster.",
  },
  'elec-ai-share': {
    title: 'AI electricity as % of US total consumption',
    subtitle: "AI compute's growing share of the US grid. Was under 1% in 2020; on track for 8–12% by 2028 in the high-growth scenario.",
  },
  'elec-rates': {
    title: 'Average household electricity rate impact (¢/kWh)',
    subtitle: "Grid infrastructure upgrades for datacenters are being passed to ratepayers. Virginia's Dominion Energy proposed its first base-rate increase since 1992 in Feb 2025, partly attributable to datacenter load growth.",
  },
  'elec-mix': {
    title: 'Renewable vs fossil share of datacenter power',
    subtitle: 'Renewables currently supply ~27% of datacenter electricity globally. Hyperscalers are signing PPAs faster than the grid can deliver, forcing gas turbine bridging.',
  },
  'elec-pue': {
    title: 'Power Usage Effectiveness (PUE) — industry trend',
    subtitle: 'PUE = total facility power ÷ IT equipment power. Lower is better (1.0 = perfect). AI GPU clusters run hotter than traditional compute — driving PUE higher at cutting-edge facilities.',
  },

  // ── Pricing · GPU & memory spot (view: pricing) ───────────────────────
  'gpu-current-rates': {
    title: 'GPU rental rates today — on-demand vs spot ($/hr)',
    subtitle: 'Live vast.ai marketplace medians across verified single-GPU offers. Spot = interruptible min-bid floor (shown only where enough offers exist); on-demand = held-instance rate. Both use a 10% trimmed median.',
  },
  'gpu-avail': {
    title: 'GPU availability — rentable vast.ai offers',
    subtitle: 'Count of verified, unrented, rentable one-GPU offers returned by the vast.ai market API.',
  },
  'gpu-index': {
    title: 'Mainstream GPU rental benchmark ($/hr)',
    subtitle: "Average on-demand $/hr across the tracked vast.ai GPUs priced each day. The pre-vast.ai period is filled by AWS EC2 spot history — an H100/H200/A100 composite rebased ('indexed') to the vast.ai benchmark level at the join point — so it shows AWS's historical shape at vast.ai's level, an estimate, not literal vast.ai prices.",
  },
  'gpu-spot-combined': {
    title: 'GPU spot price ($/hr) — vast.ai, pre-history indexed from AWS',
    subtitle: "Single continuous line per GPU: vast.ai's actual price where available, with the earlier period filled by AWS EC2 spot history rebased ('indexed') to vast.ai's level at the join point. The two are different markets, so the pre-vast.ai portion shows AWS's historical shape at vast.ai's price level — an estimate, not literal vast.ai prices.",
  },
  'aws-chip-spot': {
    title: 'AWS AI-chip spot price ($/chip/hr) — Trainium / Inferentia',
    subtitle: "AWS's in-house AI accelerators (no third-party market equivalent). Per-chip interruptible spot price: exact EC2 DescribeSpotPriceHistory backfill (≤90 days), continued forward via the free AWS Spot Advisor. Daily median across us-east-1 / us-west-2 / us-east-2.",
  },
  'gpu-cloud-avg': {
    title: 'Average GPU rental price across major clouds ($/GPU/hr)',
    subtitle: 'Mean on-demand list price per GPU across AWS, Azure, GCP, CoreWeave, Nebius, and Oracle. The H100 line pools H100 and H200. Collected daily — fetched live where a cloud has a public price feed (Azure), with maintained reference rates for the rest. Forward-filled, accumulating from the day collection began.',
  },
  'dram-index': {
    // The card shows a live title (index name + unit); this static title is the
    // fallback used in the overview "Customise" chart picker.
    title: 'Mainstream DRAM spot price index',
    subtitle: "TrendForce's official mainstream DRAM spot price index. Monthly resolution, published on DataTrack.",
  },
  'dram-chips': {
    title: 'DRAM chip & GDDR spot price over time — average per model ($)',
    // subtitle is computed (methodology + as-of date) in the view
  },
  'dram-modules': {
    title: 'Memory module spot price over time — average per model ($)',
    // subtitle is computed in the view
  },
  'dram-change': {
    title: 'DRAM spot — session change by model (%)',
    // subtitle is computed (as-of date) in the view
  },

  // ── Supply chain (views: ai-supply / ai-supply-optics / ai-supply-pcb) ─
  'supply-all-rev':    { title: 'Monthly revenue (NT$M) — All companies' },
  'supply-all-yoy':    { title: 'YoY growth (%) — All companies' },
  'supply-all-mom':    { title: 'MoM growth (%) — All companies' },
  'supply-total-rev':  { title: 'Total monthly revenue (NT$M) — All companies' },
  'supply-optics-rev': { title: 'Monthly revenue (NT$M) — Optics' },
  'supply-optics-yoy': { title: 'YoY growth (%) — Optics' },
  'supply-optics-mom': { title: 'MoM growth (%) — Optics' },
  'supply-pcb-rev':    { title: 'Monthly revenue (NT$M) — PCB' },
  'supply-pcb-yoy':    { title: 'YoY growth (%) — PCB' },
  'supply-pcb-mom':    { title: 'MoM growth (%) — PCB' },

  // ── Company · OpenAI / ChatGPT (view: demand-openai) ──────────────────
  'oa-sdk': {
    title: 'SDK weekly downloads — openai Python & JavaScript',
    subtitle: 'openai Python SDK (PyPI) and openai JS/TS SDK (npm) weekly installs.',
  },
  'oa-or-share': {
    title: 'OpenAI — share of OpenRouter weekly tokens (%)',
    subtitle: 'Percentage of total weekly OpenRouter token throughput served by OpenAI models.',
  },
  'oa-or-models': {
    title: 'OpenAI models in OpenRouter top 15 — latest week tokens',
    // subtitle is computed (latest week) in the view
  },
  'oa-trends': {
    title: 'Google Trends — ChatGPT API & brand search interest',
    subtitle: 'Relative search volume 0–100. API intent (developer) vs brand (consumer).',
  },
  'oa-stars': {
    title: 'openai-python — GitHub stars',
    subtitle: 'Developer mindshare. Stars accumulate; rising slope = accelerating adoption.',
  },
  'oa-github': {
    title: 'openai-python — GitHub dependent repos',
    subtitle: 'Production adoption: repos that depend on the SDK.',
  },
  'oa-so': {
    title: 'Stack Overflow — [openai-api] tag activity',
    subtitle: 'Developer troubleshooting volume around the OpenAI API.',
  },
  'oa-wiki': {
    title: 'Wikipedia — ChatGPT article weekly pageviews',
    // subtitle is computed (HN mentions + latest views) in the view
  },

  // ── Company · Anthropic / Claude (view: demand-anthropic) ─────────────
  'an-sdk': {
    title: 'SDK weekly downloads — anthropic Python & JavaScript',
    subtitle: 'anthropic Python SDK (PyPI) and @anthropic-ai/sdk JS/TS SDK (npm) weekly installs.',
  },
  'an-or-share': {
    title: 'Anthropic — share of OpenRouter weekly tokens (%)',
    subtitle: 'Percentage of total weekly OpenRouter token throughput served by Anthropic models.',
  },
  'an-or-models': {
    title: 'Anthropic models in OpenRouter top 15 — latest week tokens',
    // subtitle is computed (latest week) in the view
  },
  'an-trends': {
    title: 'Google Trends — Claude API & brand search interest',
    subtitle: 'Relative search volume 0–100. Claude API intent growing fastest of all providers.',
  },
  'an-stars': {
    title: 'anthropic-sdk-python — GitHub stars',
    subtitle: 'Developer mindshare. Stars accumulate; rising slope = accelerating adoption.',
  },
  'an-github': {
    title: 'anthropic-sdk-python — GitHub dependent repos',
    subtitle: 'Production adoption: repos that depend on the SDK.',
  },
  'an-so': {
    title: 'Stack Overflow — [claude] tag activity',
    subtitle: 'Developer troubleshooting volume around the Claude API.',
  },
  'an-wiki': {
    title: 'Wikipedia — Claude article weekly pageviews',
    // subtitle is computed (HN mentions + latest views) in the view
  },

  // ── Company · Google / Gemini (view: demand-google) ───────────────────
  'goo-sdk': {
    title: 'SDK weekly downloads — Google AI Python & JavaScript',
    subtitle: 'google-genai Python SDK (PyPI) and @google/genai JS/TS SDK (npm) weekly installs.',
  },
  'goo-or-share': {
    title: 'Google — share of OpenRouter weekly tokens (%)',
    subtitle: 'Percentage of total weekly OpenRouter token throughput served by Google models.',
  },
  'goo-or-models': {
    title: 'Google models in OpenRouter top 15 — latest week tokens',
    // subtitle is computed (latest week) in the view
  },
  'goo-trends': {
    title: 'Google Trends — Gemini API & brand search interest',
    subtitle: 'Relative search volume 0–100.',
  },
  'goo-stars': {
    title: 'google-genai — GitHub stars',
    subtitle: 'Developer mindshare. Stars accumulate; rising slope = accelerating adoption.',
  },
  'goo-github': {
    title: 'google-genai — GitHub dependent repos',
    subtitle: 'Production adoption: repos that depend on the SDK.',
  },
  'goo-so': {
    title: 'Stack Overflow — [google-gemini] tag activity',
    subtitle: 'Developer troubleshooting volume around the Gemini API.',
  },
  'goo-hf': {
    title: 'Gemma — HuggingFace family downloads',
    subtitle: 'Open-model demand: cumulative downloads of the Gemma family.',
  },
  'goo-wiki': {
    title: 'Wikipedia — Gemini article weekly pageviews',
    // subtitle is computed (HN mentions + latest views) in the view
  },

  // ── Company · Zhipu AI / GLM (view: demand-zhipu) ─────────────────────
  'zh-or-share': {
    title: 'Zhipu AI — share of OpenRouter weekly tokens (%)',
    subtitle: 'Percentage of total weekly OpenRouter token throughput served by Zhipu GLM models.',
  },
  'zh-revenue': {
    title: 'Zhipu AI — annual revenue (million yuan)',
    subtitle: "Zhipu AI's annual revenue grew 132% YoY to ¥724M (~$99M USD) in 2025. Enterprise AI agent deployments +249% YoY.",
  },
  'zh-market': {
    title: 'China domestic enterprise LLM market share (%)',
    subtitle: "Zhipu AI holds 6.6% of China's enterprise LLM market — second only to iFlytek. Market remains highly fragmented.",
  },
  'zh-hf': {
    title: 'GLM — HuggingFace family downloads',
    subtitle: 'Open-model demand: cumulative downloads of the GLM family (zai-org).',
  },
  'zh-pricing': {
    title: 'Input token pricing — GLM-5 vs global frontier models ($/M tokens)',
    subtitle: 'GLM-5 at $0.30/M input tokens vs $2.50–15.00/M for comparable US models. Near-parity quality at 8–50× lower cost.',
  },
  'zh-bench': {
    title: 'SWE-bench Verified — GLM-5 vs frontier models',
    subtitle: 'GLM-5 scores 77.8% on SWE-bench Verified — within 3 points of Claude Opus. The capability gap has effectively closed.',
  },

  // ── Company · MiniMax (view: demand-minimax) ──────────────────────────
  'mm-or-share': {
    title: 'MiniMax — share of OpenRouter weekly tokens (%)',
    subtitle: 'Percentage of total weekly OpenRouter token throughput served by MiniMax models.',
  },
  'mm-hf': {
    title: 'MiniMax — HuggingFace family downloads',
    subtitle: 'Open-model demand: cumulative downloads of MiniMaxAI models.',
  },
  'mm-mau': {
    title: 'MiniMax consumer app MAU (millions)',
    subtitle: "Talkie/Xingye (AI companion) and Hailuo AI (video generation) are MiniMax's consumer anchors.",
  },
  'mm-pricing': {
    title: 'Input token pricing — MiniMax M2.5 vs global frontier models ($/M tokens)',
    subtitle: 'MiniMax M2.5 at $0.30/M input tokens vs $2.50–15.00/M for comparable US models.',
  },
  'mm-bench': {
    title: 'SWE-bench Verified — MiniMax M2.5 vs frontier models',
    subtitle: 'MiniMax M2.5 scores 80.2% on SWE-bench Verified — essentially tied with Claude Opus 4.6 at 80.9%.',
  },

  // ── Market signals · Infrastructure & OSS (view: demand-general) ──────
  'gen-gpu': {
    title: 'GPU spot prices — vast.ai median $/hr',
    subtitle: 'Spot pricing for the most-rented AI accelerators. H200 commands a significant premium over H100.',
  },
  'gen-gpu-avail': {
    title: 'GPU marketplace availability — rentable offers on vast.ai',
    subtitle: 'Scarcity signal: fewer rentable offers for a GPU = demand outrunning supply.',
  },
  'gen-mcp': {
    title: 'MCP ecosystem — cumulative GitHub repos',
    // subtitle is computed (servers-repo stars) in the view
  },
  'gen-sec': {
    title: 'SEC filings mentioning AI terms — 10-K/10-Q, trailing 90 days',
    subtitle: 'Enterprise adoption signal: 10-K/10-Q filings mentioning each term in the trailing 90 days.',
  },
  'gen-commits': {
    title: 'GitHub OSS commit velocity — major AI repos (last 4 weeks)',
    subtitle: 'Total commits in the last 4 weeks across key open-source AI frameworks.',
  },
  'gen-docker': {
    title: 'Docker Hub — AI infrastructure image pull counts (total)',
    subtitle: 'Cumulative pull counts for the most-used AI infrastructure container images.',
  },
  'gen-hn': {
    title: 'Hacker News — weekly AI story volume',
    subtitle: 'Stories mentioning AI, LLM, ChatGPT, Claude, or Gemini per week. Community attention proxy.',
  },
  'gen-cnmarket': {
    title: 'China domestic enterprise LLM market share (%)',
    subtitle: "China's enterprise LLM market is highly fragmented — top 6 players hold only 37% combined. No single dominant player.",
  },

  // ── Market signals · OpenRouter model rankings (view: openrouter-rankings)
  'or-top': {
    title: 'Top 10 models — weekly token volume',
    // subtitle is computed (latest week / as-of) in the view
  },
  'or-trend': {
    title: 'Top 8 models — weekly token trend (last 4 weeks)',
    subtitle: 'Rising lines = accelerating developer adoption. Each point is one week of total token throughput.',
  },
  'or-provstack': {
    title: 'Provider token volume — stacked weekly breakdown',
    subtitle: 'Weekly token volume stacked by model provider. Shows which companies are gaining or losing share over time.',
  },
  'or-provshare': {
    title: 'Provider market share — % of weekly tokens (last 4 weeks)',
    subtitle: "Each line is a provider's percentage of total weekly OpenRouter traffic. Crossing lines = share shifts.",
  },
  'or-combo': {
    title: 'OpenRouter — total weekly tokens (bars) vs YoY growth (line)',
    subtitle: "Bars show total platform token volume (left axis); the line shows year-over-year growth in % (right axis). OpenRouter's dataset starts Jan 2025, so the line begins Jan 2026. The in-progress week is excluded.",
  },
  'or-growth': {
    title: 'Week-over-week token growth — top models (%)',
    subtitle: '% change in weekly tokens vs the prior week. Faded bars = declining models.',
  },
};
