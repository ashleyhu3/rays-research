const axios = require('axios');

// Provider slug → display name
const PROVIDER_NAMES = {
  openai:        'OpenAI',
  anthropic:     'Anthropic',
  google:        'Google',
  'meta-llama':  'Meta',
  'mistralai':   'Mistral',
  deepseek:      'DeepSeek',
  qwen:          'Alibaba (Qwen)',
  'x-ai':        'xAI',
  minimax:       'MiniMax',
  thudm:         'Zhipu AI',
  'z-ai':        'Zhipu AI',
  moonshotai:    'Moonshot AI',
  cohere:        'Cohere',
  amazon:        'Amazon',
  'perplexity':  'Perplexity',
  tencent:       'Tencent',
  xiaomi:        'Xiaomi',
  openrouter:    'OpenRouter',
  baidu:         'Baidu',
  bytedance:     'ByteDance',
  '01-ai':       '01.AI',
  other:         'Other',
};

function providerFromSlug(slug) {
  if (!slug || slug === 'other') return 'other';
  const prefix = slug.split('/')[0];
  return PROVIDER_NAMES[prefix] ?? prefix;
}

// Shorten a model permaslug to a readable label
function displayName(slug) {
  if (!slug || slug === 'other') return 'Other';
  const parts  = slug.split('/');
  const model  = parts[1] ?? parts[0];
  // Remove date suffixes like -20241022 and -preview
  return model
    .replace(/-\d{8}$/, '')
    .replace(/-preview$/, '')
    .replace(/-latest$/, '');
}

async function getOpenRouterRankings() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn('[openrouterRankings] OPENROUTER_API_KEY not set — skipping rankings scrape');
    return null;
  }

  // The API caps requests at 366 days. Fetch two windows to cover ~2 years:
  //   chunk1: 2 years ago → 1 year ago
  //   chunk2: 1 year ago  → yesterday
  const fmt = d => d.toISOString().slice(0, 10);
  const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yr1ago    = new Date(yesterday); yr1ago.setUTCFullYear(yr1ago.getUTCFullYear() - 1);
  const yr2ago    = new Date(yr1ago);    yr2ago.setUTCFullYear(yr2ago.getUTCFullYear() - 1);
  // chunk1 must end the day before chunk2 starts or that date is double-counted
  const chunk1End = new Date(yr1ago); chunk1End.setUTCDate(chunk1End.getUTCDate() - 1);
  const datasetStart = new Date('2025-01-01');

  async function fetchChunk(startDate, endDate) {
    if (endDate < datasetStart) return [];
    const s = startDate < datasetStart ? datasetStart : startDate;
    const { data } = await axios.get('https://openrouter.ai/api/v1/datasets/rankings-daily', {
      params: { start_date: fmt(s), end_date: fmt(endDate) },
      headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'signal-dashboard/1.0' },
      timeout: 30000,
    });
    return data.data ?? [];
  }

  const [chunk1, chunk2] = await Promise.all([
    fetchChunk(yr2ago, chunk1End).catch(() => []),
    fetchChunk(yr1ago, yesterday),
  ]);

  const rows = [...chunk1, ...chunk2];
  if (rows.length === 0) return null;

  // ── 1. Bucket rows into ISO weeks (Mon–Sun) ─────────────────────────
  function isoWeekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day); // offset to Monday
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + diff);
    return mon.toISOString().slice(0, 10); // YYYY-MM-DD of Monday
  }

  // weekBuckets: { weekKey → { model_slug → tokens } }
  const weekBuckets = {};
  for (const row of rows) {
    const wk = isoWeekKey(row.date);
    if (!weekBuckets[wk]) weekBuckets[wk] = {};
    const slug = row.model_permaslug;
    const tok  = parseInt(row.total_tokens, 10) || 0;
    weekBuckets[wk][slug] = (weekBuckets[wk][slug] ?? 0) + tok;
  }

  // All available ISO weeks, ascending — frontend slices to desired window
  const allWeeks = Object.keys(weekBuckets).sort();

  // ── 2. Top models in the most-recent week ───────────────────────────
  const latestWk = allWeeks[allWeeks.length - 1];
  const latestBucket = weekBuckets[latestWk] ?? {};

  const topModels = Object.entries(latestBucket)
    .filter(([slug]) => slug !== 'other')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([slug, tokens], i) => ({
      slug,
      name:     displayName(slug),
      provider: providerFromSlug(slug),
      tokens,
      rank: i + 1,
    }));

  // ── 3. Weekly trend for top 10 models ───────────────────────────────
  const top10Slugs = topModels.slice(0, 10).map(m => m.slug);
  const trend = {};
  for (const slug of top10Slugs) {
    trend[slug] = allWeeks.map(wk => weekBuckets[wk]?.[slug] ?? 0);
  }

  // ── 4. Provider totals per week ──────────────────────────────────────
  // provByWeek: { weekKey → { providerName → tokens } }
  const provByWeek = {};
  for (const wk of allWeeks) {
    provByWeek[wk] = {};
    for (const [slug, tokens] of Object.entries(weekBuckets[wk] ?? {})) {
      const prov = providerFromSlug(slug);
      provByWeek[wk][prov] = (provByWeek[wk][prov] ?? 0) + tokens;
    }
  }

  // Provider totals across all recent weeks (for ranking + market share)
  const providerTotals = {};
  for (const wk of allWeeks) {
    for (const [prov, tokens] of Object.entries(provByWeek[wk])) {
      providerTotals[prov] = (providerTotals[prov] ?? 0) + tokens;
    }
  }
  const grandTotal = Object.values(providerTotals).reduce((a, b) => a + b, 0) || 1;

  const providers = Object.entries(providerTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, tokens]) => ({ name, tokens, pct: tokens / grandTotal }));

  // ── 5. Platform-level weekly token totals (for growth chart) ────────
  const weeklyTotals = allWeeks.map(wk =>
    Object.values(weekBuckets[wk]).reduce((a, b) => a + b, 0)
  );

  // Top 8 providers by total + roll rest into "Other" — for stacked weekly bar
  const top8Provs = providers.filter(p => p.name !== 'Other').slice(0, 8).map(p => p.name);
  const providerWeekly = {};
  for (const prov of top8Provs) {
    providerWeekly[prov] = allWeeks.map(wk => provByWeek[wk]?.[prov] ?? 0);
  }
  providerWeekly['Other'] = allWeeks.map((wk, i) => {
    const topSum = top8Provs.reduce((s, p) => s + (providerWeekly[p]?.[i] ?? 0), 0);
    return (weeklyTotals[i] ?? 0) - topSum;
  });

  // ── 6. Week-over-week change for top models ──────────────────────────
  const prevWk = allWeeks[allWeeks.length - 2] ?? null;
  const topModelsWithGrowth = topModels.map(m => {
    const prev = prevWk ? (weekBuckets[prevWk]?.[m.slug] ?? 0) : 0;
    const curr = m.tokens;
    const wow  = prev > 0 ? (curr - prev) / prev : null;
    return { ...m, prevTokens: prev, wow };
  });

  return {
    topModels:      topModelsWithGrowth,
    trend,
    providers,
    providerWeekly,
    weeklyTotals,
    weekLabels:  allWeeks,   // full history — frontend slices to W weeks
    latestWeek:  latestWk,
    asOf:        fmt(yesterday),
  };
}

module.exports = { getOpenRouterRankings };
