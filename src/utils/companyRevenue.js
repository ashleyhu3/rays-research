/**
 * Estimated weekly AI revenue per company over time, derived from the
 * OpenRouter rankings scrape + live model pricing.
 *
 *   revenue(company, week) = Σ over the company's models of
 *                              (model tokens that week) × (model $/M input price) / 1e6
 *
 * `ranks.trend` carries a weekly token series for every model the scrape keeps
 * (~57), which covers ~90–100% of each company's recent weekly volume. The
 * remainder — older models that have dropped out of the kept set, so mostly a
 * historical tail — is priced at the average of the company's tracked models
 * and added on, rather than dropped to zero. Prices are current (applied to
 * historical volumes), i.e. this is revenue-at-today's-pricing.
 */
import { C } from '../config/colors.js';
import { mkDs } from './chartHelpers.js';
import { orWeekLabel, orTokensWithGrowth, orProviderDailyModels } from './openrouterProvider.js';

// Companies with a dedicated demand page, plus DeepSeek. `name` must match the
// provider display name emitted by server/scrapers/openrouterRankings.js.
// fallbackPrice is a representative $/M input price used only when no live
// price is available for any of the company's models.
const REV_COMPANIES = [
  { name: 'OpenAI',    color: C.openai,    fallbackPrice: 4.00 },
  { name: 'Anthropic', color: C.anthropic, fallbackPrice: 6.00 },
  { name: 'Google',    color: C.google,    fallbackPrice: 1.00 },
  { name: 'DeepSeek',  color: C.deepseek,  fallbackPrice: 0.35 },
  { name: 'Zhipu AI',  color: C.zhipu,     fallbackPrice: 0.40 },
  { name: 'MiniMax',   color: C.minimax,   fallbackPrice: 0.30 },
  { name: 'xAI',            color: C.xai,     fallbackPrice: 3.00 },
  { name: 'Moonshot AI',    color: C.kimi,    fallbackPrice: 0.50 },
  { name: 'Alibaba (Qwen)', color: C.qwen,    fallbackPrice: 0.30 },
  { name: 'Xiaomi',         color: C.xiaomi,  fallbackPrice: 0.20 },
  { name: 'Tencent',        color: C.tencent, fallbackPrice: 0.30 },
];

// ~6 months of complete weeks.
const WEEKS_6MO = 26;

// Sorted token multiset of a slug's model part (after the provider prefix),
// e.g. "anthropic/claude-4.8-opus" → "4.8|claude|opus". Lets us match ids whose
// version and tier are in a different order than the ranking slug.
function modelTokens(slug) {
  return slug.split('/').slice(1).join('/').split(/[-/]/).filter(Boolean).sort().join('|');
}

// $/M input tokens for one rankings permaslug, from the live /models list.
// Permaslugs carry version/date suffixes that the model ids drop, so first match
// on the longest model id that prefixes the slug at a boundary. Rankings slugs
// also reorder version/tier ("claude-4.8-opus") vs the catalog ("claude-opus-4.8"),
// which no prefix can bridge, so fall back to same-provider token-multiset
// equality — otherwise every flagship Claude model drops out. null when unpriced.
export function livePriceForSlug(slug, models) {
  if (!slug || !models?.length) return null;
  // Drop a trailing date suffix and any ":free"/":variant" tag before matching.
  const core = slug.replace(/-\d{8}$/, '').replace(/:.*$/, '');
  const provider = core.split('/')[0];
  const coreTokens = modelTokens(core);
  let best = null;       // by boundary prefix (most specific)
  let tokenBest = null;  // by reordered token multiset (fallback)
  for (const m of models) {
    if (!(m.pricing?.prompt > 0)) continue;
    const hit = core === m.id
      || core.startsWith(`${m.id}-`)
      || core.startsWith(`${m.id}:`)
      || core.startsWith(`${m.id}/`);
    if (hit) {
      if (!best || m.id.length > best.id.length) best = m;
    } else if (m.id.split('/')[0] === provider && modelTokens(m.id) === coreTokens) {
      if (!tokenBest || m.id.length > tokenBest.id.length) tokenBest = m;
    }
  }
  const pick = best || tokenBest;
  return pick ? pick.pricing.prompt : null;
}

/**
 * Line-chart data ({ labels, datasets }) of estimated weekly revenue per company
 * over the past ~6 months, one line per company. Returns null without data.
 */
export function buildCompanyRevenue(ranks, liveData, W = WEEKS_6MO) {
  const models         = liveData?.openrouter?.models ?? liveData?.openrouter?.data?.models ?? [];
  const topModels      = ranks?.topModels ?? [];
  const providerWeekly = ranks?.providerWeekly ?? {};
  const trend          = ranks?.trend ?? {};
  const allLabels      = ranks?.weekLabels ?? [];
  if (!allLabels.length) return null;

  const nWeeks = allLabels.length;
  const start  = Math.max(0, nWeeks - W);
  const labels = allLabels.slice(start).map(orWeekLabel);

  const datasets = REV_COMPANIES.map(co => {
    // Tracked models for this company, each with its price and (if in the top
    // set) its full weekly token series.
    const priced = topModels
      .filter(m => m.provider === co.name)
      .map(m => ({
        price:  livePriceForSlug(m.slug, models) ?? co.fallbackPrice,
        series: trend[m.slug] ?? null,
      }));
    const avgPrice = priced.length
      ? priced.reduce((a, p) => a + p.price, 0) / priced.length
      : co.fallbackPrice;
    const weekly = providerWeekly[co.name] ?? [];

    const data = [];
    for (let i = start; i < nWeeks; i++) {
      let revenue = 0;
      let trackedTokens = 0;
      for (const p of priced) {
        if (!p.series) continue;               // only top-set models have a series
        const t = p.series[i] ?? 0;
        revenue       += (t * p.price) / 1e6;
        trackedTokens += t;
      }
      // Remaining (untracked) volume assumed to carry the same mix as the
      // tracked volume, so price it at the blended $/M actually realised that
      // week rather than an unweighted mean of list prices — which would give a
      // rarely-used $75/M model the same say as a heavily-used $0.15/M one.
      // Falls back to the unweighted mean in weeks with no tracked volume.
      const blended  = trackedTokens > 0 ? (revenue * 1e6) / trackedTokens : avgPrice;
      const leftover = Math.max(0, (weekly[i] ?? 0) - trackedTokens);
      revenue += (leftover * blended) / 1e6;
      data.push(Math.round(revenue));
    }

    return { name: co.name, color: co.color, data, live: data.some(v => v > 0) };
  }).filter(d => d.live);

  if (!datasets.length) return null;

  return {
    labels,
    datasets: datasets.map(d => mkDs(d.name, d.color, d.data)),
  };
}

