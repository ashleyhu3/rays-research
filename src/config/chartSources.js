/**
 * ────────────────────────────────────────────────────────────────────────
 *  CHART SOURCES & FREQUENCY  —  edit the data source shown on each card.
 * ────────────────────────────────────────────────────────────────────────
 * One entry per chart, keyed by its `chartId`:
 *   src    — short source label shown top-right on the card
 *   srcUrl — link the label points to (opens in a new tab)
 *   freq   — cadence badge ('daily', 'weekly', 'hourly', 'live', 'static', …)
 *
 * To repoint a chart's source or relabel its cadence, edit here — no need to
 * touch the view files. (A few charts compute `src`/`freq` from whether live
 * data is present; those keep that bit in the view.)
 */
export const CHART_SOURCES = {
  // ── Developer signals ─────────────────────────────────────────────────
  'pypi-installs': { src: 'pypistats.org',    srcUrl: 'https://pypistats.org/packages/anthropic', freq: 'weekly' },
  'pypi-share':    { src: 'pypistats.org',    srcUrl: 'https://pypistats.org/packages/anthropic', freq: 'weekly' },
  'pypi-npm':      { src: 'npmjs.com',        srcUrl: 'https://www.npmjs.com/package/openai',      freq: 'weekly' },
  'pypi-so':       { src: 'stackexchange API', srcUrl: 'https://api.stackexchange.com/2.3/questions?tagged=claude&site=stackoverflow', freq: 'weekly' },

  'github-stars': { src: 'github.com',                    srcUrl: 'https://github.com/openai/openai-python', freq: 'daily' },
  'github-deps':  { src: 'github.com/network/dependents', srcUrl: 'https://github.com/anthropics/anthropic-sdk-python/network/dependents', freq: 'daily' },

  'trends-api':   { src: 'trends.google.com', srcUrl: 'https://trends.google.com/trends/explore?q=Claude+API,ChatGPT+API,Gemini+API', freq: 'daily' },
  'trends-geo':   { src: 'trends.google.com', srcUrl: 'https://trends.google.com/trends/explore?q=Claude+API&geo=US', freq: 'live' },
  'trends-brand': { src: 'trends.google.com', srcUrl: 'https://trends.google.com/trends/explore?q=Claude,ChatGPT', freq: 'daily' },

  // ── Consumer signals · HuggingFace ────────────────────────────────────
  'hf-downloads':  { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models?sort=downloads', freq: 'daily' },
  'hf-families':   { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models',                 freq: 'daily' },
  'hf-categories': { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models?sort=downloads',  freq: 'daily' },
  'hf-uploads':    { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/models?sort=created',     freq: 'daily' },

  // ── Infrastructure & OSS · Docker ─────────────────────────────────────
  'docker-pulls': { src: 'hub.docker.com/v2/repositories', srcUrl: 'https://hub.docker.com/search?q=&type=image', freq: '6-hourly' },
  'docker-stars': { src: 'hub.docker.com',                 srcUrl: 'https://hub.docker.com',                       freq: '6-hourly' },

  // ── Community · Hacker News & Wikipedia ───────────────────────────────
  'hn-volume': { src: 'hn.algolia.com · search_by_date', srcUrl: 'https://hn.algolia.com/?query=AI%20OR%20LLM%20OR%20ChatGPT&type=story', freq: 'hourly' },
  'hn-terms':  { src: 'hn.algolia.com',                  srcUrl: 'https://hn.algolia.com',                                                 freq: 'hourly' },
  'wiki-views': { src: 'wikimedia.org/api/rest_v1/metrics/pageviews', srcUrl: 'https://pageviews.wmcloud.org/?project=en.wikipedia.org&pages=ChatGPT|Large_language_model', freq: 'daily' },

  // ── Infrastructure & OSS · GitHub commit activity ─────────────────────
  'github-commit-velocity': { src: 'api.github.com/repos/{repo}/stats/commit_activity', srcUrl: 'https://github.com/huggingface/transformers/graphs/commit-activity', freq: 'daily' },
  'github-commit-totals':   { src: 'api.github.com', srcUrl: 'https://github.com', freq: 'daily' },

  // ── Token consumption · Chinese LLMs ──────────────────────────────────
  'cn-tokens':  { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'cn-market':  { src: 'idc.com · zhipuai.cn',   srcUrl: 'https://www.zhipuai.cn/',        freq: 'static' },
  'cn-pricing': { src: 'openrouter.ai/models',   srcUrl: 'https://openrouter.ai/models',   freq: 'live' },
  'cn-mau':     { src: 'sensortower.com · minimaxi.com', srcUrl: 'https://www.minimaxi.com/', freq: 'static' },
  'cn-revenue': { src: 'zhipuai.cn/prospectus',  srcUrl: 'https://www.zhipuai.cn/',        freq: 'static' },
  'cn-bench':   { src: 'swebench.com',           srcUrl: 'https://www.swebench.com/',      freq: 'static' },

  // ── Infrastructure · US datacenter build ──────────────────────────────
  'dc-capex':    { src: 'iea.org/reports', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'static' },
  'dc-capacity': { src: 'iea.org · cbre.com', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'static' },
  'dc-state':    { src: 'ferc.gov · epri.org', srcUrl: 'https://www.ferc.gov/industries-data/electric/industry-activities/interconnection-queues', freq: 'static' },
  'dc-grid':     { src: 'ferc.gov · pjm.com', srcUrl: 'https://www.ferc.gov/industries-data/electric/industry-activities/interconnection-queues', freq: 'static' },
  'dc-btm':      { src: 'eia.gov/860', srcUrl: 'https://www.eia.gov/electricity/data/eia860/', freq: 'static' },
  'dc-deals':    { src: 'cbre.com/datacenters', srcUrl: 'https://www.cbre.com/insights/reports/north-america-data-center-trends', freq: 'static' },

  // ── Infrastructure · AI electricity demand ────────────────────────────
  'elec-consumption': { src: 'iea.org · eia.gov', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'static' },
  'elec-state':       { src: 'eia.gov/electricity/state', srcUrl: 'https://www.eia.gov/electricity/state/', freq: 'static' },
  'elec-ai-share':    { src: 'iea.org · eia.gov', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'static' },
  // elec-rates: src & freq depend on whether live EIA data is present (kept in view)
  'elec-rates':       { srcUrl: 'https://www.eia.gov/electricity/monthly/' },
  'elec-mix':         { src: 'iea.org · woodmac.com', srcUrl: 'https://www.iea.org/reports/key-questions-on-energy-and-ai', freq: 'static' },
  'elec-pue':         { src: 'uptimeinstitute.com', srcUrl: 'https://uptimeinstitute.com/resources/research-and-reports', freq: 'static' },

  // ── Pricing · GPU & memory spot ───────────────────────────────────────
  'gpu-current-rates': { src: 'vast.ai API',          srcUrl: 'https://cloud.vast.ai/create/', freq: 'live' },
  'gpu-avail':         { src: 'vast.ai API',          srcUrl: 'https://vast.ai/pricing',        freq: 'live' },
  'gpu-index':         { src: 'vast.ai + AWS EC2',    srcUrl: 'https://aws.amazon.com/ec2/spot/instance-advisor/', freq: 'daily' },
  'gpu-spot-combined': { src: 'vast.ai + AWS EC2',    srcUrl: 'https://aws.amazon.com/ec2/spot/instance-advisor/', freq: 'daily' },
  'aws-chip-spot':     { src: 'AWS EC2 + Spot Advisor', srcUrl: 'https://aws.amazon.com/ec2/spot/instance-advisor/', freq: 'daily' },
  'gpu-cloud-avg':     { src: 'AWS · Azure · GCP · CoreWeave · Nebius · Oracle', srcUrl: 'https://cloud-gpus.com/', freq: 'daily' },
  'dram-index':        { src: 'datatrack.trendforce.com', srcUrl: 'https://datatrack.trendforce.com/Chart/content/4694/mainstream-dram-spot-price', freq: 'monthly' },
  'dram-chips':        { src: 'trendforce.com/price/dram/dram_spot', srcUrl: 'https://www.trendforce.com/price/dram/dram_spot', freq: 'daily' },
  'dram-modules':      { src: 'trendforce.com/price/dram/dram_spot', srcUrl: 'https://www.trendforce.com/price/dram/dram_spot', freq: 'daily' },
  'dram-change':       { src: 'trendforce.com/price/dram/dram_spot', srcUrl: 'https://www.trendforce.com/price/dram/dram_spot', freq: 'daily' },

  // ── Company · OpenAI / ChatGPT ────────────────────────────────────────
  'oa-sdk':       { src: 'pypistats.org · npmjs.com', srcUrl: 'https://pypistats.org/packages/openai', freq: 'weekly' },
  'oa-or-share':  { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'oa-or-models': { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'oa-trends':    { src: 'trends.google.com',         srcUrl: 'https://trends.google.com/trends/explore?q=ChatGPT+API,ChatGPT', freq: 'daily' },
  'oa-stars':     { src: 'github.com',                srcUrl: 'https://github.com/openai/openai-python', freq: 'daily' },
  'oa-github':    { src: 'github.com',                srcUrl: 'https://github.com/openai/openai-python', freq: 'daily' },
  'oa-so':        { src: 'stackexchange.com',         srcUrl: 'https://stackoverflow.com/questions/tagged/openai-api', freq: 'daily' },
  'oa-wiki':      { src: 'wikimedia.org',             srcUrl: 'https://en.wikipedia.org/wiki/ChatGPT', freq: 'weekly' },

  // ── Company · Anthropic / Claude ──────────────────────────────────────
  'an-sdk':       { src: 'pypistats.org · npmjs.com', srcUrl: 'https://pypistats.org/packages/anthropic', freq: 'weekly' },
  'an-or-share':  { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'an-or-models': { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'an-trends':    { src: 'trends.google.com',         srcUrl: 'https://trends.google.com/trends/explore?q=Claude+API,Claude', freq: 'daily' },
  'an-stars':     { src: 'github.com',                srcUrl: 'https://github.com/anthropics/anthropic-sdk-python', freq: 'daily' },
  'an-github':    { src: 'github.com',                srcUrl: 'https://github.com/anthropics/anthropic-sdk-python', freq: 'daily' },
  'an-so':        { src: 'stackexchange.com',         srcUrl: 'https://stackoverflow.com/questions/tagged/claude', freq: 'daily' },
  'an-wiki':      { src: 'wikimedia.org',             srcUrl: 'https://en.wikipedia.org/wiki/Claude_(language_model)', freq: 'weekly' },

  // ── Company · Google / Gemini ─────────────────────────────────────────
  'goo-sdk':       { src: 'pypistats.org · npmjs.com', srcUrl: 'https://pypistats.org/packages/google-genai', freq: 'weekly' },
  'goo-or-share':  { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'goo-or-models': { src: 'openrouter.ai/rankings',    srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'goo-trends':    { src: 'trends.google.com',         srcUrl: 'https://trends.google.com/trends/explore?q=Gemini+API,Gemini', freq: 'daily' },
  'goo-stars':     { src: 'github.com',                srcUrl: 'https://github.com/googleapis/python-genai', freq: 'daily' },
  'goo-github':    { src: 'github.com',                srcUrl: 'https://github.com/googleapis/python-genai', freq: 'daily' },
  'goo-so':        { src: 'stackexchange.com',         srcUrl: 'https://stackoverflow.com/questions/tagged/google-gemini', freq: 'daily' },
  'goo-hf':        { src: 'huggingface.co/api',        srcUrl: 'https://huggingface.co/google', freq: 'daily' },
  'goo-wiki':      { src: 'wikimedia.org',             srcUrl: 'https://en.wikipedia.org/wiki/Gemini_(language_model)', freq: 'weekly' },

  // ── Company · Zhipu AI / GLM ──────────────────────────────────────────
  'zh-or-share': { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'zh-revenue':  { src: 'zhipuai.cn · IPO prospectus', srcUrl: 'https://www.zhipuai.cn/', freq: 'static' },
  'zh-market':   { src: 'idc.com · zhipuai.cn', srcUrl: 'https://www.zhipuai.cn/', freq: 'static' },
  'zh-hf':       { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/zai-org', freq: 'daily' },
  // zh-pricing: src reflects whether live OpenRouter pricing is present (kept in view)
  'zh-pricing':  { srcUrl: 'https://openrouter.ai/models', freq: 'live' },
  'zh-bench':    { src: 'swebench.com', srcUrl: 'https://www.swebench.com/', freq: 'static' },

  // ── Company · MiniMax ─────────────────────────────────────────────────
  'mm-or-share': { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'mm-hf':       { src: 'huggingface.co/api', srcUrl: 'https://huggingface.co/MiniMaxAI', freq: 'daily' },
  'mm-mau':      { src: 'sensortower.com · minimaxi.com', srcUrl: 'https://www.minimaxi.com/', freq: 'static' },
  // mm-pricing: src reflects whether live OpenRouter pricing is present (kept in view)
  'mm-pricing':  { srcUrl: 'https://openrouter.ai/models', freq: 'live' },
  'mm-bench':    { src: 'swebench.com', srcUrl: 'https://www.swebench.com/', freq: 'static' },

  // ── Market signals · Infrastructure & OSS ─────────────────────────────
  'gen-gpu':       { src: 'vast.ai', srcUrl: 'https://vast.ai/pricing', freq: 'hourly' },
  'gen-gpu-avail': { src: 'vast.ai', srcUrl: 'https://vast.ai/', freq: 'daily' },
  'gen-mcp':       { src: 'api.github.com/search', srcUrl: 'https://github.com/search?q=%22mcp+server%22&type=repositories', freq: 'daily' },
  'gen-sec':       { src: 'efts.sec.gov full-text search', srcUrl: 'https://efts.sec.gov/LATEST/search-index?q=%22AI+agent%22&forms=10-K', freq: 'daily' },
  'gen-commits':   { src: 'github.com', srcUrl: 'https://github.com/huggingface/transformers', freq: 'weekly' },
  'gen-docker':    { src: 'hub.docker.com', srcUrl: 'https://hub.docker.com/r/nvidia/cuda', freq: '6-hourly' },
  'gen-hn':        { src: 'hn.algolia.com', srcUrl: 'https://hn.algolia.com/?q=AI', freq: 'hourly' },
  'gen-cnmarket':  { src: 'idc.com · zhipuai.cn', srcUrl: 'https://www.zhipuai.cn/', freq: 'static' },

  // ── Market signals · OpenRouter model rankings ────────────────────────
  'or-top':       { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'or-trend':     { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'or-provstack': { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'or-provshare': { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'or-combo':     { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
  'or-growth':    { src: 'openrouter.ai/rankings', srcUrl: 'https://openrouter.ai/rankings', freq: 'daily' },
};
