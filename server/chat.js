'use strict';
const Groq    = require('groq-sdk');
const cache   = require('./cache');
const history = require('./history');

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Groq enforces daily token quotas PER MODEL, so running the Detective on a
// smaller model doubles the effective free-tier budget and keeps the 70B
// quota for the answers users actually read. The grading/rewrite task is
// well within an 8B model's ability. Set GROQ_DETECTIVE_MODEL=<MODEL> to
// run both personas on the same model again.
const DETECTIVE_MODEL = process.env.GROQ_DETECTIVE_MODEL || 'llama-3.1-8b-instant';

// Hard cap on the DATA CONTEXT handed to the Wordsmith (~4 chars/token, so
// ~6K tokens). History expansions and a second retrieval hop can balloon the
// context; the compressor below trims back to this before the 70B call.
const CONTEXT_CHAR_BUDGET = 24000;

// ── Shared engine, two personas ────────────────────────────────────────────
// A single Groq client serves both logical roles. Each persona is just a
// different system prompt (and quota-driven model choice) on the same client.

let groqInstance = null;
function makeGroq() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
  if (!groqInstance) groqInstance = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqInstance;
}

async function callModel({ system, user, model = MODEL, temperature = 0, maxTokens = 2048, json = false }) {
  const groq = makeGroq();
  const response = await groq.chat.completions.create({
    model,
    max_tokens:  maxTokens,
    temperature,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}

// Friendly text for Groq daily-quota errors (HTTP 429)
function rateLimitMessage(err) {
  if (err?.status !== 429) return null;
  const wait = /try again in ([0-9hms.]+)/i.exec(err.message ?? '')?.[1]
    ?.replace(/\.+$/, '')        // trailing sentence period caught by the class
    ?.replace(/\.\d+s/, 's');    // fractional seconds, e.g. 3m36.864s → 3m36s
  return `The AI model's daily free-tier token limit has been reached${wait ? `. It resets in about ${wait}` : ''}. The dashboards themselves are unaffected — only the Ask tab is paused.`;
}

function fmt(n) {
  if (n == null || isNaN(n)) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function agoText(ts) {
  if (!ts) return null;
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── History helpers (the "parent" side of each section) ────────────────────
// Sections are deliberately small summaries so the Detective can grade them
// cheaply. Each one can carry a `detail` payload — its full recent time
// series — that is only attached to the Wordsmith context when the question
// actually needs trend data (NodeRAG-style parent-child expansion).

// "1.2M → 1.3M → …" for in-cache weekly arrays (oldest → newest)
function weeklyTail(weeks, n = 12) {
  if (!Array.isArray(weeks) || weeks.length < 2) return null;
  return weeks.slice(-n).map(fmt).join(' → ');
}

// "06-01: 412 | 06-05: 415 | …" from the daily snapshot store
function snapshotTail(source, metric, n = 8) {
  const s = history.series(source, metric);
  if (!s || s.dates.length < 2) return null;
  const dates = s.dates.slice(-n);
  return dates.map((d, i) => `${d.slice(5)}: ${fmt(s.values.slice(-n)[i])}`).join(' | ');
}

// One "Recent history" block covering every snapshotted metric of a source
function snapshotDetail(source, heading, maxMetrics = 24) {
  const metrics = history.all()[source];
  if (!metrics) return null;
  const lines = [];
  for (const metric of Object.keys(metrics).slice(0, maxMetrics)) {
    const tail = snapshotTail(source, metric);
    if (tail) lines.push(`  ${metric}: ${tail}`);
  }
  return lines.length ? `Recent history — ${heading} (daily snapshots, oldest → newest):\n${lines.join('\n')}` : null;
}

// ── Section builders ────────────────────────────────────────────────────────
// Every cached source is serialized into a discrete, gradeable section:
//   id/title/about — what the Detective grades on
//   entities       — exact names covered (packages, tickers, companies…) so
//                    grading and the [meta] passport are lexically precise
//   text           — the compact summary the Wordsmith always sees if vetted
//   detail         — optional historical series, attached only on expansion

function buildPypi() {
  const pypi = cache.get('pypi');
  if (!pypi) return null;
  const lines = Object.entries(pypi).map(([pkg, weeks]) => {
    if (!Array.isArray(weeks) || weeks.length < 4) return `  ${pkg}: insufficient data`;
    const total = weeks.reduce((a, b) => a + b, 0);
    const last4 = weeks.slice(-4).reduce((a, b) => a + b, 0);
    const prev4 = weeks.slice(-8, -4).reduce((a, b) => a + b, 0);
    const chg   = prev4 > 0 ? ` | trend: ${((last4 - prev4) / prev4 * 100).toFixed(1)}% vs prior 4 weeks` : '';
    return `  ${pkg}: ${fmt(total)} total (52 weeks) | last week: ${fmt(weeks.at(-1))} | last 4 weeks: ${fmt(last4)}${chg}`;
  });
  const detail = Object.entries(pypi)
    .map(([pkg, weeks]) => { const t = weeklyTail(weeks); return t ? `  ${pkg}: ${t}` : null; })
    .filter(Boolean);
  return {
    id:       'pypi',
    title:    'PyPI Weekly Downloads',
    about:    'Weekly download counts for AI SDK packages (openai, anthropic, google-generativeai, mistralai)',
    source:   'pypistats.org',
    entities: Object.keys(pypi),
    text:     `### PyPI Weekly Downloads\n${lines.join('\n')}`,
    detail:   detail.length ? `Recent history — weekly downloads, last 12 weeks (oldest → newest):\n${detail.join('\n')}` : null,
  };
}

function buildNpm() {
  const npm = cache.get('npm');
  if (!npm) return null;
  const lines = Object.entries(npm).map(([pkg, weeks]) => {
    if (!Array.isArray(weeks) || weeks.length < 4) return `  ${pkg}: insufficient data`;
    const total = weeks.reduce((a, b) => a + b, 0);
    const last4 = weeks.slice(-4).reduce((a, b) => a + b, 0);
    const prev4 = weeks.slice(-8, -4).reduce((a, b) => a + b, 0);
    const chg   = prev4 > 0 ? ` | trend: ${((last4 - prev4) / prev4 * 100).toFixed(1)}% vs prior 4 weeks` : '';
    return `  ${pkg}: ${fmt(total)} total (52 weeks) | last week: ${fmt(weeks.at(-1))} | last 4 weeks: ${fmt(last4)}${chg}`;
  });
  const detail = Object.entries(npm)
    .map(([pkg, weeks]) => { const t = weeklyTail(weeks); return t ? `  ${pkg}: ${t}` : null; })
    .filter(Boolean);
  return {
    id:       'npm',
    title:    'npm Weekly Downloads',
    about:    'Weekly npm download counts for AI JavaScript/TypeScript SDKs (openai, @anthropic-ai/sdk, langchain, ai, llamaindex, etc.)',
    source:   'api.npmjs.org',
    entities: Object.keys(npm),
    text:     `### npm Weekly Downloads\n${lines.join('\n')}`,
    detail:   detail.length ? `Recent history — weekly downloads, last 12 weeks (oldest → newest):\n${detail.join('\n')}` : null,
  };
}

function buildStackOverflow() {
  const so = cache.get('stackoverflow');
  if (!so || !(Object.keys(so.totals ?? {}).length || Object.keys(so.weekly ?? {}).length)) return null;
  const tags  = new Set([...Object.keys(so.totals ?? {}), ...Object.keys(so.weekly ?? {})]);
  const lines = [...tags].map(tag => {
    const total  = so.totals?.[tag];
    const weekly = so.weekly?.[tag];
    return `  ${tag}: ${total != null ? `${fmt(total)} questions all-time` : 'total N/A'}${weekly != null ? ` | ${fmt(weekly)} new this week` : ''}`;
  });
  return {
    id:       'stackoverflow',
    title:    'Stack Overflow Tag Activity',
    about:    'All-time and weekly question counts for AI developer tags (openai-api, anthropic-claude, google-gemini-api, langchain, mistral-ai)',
    source:   'Stack Exchange API',
    entities: [...tags],
    text:     `### Stack Overflow Tag Activity\n${lines.join('\n')}`,
    detail:   snapshotDetail('stackoverflow', 'question counts'),
  };
}

function buildGitHub() {
  const github = cache.get('github');
  if (!github) return null;
  const lines = Object.entries(github).map(([repo, v]) =>
    `  ${repo}: ${fmt(v?.stars)} stars | ${fmt(v?.dependents)} dependent repos`
  );
  return {
    id:       'github',
    title:    'GitHub SDK Statistics',
    about:    'Stars and dependent-repo counts for major AI SDK repositories',
    source:   'GitHub API',
    entities: Object.keys(github),
    text:     `### GitHub SDK Statistics\n${lines.join('\n')}`,
    detail:   snapshotDetail('github', 'stars and dependent repos'),
  };
}

function buildJobs() {
  const jobs = cache.get('jobs');
  if (!jobs) return null;
  const entries = Object.entries(jobs).filter(([, v]) => v != null);
  const lines = entries
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([co, v]) => `  ${co}: ${v.total} open roles total | ${v.engineering} engineering`);
  return {
    id:       'jobs',
    title:    'Open Job Postings (Greenhouse)',
    about:    'Open role counts at AI companies (Anthropic, OpenAI, Google DeepMind, Mistral, Cohere, Perplexity)',
    source:   'Greenhouse boards',
    entities: entries.map(([co]) => co),
    text:     `### Open Job Postings (Greenhouse)\n${lines.join('\n')}`,
    detail:   snapshotDetail('jobs', 'open role counts'),
  };
}

function buildReddit() {
  const reddit = cache.get('reddit');
  if (!reddit) return null;
  const entries = Object.entries(reddit).filter(([, v]) => v != null);
  const lines = entries
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `  ${name}: ${fmt(count)} posts this week`);
  return {
    id:       'reddit',
    title:    'Reddit Weekly Mentions',
    about:    'Weekly Reddit post counts mentioning ChatGPT, Claude, Gemini, Mistral',
    source:   'Reddit search',
    entities: entries.map(([name]) => name),
    text:     `### Reddit Weekly Mentions\n${lines.join('\n')}`,
    detail:   snapshotDetail('reddit', 'weekly mention counts'),
  };
}

function buildTrends() {
  const trends = cache.get('trends');
  if (!trends) return null;
  const parts = [];
  const entities = [];
  for (const [group, label] of [['api', 'API keywords'], ['brand', 'Brand keywords']]) {
    if (!trends[group]) continue;
    entities.push(...Object.keys(trends[group]));
    const vals = Object.entries(trends[group])
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.at(-1) : v}/100`)
      .join(' | ');
    parts.push(`  ${label}: ${vals}`);
  }
  if (!parts.length) return null;
  const detail = [];
  for (const group of ['api', 'brand']) {
    for (const [k, v] of Object.entries(trends[group] ?? {})) {
      if (Array.isArray(v) && v.length >= 2) detail.push(`  ${k}: ${v.slice(-14).join(', ')}`);
    }
  }
  return {
    id:       'trends',
    title:    'Google Trends',
    about:    'Relative Google search interest (0–100) for AI brand and API keywords',
    source:   'Google Trends',
    entities,
    text:     `### Google Trends (relative interest 0–100, last 84 days)\n${parts.join('\n')}`,
    detail:   detail.length ? `Recent history — daily interest values, last 14 days (oldest → newest):\n${detail.join('\n')}` : null,
  };
}

function buildGpu() {
  const gpu = cache.get('gpu');
  const gpuPrices = gpu?.prices ?? gpu;
  if (!gpuPrices || Object.keys(gpuPrices).length === 0) return null;
  const lines = Object.entries(gpuPrices)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `  ${k.replace(/_/g, ' ')}: $${v}/hr`);
  if (gpu?.history?.index?.length) {
    lines.push(`  Mainstream GPU index (avg across tracked GPUs): $${gpu.history.index.at(-1)}/hr`);
  }
  if (gpu?.availability && Object.keys(gpu.availability).length > 0) {
    const avail = Object.entries(gpu.availability)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v} offers`)
      .join(' | ');
    lines.push(`  Marketplace availability (scarcity signal — fewer offers = higher demand): ${avail}`);
  }

  // Parent payload: daily price index + per-GPU 30-day movement
  const detail = [];
  const h = gpu?.history;
  if (h?.dates?.length >= 2 && h.index?.length) {
    const n = Math.min(14, h.dates.length);
    const tail = h.dates.slice(-n).map((d, i) => `${d.slice(5)}: $${h.index.slice(-n)[i]}`).join(' | ');
    detail.push(`  GPU index ($/hr, daily): ${tail}`);
    for (const [gpuKey, series] of Object.entries(h.series ?? {})) {
      const window = series.slice(-30).filter(v => v != null);
      if (window.length < 2) continue;
      const first = window[0], last = window.at(-1);
      const chg = first > 0 ? ((last - first) / first * 100).toFixed(1) : null;
      detail.push(`  ${gpuKey.replace(/_/g, ' ')}: $${first} → $${last} over last 30 days${chg != null ? ` (${chg >= 0 ? '+' : ''}${chg}%)` : ''}`);
    }
  }
  const availDetail = snapshotDetail('gpu', 'marketplace offer counts');
  return {
    id:       'gpu',
    title:    'GPU Spot Prices & Availability',
    about:    'Spot rental prices and marketplace availability on vast.ai for H100, H200, B200, A100, RTX 4090 ($/hr, offer counts)',
    source:   'vast.ai marketplace',
    entities: Object.keys(gpuPrices).map(k => k.replace(/_/g, ' ')),
    text:     `### GPU Spot Prices & Availability (vast.ai)\n${lines.join('\n')}`,
    detail:   [detail.length ? `Recent history — GPU spot prices:\n${detail.join('\n')}` : null, availDetail]
                .filter(Boolean).join('\n') || null,
  };
}

