import { C, fa } from '../config/colors';
import { GRID, TICK, BORD } from './chartHelpers';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  INPUT TOKEN PRICING  —  shared cross-provider model set + chart builder.
 * ────────────────────────────────────────────────────────────────────────
 * One curated list of flagship/representative models across every major
 * provider. Each entry carries:
 *   match    — OpenRouter model-id prefix used for the live price lookup
 *   require  — (optional) substring the live id must contain
 *   exclude  — (optional) substrings that disqualify a live id (variants like
 *              -fast / -image / -nano that would otherwise distort the price)
 *   label    — bar label shown on the chart
 *   color    — brand colour
 *   provider — which company page should highlight this bar
 *   price    — static fallback ($/M input tokens) used when live data is absent
 *
 * Live OpenRouter prices are already normalised to $/M tokens by the server
 * (server/scrapers/openrouter.js multiplies the per-token price by 1e6).
 */
export const PRICE_MODELS = [
  { match: 'anthropic/claude-opus',   exclude: ['fast'],                     label: 'Claude Opus',   color: C.anthropic, provider: 'Anthropic', price: 15.00 },
  { match: 'anthropic/claude-sonnet', exclude: ['fast'],                     label: 'Claude Sonnet', color: C.anthropic, provider: 'Anthropic', price:  3.00 },
  { match: 'openai/gpt-5',            exclude: ['mini','nano','image','chat','pro','codex'], label: 'GPT-5',     color: C.openai,    provider: 'OpenAI',    price:  5.00 },
  { match: 'openai/gpt-5',            require: 'mini',                       label: 'GPT-5 mini',    color: C.openai,    provider: 'OpenAI',    price:  0.25 },
  { match: 'openai/o3',               exclude: ['mini','pro','deep'],        label: 'OpenAI o3',     color: C.teal,      provider: 'OpenAI',    price:  2.00 },
  { match: 'google/gemini',           require: 'pro', exclude: ['image','customtools','deep'], label: 'Gemini Pro', color: C.google, provider: 'Google', price: 1.25 },
  { match: 'google/gemini',           require: 'flash', exclude: ['lite','image','preview'],   label: 'Gemini Flash', color: C.google, provider: 'Google', price: 0.30 },
  { match: 'x-ai/grok',               exclude: ['build','multi-agent','image','mini','fast'], label: 'Grok',  color: C.xai,     provider: 'xAI',       price:  3.00 },
  { match: 'mistralai/mistral-large', exclude: [],                           label: 'Mistral Large', color: C.mistral,   provider: 'Mistral',   price:  2.00 },
  { match: 'meta-llama/llama-4-maverick', exclude: [':free'],                label: 'Llama 4 Maverick', color: C.meta,  provider: 'Meta',      price:  0.20 },
  { match: 'deepseek/deepseek-v',     exclude: ['flash','exp'],              label: 'DeepSeek V',    color: C.deepseek,  provider: 'DeepSeek',  price:  0.28 },
  { match: 'moonshotai/kimi-k2',      exclude: ['code','thinking'],          label: 'Kimi K2',       color: C.kimi,      provider: 'Moonshot',  price:  0.30 },
  { match: 'z-ai/glm',                exclude: ['flash','turbo','air'],      label: 'GLM',           color: C.zhipu,     provider: 'Zhipu',     price:  0.40 },
  { match: 'minimax/minimax-m',       exclude: ['her'],                      label: 'MiniMax',       color: C.minimax,   provider: 'MiniMax',   price:  0.30 },
  { match: 'qwen/qwen',               require: 'max', exclude: ['preview'],  label: 'Qwen Max',      color: C.qwen,      provider: 'Alibaba',   price:  1.20 },
];

// Metric-key convention for the server's daily price-history store. MUST match
// PRICE_SPECS in server/history.js so the per-company trend lines line up.
export const priceMetricKey = label => `${label}.input`;

// Distinct line colours for providers that have more than one tracked model.
const TREND_PALETTE = [C.anthropic, C.teal, C.deepseek, C.kimi, C.qwen];

