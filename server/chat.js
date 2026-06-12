'use strict';
const Groq  = require('groq-sdk');
const cache = require('./cache');

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Groq enforces daily token quotas PER MODEL, so running the Detective on a
// smaller model doubles the effective free-tier budget and keeps the 70B
// quota for the answers users actually read. The grading/rewrite task is
// well within an 8B model's ability. Set GROQ_DETECTIVE_MODEL=<MODEL> to
// run both personas on the same model again.
const DETECTIVE_MODEL = process.env.GROQ_DETECTIVE_MODEL || 'llama-3.1-8b-instant';

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

// ── Serialize cached data sources into discrete, gradeable sections ────────

function buildSections() {
  const sections = [];

  // 1. PyPI weekly download history
  const pypi = cache.get('pypi');
  if (pypi) {
    const lines = Object.entries(pypi).map(([pkg, weeks]) => {
      if (!Array.isArray(weeks) || weeks.length < 4) return `  ${pkg}: insufficient data`;
      const total = weeks.reduce((a, b) => a + b, 0);
      const last4 = weeks.slice(-4).reduce((a, b) => a + b, 0);
      const prev4 = weeks.slice(-8, -4).reduce((a, b) => a + b, 0);
      const chg   = prev4 > 0 ? ` | trend: ${((last4 - prev4) / prev4 * 100).toFixed(1)}% vs prior 4 weeks` : '';
      return `  ${pkg}: ${fmt(total)} total (52 weeks) | last week: ${fmt(weeks.at(-1))} | last 4 weeks: ${fmt(last4)}${chg}`;
    });
    sections.push({
      id:    'pypi',
      title: 'PyPI Weekly Downloads',
      about: 'Weekly download counts for AI SDK packages (openai, anthropic, google-generativeai, mistralai)',
      text:  `### PyPI Weekly Downloads\n${lines.join('\n')}`,
    });
  }

  // 1b. npm weekly download history
  const npm = cache.get('npm');
  if (npm) {
    const lines = Object.entries(npm).map(([pkg, weeks]) => {
      if (!Array.isArray(weeks) || weeks.length < 4) return `  ${pkg}: insufficient data`;
      const total = weeks.reduce((a, b) => a + b, 0);
      const last4 = weeks.slice(-4).reduce((a, b) => a + b, 0);
      const prev4 = weeks.slice(-8, -4).reduce((a, b) => a + b, 0);
      const chg   = prev4 > 0 ? ` | trend: ${((last4 - prev4) / prev4 * 100).toFixed(1)}% vs prior 4 weeks` : '';
      return `  ${pkg}: ${fmt(total)} total (52 weeks) | last week: ${fmt(weeks.at(-1))} | last 4 weeks: ${fmt(last4)}${chg}`;
    });
    sections.push({
      id:    'npm',
      title: 'npm Weekly Downloads',
      about: 'Weekly npm download counts for AI JavaScript/TypeScript SDKs (openai, @anthropic-ai/sdk, langchain, ai, llamaindex, etc.)',
      text:  `### npm Weekly Downloads\n${lines.join('\n')}`,
    });
  }

  // 1c. Stack Overflow tag activity
  const so = cache.get('stackoverflow');
  if (so && (Object.keys(so.totals ?? {}).length || Object.keys(so.weekly ?? {}).length)) {
    const tags  = new Set([...Object.keys(so.totals ?? {}), ...Object.keys(so.weekly ?? {})]);
    const lines = [...tags].map(tag => {
      const total  = so.totals?.[tag];
      const weekly = so.weekly?.[tag];
      return `  ${tag}: ${total != null ? `${fmt(total)} questions all-time` : 'total N/A'}${weekly != null ? ` | ${fmt(weekly)} new this week` : ''}`;
    });
    sections.push({
      id:    'stackoverflow',
      title: 'Stack Overflow Tag Activity',
      about: 'All-time and weekly question counts for AI developer tags (openai-api, anthropic-claude, google-gemini-api, langchain, mistral-ai)',
      text:  `### Stack Overflow Tag Activity\n${lines.join('\n')}`,
    });
  }

  // 2. GitHub SDK stats
  const github = cache.get('github');
  if (github) {
    const lines = Object.entries(github).map(([repo, v]) =>
      `  ${repo}: ${fmt(v?.stars)} stars | ${fmt(v?.dependents)} dependent repos`
    );
    sections.push({
      id:    'github',
      title: 'GitHub SDK Statistics',
      about: 'Stars and dependent-repo counts for major AI SDK repositories',
      text:  `### GitHub SDK Statistics\n${lines.join('\n')}`,
    });
  }

  // 3. Job openings
  const jobs = cache.get('jobs');
  if (jobs) {
    const lines = Object.entries(jobs)
      .filter(([, v]) => v != null)
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([co, v]) => `  ${co}: ${v.total} open roles total | ${v.engineering} engineering`);
    sections.push({
      id:    'jobs',
      title: 'Open Job Postings (Greenhouse)',
      about: 'Open role counts at AI companies (Anthropic, OpenAI, Google DeepMind, Mistral, Cohere, Perplexity)',
      text:  `### Open Job Postings (Greenhouse)\n${lines.join('\n')}`,
    });
  }

  // 4. Reddit weekly mentions
  const reddit = cache.get('reddit');
  if (reddit) {
    const lines = Object.entries(reddit)
      .filter(([, v]) => v != null)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => `  ${name}: ${fmt(count)} posts this week`);
    sections.push({
      id:    'reddit',
      title: 'Reddit Weekly Mentions',
      about: 'Weekly Reddit post counts mentioning ChatGPT, Claude, Gemini, Mistral',
      text:  `### Reddit Weekly Mentions\n${lines.join('\n')}`,
    });
  }

  // 6. Google Trends
  const trends = cache.get('trends');
  if (trends) {
    const parts = [];
    if (trends.api) {
      const vals = Object.entries(trends.api)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.at(-1) : v}/100`)
        .join(' | ');
      parts.push(`  API keywords: ${vals}`);
    }
    if (trends.brand) {
      const vals = Object.entries(trends.brand)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.at(-1) : v}/100`)
        .join(' | ');
      parts.push(`  Brand keywords: ${vals}`);
    }
    if (parts.length) {
      sections.push({
        id:    'trends',
        title: 'Google Trends',
        about: 'Relative Google search interest (0–100) for AI brand and API keywords',
        text:  `### Google Trends (relative interest 0–100, last 84 days)\n${parts.join('\n')}`,
      });
    }
  }

  // 7. GPU spot prices
  const gpu = cache.get('gpu');
  const gpuPrices = gpu?.prices ?? gpu;
  if (gpuPrices && Object.keys(gpuPrices).length > 0) {
    const lines = Object.entries(gpuPrices)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `  ${k.replace(/_/g, ' ')}: $${v}/hr`);
    if (gpu?.history?.index?.length) {
      lines.push(`  Mainstream GPU index (avg across tracked GPUs): $${gpu.history.index.at(-1)}/hr`);
    }
    sections.push({
      id:    'gpu',
      title: 'GPU Spot Prices',
      about: 'Spot rental prices on vast.ai for H100, H200, A100, RTX 4090 ($/hr)',
      text:  `### GPU Spot Prices (vast.ai, median $/hr)\n${lines.join('\n')}`,
    });
  }

  // 7b. DRAM memory spot prices
  const dram = cache.get('dram');
  if (dram?.models?.length) {
    const lines = dram.models.map(m =>
      `  ${m.model} (${m.category}): $${m.price} avg | session change ${m.changePct >= 0 ? '+' : ''}${m.changePct}% | ${m.variants} variant(s)`
    );
    if (dram.index?.values?.length) {
      lines.push(`  ${dram.index.name} (TrendForce monthly index): $${dram.index.values.at(-1)} as of ${dram.index.dates.at(-1)}`);
    }
    sections.push({
      id:    'dram',
      title: 'DRAM Memory Spot Prices',
      about: 'DRAM/memory chip spot prices from TrendForce (DDR4, DDR5, HBM-adjacent)',
      text:  `### DRAM Memory Spot Prices (TrendForce, session average × (1 + session change), averaged per model, as of ${dram.asOf})\n${lines.join('\n')}`,
    });
  }

  // 8. OpenRouter model pricing — majors only; the full catalog spans dozens
  // of providers and would dominate the LLM context for any pricing question
  const MAJOR_PROVIDERS = new Set([
    'openai', 'anthropic', 'google', 'meta-llama', 'mistralai', 'deepseek',
    'qwen', 'x-ai', 'minimax', 'thudm', 'z-ai', 'moonshotai', 'cohere',
    'amazon', 'perplexity',
  ]);
  const openrouter = cache.get('openrouter');
  if (openrouter?.models) {
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
    sections.push({
      id:    'openrouter',
      title: 'OpenRouter AI Model Catalog & Pricing',
      about: 'API pricing and context windows for hosted AI models across providers',
      text:  `### OpenRouter AI Model Catalog & Pricing\n${lines.join('\n')}`,
    });
  }

  // 8b. OpenRouter usage rankings (token throughput by model & provider)
  const orRanks = cache.get('openrouterRanks');
  if (orRanks?.topModels?.length) {
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
    sections.push({
      id:    'openrouterRanks',
      title: 'OpenRouter Usage Rankings',
      about: 'Real LLM usage market share: weekly token throughput by model and provider on OpenRouter (which models/providers are actually used most)',
      text:  `### OpenRouter Usage Rankings (weekly token throughput)\n${lines.join('\n')}`,
    });
  }

  // 9. EIA electricity rates
  const eia = cache.get('eia');
  if (eia?.rates) {
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
    sections.push({
      id:    'electricity',
      title: 'US Electricity Rates',
      about: 'US residential electricity rates by state from EIA (¢/kWh)',
      text:  `### US Electricity Rates (¢/kWh, EIA, residential)\n${[usLine, ...stateLines].filter(Boolean).join('\n')}`,
    });
  }

  // 10. Taiwan supply chain revenue (MOPS)
  const mops = cache.get('mops');
  if (mops?.companies) {
    const lines = Object.values(mops.companies).map(c => {
      const latest = c.monthly?.at(-1);
      if (!latest) return `  ${c.name} (${c.ticker}, ${c.group}): no data`;
      return `  ${c.name} (${c.ticker}, ${c.group}): NT$${latest.revenue}M in ${latest.period} | YoY: ${latest.yoy ?? 'N/A'}% | MoM: ${latest.mom ?? 'N/A'}%`;
    });
    sections.push({
      id:    'mops',
      title: 'Taiwan AI Supply Chain Revenue',
      about: 'Monthly revenue for Taiwanese optics and PCB AI supply chain companies (MOPS filings)',
      text:  `### Taiwan AI Supply Chain Revenue (NT$M/month, MOPS)\n${lines.join('\n')}`,
    });
  }

  // 12. GitHub AI repo commit velocity
  const githubCommits = cache.get('githubCommits');
  if (githubCommits) {
    const lines = [];
    if (githubCommits.commits) {
      for (const [repo, weeks] of Object.entries(githubCommits.commits)) {
        if (!Array.isArray(weeks) || weeks.length < 4) continue;
        const last4 = weeks.slice(-4).reduce((a, b) => a + b, 0);
        const prev4 = weeks.slice(-8, -4).reduce((a, b) => a + b, 0);
        const trend = prev4 > 0
          ? ` | trend: ${((last4 - prev4) / prev4 * 100).toFixed(1)}% vs prior 4 weeks`
          : '';
        lines.push(`  ${repo}: ${fmt(last4)} commits (last 4 weeks)${trend}`);
      }
    }
    if (githubCommits.newRepos) {
      const r = githubCommits.newRepos;
      lines.push(`  New LLM repos on GitHub: ${fmt(r.last30d)} (30d) | ${fmt(r.last60d)} (60d) | ${fmt(r.last90d)} (90d)`);
    }
    if (lines.length) {
      sections.push({
        id:    'githubCommits',
        title: 'GitHub AI Repo Commit Velocity',
        about: 'Weekly commit counts for major open-source AI repos plus new LLM repo creation rates',
        text:  `### GitHub AI Repo Commit Velocity\n${lines.join('\n')}`,
      });
    }
  }

  // 13. Docker Hub AI image pulls
  const docker = cache.get('docker');
  if (docker?.images) {
    const lines = Object.entries(docker.images)
      .sort(([, a], [, b]) => b.pulls - a.pulls)
      .map(([img, v]) => `  ${img}: ${fmt(v.pulls)} total pulls | ${fmt(v.stars)} stars`);
    sections.push({
      id:    'docker',
      title: 'Docker Hub AI Image Pull Counts',
      about: 'Cumulative pull counts for PyTorch, NVIDIA CUDA, Ollama, vLLM, HF TGI Docker images',
      text:  `### Docker Hub AI Image Pull Counts\n${lines.join('\n')}`,
    });
  }

  // 14. Hacker News AI story volume
  const hn = cache.get('hn');
  if (hn) {
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
    if (lines.length) {
      sections.push({
        id:    'hn',
        title: 'Hacker News AI Story Mentions',
        about: 'Weekly Hacker News AI story volume with per-term breakdown (ChatGPT, Claude, Gemini, LLM, AI agents)',
        text:  `### Hacker News AI Story Mentions\n${lines.join('\n')}`,
      });
    }
  }

  // 15. Wikipedia AI article pageviews
  const wikipedia = cache.get('wikipedia');
  if (wikipedia?.articles) {
    const lines = Object.entries(wikipedia.articles).map(([article, weeks]) => {
      if (!Array.isArray(weeks) || weeks.length === 0) return `  ${article}: no data`;
      const last = weeks.at(-1);
      const prev = weeks.at(-2);
      const trend = prev > 0
        ? ` | trend: ${((last - prev) / prev * 100).toFixed(1)}% vs prior week`
        : '';
      return `  ${article}: ${fmt(last)} pageviews (latest week) | 12-week total: ${fmt(weeks.slice(-12).reduce((a, b) => a + b, 0))}${trend}`;
    });
    sections.push({
      id:    'wikipedia',
      title: 'Wikipedia AI Article Pageviews',
      about: 'Weekly pageviews for AI-related Wikipedia articles (ChatGPT, Artificial intelligence, LLM, Claude, Gemini)',
      text:  `### Wikipedia AI Article Pageviews (weekly)\n${lines.join('\n')}`,
    });
  }

  // 16. HuggingFace top models by downloads
  const hf = cache.get('huggingface');
  if (hf?.models?.length) {
    const lines = hf.models.slice(0, 15).map((m, i) =>
      `  #${i + 1} ${m.id} (${m.pipeline_tag}): ${fmt(m.downloads)} downloads`
    );
    sections.push({
      id:    'huggingface',
      title: 'HuggingFace Top Models',
      about: 'Most-downloaded models on HuggingFace Hub (open-source model adoption)',
      text:  `### HuggingFace Top Models (by all-time downloads)\n${lines.join('\n')}`,
    });
  }

  return sections;
}