function buildDram() {
  const dram = cache.get('dram');
  if (!dram?.models?.length) return null;
  const lines = dram.models.map(m =>
    `  ${m.model} (${m.category}): $${m.price} avg | session change ${m.changePct >= 0 ? '+' : ''}${m.changePct}% | ${m.variants} variant(s)`
  );
  if (dram.index?.values?.length) {
    lines.push(`  ${dram.index.name} (TrendForce monthly index): $${dram.index.values.at(-1)} as of ${dram.index.dates.at(-1)}`);
  }
  const detail = [];
  if (dram.index?.values?.length >= 2) {
    const n = Math.min(12, dram.index.values.length);
    const tail = dram.index.dates.slice(-n).map((d, i) => `${d}: $${dram.index.values.slice(-n)[i]}`).join(' | ');
    detail.push(`  ${dram.index.name} (monthly): ${tail}`);
  }
  for (const [model, series] of Object.entries(dram.history?.series ?? {})) {
    if (!Array.isArray(series) || series.filter(v => v != null).length < 2) continue;
    const n = Math.min(10, series.length);
    const tail = dram.history.dates.slice(-n)
      .map((d, i) => { const v = series.slice(-n)[i]; return v != null ? `${d.slice(5)}: $${v}` : null; })
      .filter(Boolean).join(' | ');
    if (tail) detail.push(`  ${model} (daily spot): ${tail}`);
  }
  return {
    id:       'dram',
    title:    'DRAM Memory Spot Prices',
    about:    'DRAM/memory chip spot prices from TrendForce (DDR4, DDR5, HBM-adjacent)',
    source:   'TrendForce',
    entities: dram.models.map(m => m.model),
    text:     `### DRAM Memory Spot Prices (TrendForce, session average × (1 + session change), averaged per model, as of ${dram.asOf})\n${lines.join('\n')}`,
    detail:   detail.length ? `Recent history — DRAM prices:\n${detail.join('\n')}` : null,
  };
}

