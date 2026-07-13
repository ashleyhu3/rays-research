/**
 * ────────────────────────────────────────────────────────────────────────
 *  CHART SOURCES & FREQUENCY  —  edit the data source shown on each card.
 * ────────────────────────────────────────────────────────────────────────
 * One entry per chart, keyed by its `chartId`:
 *   src    — short source label, shown in the "Source:" row beneath the chart
 *   srcUrl — link the label points to (opens in a new tab)
 *   freq   — cadence badge ('daily', 'weekly', 'hourly', 'live', 'static', …)
 *   lag    — the feed's INHERENT data lag (how far behind reality the value is),
 *            shown in parentheses after the source link. Distinct from `freq`
 *            (how often we refresh). Mirrors the upstreamLagText values curated
 *            in server/sourceRegistry.js; charts with no live scraper (research
 *            reports, benchmarks, IPO figures) use the nearest equivalent.
 *
 * To repoint a chart's source or relabel its cadence, edit here — no need to
 * touch the view files. (A few charts compute `src`/`freq` from whether live
 * data is present; those keep that bit in the view.)
 */

// Canonical data-lag phrases per upstream feed (see server/sourceRegistry.js).
// Referenced below so every chart on the same feed reads consistently.
const LAG = {
  sdk:        '~1 day behind',            // combined PyPI + npm SDK installs
  pypi:       '~1–1.5 days behind',
  npm:        '~1 day behind',
  github:     'near real-time',
  hf:         '~1 day behind',
  docker:     '~hours behind',
  hn:         'near real-time',
  ghCommits:  'current week partial',
  orRanks:    'current week partial',     // OpenRouter usage rankings
  orPrice:    'live catalog',             // OpenRouter /models pricing
  litellm:    '~hours–2 days behind',
  dram:       '~same session',
  gpu:        'live',                     // vast.ai marketplace
  dailySnap:  '~1 day behind',            // live source, snapshotted once/day
  aws:        '~hours behind',
  cloudGpu:   '~hours behind',
  eia:        '~2 months behind',
  mops:       'up to ~1 month behind',
  customs:    'monthly · ~1 month behind',
  sec:        '~1 day behind',
  mcp:        '~minutes behind',
  sentiment:  'daily · prices EOD',
  similarweb: 'monthly estimate',
  report:     'annual report',            // curated research reports (IEA, IDC…)
  quarterly:  'quarterly',
  filing:     'annual filing',
  asReported: 'as reported',
  benchmark:  'as published',
};

