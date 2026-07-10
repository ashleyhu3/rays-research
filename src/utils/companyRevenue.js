/**
 * Estimated weekly AI revenue per company over time, derived from the
 * OpenRouter rankings scrape + live model pricing.
 *
 *   revenue(company, week) = Σ over the company's models of
 *                              (model tokens that week) × (model $/M input price) / 1e6
 *
 * We have per-model weekly token series only for the tracked top models
 * (`ranks.trend`), so a company's remaining volume (its provider weekly total
 * minus the tracked models) is priced at the average of its tracked models and
 * added on — keeping every company represented instead of dropping smaller
 * models to zero. Prices are current (applied to historical volumes), i.e. this
 * is revenue-at-today's-pricing.
 */
import { C } from '../config/colors';
import { mkDs } from './chartHelpers';
import { orWeekLabel } from './openrouterProvider';

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
];

// ~6 months of complete weeks.
const WEEKS_6MO = 26;

// $/M input tokens for one rankings permaslug, from the live /models list.
// Permaslugs carry version/date suffixes that the model ids drop, so match on
// the longest model id that prefixes the slug at a boundary. null when unpriced.
export function livePriceForSlug(slug, models) {
  if (!slug || !models?.length) return null;
  let best = null;
  for (const m of models) {
    if (!(m.pricing?.prompt > 0)) continue;
    const hit = slug === m.id
      || slug.startsWith(`${m.id}-`)
      || slug.startsWith(`${m.id}:`)
      || slug.startsWith(`${m.id}/`);
    if (hit && (!best || m.id.length > best.id.length)) best = m;
  }
  return best ? best.pricing.prompt : null;
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
      // Remaining (untracked) volume priced at the company's tracked-model average.
      const leftover = Math.max(0, (weekly[i] ?? 0) - trackedTokens);
      revenue += (leftover * avgPrice) / 1e6;
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

/** y-axis / tooltip formatter for USD revenue. */
export const fmtUsd = v => {
  const n = Math.abs(v);
  if (n >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};