// OpenRouter model pricing — majors only; the full catalog spans dozens
// of providers and would dominate the LLM context for any pricing question
const MAJOR_PROVIDERS = new Set([
  'openai', 'anthropic', 'google', 'meta-llama', 'mistralai', 'deepseek',
  'qwen', 'x-ai', 'minimax', 'thudm', 'z-ai', 'moonshotai', 'cohere',
  'amazon', 'perplexity',
]);

function buildOpenrouter() {
  const openrouter = cache.get('openrouter');
  if (!openrouter?.models) return null;
  const byProvider = {};
  for (const m of openrouter.models) {
    const provider = m.id.split('/')[0] || 'unknown';
    if (!MAJOR_PROVIDERS.has(provider)) continue;
    (byProvider[provider] = byProvider[provider] || []).push(m);
  }
  const lines = Object.entries(byProvider).flatMap(([, models]) =>
    models.slice(0, 4).map(m =>
      `  ${m.id}: context ${fmt(m.context)} tokens | in $${m.pricing?.prompt ?? '?'} / out $${m.pricing?.completion ?? '?'} per 1M tokens`
    )
  );
  return {
    id:       'openrouter',
    title:    'OpenRouter AI Model Catalog & Pricing',
    about:    'API pricing and context windows for hosted AI models across providers',
    source:   'OpenRouter API',
    entities: Object.keys(byProvider),
    text:     `### OpenRouter AI Model Catalog & Pricing\n${lines.join('\n')}`,
    detail:   null,
  };
}

function buildOpenrouterRanks() {
  const orRanks = cache.get('openrouterRanks');
  if (!orRanks?.topModels?.length) return null;
  const lines = [`  Week of ${orRanks.latestWeek} (data as of ${orRanks.asOf})`];
  lines.push('  Top models by weekly token volume:');
  for (const m of orRanks.topModels.slice(0, 10)) {
    const wow = m.wow != null ? ` | WoW: ${m.wow >= 0 ? '+' : ''}${(m.wow * 100).toFixed(1)}%` : '';
    lines.push(`    #${m.rank} ${m.name} (${m.provider}): ${fmt(m.tokens)} tokens${wow}`);
  }
  if (orRanks.providers?.length) {
    const provs = orRanks.providers
      .filter(p => p.name !== 'Other')
      .slice(0, 8)
      .map(p => `${p.name}: ${(p.pct * 100).toFixed(1)}% (${fmt(p.tokens)} tokens)`)
      .join(' | ');
    lines.push(`  Provider market share (recent weeks): ${provs}`);
  }
  if (orRanks.weeklyTotals?.length >= 2) {
    const last = orRanks.weeklyTotals.at(-1);
    const prev = orRanks.weeklyTotals.at(-2);
    const chg  = prev > 0 ? ` | WoW: ${((last - prev) / prev * 100).toFixed(1)}%` : '';
    lines.push(`  Platform total tokens latest week: ${fmt(last)}${chg}`);
  }
  const totalsTail = weeklyTail(orRanks.weeklyTotals);
  return {
    id:       'openrouterRanks',
    title:    'OpenRouter Usage Rankings',
    about:    'Real LLM usage market share: weekly token throughput by model and provider on OpenRouter (which models/providers are actually used most)',
    source:   'OpenRouter rankings',
    entities: [...new Set([
      ...orRanks.topModels.slice(0, 10).map(m => m.name),
      ...(orRanks.providers ?? []).slice(0, 8).map(p => p.name),
    ])],
    text:     `### OpenRouter Usage Rankings (weekly token throughput)\n${lines.join('\n')}`,
    detail:   totalsTail ? `Recent history — platform total tokens per week (oldest → newest):\n  ${totalsTail}` : null,
  };
}

