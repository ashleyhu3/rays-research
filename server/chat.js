'use strict';
const Groq  = require('groq-sdk');
const cache = require('./cache');

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function makeGroq() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function fmt(n) {
  if (n == null || isNaN(n)) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Serialize ALL cached data sources into one text context ────────────────

function buildContext() {
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
    sections.push(`### PyPI Weekly Downloads\n${lines.join('\n')}`);
  }

  // 2. GitHub SDK stats
  const github = cache.get('github');
  if (github) {
    const lines = Object.entries(github).map(([repo, v]) =>
      `  ${repo}: ${fmt(v?.stars)} stars | ${fmt(v?.dependents)} dependent repos`
    );
    sections.push(`### GitHub SDK Statistics\n${lines.join('\n')}`);
  }

  // 3. Job openings
  const jobs = cache.get('jobs');
  if (jobs) {
    const lines = Object.entries(jobs)
      .filter(([, v]) => v != null)
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([co, v]) => `  ${co}: ${v.total} open roles total | ${v.engineering} engineering`);
    sections.push(`### Open Job Postings (Greenhouse)\n${lines.join('\n')}`);
  }

  // 4. Reddit weekly mentions
  const reddit = cache.get('reddit');
  if (reddit) {
    const lines = Object.entries(reddit)
      .filter(([, v]) => v != null)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => `  ${name}: ${fmt(count)} posts this week`);
    sections.push(`### Reddit Weekly Mentions\n${lines.join('\n')}`);
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
    if (parts.length) sections.push(`### Google Trends (relative interest 0–100, last 84 days)\n${parts.join('\n')}`);
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
    sections.push(`### GPU Spot Prices (vast.ai, median $/hr)\n${lines.join('\n')}`);
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
    sections.push(`### DRAM Memory Spot Prices (TrendForce, session average × (1 + session change), averaged per model, as of ${dram.asOf})\n${lines.join('\n')}`);
  }

  // 8. OpenRouter model pricing
  const openrouter = cache.get('openrouter');
  if (openrouter?.models) {
    const byProvider = {};
    for (const m of openrouter.models) {
      const provider = m.id.split('/')[0] || 'unknown';
      (byProvider[provider] = byProvider[provider] || []).push(m);
    }
    const lines = Object.entries(byProvider).flatMap(([, models]) =>
      models.slice(0, 4).map(m =>
        `  ${m.id}: context ${fmt(m.context)} tokens | in $${m.pricing?.prompt ?? '?'} / out $${m.pricing?.completion ?? '?'} per 1M tokens`
      )
    );
    sections.push(`### OpenRouter AI Model Catalog & Pricing\n${lines.join('\n')}`);
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
    sections.push(`### US Electricity Rates (¢/kWh, EIA, residential)\n${[usLine, ...stateLines].filter(Boolean).join('\n')}`);
  }

  // 10. Taiwan supply chain revenue (MOPS)
  const mops = cache.get('mops');
  if (mops?.companies) {
    const lines = Object.values(mops.companies).map(c => {
      const latest = c.monthly?.at(-1);
      if (!latest) return `  ${c.name} (${c.ticker}, ${c.group}): no data`;
      return `  ${c.name} (${c.ticker}, ${c.group}): NT$${latest.revenue}M in ${latest.period} | YoY: ${latest.yoy ?? 'N/A'}% | MoM: ${latest.mom ?? 'N/A'}%`;
    });
    sections.push(`### Taiwan AI Supply Chain Revenue (NT$M/month, MOPS)\n${lines.join('\n')}`);
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
    if (lines.length) sections.push(`### GitHub AI Repo Commit Velocity\n${lines.join('\n')}`);
  }

  // 13. Docker Hub AI image pulls
  const docker = cache.get('docker');
  if (docker?.images) {
    const lines = Object.entries(docker.images)
      .sort(([, a], [, b]) => b.pulls - a.pulls)
      .map(([img, v]) => `  ${img}: ${fmt(v.pulls)} total pulls | ${fmt(v.stars)} stars`);
    sections.push(`### Docker Hub AI Image Pull Counts\n${lines.join('\n')}`);
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
    if (lines.length) sections.push(`### Hacker News AI Story Mentions\n${lines.join('\n')}`);
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
    sections.push(`### Wikipedia AI Article Pageviews (weekly)\n${lines.join('\n')}`);
  }

  return sections.length
    ? sections.join('\n\n')
    : '(No data loaded yet — ask the user to click "Refresh Data" in the top navbar)';
}

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a research assistant for an AI industry signals dashboard.
You receive a DATA CONTEXT with live data from 13 sources:
1.  PyPI Downloads — weekly history for openai, anthropic, google-generativeai, mistralai packages
2.  GitHub SDK Stats — stars and dependent-repo counts for major AI SDKs
3.  Job Postings — open roles at AI companies (Anthropic, OpenAI, Google DeepMind, Mistral, Cohere, Perplexity)
4.  Reddit Mentions — weekly post counts (ChatGPT, Claude, Gemini, Mistral)
5.  Google Trends — relative search interest for brand and API keywords (0–100 scale)
6.  GPU Prices — spot prices on vast.ai (H100, H200, A100, RTX 4090)
7.  OpenRouter — all available AI models with pricing and context windows
8.  Electricity Rates — US state residential rates from EIA
9.  Taiwan Supply Chain — monthly revenue for optics and PCB AI supply chain companies (MOPS)
10. GitHub Commit Velocity — weekly commit history for 8 major open-source AI repos + new LLM repo growth
11. Docker Hub Pulls — cumulative pull counts for PyTorch, NVIDIA CUDA, Ollama, vLLM, HF TGI images
12. Hacker News Mentions — weekly AI story volume + per-term breakdown (ChatGPT, Claude, Gemini, LLM, AI agents)
13. Wikipedia Pageviews — weekly pageviews for ChatGPT, Artificial intelligence, LLM, Claude, Gemini articles

