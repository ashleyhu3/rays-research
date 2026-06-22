'use strict';
const axios = require('axios');

/**
 * LLM API token pricing — official provider list prices for flagship American
 * and Chinese models, in USD per 1M tokens (input and output).
 *
 * SOURCE: LiteLLM's community-maintained cost map, a single MIT-licensed JSON
 * file refreshed on day-0 model launches. No API key, one GET, fully
 * automatable — it slots into the same daily cron as the other scrapers.
 *   https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
 *
 * These are the providers' own published per-token list prices (not a
 * marketplace markup like OpenRouter), so the two sources complement each
 * other: this = official price, OpenRouter = what the market actually pays.
 *
 * SELECTION: rather than pin brittle exact keys (which churn every model
 * release), each spec matches by native `litellm_provider` + family substring
 * and picks the cleanest entry. Mirrors pickPrice() in server/history.js.
 */
const COST_MAP_URL = process.env.LITELLM_COST_MAP_URL
  || 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// region drives the US-vs-China split; brand drives the chart colour (the keys
// map to the C.* tokens in src/config/colors.js).
const SPECS = [
  // ── American ────────────────────────────────────────────────────────
  { label: 'GPT-5',           region: 'US', brand: 'openai',     provider: 'openai',    include: ['gpt-5'],            exclude: ['mini', 'nano', 'chat', 'pro', 'codex', 'image', 'audio'] },
  { label: 'GPT-5 mini',      region: 'US', brand: 'openai',     provider: 'openai',    include: ['gpt-5', 'mini'],    exclude: ['nano'] },
  { label: 'Claude Opus 4.1', region: 'US', brand: 'anthropic',  provider: 'anthropic', include: ['claude-opus-4'],    exclude: [] },
  { label: 'Claude Sonnet 4.5', region: 'US', brand: 'anthropic', provider: 'anthropic', include: ['claude-sonnet-4'], exclude: [] },
  { label: 'Gemini 2.5 Pro',  region: 'US', brand: 'google',     provider: 'gemini',    include: ['gemini-2.5-pro'],   exclude: ['preview'] },
  { label: 'Gemini 2.5 Flash', region: 'US', brand: 'google',    provider: 'gemini',    include: ['gemini-2.5-flash'], exclude: ['lite', 'image', 'preview'] },
  { label: 'Grok 4',          region: 'US', brand: 'xai',        provider: 'xai',       include: ['grok-4'],           exclude: ['fast', 'mini', 'heavy'] },

  // ── Chinese ─────────────────────────────────────────────────────────
  { label: 'DeepSeek-V',      region: 'CN', brand: 'deepseek',   provider: 'deepseek',  include: ['deepseek-chat'],     exclude: [] },
  { label: 'DeepSeek-R',      region: 'CN', brand: 'deepseek',   provider: 'deepseek',  include: ['deepseek-reasoner'], exclude: [] },
  // Labels stay family-level (GLM/Kimi/MiniMax) because the spec doesn't pin a
  // version — the selector tracks the newest base model, so a versioned label
  // would drift out of sync with the resolved key.
  { label: 'GLM',             region: 'CN', brand: 'zhipu',      provider: 'zai',       include: ['glm'],               exclude: ['air', 'flash', '-x', '-v', 'vision'] },
  { label: 'Kimi K2',         region: 'CN', brand: 'kimi',       provider: 'moonshot',  include: ['kimi-k2'],           exclude: ['thinking', 'turbo', '0905', 'instruct'] },
  { label: 'MiniMax',         region: 'CN', brand: 'minimax',    provider: 'minimax',   include: ['minimax-m'],         exclude: [] },
  { label: 'Qwen Max',        region: 'CN', brand: 'qwen',       provider: 'dashscope', include: ['qwen-max'],          exclude: [] },
];

// Cleanest live entry for a spec: among native-provider keys matching all
// `include` substrings and none of `exclude`, with positive input AND output
// prices, take the shortest id (the base model, not a dated/variant alias).
function pick(map, spec) {
  const cands = Object.entries(map)
    .filter(([id, v]) => v && v.litellm_provider === spec.provider)
    .map(([id, v]) => [id.toLowerCase(), id, v])
    .filter(([idl]) => spec.include.every(s => idl.includes(s)))
    .filter(([idl]) => !spec.exclude.some(s => idl.includes(s)))
    .filter(([, , v]) => v.input_cost_per_token > 0 && v.output_cost_per_token > 0)
    .sort((a, b) => a[1].length - b[1].length);
  return cands[0] ? { key: cands[0][1], v: cands[0][2] } : null;
}

// Resolve the curated model set from a parsed cost map. Shared by the live
// scraper and the git-history backfill (server/scripts/backfillLitellm.js) so
// both apply identical selection rules.
function selectModels(map) {
  if (!map || typeof map !== 'object') throw new Error('LiteLLM cost map: unexpected payload');
  const models = [];
  for (const spec of SPECS) {
    const hit = pick(map, spec);
    if (!hit) {
      console.warn(`[litellm] no match for ${spec.label} (${spec.provider})`);
      continue;
    }
    models.push({
      key:      hit.key,
      label:    spec.label,
      brand:    spec.brand,
      region:   spec.region,
      input:    +(hit.v.input_cost_per_token  * 1e6).toFixed(3), // $/1M tokens
      output:   +(hit.v.output_cost_per_token * 1e6).toFixed(3),
      context:  hit.v.max_input_tokens ?? hit.v.max_tokens ?? null,
    });
  }
  if (models.length === 0) throw new Error('LiteLLM cost map: no models matched any spec');
  return models;
}

async function getLitellmPricing() {
  const { data } = await axios.get(COST_MAP_URL, {
    headers: { 'User-Agent': 'signal-dashboard/1.0' },
    timeout: 15000,
    // The file is ~1.5MB of JSON; axios parses it for us.
    responseType: 'json',
  });
  return { asOf: new Date().toISOString().slice(0, 10), models: selectModels(data) };
}

module.exports = { getLitellmPricing, selectModels, SPECS, COST_MAP_URL };