function buildElectricity() {
  const eia = cache.get('eia');
  if (!eia?.rates) return null;
  const usRates = eia.rates['US'];
  const usLine = usRates
    ? `  US national avg: ${Object.entries(usRates).sort(([a], [b]) => a.localeCompare(b)).map(([y, r]) => `${y}: ${r}¢/kWh`).join(' | ')}`
    : null;
  const stateLines = Object.entries(eia.rates)
    .filter(([k]) => k !== 'US')
    .map(([state, years]) => {
      const [yr, rate] = Object.entries(years).sort(([a], [b]) => b.localeCompare(a))[0] ?? [];
      return yr ? `  ${state}: ${rate}¢/kWh (${yr})` : null;
    })
    .filter(Boolean);
  return {
    id:       'electricity',
    title:    'US Electricity Rates',
    about:    'US residential electricity rates by state from EIA (¢/kWh)',
    source:   'EIA',
    entities: Object.keys(eia.rates),
    text:     `### US Electricity Rates (¢/kWh, EIA, residential)\n${[usLine, ...stateLines].filter(Boolean).join('\n')}`,
    detail:   null, // rates are already multi-year in the summary
  };
}

function buildMops() {
  const mops = cache.get('mops');
  if (!mops?.companies) return null;
  const companies = Object.values(mops.companies);
  const lines = companies.map(c => {
    const latest = c.monthly?.at(-1);
    if (!latest) return `  ${c.name} (${c.ticker}, ${c.group}): no data`;
    return `  ${c.name} (${c.ticker}, ${c.group}): NT$${latest.revenue}M in ${latest.period} | YoY: ${latest.yoy ?? 'N/A'}% | MoM: ${latest.mom ?? 'N/A'}%`;
  });
  const detail = companies
    .map(c => {
      const months = (c.monthly ?? []).slice(-6);
      if (months.length < 2) return null;
      return `  ${c.name}: ${months.map(m => `${m.period}: NT$${m.revenue}M`).join(' | ')}`;
    })
    .filter(Boolean);
  return {
    id:       'mops',
    title:    'Taiwan AI Supply Chain Revenue',
    about:    'Monthly revenue for Taiwanese optics and PCB AI supply chain companies (MOPS filings)',
    source:   'MOPS / FinMind',
    entities: companies.map(c => c.name),
    text:     `### Taiwan AI Supply Chain Revenue (NT$M/month, MOPS)\n${lines.join('\n')}`,
    detail:   detail.length ? `Recent history — monthly revenue, last 6 months:\n${detail.join('\n')}` : null,
  };
}

function buildGithubCommits() {
  const githubCommits = cache.get('githubCommits');
  if (!githubCommits) return null;
  const lines = [];
  const detail = [];
  const repos = [];
  if (githubCommits.commits) {
    for (const [repo, weeks] of Object.entries(githubCommits.commits)) {
      if (!Array.isArray(weeks) || weeks.length < 4) continue;
      repos.push(repo);
      const last4 = weeks.slice(-4).reduce((a, b) => a + b, 0);
      const prev4 = weeks.slice(-8, -4).reduce((a, b) => a + b, 0);
      const trend = prev4 > 0
        ? ` | trend: ${((last4 - prev4) / prev4 * 100).toFixed(1)}% vs prior 4 weeks`
        : '';
      lines.push(`  ${repo}: ${fmt(last4)} commits (last 4 weeks)${trend}`);
      const tail = weeklyTail(weeks);
      if (tail) detail.push(`  ${repo}: ${tail}`);
    }
  }
  if (githubCommits.newRepos) {
    const r = githubCommits.newRepos;
    lines.push(`  New LLM repos on GitHub: ${fmt(r.last30d)} (30d) | ${fmt(r.last60d)} (60d) | ${fmt(r.last90d)} (90d)`);
  }
  if (!lines.length) return null;
  return {
    id:       'githubCommits',
    title:    'GitHub AI Repo Commit Velocity',
    about:    'Weekly commit counts for major open-source AI repos plus new LLM repo creation rates',
    source:   'GitHub API',
    entities: repos,
    text:     `### GitHub AI Repo Commit Velocity\n${lines.join('\n')}`,
    detail:   detail.length ? `Recent history — weekly commits, last 12 weeks (oldest → newest):\n${detail.join('\n')}` : null,
  };
}

function buildDocker() {
  const docker = cache.get('docker');
  if (!docker?.images) return null;
  const lines = Object.entries(docker.images)
    .sort(([, a], [, b]) => b.pulls - a.pulls)
    .map(([img, v]) => `  ${img}: ${fmt(v.pulls)} total pulls | ${fmt(v.stars)} stars`);
  return {
    id:       'docker',
    title:    'Docker Hub AI Image Pull Counts',
    about:    'Cumulative pull counts for PyTorch, NVIDIA CUDA, Ollama, vLLM, HF TGI Docker images',
    source:   'Docker Hub API',
    entities: Object.keys(docker.images),
    text:     `### Docker Hub AI Image Pull Counts\n${lines.join('\n')}`,
    detail:   snapshotDetail('docker', 'cumulative pull counts'),
  };
}

function buildHn() {
  const hn = cache.get('hn');
  if (!hn) return null;
  const lines = [];
  if (hn.weekly?.length) {
    const last = hn.weekly.at(-1);
    const prev = hn.weekly.at(-2);
    const trend = prev > 0
      ? ` | trend: ${((last - prev) / prev * 100).toFixed(1)}% vs prior week`
      : '';
    lines.push(`  Latest week: ${fmt(last)} AI stories on HN${trend}`);
    hn.weekly.slice(-4).forEach((n, i, arr) => {
      lines.push(`    Week -${arr.length - 1 - i}: ${fmt(n)}`);
    });
  }
  if (hn.perTerm) {
    const terms = Object.entries(hn.perTerm)
      .sort(([, a], [, b]) => b - a)
      .map(([t, n]) => `${t}: ${fmt(n)}`).join(' | ');
    lines.push(`  Per term (last 4 weeks): ${terms}`);
  }
  if (!lines.length) return null;
  const tail = weeklyTail(hn.weekly);
  return {
    id:       'hn',
    title:    'Hacker News AI Story Mentions',
    about:    'Weekly Hacker News AI story volume with per-term breakdown (ChatGPT, Claude, Gemini, LLM, AI agents)',
    source:   'HN Algolia API',
    entities: Object.keys(hn.perTerm ?? {}),
    text:     `### Hacker News AI Story Mentions\n${lines.join('\n')}`,
    detail:   tail ? `Recent history — AI stories per week, last 12 weeks (oldest → newest):\n  ${tail}` : null,
  };
}