/**
 * Estimated total weekly revenue across all companies over the last W weeks —
 * the per-company series summed week by week, so every revenue chart agrees.
 * Returns null without data.
 */
export function totalRevenueSeries(ranks, liveData, W = WEEKS_6MO) {
  const perCompany = buildCompanyRevenue(ranks, liveData, W);
  if (!perCompany) return null;

  return {
    labels: perCompany.labels,
    data:   perCompany.labels.map((_, i) =>
      perCompany.datasets.reduce((sum, ds) => sum + (ds.data[i] ?? 0), 0)),
  };
}

/** Line-chart data ({ labels, datasets }) of total estimated weekly revenue. */
export function buildTotalRevenue(ranks, liveData, W = WEEKS_6MO) {
  const total = totalRevenueSeries(ranks, liveData, W);
  if (!total) return null;

  return {
    labels: total.labels,
    datasets: [mkDs('All companies', C.teal, total.data, true)],
  };
}

/**
 * Estimated weekly revenue for one company over the last W weeks, in the same
 * units and from the same computation as buildCompanyRevenue. Returns null when
 * the company has no live revenue.
 */
export function companyRevenueSeries(ranks, liveData, company, W = WEEKS_6MO) {
  const perCompany = buildCompanyRevenue(ranks, liveData, W);
  const ds = perCompany?.datasets.find(d => d.label === company);
  return ds ? { labels: perCompany.labels, data: ds.data } : null;
}

/**
 * Blended realised price by week — estimated weekly revenue ÷ that week's
 * tokens, in $/M — for one company, or for the whole platform when `provider`
 * is null. That is the average $/M actually earned across the mix of models
 * served that week, as opposed to any single model's list price.
 *
 * orTokensWithGrowth drops the in-progress week (a partial total would read as
 * a collapse) while the revenue series keeps every week in ranks.weekLabels, so
 * the two are aligned on their trailing complete weeks before dividing.
 * Returns null without data.
 */
export function buildRevPerToken(ranks, liveData, provider, W = WEEKS_6MO) {
  const s   = orTokensWithGrowth(ranks, provider, W, 52);
  const rev = provider
    ? companyRevenueSeries(ranks, liveData, provider, Infinity)
    : totalRevenueSeries(ranks, liveData, Infinity);
  if (!s || !rev) return null;

  const n   = rev.data.length;
  const end = s.labels.at(-1) === rev.labels.at(-1) ? n : n - 1;
  const start   = end - s.tokens.length;
  const weekRev = rev.data.slice(start, end);
  if (start < 0 || weekRev.length !== s.tokens.length) return null;

  return {
    labels:   s.labels,
    isoWeeks: (ranks?.weekLabels ?? []).slice(start, end),
    tokens:   s.tokens,
    revenue:  weekRev,
    price:    s.tokens.map((t, i) => (t > 0 ? +((weekRev[i] * 1e6) / t).toFixed(3) : null)),
  };
}

/**
 * Native daily model mix for a provider plus its token-weighted input price.
 * Unlike the old weekly estimate, each point is priced from the models used on
 * that particular day, so launches and mix shifts move the average naturally.
 */
export function buildDailyModelMix(ranks, liveData, provider, W = 12) {
  const daily = orProviderDailyModels(ranks, provider, W);
  if (!daily) return null;

  const catalog = liveData?.openrouter?.models ?? liveData?.openrouter?.data?.models ?? [];
  const tracked = daily.models.filter(m => m.slug !== 'other').map(model => ({
    ...model,
    price: livePriceForSlug(model.slug, catalog),
  }));

  const price = daily.tokens.map((total, i) => {
    if (!(total > 0)) return null;
    let pricedTokens = 0;
    let value = 0;
    for (const model of tracked) {
      if (!(model.price > 0)) continue;
      const tokens = model.tokens[i] ?? 0;
      pricedTokens += tokens;
      value += tokens * model.price;
    }
    // Unpriced / "Other" models are excluded rather than assigned a constant
    // fallback. A missing catalog therefore produces a gap, not the misleading
    // flat price line this daily model-mix chart is intended to replace.
    return pricedTokens > 0 ? +(value / pricedTokens).toFixed(3) : null;
  });

  return { ...daily, price };
}

/** y-axis / tooltip formatter for USD revenue. */
export const fmtUsd = v => {
  const n = Math.abs(v);
  if (n >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};

/** y-axis / tooltip formatter for blended revenue per million tokens. */
export const fmtUsdPerM = v => (v == null ? '—' : `$${v.toFixed(2)}/M`);