// ── Persona 1: The Detective ───────────────────────────────────────────────
// Gatekeeper: rewrites the user's question into a focused research intent and
// grades every data section for relevance, so the Wordsmith only ever sees
// vetted data. Grading is batched into one call (one round-trip instead of
// one per section) but the role is identical to a per-chunk YES/NO grader.

const DETECTIVE_PROMPT = `You are 'The Detective', the research gatekeeper for an AI industry signals dashboard.
You receive a user question and a catalog of available data sections (id, title, description, sample).
Your two jobs:
1. Rewrite the user's question into a single precise research intent (what data is actually needed).
2. Grade each section: is it relevant to answering this question?

Grading rules:
- Approve a section ONLY if its data would directly contribute to the answer.
- Broad questions ("all signals for X", "everything about Y", "compare A vs B") justify approving many sections.
- Narrow questions ("which GPU is cheapest?") should approve very few — usually one or two.
- Never approve a section just because it mentions AI; it must serve THIS question.
- Treat companies and their products as the same entity: OpenAI ↔ ChatGPT/GPT/openai SDK,
  Anthropic ↔ Claude/anthropic SDK, Google ↔ Gemini/google-generativeai, Mistral ↔ mistralai.
  A question about a company is served by data about its products, and vice versa.

Respond with ONLY a JSON object, no other text:
{"intent": "<one-sentence research intent>", "relevant": ["<section id>", ...]}`;