function buildWikipedia() {
  const wikipedia = cache.get('wikipedia');
  if (!wikipedia?.articles) return null;
  const lines = Object.entries(wikipedia.articles).map(([article, weeks]) => {
    if (!Array.isArray(weeks) || weeks.length === 0) return `  ${article}: no data`;
    const last = weeks.at(-1);
    const prev = weeks.at(-2);
    const trend = prev > 0
      ? ` | trend: ${((last - prev) / prev * 100).toFixed(1)}% vs prior week`
      : '';
    return `  ${article}: ${fmt(last)} pageviews (latest week) | 12-week total: ${fmt(weeks.slice(-12).reduce((a, b) => a + b, 0))}${trend}`;
  });
  const detail = Object.entries(wikipedia.articles)
    .map(([article, weeks]) => { const t = weeklyTail(weeks); return t ? `  ${article}: ${t}` : null; })
    .filter(Boolean);
  return {
    id:       'wikipedia',
    title:    'Wikipedia AI Article Pageviews',
    about:    'Weekly pageviews for AI-related Wikipedia articles (ChatGPT, Artificial intelligence, LLM, Claude, Gemini)',
    source:   'Wikimedia pageviews API',
    entities: Object.keys(wikipedia.articles),
    text:     `### Wikipedia AI Article Pageviews (weekly)\n${lines.join('\n')}`,
    detail:   detail.length ? `Recent history — weekly pageviews, last 12 weeks (oldest → newest):\n${detail.join('\n')}` : null,
  };
}

function buildHuggingface() {
  const hf = cache.get('huggingface');
  if (!hf?.models?.length) return null;
  const lines = hf.models.slice(0, 15).map((m, i) =>
    `  #${i + 1} ${m.id} (${m.pipeline_tag}): ${fmt(m.downloads)} downloads | ${fmt(m.likes)} likes`
  );
  if (hf.newModels?.perDay) {
    lines.push(`  Model creation rate: ~${fmt(hf.newModels.perDay)} new models/day (~${fmt(hf.newModels.perWeekEst)}/week)`);
  }
  const famNames = Object.keys(hf.families ?? {});
  if (hf.families) {
    const fams = Object.entries(hf.families)
      .filter(([, v]) => v)
      .sort(([, a], [, b]) => b.downloads - a.downloads)
      .map(([name, v]) => `${name}: ${fmt(v.downloads)} downloads (top: ${v.top})`)
      .join(' | ');
    if (fams) lines.push(`  Downloads by model family (top 100 models each): ${fams}`);
  }
  return {
    id:       'huggingface',
    title:    'HuggingFace Open-Model Demand',
    about:    'Most-downloaded models, model creation rate, and downloads by family (Llama, Qwen, Gemma, DeepSeek, Mistral) on HuggingFace Hub',
    source:   'HuggingFace Hub API',
    entities: [...famNames, ...hf.models.slice(0, 5).map(m => m.id)],
    text:     `### HuggingFace Open-Model Demand\n${lines.join('\n')}`,
    detail:   snapshotDetail('huggingface', 'family downloads and model creation rate'),
  };
}

function buildMcp() {
  const mcp = cache.get('mcp');
  if (!mcp?.queries) return null;
  const lines = Object.entries(mcp.queries).map(([label, v]) =>
    `  "${label}" repos on GitHub: ${fmt(v.total)} total | ${fmt(v.new7d)} created last 7d | ${fmt(v.new30d)} created last 30d`
  );
  if (mcp.serversRepo) {
    lines.push(`  modelcontextprotocol/servers (official): ${fmt(mcp.serversRepo.stars)} stars | ${fmt(mcp.serversRepo.forks)} forks`);
  }
  return {
    id:       'mcp',
    title:    'MCP Ecosystem Growth',
    about:    'Model Context Protocol (MCP) ecosystem: GitHub repo counts and weekly/monthly creation rates — the agent-economy growth signal',
    source:   'GitHub search API',
    entities: Object.keys(mcp.queries),
    text:     `### MCP Ecosystem Growth (GitHub, as of ${mcp.asOf})\n${lines.join('\n')}`,
    detail:   snapshotDetail('mcp', 'repo counts'),
  };
}

function buildSec() {
  const sec = cache.get('sec');
  if (!sec?.terms) return null;
  const entries = Object.entries(sec.terms).filter(([, v]) => v);
  const lines = entries.map(([term, v]) => {
    const chg = v.prior90d > 0 ? ` | QoQ: ${((v.last90d - v.prior90d) / v.prior90d * 100).toFixed(1)}%` : '';
    return `  "${term}": ${fmt(v.last90d)} filings (last 90d) vs ${fmt(v.prior90d)} (prior 90d)${chg}${v.capped ? ' (count capped at 10K)' : ''}`;
  });
  return {
    id:       'sec',
    title:    'SEC Filing AI Mentions',
    about:    'How many 10-K/10-Q filings mention AI terms (artificial intelligence, LLM, generative AI, AI agent) — enterprise adoption signal from SEC EDGAR',
    source:   'SEC EDGAR full-text search',
    entities: entries.map(([term]) => term),
    text:     `### SEC Filing AI Mentions (10-K/10-Q, EDGAR full-text search)\n${lines.join('\n')}`,
    detail:   snapshotDetail('sec', 'filing counts'),
  };
}

function buildRedditCommunities() {
  const redditComm = cache.get('redditCommunities');
  if (!redditComm?.subs) return null;
  const entries = Object.entries(redditComm.subs).filter(([, v]) => v);
  const lines = entries
    .sort(([, a], [, b]) => (b.subscribers ?? 0) - (a.subscribers ?? 0))
    .map(([name, v]) =>
      `  r/${name}: ${fmt(v.subscribers)} subscribers${v.activeUsers != null ? ` | ${fmt(v.activeUsers)} active now` : ''}`
    );
  if (!lines.length) return null;
  return {
    id:       'redditCommunities',
    title:    'Reddit Community Size',
    about:    'Subscriber counts and active users for AI subreddits (r/ChatGPT, r/ClaudeAI, r/LocalLLaMA, r/singularity, r/OpenAI)',
    source:   'Reddit API',
    entities: entries.map(([name]) => `r/${name}`),
    text:     `### Reddit Community Size (as of ${redditComm.asOf})\n${lines.join('\n')}`,
    detail:   snapshotDetail('redditCommunities', 'subscriber counts'),
  };
}