export const CHART_SOURCES = {
  // ── Developer signals ─────────────────────────────────────────────────
  'pypi-installs': { src: 'pypistats.org',    srcUrl: 'https://pypistats.org/packages/anthropic', freq: 'weekly', lag: LAG.pypi },
  'pypi-share':    { src: 'pypistats.org',    srcUrl: 'https://pypistats.org/packages/anthropic', freq: 'weekly', lag: LAG.pypi },
  'pypi-npm':      { src: 'npmjs.com',        srcUrl: 'https://www.npmjs.com/package/openai',      freq: 'weekly', lag: LAG.npm },

  'github-stars': { src: 'github.com',                    srcUrl: 'https://github.com/openai/openai-python', freq: 'daily', lag: LAG.github },
  'github-deps':  { src: 'github.com/network/dependents', srcUrl: 'https://github.com/anthropics/anthropic-sdk-python/network/dependents', freq: 'daily', lag: LAG.github },

  // ── Consumer signals · HuggingFace ────────────────────────────────────
  'hf-downloads':  { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models?sort=downloads', freq: 'daily', lag: LAG.hf },
  'hf-families':   { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models',                 freq: 'daily', lag: LAG.hf },
  'hf-categories': { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models?sort=downloads',  freq: 'daily', lag: LAG.hf },
  'hf-uploads':    { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models?sort=created',     freq: 'daily', lag: LAG.hf },

  // ── Infrastructure & OSS · Docker ─────────────────────────────────────
  'docker-pulls': { src: 'hub.docker.com/v2/repositories', srcUrl: 'https://hub.docker.com/search?q=&type=image', freq: '6-hourly', lag: LAG.docker },
  'docker-stars': { src: 'hub.docker.com',                 srcUrl: 'https://hub.docker.com',                       freq: '6-hourly', lag: LAG.docker },

  // ── Community · Hacker News ───────────────────────────────────────────
  'hn-volume': { src: 'hn.algolia.com · search_by_date', srcUrl: 'https://hn.algolia.com/?query=AI%20OR%20LLM%20OR%20ChatGPT&type=story', freq: 'weekly', lag: LAG.hn },
  'hn-terms':  { src: 'hn.algolia.com',                  srcUrl: 'https://hn.algolia.com',                                                 freq: 'weekly', lag: LAG.hn },

  // ── Infrastructure & OSS · GitHub commit activity ─────────────────────
  'github-commit-velocity': { src: 'api.github.com/repos/{repo}/stats/commit_activity', srcUrl: 'https://github.com/huggingface/transformers/graphs/commit-activity', freq: 'daily', lag: LAG.ghCommits },
  'github-commit-totals':   { src: 'api.github.com', srcUrl: 'https://github.com', freq: 'daily', lag: LAG.ghCommits },

  // ── Token consumption · Chinese LLMs ──────────────────────────────────
  'cn-tokens':  { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily',  lag: LAG.orRanks },
  'cn-market':  { src: 'idc.com · zhipuai.cn',   srcUrl: 'https://www.zhipuai.cn/',        freq: 'static', lag: LAG.report },
  'cn-pricing': { src: 'openrouter.ai/models',   srcUrl: 'https://openrouter.ai/models',   freq: 'live',   lag: LAG.orPrice },
  'cn-mau':     { src: 'sensortower.com · minimaxi.com', srcUrl: 'https://www.minimaxi.com/', freq: 'static', lag: LAG.quarterly },
  'cn-revenue': { src: 'zhipuai.cn/prospectus',  srcUrl: 'https://www.zhipuai.cn/',        freq: 'static', lag: LAG.filing },
  'cn-bench':   { src: 'swebench.com',           srcUrl: 'https://www.swebench.com/',      freq: 'static', lag: LAG.benchmark },

  // ── Infrastructure · US datacenter build ──────────────────────────────
  'dc-capex':    { src: 'iea.org/reports', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'yearly', lag: LAG.report },
  'dc-capacity': { src: 'iea.org · cbre.com', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'yearly', lag: LAG.report },
  'dc-state':    { src: 'ferc.gov · epri.org', srcUrl: 'https://www.ferc.gov/industries-data/electric/industry-activities/interconnection-queues', freq: 'static', lag: LAG.asReported },
  'dc-grid':     { src: 'ferc.gov · pjm.com', srcUrl: 'https://www.ferc.gov/industries-data/electric/industry-activities/interconnection-queues', freq: 'static', lag: LAG.asReported },
  'dc-btm':      { src: 'eia.gov/860', srcUrl: 'https://www.eia.gov/electricity/data/eia860/', freq: 'static', lag: LAG.asReported },
  'dc-deals':    { src: 'cbre.com/datacenters', srcUrl: 'https://www.cbre.com/insights/reports/north-america-data-center-trends', freq: 'static', lag: LAG.quarterly },

  // ── Infrastructure · AI electricity demand ────────────────────────────
  'elec-consumption': { src: 'iea.org · eia.gov', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'yearly', lag: LAG.report },
  'elec-state':       { src: 'eia.gov/electricity/state', srcUrl: 'https://www.eia.gov/electricity/state/', freq: 'yearly', lag: LAG.report },
  'elec-ai-share':    { src: 'iea.org · eia.gov', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'yearly', lag: LAG.report },
  // elec-rates: src & freq depend on whether live EIA data is present (kept in view)
  'elec-rates':       { srcUrl: 'https://www.eia.gov/electricity/monthly/', lag: LAG.eia },
  'elec-mix':         { src: 'iea.org · woodmac.com', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'yearly', lag: LAG.report },
  'elec-pue':         { src: 'uptimeinstitute.com', srcUrl: 'https://uptimeinstitute.com/resources/research-and-reports', freq: 'yearly', lag: LAG.report },

  // ── Pricing · GPU & memory spot ───────────────────────────────────────
  'gpu-current-rates': { src: 'vast.ai API',          srcUrl: 'https://cloud.vast.ai/create/', freq: 'live', lag: LAG.gpu },
  'gpu-avail':         { src: 'vast.ai API',          srcUrl: 'https://vast.ai/pricing',        freq: 'live', lag: LAG.gpu },
  'gpu-index':         { src: 'vast.ai + AWS EC2',    srcUrl: 'https://aws.amazon.com/ec2/spot/instance-advisor/', freq: 'daily', lag: LAG.dailySnap },
  'gpu-by-model':      { src: 'vast.ai API',          srcUrl: 'https://vast.ai/pricing',        freq: 'daily', lag: LAG.gpu },
  'gpu-spot-combined': { src: 'vast.ai + AWS EC2',    srcUrl: 'https://aws.amazon.com/ec2/spot/instance-advisor/', freq: 'daily', lag: LAG.dailySnap },
  'aws-chip-spot':     { src: 'AWS EC2 + Spot Advisor', srcUrl: 'https://aws.amazon.com/ec2/spot/instance-advisor/', freq: 'daily', lag: LAG.dailySnap },
  'gpu-cloud-avg':     { src: 'AWS · Azure · GCP · CoreWeave · Nebius · Oracle', srcUrl: 'https://cloud-gpus.com/', freq: 'daily', lag: LAG.cloudGpu },

  // ── Pricing · LLM API token prices (LiteLLM cost map) ─────────────────
  'llm-api-input':  { src: 'LiteLLM cost map', srcUrl: 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json', freq: 'daily', lag: LAG.litellm },
  'llm-api-output': { src: 'LiteLLM cost map', srcUrl: 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json', freq: 'daily', lag: LAG.litellm },
  'dram-index':        { src: 'datatrack.trendforce.com', srcUrl: 'https://datatrack.trendforce.com/Chart/content/4694/mainstream-dram-spot-price', freq: 'monthly', lag: LAG.dram },
  'dram-chips':        { src: 'trendforce.com/price/dram/dram_spot', srcUrl: 'https://www.trendforce.com/price/dram/dram_spot', freq: 'daily', lag: LAG.dram },
  'dram-modules':      { src: 'trendforce.com/price/dram/dram_spot', srcUrl: 'https://www.trendforce.com/price/dram/dram_spot', freq: 'daily', lag: LAG.dram },
  'dram-change':       { src: 'trendforce.com/price/dram/dram_spot', srcUrl: 'https://www.trendforce.com/price/dram/dram_spot', freq: 'daily', lag: LAG.dram },
  'nand-spot':         { src: 'trendforce.com/price/flash/flash_spot', srcUrl: 'https://www.trendforce.com/price/flash/flash_spot', freq: 'daily', lag: LAG.dram },
  'tft-lcd-panel':     { src: 'trendforce.com/price/lcd/panel', srcUrl: 'https://www.trendforce.com/price/lcd/panel', freq: 'daily', lag: 'monthly / half-monthly updates' },

  // ── Sentiment · StockTwits + Yahoo Finance ────────────────────────────
  'sent-aggregate':    { src: 'stocktwits.com', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-cat-volprice': { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-cat-volnext':  { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-cat-sentnext': { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-level-returns':{ src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-significance': { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-tk-weekly-vp': { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-tk-weekly-logvp': { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-tk-sentiment': { src: 'stocktwits.com', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-tk-leadlag':   { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },
  'sent-tk-rolling':   { src: 'StockTwits + Yahoo Finance', srcUrl: 'https://stocktwits.com/', freq: 'daily', lag: LAG.sentiment },

  // ── Company · OpenAI / ChatGPT ────────────────────────────────────────
  'oa-sdk':       { src: 'pypistats.org · npmjs.com', srcUrl: 'https://pypistats.org/packages/openai', freq: 'weekly', lag: LAG.sdk },
  'oa-or-share':  { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'oa-or-models': { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'oa-stars':     { src: 'github.com',                srcUrl: 'https://github.com/openai/openai-python', freq: 'daily', lag: LAG.github },
  // oa-pricing: src reflects whether live OpenRouter pricing is present (kept in view)
  'oa-pricing':   { srcUrl: 'https://openrouter.ai/models', freq: 'live', lag: LAG.orPrice },
  'oa-revenue':   { src: 'Epoch AI', srcUrl: 'https://epoch.ai/data/ai-companies-revenue', freq: 'static', lag: LAG.asReported },

  // ── Company · Anthropic / Claude ──────────────────────────────────────
  'an-sdk':       { src: 'pypistats.org · npmjs.com', srcUrl: 'https://pypistats.org/packages/anthropic', freq: 'weekly', lag: LAG.sdk },
  'an-or-share':  { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'an-or-models': { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'an-stars':     { src: 'github.com',                srcUrl: 'https://github.com/anthropics/anthropic-sdk-python', freq: 'daily', lag: LAG.github },
  'an-github':    { src: 'github.com',                srcUrl: 'https://github.com/anthropics/anthropic-sdk-python', freq: 'daily', lag: LAG.github },
  // an-pricing: src reflects whether live OpenRouter pricing is present (kept in view)
  'an-pricing':   { srcUrl: 'https://openrouter.ai/models', freq: 'live', lag: LAG.orPrice },
  'ant-revenue':  { src: 'Epoch AI', srcUrl: 'https://epoch.ai/data/ai-companies-revenue', freq: 'static', lag: LAG.asReported },

  // ── Company · Google / Gemini ─────────────────────────────────────────
  'goo-sdk':       { src: 'pypistats.org · npmjs.com', srcUrl: 'https://pypistats.org/packages/google-genai', freq: 'weekly', lag: LAG.sdk },
  'goo-or-share':  { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'goo-or-models': { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'goo-stars':     { src: 'github.com',                srcUrl: 'https://github.com/googleapis/python-genai', freq: 'daily', lag: LAG.github },
  'goo-github':    { src: 'github.com',                srcUrl: 'https://github.com/googleapis/python-genai', freq: 'daily', lag: LAG.github },
  // goo-pricing: src reflects whether live OpenRouter pricing is present (kept in view)
  'goo-pricing':   { srcUrl: 'https://openrouter.ai/models', freq: 'live', lag: LAG.orPrice },
  'goo-hf':        { src: 'huggingface.co/api',        srcUrl: 'https://huggingface.co/google', freq: 'daily', lag: LAG.hf },

  // ── Company · Zhipu AI / GLM ──────────────────────────────────────────
  'zh-or-share': { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'zh-revenue':  { src: 'zhipuai.cn · IPO prospectus', srcUrl: 'https://www.zhipuai.cn/', freq: 'yearly', lag: LAG.filing },
  'zh-market':   { src: 'idc.com · zhipuai.cn', srcUrl: 'https://www.zhipuai.cn/', freq: 'static', lag: LAG.report },
  'zh-hf':       { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/zai-org', freq: 'daily', lag: LAG.hf },
  // zh-pricing: src reflects whether live OpenRouter pricing is present (kept in view)
  'zh-pricing':  { srcUrl: 'https://openrouter.ai/models', freq: 'live', lag: LAG.orPrice },
  'zh-bench':    { src: 'swebench.com', srcUrl: 'https://www.swebench.com/', freq: 'static', lag: LAG.benchmark },

  // ── Company · MiniMax ─────────────────────────────────────────────────
  'mm-or-share': { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'mm-hf':       { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/MiniMaxAI', freq: 'daily', lag: LAG.hf },
  'mm-mau':      { src: 'sensortower.com · minimaxi.com', srcUrl: 'https://www.minimaxi.com/', freq: 'quarterly', lag: LAG.quarterly },
  // mm-pricing: src reflects whether live OpenRouter pricing is present (kept in view)
  'mm-pricing':  { srcUrl: 'https://openrouter.ai/models', freq: 'live', lag: LAG.orPrice },
  'mm-bench':    { src: 'swebench.com', srcUrl: 'https://www.swebench.com/', freq: 'static', lag: LAG.benchmark },

  // ── Market signals · Infrastructure & OSS ─────────────────────────────
  'gen-ai-revenue':{ src: 'Epoch AI', srcUrl: 'https://epoch.ai/data/ai-companies-revenue', freq: 'static', lag: LAG.asReported },
  'gen-gpu':       { src: 'vast.ai', srcUrl: 'https://vast.ai/pricing', freq: 'hourly', lag: LAG.gpu },
  'gen-gpu-avail': { src: 'vast.ai', srcUrl: 'https://vast.ai/', freq: 'daily', lag: LAG.gpu },
  'gen-mcp':       { src: 'api.github.com/search', srcUrl: 'https://github.com/search?q=%22mcp+server%22&type=repositories', freq: 'daily', lag: LAG.mcp },
  'gen-sec':       { src: 'efts.sec.gov full-text search', srcUrl: 'https://efts.sec.gov/LATEST/search-index?q=%22AI+agent%22&forms=10-K', freq: 'daily', lag: LAG.sec },
  'gen-commits':   { src: 'github.com', srcUrl: 'https://github.com/huggingface/transformers', freq: 'weekly', lag: LAG.ghCommits },
  'gen-docker':    { src: 'hub.docker.com', srcUrl: 'https://hub.docker.com/r/nvidia/cuda', freq: '6-hourly', lag: LAG.docker },
  'gen-hn':        { src: 'hn.algolia.com', srcUrl: 'https://hn.algolia.com/?q=AI', freq: 'weekly', lag: LAG.hn },
  'gen-cnmarket':  { src: 'idc.com · zhipuai.cn', srcUrl: 'https://www.zhipuai.cn/', freq: 'static', lag: LAG.report },
  'gen-tw-drones': { src: 'Taiwan Customs (MOF/BOFT)', srcUrl: 'https://publicinfo.trade.gov.tw/cuswebo/FSCE000F/FSCE000F', freq: 'monthly', lag: LAG.customs },

  // ── Market signals · OpenRouter model rankings ────────────────────────
  'or-top':       { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'or-provstack': { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'or-revenue-total': { src: 'openrouter.ai/rankings + /models pricing', srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'or-combo-price': { src: 'openrouter.ai/rankings + /models pricing', srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },
  'or-growth':    { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'weekly', lag: LAG.orRanks },

  // ── Web traffic (SimilarWeb via Apify) ────────────────────────────────
  'oa-web-visits':    { src: 'SimilarWeb via Apify', srcUrl: 'https://www.similarweb.com/website/openai.com/',        freq: 'daily', lag: LAG.similarweb },
  'an-web-visits':    { src: 'SimilarWeb via Apify', srcUrl: 'https://www.similarweb.com/website/anthropic.com/',     freq: 'daily', lag: LAG.similarweb },
  'goo-web-visits':   { src: 'SimilarWeb via Apify', srcUrl: 'https://www.similarweb.com/website/gemini.google.com/', freq: 'daily', lag: LAG.similarweb },
  'mm-web-visits':    { src: 'SimilarWeb via Apify', srcUrl: 'https://www.similarweb.com/website/hailuoai.com/',      freq: 'daily', lag: LAG.similarweb },
  'zh-web-visits':    { src: 'SimilarWeb via Apify', srcUrl: 'https://www.similarweb.com/website/zhipuai.cn/',        freq: 'daily', lag: LAG.similarweb },
  'web-visits-total': { src: 'SimilarWeb via Apify', srcUrl: 'https://apify.com/curious_coder/similarweb-scraper',    freq: 'daily', lag: LAG.similarweb },
};
