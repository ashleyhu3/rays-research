'use strict';
const path    = require('path');
const storage = require('./storage');

// Daily snapshot store for point-in-time metrics (job counts, stars,
// subscribers, filing counts…) so the dashboard can chart their trend.
// Shape: { [source]: { [metric]: { 'YYYY-MM-DD': value } } }
// One value per metric per UTC day; same-day re-scrapes overwrite.
// Persisted via the storage layer (Mongo in prod, JSON file in dev).
const FILE = path.join(__dirname, 'data', 'metricsHistory.json');
const BLOB = 'metricsHistory';

let store = null;

function load() {
  if (store) return store;
  store = storage.read(BLOB, FILE);
  return store;
}

function persist() {
  storage.write(BLOB, FILE, store);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// metrics: flat { metricName: numericValue }; non-finite values are skipped
function record(source, metrics) {
  const s = load();
  const day = today();
  if (!s[source]) s[source] = {};
  let changed = false;
  for (const [name, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value)) continue;
    if (!s[source][name]) s[source][name] = {};
    s[source][name][day] = value;
    changed = true;
  }
  if (changed) persist();
}

// Tracked input-price models. MIRROR of PRICE_MODELS in
// src/utils/modelPricing.js (label + match filters only — colours/static prices
// live client-side). Keep the `label`s in sync so the per-company price trend
// keys (`<label>.input`) match the client series.
const PRICE_SPECS = [
  { match: 'anthropic/claude-opus',       exclude: ['fast'],                                     label: 'Claude Opus' },
  { match: 'anthropic/claude-sonnet',     exclude: ['fast'],                                     label: 'Claude Sonnet' },
  { match: 'openai/gpt-5',                exclude: ['mini', 'nano', 'image', 'chat', 'pro', 'codex'], label: 'GPT-5' },
  { match: 'openai/gpt-5',                require: 'mini',                                       label: 'GPT-5 mini' },
  { match: 'openai/o3',                   exclude: ['mini', 'pro', 'deep'],                      label: 'OpenAI o3' },
  { match: 'google/gemini',               require: 'pro',   exclude: ['image', 'customtools', 'deep'], label: 'Gemini Pro' },
  { match: 'google/gemini',               require: 'flash', exclude: ['lite', 'image', 'preview'],     label: 'Gemini Flash' },
  { match: 'x-ai/grok',                   exclude: ['build', 'multi-agent', 'image', 'mini', 'fast'], label: 'Grok' },
  { match: 'mistralai/mistral-large',     exclude: [],                                           label: 'Mistral Large' },
  { match: 'meta-llama/llama-4-maverick', exclude: [':free'],                                    label: 'Llama 4 Maverick' },
  { match: 'deepseek/deepseek-v',         exclude: ['flash', 'exp'],                             label: 'DeepSeek V' },
  { match: 'moonshotai/kimi-k2',          exclude: ['code', 'thinking'],                         label: 'Kimi K2' },
  { match: 'z-ai/glm',                    exclude: ['flash', 'turbo', 'air'],                    label: 'GLM' },
  { match: 'minimax/minimax-m',           exclude: ['her'],                                      label: 'MiniMax' },
  { match: 'qwen/qwen',                   require: 'max',   exclude: ['preview'],                label: 'Qwen Max' },
];

// Cleanest live model for a spec: shortest id matching the prefix/require/exclude
// filters with a positive prompt price (mirrors pickLive in modelPricing.js).
function pickPrice(models, { match, require, exclude }) {
  const c = models
    .filter(m => m.id.startsWith(match) && m.pricing?.prompt > 0)
    .filter(m => (require ? m.id.includes(require) : true))
    .filter(m => !(exclude ?? []).some(x => m.id.includes(x)))
    .sort((a, b) => a.id.length - b.id.length);
  return c[0] ?? null;
}

// Flatteners: cache payload per source → { metricName: value }
const EXTRACTORS = {
  openrouter(data) {
    const models = data?.models;
    if (!Array.isArray(models)) return {};
    const out = {};
    for (const spec of PRICE_SPECS) {
      const m = pickPrice(models, spec);
      if (m) out[`${spec.label}.input`] = Number(m.pricing.prompt.toFixed(4));
    }
    return out;
  },
  github(data) {
    const out = {};
    for (const [repo, v] of Object.entries(data ?? {})) {
      if (v?.stars      != null) out[`${repo}.stars`]      = v.stars;
      if (v?.dependents != null) out[`${repo}.dependents`] = v.dependents;
    }
    return out;
  },
  mcp(data) {
    const out = {};
    for (const [q, v] of Object.entries(data?.queries ?? {})) {
      out[`${q}.total`] = v.total;
      out[`${q}.new7d`] = v.new7d;
    }
    if (data?.serversRepo?.stars != null) out['servers.stars'] = data.serversRepo.stars;
    return out;
  },
  sec(data) {
    const out = {};
    for (const [term, v] of Object.entries(data?.terms ?? {})) {
      if (v?.last90d != null) out[`${term}.filings90d`] = v.last90d;
    }
    return out;
  },
  gpu(data) {
    const out = {};
    for (const [g, n] of Object.entries(data?.availability ?? {})) {
      out[`${g}.offers`] = n;
    }
    return out;
  },
  huggingface(data) {
    const out = {};
    for (const [fam, v] of Object.entries(data?.families ?? {})) {
      if (v?.downloads != null) out[`${fam}.downloads`] = v.downloads;
    }
    if (data?.newModels?.perDay != null) out['hub.newModelsPerDay'] = data.newModels.perDay;
    return out;
  },
  docker(data) {
    const out = {};
    for (const [img, v] of Object.entries(data?.images ?? {})) {
      if (v?.pulls) out[`${img}.pulls`] = v.pulls;
    }
    return out;
  },
  // Official $/1M token list prices per tracked model, so the price trend chart
  // accumulates forward from the day collection began (like the GPU index).
  litellm(data) {
    const out = {};
    for (const m of data?.models ?? []) {
      if (Number.isFinite(m.input))  out[`${m.label}.input`]  = m.input;
      if (Number.isFinite(m.output)) out[`${m.label}.output`] = m.output;
    }
    return out;
  },
};

// Called by the scheduler after every successful scrape
function snapshot(source, data) {
  const extract = EXTRACTORS[source];
  if (!extract || data == null) return;
  try { record(source, extract(data)); }
  catch (e) { console.warn(`[history] snapshot ${source} failed:`, e.message); }
}

// { dates: ['YYYY-MM-DD'…], values: [n…] } sorted ascending
function series(source, metric) {
  const m = load()[source]?.[metric];
  if (!m) return null;
  const dates = Object.keys(m).sort();
  return { dates, values: dates.map(d => m[d]) };
}

function all() {
  return load();
}

module.exports = { record, snapshot, series, all };