async function runDetective(userQuery, sections) {
  const catalog = sections.map(s => {
    const sample = s.text.split('\n').slice(1, 3).map(l => l.trim()).join(' / ');
    return `- id: ${s.id}\n  title: ${s.title}\n  description: ${s.about}\n  sample: ${sample}`;
  }).join('\n');

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
    ? parsed.relevant.filter(id => validIds.has(id))
    : [];

  return {
    intent:   typeof parsed.intent === 'string' ? parsed.intent : userQuery,
    relevant,
  };
}

// ── Persona 2: The Wordsmith ───────────────────────────────────────────────
// Writer: never sees the raw catalog, only the Detective-vetted sections.

const WORDSMITH_PROMPT = `You are 'The Wordsmith', a research writer for an AI industry signals dashboard.
You receive a DATA CONTEXT containing ONLY the data sections a research gatekeeper has already
vetted as relevant to the user's question. Every section you receive matters — use them all.

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
- If the DATA CONTEXT does not contain what the question asks for, truthfully say the
  dashboard has no data for it — do not improvise.

## Citing sections
Every data section in the DATA CONTEXT starts with a line like [section: pypi].
End your response with a JSON block on its own line listing the ids of the sections
whose numbers you ACTUALLY cited in your answer — no more, no less. If you cited
nothing (e.g. the data could not answer the question), use an empty list.
{"sections_used": ["pypi", "reddit"]}`;