// Options chains are cached per ticker (`options:<TICKER>:<date>`) only when
// someone opens the Options Flow tab, so this section appears dynamically.
function buildOptions() {
  const byTicker = new Map();
  for (const key of cache.keys()) {
    if (!key.startsWith('options:')) continue;
    const data = cache.get(key);
    if (!data?.ticker) continue;
    const prev = byTicker.get(data.ticker);
    if (!prev || (data.calls?.length ?? 0) > (prev.calls?.length ?? 0)) byTicker.set(data.ticker, data);
  }
  if (byTicker.size === 0) return null;

  const sum = (arr, f) => (arr ?? []).reduce((n, c) => n + (f(c) ?? 0), 0);
  const avg = (arr, f) => {
    const vals = (arr ?? []).map(f).filter(v => v != null);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  };
  const lines = [...byTicker.values()].map(d => {
    const callVol = sum(d.calls, c => c.volume);
    const putVol  = sum(d.puts,  c => c.volume);
    const pcRatio = callVol > 0 ? (putVol / callVol).toFixed(2) : 'N/A';
    const callOI  = sum(d.calls, c => c.openInterest);
    const putOI   = sum(d.puts,  c => c.openInterest);
    const topCall = (d.calls ?? []).reduce((best, c) => (c.openInterest ?? 0) > (best?.openInterest ?? -1) ? c : best, null);
    const ivCalls = avg(d.calls, c => c.impliedVolatility);
    const ivPuts  = avg(d.puts,  c => c.impliedVolatility);
    const chg     = d.changePct != null ? ` (${d.changePct >= 0 ? '+' : ''}${d.changePct.toFixed(2)}% today)` : '';
    return `  ${d.ticker}: spot $${d.price ?? 'N/A'}${chg} | expiry ${d.selectedDate ?? 'N/A'} | put/call volume ratio ${pcRatio} (calls ${fmt(callVol)} vs puts ${fmt(putVol)})` +
      ` | open interest: calls ${fmt(callOI)}${topCall?.strike != null ? ` (heaviest at $${topCall.strike} strike)` : ''} vs puts ${fmt(putOI)}` +
      `${ivCalls ? ` | avg IV: calls ${ivCalls}% / puts ${ivPuts ?? 'N/A'}%` : ''}`;
  });
  return {
    id:       'options',
    title:    'Stock Options Flow',
    about:    'Options-market sentiment for AI-related stock tickers recently viewed in the Options Flow tab: spot price, put/call volume ratio, open interest, implied volatility (near-dated expiries)',
    source:   'Yahoo Finance options chains',
    entities: [...byTicker.keys()],
    text:     `### Stock Options Flow (near-dated expiries)\n${lines.join('\n')}`,
    detail:   null,
  };
}

// ── Registry & coverage guard ───────────────────────────────────────────────
// `key` is the scheduler/cache key each builder reads, so freshness passports
// and the coverage check are automatic. Adding a scraper without adding a
// builder here triggers a startup warning instead of silently leaving the
// new source invisible to the Ask tab.

const REGISTRY = [
  { key: 'pypi',              build: buildPypi },
  { key: 'npm',               build: buildNpm },
  { key: 'stackoverflow',     build: buildStackOverflow },
  { key: 'github',            build: buildGitHub },
  { key: 'jobs',              build: buildJobs },
  { key: 'reddit',            build: buildReddit },
  { key: 'trends',            build: buildTrends },
  { key: 'gpu',               build: buildGpu },
  { key: 'dram',              build: buildDram },
  { key: 'openrouter',        build: buildOpenrouter },
  { key: 'openrouterRanks',   build: buildOpenrouterRanks },
  { key: 'eia',               build: buildElectricity },
  { key: 'mops',              build: buildMops },
  { key: 'githubCommits',     build: buildGithubCommits },
  { key: 'docker',            build: buildDocker },
  { key: 'hn',                build: buildHn },
  { key: 'wikipedia',         build: buildWikipedia },
  { key: 'huggingface',       build: buildHuggingface },
  { key: 'mcp',               build: buildMcp },
  { key: 'sec',               build: buildSec },
  { key: 'redditCommunities', build: buildRedditCommunities },
  { key: 'options',           build: buildOptions },
];

let coverageWarned = false;
function warnUncoveredScrapers() {
  if (coverageWarned) return;
  coverageWarned = true;
  // Lazy require: scheduler depends on cache/history only, so no cycle, but
  // keep it out of module load order anyway.
  const { scrapers } = require('./scheduler');
  const covered = new Set(REGISTRY.map(r => r.key));
  const missing = Object.keys(scrapers).filter(k => !covered.has(k));
  if (missing.length) {
    console.warn(`[chat] scrapers with no RAG section (invisible to the Ask tab): ${missing.join(', ')} — add a builder to REGISTRY in chat.js`);
  }
}

function buildSections() {
  warnUncoveredScrapers();
  const sections = [];
  for (const { key, build } of REGISTRY) {
    try {
      const s = build();
      if (!s) continue;
      s.updated = agoText(cache.meta(key)?.fetchedAt);
      sections.push(s);
    } catch (e) {
      console.warn(`[chat] section ${key} failed to build:`, e.message);
    }
  }
  return sections;
}

// ── Persona 1: The Detective ───────────────────────────────────────────────
// Gatekeeper: rewrites the user's question into a focused research intent and
// grades every data section for relevance, so the Wordsmith only ever sees
// vetted data. Grading is batched into one call (one round-trip instead of
// one per section) but the role is identical to a per-chunk YES/NO grader.

const DETECTIVE_PROMPT = `You are 'The Detective', the research gatekeeper for an AI industry signals dashboard.
You receive a user question and a catalog of available data sections (id, title, covers, description, sample).
Your three jobs:
1. Rewrite the user's question into a single precise research intent (what data is actually needed).
2. Grade each section: is it relevant to answering this question?
3. Flag which approved sections need their HISTORICAL time series, not just the latest summary.

Grading rules:
- Approve a section ONLY if its data would directly contribute to the answer.
- Broad questions ("all signals for X", "everything about Y", "compare A vs B") justify approving many sections.
- Narrow questions ("which GPU is cheapest?") should approve very few — usually one or two.
- Never approve a section just because it mentions AI; it must serve THIS question.
- Match against the "covers" list: it names the exact packages/companies/tickers in each section.
- Treat companies and their products as the same entity: OpenAI ↔ ChatGPT/GPT/openai SDK,
  Anthropic ↔ Claude/anthropic SDK, Google ↔ Gemini/google-generativeai, Mistral ↔ mistralai.
  A question about a company is served by data about its products, and vice versa.

History rules:
- Put a section id in "expand" (must also be in "relevant") when the question asks about trends,
  growth, momentum, change over time, or "how is X trending".
- Point-in-time questions ("which is cheapest right now?") need no expansion.

Respond with ONLY a JSON object, no other text. Order "relevant" from most to least important:
{"intent": "<one-sentence research intent>", "relevant": ["<section id>", ...], "expand": ["<section id>", ...]}`;

function catalogEntry(s) {
  const sample = s.text.split('\n').slice(1, 3).map(l => l.trim()).join(' / ');
  return `- id: ${s.id}\n  title: ${s.title}\n  covers: ${s.entities?.slice(0, 14).join(', ') || 'n/a'}\n  description: ${s.about}\n  sample: ${sample}`;
}