## Output format

For broad queries ("all signals for X", "everything about Y", "compare A vs B"):
  Structure your response as one section per signal that has relevant data.
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

  Scan EVERY section of the DATA CONTEXT and include a section for each source where you find matching data.
  Skip sections with no relevant data — do not mention them.

For simple single-fact questions ("Which GPU is cheapest?", "What is the price of X?"):
  Answer in one or two direct sentences with the exact figure. No section headers needed.

## Rules
- ONLY use numbers present in the DATA CONTEXT. Never invent or estimate.
- Cite exact figures (e.g. "30,954 stars", "$2.18/hr").
- For the charts JSON at the end, include ONLY chart IDs for sections you actually wrote above.

End your response with a JSON block on its own line:
{"charts": [...]}

Chart ID → signal name mapping (ONLY include IDs whose section appears in your answer):
  "pypi"             → PyPI Downloads
  "github"           → GitHub SDK Stats
  "trends"           → Google Trends + Job Postings
  "reddit"           → Reddit Mentions
  "gpu"              → GPU Prices + OpenRouter
  "electricity"      → Electricity Rates
  "ai-supply"        → Taiwan Supply Chain
  "github-commits"   → GitHub Commit Velocity
  "docker"           → Docker Hub Pulls
  "community"        → Hacker News + Wikipedia`;

// ── Main function ──────────────────────────────────────────────────────────

async function chat(message) {
  const groq    = makeGroq();
  const context = buildContext();

  const response = await groq.chat.completions.create({
    model:       MODEL,
    max_tokens:  2048,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `DATA CONTEXT:\n\n${context}\n\n---\nQUESTION: ${message}` },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '';

  // Extract trailing {"charts": [...]} block
  const jsonMatch = raw.match(/\{[^{}]*"charts"[^{}]*\}/s);
  let sources = [];
  let text    = raw;
  if (jsonMatch) {
    try { sources = JSON.parse(jsonMatch[0]).charts ?? []; } catch {}
    text = raw.slice(0, jsonMatch.index).trimEnd();
  }

  return { text, sources };
}

module.exports = { chat, invalidateEmbeddings: () => {} };
