const axios = require('axios');
const path = require('path');
const storage = require('../storage');

// The computed payload is persisted (Mongo in prod, JSON file in dev) so the
// site can serve it instantly on a cold start and even when this process has no
// API key — the GitHub Action refreshes it twice daily with its own key. A
// stored payload older than ~36h is treated as stale and triggers a live fetch.
const BLOB = 'openrouterRanks';
const STORE_FILE = path.join(__dirname, '..', 'data', 'openrouterRanks.json');

function loadStored() {
  const v = storage.read(BLOB, STORE_FILE);
  return v && Array.isArray(v.weekLabels) && v.weekLabels.length ? v : null;
}
function saveStored(payload) {
  storage.write(BLOB, STORE_FILE, payload);
}
function isStale(payload) {
  const t = Date.parse((payload?.asOf ?? '') + 'T00:00:00Z');
  return !Number.isFinite(t) || (Date.now() - t) > 36 * 3600 * 1000;
}

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

// Dedicated model charts need their history to remain available even if a
// model later falls outside its provider's recent top-model cutoff.
const PINNED_DAILY_MODELS = ['anthropic/claude-5-fable'];

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

  // Keep the source's native daily grain for the provider pages. OpenRouter's
  // provider chart is a daily stack of models; collapsing these rows to weeks
  // loses the model-mix changes needed to calculate a meaningful blended
  // token price. To keep the cached response compact we retain the 12 most
  // used models per provider (ranked over the latest 90 days) and roll every
  // remaining model into "Other".
  const dailyBuckets = {};
  for (const row of rows) {
    if (!row.date) continue;
    if (!dailyBuckets[row.date]) dailyBuckets[row.date] = {};
    const slug = row.model_permaslug || 'other';
    const tok  = parseInt(row.total_tokens, 10) || 0;
    dailyBuckets[row.date][slug] = (dailyBuckets[row.date][slug] ?? 0) + tok;
  }
  const dailyLabels = Object.keys(dailyBuckets).sort();
  const recentDates = new Set(dailyLabels.slice(-90));
  const recentByProvider = {};
  const allProviderSlugs = {};
  for (const date of dailyLabels) {
    for (const [slug, tokens] of Object.entries(dailyBuckets[date])) {
      const provider = providerFromSlug(slug);
      if (!allProviderSlugs[provider]) allProviderSlugs[provider] = new Set();
      allProviderSlugs[provider].add(slug);
      if (recentDates.has(date)) {
        if (!recentByProvider[provider]) recentByProvider[provider] = {};
        recentByProvider[provider][slug] = (recentByProvider[provider][slug] ?? 0) + tokens;
      }
    }
  }

  const providerDaily = {};
  const providerModelDaily = {};
  for (const [provider, slugSet] of Object.entries(allProviderSlugs)) {
    providerDaily[provider] = dailyLabels.map(date => {
      let total = 0;
      for (const slug of slugSet) total += dailyBuckets[date]?.[slug] ?? 0;
      return total;
    });

    const pinned = [...slugSet].filter(slug =>
      PINNED_DAILY_MODELS.some(prefix => slug.startsWith(prefix))
    );
    const ranked = Object.entries(recentByProvider[provider] ?? {})
      .filter(([slug]) => slug !== 'other')
      .sort((a, b) => b[1] - a[1])
      .map(([slug]) => slug);
    const kept = [...new Set([...pinned, ...ranked])].slice(0, Math.max(12, pinned.length));
    const keptSet = new Set(kept);
    const modelSeries = kept.map(slug => ({
      slug,
      name: displayName(slug),
      tokens: dailyLabels.map(date => dailyBuckets[date]?.[slug] ?? 0),
    }));
    const otherTokens = dailyLabels.map(date => {
      let total = 0;
      for (const slug of slugSet) {
        if (!keptSet.has(slug)) total += dailyBuckets[date]?.[slug] ?? 0;
      }
      return total;
    });
    if (otherTokens.some(Boolean)) {
      modelSeries.push({ slug: 'other', name: 'Other', tokens: otherTokens });
    }
    providerModelDaily[provider] = modelSeries;
  }
  const dailyTotals = dailyLabels.map(date =>
    Object.values(dailyBuckets[date]).reduce((sum, tokens) => sum + tokens, 0)
  );

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

  // Keep a deep list of models so downstream charts (volume-vs-price scatter,
  // per-model revenue) see beyond the handful of highest-volume models — e.g.
  // Claude Opus, GPT-4o and other second-tier models sit well below the top 15.
  const topModels = Object.entries(latestBucket)
    .filter(([slug]) => slug !== 'other')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([slug, tokens], i) => ({
      slug,
      name:     displayName(slug),
      provider: providerFromSlug(slug),
      tokens,
      rank: i + 1,
    }));

  // ── 3. Weekly trend for every kept model ────────────────────────────
  // One series per model in `topModels`, not just the global top 10. The
  // revenue estimate prices a company's untracked volume at the average of its
  // tracked models, so a company whose models all sit below the global top 10
  // (OpenAI, Google) used to have *no* series at all: its revenue collapsed to
  // tokens × one constant price, and revenue-per-token came out a flat line.
  // With a series per kept model, each company's weekly mix is priced model by
  // model. ~57 slugs × ~80 weeks — a few hundred KB, cheap to store and ship.
  const trend = {};
  for (const { slug } of topModels) {
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

  // Weekly series for every provider so per-company pages can look up any name.
  // top8Provs is kept separately for the stacked bar's "Other" rollup.
  const top8Provs = providers.filter(p => p.name !== 'Other').slice(0, 8).map(p => p.name);
  const providerWeekly = {};
  for (const prov of Object.keys(providerTotals)) {
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
    schemaVersion: 2,
    topModels:      topModelsWithGrowth,
    trend,
    providers,
    providerWeekly,
    weeklyTotals,
    weekLabels:  allWeeks,   // full history — frontend slices to W weeks
    dailyLabels,
    dailyTotals,
    providerDaily,
    providerModelDaily,
    latestWeek:  latestWk,
    asOf:        fmt(yesterday),
  };
}

module.exports = { getOpenRouterRankings };