// The tracked models that belong to one provider, as metricTrendCard `series`.
// Single-model providers keep their brand colour; multi-model providers get
// distinct palette colours so the trend lines stay legible.
export function companyPriceSeries(provider) {
  const ms = PRICE_MODELS.filter(m => m.provider === provider);
  return ms.map((m, i) => ({
    metric: priceMetricKey(m.label),
    label:  m.label,
    color:  ms.length === 1 ? m.color : TREND_PALETTE[i % TREND_PALETTE.length],
  }));
}

/**
 * Daily input-price history (`{ metric: { 'YYYY-MM-DD': price } }`) as consumed
 * by metricTrendCard. Server-accumulated history is merged with today's live
 * OpenRouter price for every tracked model, so a company card shows current
 * prices immediately and turns into a multi-day trend as snapshots accumulate.
 */
export function priceHistory(liveData) {
  const hist = {};
  const server = liveData?.metricsHistory?.openrouter ?? {};
  for (const [k, v] of Object.entries(server)) hist[k] = { ...v };

  const models = liveData?.openrouter?.models ?? liveData?.openrouter?.data?.models;
  if (models?.length > 0) {
    const today = new Date().toISOString().slice(0, 10); // UTC, matches server
    for (const spec of PRICE_MODELS) {
      const m = pickLive(models, spec);
      if (!m) continue;
      const key = priceMetricKey(spec.label);
      hist[key] = { ...(hist[key] ?? {}), [today]: m.pricing.prompt };
    }
  }
  return hist;
}

// Pick the cleanest live model for an entry: closest-to-base id (shortest)
// among those matching the prefix / require / exclude filters and priced > 0.
function pickLive(models, { match, require, exclude }) {
  const cands = models
    .filter(m => m.id.startsWith(match) && m.pricing?.prompt > 0)
    .filter(m => (require ? m.id.includes(require) : true))
    .filter(m => !(exclude ?? []).some(x => m.id.includes(x)))
    .sort((a, b) => a.id.length - b.id.length);
  return cands[0] ?? null;
}

/**
 * Build the input-token-pricing bar dataset from live OpenRouter data, falling
 * back to static prices. Bars are sorted high→low. When `highlight` (a provider
 * name) is given, that provider's bars are drawn at full opacity and the rest
 * are dimmed, so a company page can foreground its own models.
 *
 * Returns { data, src } where `src` notes whether the values are live.
 */