async function runDetective(userQuery, sections) {
  const catalog = sections.map(catalogEntry).join('\n');

  const raw = await callModel({
    system:      DETECTIVE_PROMPT,
    user:        `User Question: ${userQuery}\n\nAvailable Data Sections:\n${catalog}`,
    model:       DETECTIVE_MODEL,
    temperature: 0,
    maxTokens:   512,
    json:        true,
  });

  const parsed   = JSON.parse(raw);
  const validIds = new Set(sections.map(s => s.id));
  const relevant = Array.isArray(parsed.relevant)
    ? [...new Set(parsed.relevant.filter(id => validIds.has(id)))]
    : [];
  const expand = Array.isArray(parsed.expand)
    ? parsed.expand.filter(id => relevant.includes(id))
    : [];

  return {
    intent: typeof parsed.intent === 'string' ? parsed.intent : userQuery,
    relevant,
    expand,
  };
}

// ── Persona 1b: second retrieval hop (chain-of-retrieval) ──────────────────
// A narrow first pass can miss the complement the answer needs — the other
// half of a comparison, usage data for a pricing question, product data for
// a company question. After seeing what was retrieved, the Detective gets
// one cheap chance to pull in what's missing.

const HOP_PROMPT = `You are 'The Detective' performing a second retrieval pass for an AI industry signals dashboard.
A first pass already retrieved data sections for the research intent below. Decide whether any of the
REMAINING sections are also required to fully answer it — e.g. the other side of a comparison, a
complementary signal (price ↔ usage, demand ↔ supply, hardware ↔ electricity cost), or product data
that answers a company question.
Be conservative: add a section only when the answer would be incomplete without it. Usually nothing is needed.

Respond with ONLY a JSON object, no other text:
{"add": ["<section id>", ...]}`;

async function runDetectiveHop(intent, vetted, remaining) {
  const retrieved = vetted
    .map(s => `- ${s.id}: ${s.title} (${s.text.split('\n')[1]?.trim() ?? ''})`)
    .join('\n');
  const catalog = remaining.map(catalogEntry).join('\n');

  const raw = await callModel({
    system:      HOP_PROMPT,
    user:        `Research Intent: ${intent}\n\nAlready Retrieved:\n${retrieved}\n\nRemaining Sections:\n${catalog}`,
    model:       DETECTIVE_MODEL,
    temperature: 0,
    maxTokens:   256,
    json:        true,
  });

  const parsed   = JSON.parse(raw);
  const validIds = new Set(remaining.map(s => s.id));
  return Array.isArray(parsed.add) ? [...new Set(parsed.add.filter(id => validIds.has(id)))] : [];
}

// Lexical safety net for history expansion when the Detective under-flags
const TREND_RX = /\b(trend(s|ing)?|history|historical|over time|momentum|trajector\w*|grow(th|ing|n)?|grew|chang(e|ed|ing)|accelerat\w*|declin\w*|since|last (few )?(week|month|quarter|year)s?|past (week|month|quarter|year))\b/i;

// ── Context assembly & compression ──────────────────────────────────────────
// Each vetted section is rendered with a passport header (provenance,
// freshness, coverage) plus its optional history block, then squeezed under
// CONTEXT_CHAR_BUDGET in relevance order: history blocks go first, then long
// section bodies are truncated, then whole low-relevance sections dropped.

function assembleContext(vetted, expandIds) {
  const entries = vetted.map(s => ({
    id:     s.id,
    head:   `[section: ${s.id}]\n[meta] source: ${s.source}${s.updated ? ` | updated: ${s.updated}` : ''} | covers: ${s.entities?.slice(0, 14).join(', ') || 'n/a'}`,
    body:   s.text,
    detail: expandIds.has(s.id) && s.detail ? s.detail : null,
  }));
  const render = e => [e.head, e.body, e.detail].filter(Boolean).join('\n');
  const size   = () => entries.reduce((n, e) => n + render(e).length + 2, 0);

  // Stage 1: shed history expansions, least-relevant section first
  for (let i = entries.length - 1; i >= 0 && size() > CONTEXT_CHAR_BUDGET; i--) {
    entries[i].detail = null;
  }
  // Stage 2: truncate long bodies, least-relevant first
  const MAX_ROWS = 15;
  for (let i = entries.length - 1; i >= 0 && size() > CONTEXT_CHAR_BUDGET; i--) {
    const lines = entries[i].body.split('\n');
    if (lines.length > MAX_ROWS + 1) {
      entries[i].body = [...lines.slice(0, MAX_ROWS), `  …(${lines.length - MAX_ROWS} more rows omitted)`].join('\n');
    }
  }
  // Stage 3: drop whole sections from the bottom, but never the most relevant
  while (entries.length > 1 && size() > CONTEXT_CHAR_BUDGET) entries.pop();

  return {
    context: entries.map(render).join('\n\n'),
    kept:    entries.map(e => e.id),
  };
}

// ── Persona 2: The Wordsmith ───────────────────────────────────────────────
// Writer: never sees the raw catalog, only the Detective-vetted sections.

const WORDSMITH_PROMPT = `You are 'The Wordsmith', a research writer for an AI industry signals dashboard.
You receive a DATA CONTEXT containing ONLY the data sections a research gatekeeper has already
vetted as relevant to the user's question. Every section you receive matters — use them all.

## Reading the DATA CONTEXT
- Each section starts with [section: <id>] and a [meta] line stating its source, freshness, and
  coverage. Use [meta] for provenance and recency only — never cite it as a data point.
- Some sections include a "Recent history" block with time series (oldest → newest). For any
  question about trends, growth, or change over time, ground your answer in those actual series
  values, not just the latest snapshot.
- When data carries an as-of date or freshness, anchor claims to it ("as of <date>", "as of the
  latest weekly data") rather than implying real-time figures.

## Output format

For broad queries ("all signals for X", "everything about Y", "compare A vs B"):
  Structure your response as one section per signal in the DATA CONTEXT.
  Use this exact format for each section:

  **[Signal Name]**
  [entity]: [value] | [value2] | [trend if available]

  Example:
  **PyPI Downloads**
  openai SDK: 45.2M total (52w) | last week: 1.1M | +6.3% vs prior 4w

  **Job Postings**
  OpenAI: 486 total roles | 312 engineering

  **Reddit Mentions**
  ChatGPT: 45,200 posts this week

For simple single-fact questions ("Which GPU is cheapest?", "What is the price of X?"):
  Answer in one or two direct sentences with the exact figure. No section headers needed.

## Rules
- ONLY use numbers present in the DATA CONTEXT. Never invent or estimate.
- Cite exact figures (e.g. "30,954 stars", "$2.18/hr").
- Treat companies and their products as the same entity: OpenAI ↔ ChatGPT/GPT,
  Anthropic ↔ Claude, Google ↔ Gemini, Mistral ↔ mistralai. Data about a product
  answers questions about its company, and vice versa — say so explicitly.
- If a section notes "(N more rows omitted)", the context was compressed; answer from the rows
  shown and do not speculate about omitted ones.
- If the DATA CONTEXT does not contain what the question asks for, truthfully say the
  dashboard has no data for it — do not improvise.

## Citing sections
End your response with a JSON block on its own line listing the ids of the sections
whose numbers you ACTUALLY cited in your answer — no more, no less. If you cited
nothing (e.g. the data could not answer the question), use an empty list.
{"sections_used": ["pypi", "reddit"]}`;