async function runWordsmith(userQuery, intent, vettedSections) {
  const context = vettedSections.map(s => `[section: ${s.id}]\n${s.text}`).join('\n\n');
  return callModel({
    system:      WORDSMITH_PROMPT,
    user:        `DATA CONTEXT:\n\n${context}\n\n---\nRESEARCH INTENT: ${intent}\nQUESTION: ${userQuery}`,
    temperature: 0.1,
    // Groq counts max_tokens toward the daily-quota estimate of every request,
    // so keep this at what answers actually need rather than a generous cap
    maxTokens:   1024,
  });
}

// ── Agentic RAG pipeline: Detective → vetting → Wordsmith ──────────────────

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

  // 1+2. The Detective rewrites the query and grades every section
  let intent   = message;
  let vetted   = sections;
  let detected = false;
  try {
    const verdict = await runDetective(message, sections);
    intent = verdict.intent;
    console.log(`[chat] detective intent: "${intent}" | approved ${verdict.relevant.length}/${sections.length} sections: ${verdict.relevant.join(', ') || '(none)'}`);

    // Nothing relevant in the entire catalog — skip the Wordsmith entirely
    if (verdict.relevant.length === 0) {
      return {
        text:    `I checked all ${sections.length} live data sources, but none of them contain information relevant to that question. Try asking about AI SDK downloads, GPU prices, job postings, supply chain revenue, or community signals.`,
        sources: [],
        meta:    { intent, approved: 0, total: sections.length, sections: [] },
      };
    }

    vetted   = sections.filter(s => verdict.relevant.includes(s.id));
    detected = true;
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

  // 3. The Wordsmith writes the answer from vetted data only
  let raw;
  try {
    raw = await runWordsmith(message, intent, vetted);
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
        const vettedIds = new Set(vetted.map(s => s.id));
        used = parsed.filter(id => vettedIds.has(id));
      }
    } catch {}
    text = raw.slice(0, jsonMatch.index).trimEnd();
  }

  // Fallback when the Wordsmith's self-report is missing/corrupt: the
  // Detective's approvals are the next-best signal (skip on full-context fallback)
  if (used === null) {
    used = detected ? vetted.map(s => s.id) : [];
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
    },
  };
}

module.exports = { chat, buildSections, invalidateEmbeddings: () => {} };