export function buildPriceData(liveData, { highlight } = {}) {
  const models = liveData?.openrouter?.models ?? liveData?.openrouter?.data?.models;
  let rows = null;
  let live = false;

  if (models?.length > 0) {
    const matched = PRICE_MODELS
      .map(spec => {
        const m = pickLive(models, spec);
        return m ? { ...spec, price: m.pricing.prompt } : null;
      })
      .filter(Boolean);
    if (matched.length >= 5) { rows = matched; live = true; }
  }
  if (!rows) rows = PRICE_MODELS.map(spec => ({ ...spec }));

  rows.sort((a, b) => b.price - a.price);

  const dim = highlight
    ? r => (r.provider === highlight ? 0.85 : 0.28)
    : () => 0.75;

  return {
    src: live ? 'openrouter.ai/api/v1/models · live' : 'openrouter.ai · provider docs',
    data: {
      labels: rows.map(r => r.label),
      datasets: [{
        label: 'Input $/M tokens',
        data: rows.map(r => r.price),
        backgroundColor: rows.map(r => fa(r.color, dim(r))),
        borderColor: rows.map(r => r.color),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
  };
}

/**
 * ────────────────────────────────────────────────────────────────────────
 *  PER-COMPANY MODEL HISTORY  —  models in release-date order.
 * ────────────────────────────────────────────────────────────────────────
 * Each entry:
 *   label       — bar label
 *   releaseDate — 'YYYY-MM' used only for sort order (already pre-sorted)
 *   match       — OpenRouter model-id prefix for live price lookup
 *   require     — (optional) substring that must appear in the live id
 *   exclude     — (optional) substrings that disqualify a live id
 *   price       — static fallback $/M input tokens
 *   color       — bar fill colour
 */
export const COMPANY_MODELS = {
  Anthropic: [
    { label: 'Claude 1',          releaseDate: '2023-03', match: 'anthropic/claude-1',          price:  11.02, color: C.anthropic },
    { label: 'Claude Instant',    releaseDate: '2023-03', match: 'anthropic/claude-instant',     price:   1.63, color: C.anthropic },
    { label: 'Claude 2',          releaseDate: '2023-07', match: 'anthropic/claude-2',           exclude: ['.1', '1.'], price: 8.00, color: C.anthropic },
    { label: 'Claude 2.1',        releaseDate: '2023-11', match: 'anthropic/claude-2.1',         price:   8.00, color: C.anthropic },
    { label: 'Claude 3 Haiku',    releaseDate: '2024-03', match: 'anthropic/claude-3-haiku',     price:   0.25, color: C.anthropic },
    { label: 'Claude 3 Sonnet',   releaseDate: '2024-03', match: 'anthropic/claude-3-sonnet',    exclude: ['3.5','3-7'], price: 3.00, color: C.anthropic },
    { label: 'Claude 3 Opus',     releaseDate: '2024-03', match: 'anthropic/claude-3-opus',      exclude: ['4'],        price: 15.00, color: C.anthropic },
    { label: 'Claude 3.5 Sonnet', releaseDate: '2024-06', match: 'anthropic/claude-3.5-sonnet',  price:   3.00, color: C.anthropic },
    { label: 'Claude 3.5 Haiku',  releaseDate: '2024-11', match: 'anthropic/claude-3.5-haiku',   price:   0.80, color: C.anthropic },
    { label: 'Claude 3.7 Sonnet', releaseDate: '2025-02', match: 'anthropic/claude-3.7-sonnet',  price:   3.00, color: C.anthropic },
    { label: 'Claude Sonnet 4',   releaseDate: '2025-06', match: 'anthropic/claude-sonnet-4',    exclude: ['5'], price: 3.00, color: C.anthropic },
    { label: 'Claude Opus 4',     releaseDate: '2025-06', match: 'anthropic/claude-opus-4',      exclude: ['5'], price: 15.00, color: C.anthropic },
  ],
  OpenAI: [
    { label: 'GPT-3.5 Turbo', releaseDate: '2022-11', match: 'openai/gpt-3.5-turbo', price:  0.50, color: C.openai },
    { label: 'GPT-4',         releaseDate: '2023-03', match: 'openai/gpt-4',         exclude: ['turbo','o','mini','32k','preview'], price: 30.00, color: C.openai },
    { label: 'GPT-4 Turbo',   releaseDate: '2023-11', match: 'openai/gpt-4-turbo',   price: 10.00, color: C.openai },
    { label: 'GPT-4o',        releaseDate: '2024-05', match: 'openai/gpt-4o',        exclude: ['mini','audio','realtime','search','preview','2024'], price: 2.50, color: C.openai },
    { label: 'GPT-4o mini',   releaseDate: '2024-07', match: 'openai/gpt-4o-mini',   exclude: ['audio','search'], price: 0.15, color: C.openai },
    { label: 'o1',            releaseDate: '2024-09', match: 'openai/o1',            exclude: ['mini','pro','preview'], price: 15.00, color: C.teal },
    { label: 'o3 mini',       releaseDate: '2025-01', match: 'openai/o3-mini',       price:  1.10, color: C.teal },
    { label: 'o3',            releaseDate: '2025-04', match: 'openai/o3',            exclude: ['mini','pro','deep'], price: 10.00, color: C.teal },
    { label: 'GPT-5',         releaseDate: '2025-05', match: 'openai/gpt-5',         exclude: ['mini','nano','image','chat','pro','codex'], price: 5.00, color: C.openai },
  ],
  Google: [
    { label: 'Gemini 1.0 Pro',   releaseDate: '2023-12', match: 'google/gemini-pro',     exclude: ['1.5','2','exp','vision'], price: 0.50, color: C.google },
    { label: 'Gemini Ultra 1.0', releaseDate: '2024-02', match: 'google/gemini-ultra',    price: 7.00, color: C.google },
    { label: 'Gemini 1.5 Flash', releaseDate: '2024-04', match: 'google/gemini-1.5-flash', exclude: ['lite','8b'], price: 0.075, color: C.google },
    { label: 'Gemini 1.5 Pro',   releaseDate: '2024-04', match: 'google/gemini-1.5-pro',  exclude: ['exp'], price: 1.25, color: C.google },
    { label: 'Gemini 2.0 Flash', releaseDate: '2024-12', match: 'google/gemini-2.0-flash', exclude: ['lite','exp','think'], price: 0.10, color: C.google },
    { label: 'Gemini 2.5 Flash', releaseDate: '2025-04', match: 'google/gemini-2.5-flash', exclude: ['preview','lite'], price: 0.30, color: C.google },
    { label: 'Gemini 2.5 Pro',   releaseDate: '2025-04', match: 'google/gemini-2.5-pro',   exclude: ['preview','exp'], price: 1.25, color: C.google },
  ],
  Zhipu: [
    { label: 'GLM-3 Turbo', releaseDate: '2023-10', match: 'z-ai/glm-3-turbo', price: 0.05,  color: C.zhipu },
    { label: 'GLM-4',       releaseDate: '2024-01', match: 'z-ai/glm-4',       exclude: ['air','flash','plus','v','long','alltools'], price: 0.14, color: C.zhipu },
    { label: 'GLM-4 Air',   releaseDate: '2024-06', match: 'z-ai/glm-4-air',   price: 0.01,  color: C.zhipu },
    { label: 'GLM-4 Flash', releaseDate: '2024-06', match: 'z-ai/glm-4-flash', price: 0.00,  color: C.zhipu },
    { label: 'GLM-4 Plus',  releaseDate: '2024-09', match: 'z-ai/glm-4-plus',  price: 0.14,  color: C.zhipu },
    { label: 'GLM-Z1',      releaseDate: '2025-01', match: 'z-ai/glm-z1',      exclude: ['flash','rumination'], price: 0.80, color: C.zhipu },
  ],
  MiniMax: [
    { label: 'MiniMax Text-01', releaseDate: '2024-12', match: 'minimax/minimax-text-01', price: 0.20, color: C.minimax },
    { label: 'MiniMax M1',      releaseDate: '2025-05', match: 'minimax/minimax-m1',      price: 0.30, color: C.minimax },
  ],
};

/**
 * Bar chart data for a company's model pricing, sorted earliest→latest.
 * Uses live OpenRouter prices where available, falls back to static.
 */
export function buildCompanyPriceBar(liveData, provider) {
  const orModels = liveData?.openrouter?.models ?? liveData?.openrouter?.data?.models;
  const specs = COMPANY_MODELS[provider] ?? [];
  let liveUsed = false;

  const rows = specs.map(spec => {
    let price = spec.price;
    if (orModels?.length > 0 && spec.match) {
      const m = pickLive(orModels, spec);
      if (m) { price = m.pricing.prompt; liveUsed = true; }
    }
    return { label: spec.label, price, color: spec.color };
  });

  return {
    src: liveUsed ? 'openrouter.ai/api/v1/models · live' : null,
    data: {
      labels: rows.map(r => r.label),
      datasets: [{
        label: 'Input $/M tokens',
        data: rows.map(r => r.price),
        backgroundColor: rows.map(r => fa(r.color, 0.72)),
        borderColor: rows.map(r => r.color),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
  };
}

/** Chart.js options for the per-company release-timeline bar chart. */
export const pricingBarOpts = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1a1f2a',
      borderColor: 'rgba(255,255,255,.12)',
      borderWidth: 1,
      callbacks: { label: ctx => `$${ctx.parsed.y.toFixed(3)}/M tokens` },
    },
  },
  scales: {
    x: {
      grid: GRID,
      border: BORD,
      ticks: { ...TICK, maxRotation: 45, minRotation: 0 },
    },
    y: {
      grid: GRID,
      border: BORD,
      ticks: { ...TICK, callback: v => `$${v}` },
      beginAtZero: true,
    },
  },
};