async function runWordsmith(userQuery, intent, context) {
  return callModel({
    system:      WORDSMITH_PROMPT,
    user:        `DATA CONTEXT:\n\n${context}\n\n---\nRESEARCH INTENT: ${intent}\nQUESTION: ${userQuery}`,
    temperature: 0.1,
    // Groq counts max_tokens toward the daily-quota estimate of every request,
    // so keep this at what answers actually need rather than a generous cap
    maxTokens:   1024,
  });
}

// ── Agentic RAG pipeline: Detective → hop → expand → compress → Wordsmith ──

// Section id → frontend chart id (see CHART_REGISTRY / SOURCE_META in the UI)
const SECTION_TO_CHART = {
  pypi:           'pypi',
  npm:            'pypi',
  stackoverflow:  'pypi',
  huggingface:    'hf',
  openrouterRanks: 'openrouter-rankings',
  github:        'github',
  jobs:          'trends',
  trends:        'trends',
  reddit:        'reddit',
  gpu:           'gpu',
  dram:          'dram',
  openrouter:    'openrouter',
  electricity:   'electricity',
  mops:          'ai-supply',
  githubCommits: 'github-commits',
  docker:        'docker',
  hn:            'community',
  wikipedia:     'community',
  mcp:               'mcp',
  sec:               'sec',
  redditCommunities: 'reddit',
  options:           'options',
};

async function chat(message) {
  const sections = buildSections();

  if (sections.length === 0) {
    return {
      text:    'No data loaded yet — click "Refresh Data" in the top navbar, then ask again.',
      sources: [],
      meta:    { intent: message, approved: 0, total: 0 },
    };
  }

  // 1. The Detective rewrites the query and grades every section
  let intent    = message;
  let vetted    = sections;
  let expandIds = new Set();
  let detected  = false;
  let hopAdded  = [];
  try {
    const verdict = await runDetective(message, sections);
    intent = verdict.intent;
    console.log(`[chat] detective intent: "${intent}" | approved ${verdict.relevant.length}/${sections.length} sections: ${verdict.relevant.join(', ') || '(none)'} | expand: ${verdict.expand.join(', ') || '(none)'}`);

    // Nothing relevant in the entire catalog — skip the Wordsmith entirely
    if (verdict.relevant.length === 0) {
      return {
        text:    `I checked all ${sections.length} live data sources, but none of them contain information relevant to that question. Try asking about AI SDK downloads, GPU prices, job postings, supply chain revenue, or community signals.`,
        sources: [],
        meta:    { intent, approved: 0, total: sections.length, sections: [] },
      };
    }

    // Preserve the Detective's most→least relevant ordering: the compressor
    // sheds context from the tail, so order is the relevance score
    const byId = new Map(sections.map(s => [s.id, s]));
    vetted    = verdict.relevant.map(id => byId.get(id)).filter(Boolean);
    expandIds = new Set(verdict.expand);
    detected  = true;

    // 2. Chain-of-retrieval hop: only narrow retrievals risk missing their
    // complement, so skip when the first pass was already broad
    if (vetted.length <= 4 && vetted.length < sections.length) {
      try {
        const remaining = sections.filter(s => !verdict.relevant.includes(s.id));
        // Cap additions: the hop fills a gap, it must not re-broaden retrieval
        hopAdded = (await runDetectiveHop(intent, vetted, remaining)).slice(0, 2);
        if (hopAdded.length) {
          console.log(`[chat] second hop added: ${hopAdded.join(', ')}`);
          vetted = [...vetted, ...hopAdded.map(id => byId.get(id))];
        }
      } catch (e) {
        // The hop is best-effort — a failure (including 429) must never block
        console.warn('[chat] second hop skipped:', e.message);
      }
    }
  } catch (e) {
    // Out of quota: don't fall through — the full-context Wordsmith call
    // would be the most expensive request possible against a drained budget
    const limited = rateLimitMessage(e);
    if (limited) {
      return { text: limited, sources: [], meta: { intent, approved: 0, total: sections.length, sections: [] } };
    }
    // Any other Detective failure must never block an answer — fall back to full context
    console.error('[chat] detective failed, using all sections:', e.message);
  }

  // 3. History expansion: Detective flags plus a lexical safety net
  if (TREND_RX.test(message)) for (const s of vetted) expandIds.add(s.id);

  // 4. Compress to budget (passports + summaries + history, relevance-ordered)
  const { context, kept } = assembleContext(vetted, expandIds);
  if (kept.length < vetted.length) {
    console.log(`[chat] context compressed: kept ${kept.length}/${vetted.length} sections under ${CONTEXT_CHAR_BUDGET} chars`);
  }

  // 5. The Wordsmith writes the answer from vetted data only
  let raw;
  try {
    raw = await runWordsmith(message, intent, context);
  } catch (e) {
    const limited = rateLimitMessage(e);
    if (!limited) throw e;
    return { text: limited, sources: [], meta: { intent, approved: vetted.length, total: sections.length, sections: [] } };
  }

  // Extract trailing {"sections_used": [...]} block — the sections whose
  // figures actually appear in the answer. Charts must mirror the text, so
  // they derive from this, not from the Detective's (broader) approvals.
  const jsonMatch = raw.match(/\{[^{}]*"sections_used"[^{}]*\}/s);
  let text = raw;
  let used = null;
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]).sections_used;
      if (Array.isArray(parsed)) {
        const keptIds = new Set(kept);
        used = parsed.filter(id => keptIds.has(id));
      }
    } catch {}
    text = raw.slice(0, jsonMatch.index).trimEnd();
  }

  // Fallback when the Wordsmith's self-report is missing/corrupt: the
  // Detective's approvals are the next-best signal (skip on full-context fallback)
  if (used === null) {
    used = detected ? kept : [];
  }
  const sources = [...new Set(used.map(id => SECTION_TO_CHART[id]).filter(Boolean))];

  return {
    text,
    sources,
    meta: {
      intent,
      approved: vetted.length,
      total:    sections.length,
      sections: used,
      expanded: kept.filter(id => expandIds.has(id)),
      hop:      hopAdded,
    },
  };
}

module.exports = { chat, buildSections, invalidateEmbeddings: () => {} };
