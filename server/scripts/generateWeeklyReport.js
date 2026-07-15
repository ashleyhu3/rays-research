'use strict';

// Weekly AI report — a self-contained HTML/Markdown document (rendered to PDF via
// Chrome, or emailed) summarising the three headline pages of the site:
//   • AI Demand  — total weekly OpenRouter tokens vs YoY plus one 6-month
//                  token/Yoy combo chart per tracked company, ranked by latest
//                  YoY growth.
//   • AI Supply  — every Taiwan supply chain as a memory-pricing-style card:
//                  per-company revenue tiles + a point-labelled YoY line chart,
//                  ranked by latest average YoY growth across tickers.
//   • Pricing    — three memory spot charts plus the GPU spot chart as a 2x2
//                  grid, matching the site pricing pages.
//
// The maths mirrors the in-app utilities so the report can never disagree with the
// website: openrouterProvider.js (completeWeeks / orTokensWithGrowth), the OpenRouter
// provider-weekly rankings, SupplyChain.jsx (per-company monthly YoY), and
// Pricing.jsx (memory/GPU spot chart series).

const fs = require('fs');
const path = require('path');

const SNAPSHOT_FILE = path.join(__dirname, '..', 'data', 'latestSnapshots.json');
const DEFAULT_BASE_URL = process.env.WEEKLY_REPORT_BASE_URL || 'http://localhost:3001';

// Report window: 6 months ≈ 26 ISO weeks for demand/pricing; 12 months for supply YoY lines.
const DEMAND_WEEKS = 26;
const PRICING_WEEKS = 26;
const SUPPLY_MONTHS = 12;

// ── Palette (light-theme print document) ────────────────────────────────────
const UP_COLOR = '#059669';
const DOWN_COLOR = '#dc2626';
const FLAT_COLOR = '#6b7280';
const BAR_COLOR = '#93c5fd';
const BAR_STRONG = '#3b82f6';
const LINE_COLOR = '#ea580c';
const GLYPH = { up: '▲', down: '▼', flat: '—' };

// Brand colour tokens (mirrors src/config/colors.js).
const C = {
  openai: '#10b981', anthropic: '#e8c547', google: '#4285f4', mistral: '#f59e0b',
  meta: '#0866ff', perplexity: '#a78bfa', minimax: '#e879f9', zhipu: '#34d399',
  deepseek: '#60a5fa', kimi: '#fb923c', xiaomi: '#f43f5e', baidu: '#3b82f6',
  xai: '#9ca3af', qwen: '#6366f1', red: '#f87171', teal: '#39d0b4',
  orange: '#f0883e', slate: '#94a3b8',
};

const PROV_COLOR = {
  OpenAI: C.openai, Anthropic: C.anthropic, Google: C.google, Meta: C.meta,
  Mistral: C.mistral, DeepSeek: C.deepseek, 'Alibaba (Qwen)': '#facc15', xAI: C.xai,
  MiniMax: C.minimax, 'Zhipu AI': C.zhipu, 'Moonshot AI': C.kimi, Perplexity: C.perplexity,
  Tencent: '#1db954', Xiaomi: C.red, OpenRouter: C.teal,
};

function provColor(name) { return PROV_COLOR[name] ?? C.slate; }

function modelColor(slug) {
  if (!slug) return C.slate;
  const prefix = slug.split('/')[0];
  const map = {
    openai: C.openai, anthropic: C.anthropic, google: C.google, 'meta-llama': C.meta,
    mistralai: C.mistral, deepseek: C.deepseek, qwen: '#facc15', 'x-ai': C.xai,
    minimax: C.minimax, thudm: C.zhipu, 'z-ai': C.zhipu, moonshotai: C.kimi,
    cohere: C.perplexity, perplexity: C.perplexity, tencent: '#1db954', xiaomi: C.red,
    openrouter: C.teal, bytedance: '#fe2c55', baidu: C.baidu, '01-ai': '#e879f9',
  };
  return map[prefix] ?? C.slate;
}

// AI companies shown in the sidebar's "AI companies" section.
const DEMAND_COMPANIES = [
  { provider: 'OpenAI', label: 'OpenAI / ChatGPT', color: C.openai },
  { provider: 'Anthropic', label: 'Anthropic / Claude', color: C.anthropic },
  { provider: 'Google', label: 'Google / Gemini', color: C.google },
  { provider: 'Zhipu AI', label: 'Zhipu AI / GLM', color: C.zhipu },
  { provider: 'MiniMax', label: 'MiniMax', color: C.minimax },
];

// Demand charts = current sidebar companies plus explicit OpenRouter-only extras.
const DEMAND_CHART_COMPANIES = [
  ...DEMAND_COMPANIES,
  { provider: 'DeepSeek', label: 'DeepSeek', color: C.deepseek },
  { provider: 'xAI', label: 'xAI / Grok', color: C.xai },
];

// Companies for the legacy latest-week mainstream-model bar chart helper. The
// chart is no longer rendered in the weekly report, but the helper stays exported
// for callers/tests that may still import it.
const MODEL_COMPANIES = [
  { provider: 'OpenAI', label: 'OpenAI' },
  { provider: 'Anthropic', label: 'Anthropic' },
  { provider: 'Google', label: 'Google' },
  { provider: 'Zhipu AI', label: 'Zhipu AI' },
  { provider: 'MiniMax', label: 'MiniMax' },
  { provider: 'DeepSeek', label: 'DeepSeek' },
];

// Canonical Taiwan supply-chain roster (id → ticker/group/name), mirroring
// SupplyChain.jsx's ALL_COMPANIES. Names come from here — not the MOPS snapshot,
// which can carry stale names — so the report's labels match the website exactly.
// Only the monthly revenue series is joined in from live MOPS data by id.
const COMPANIES = [
  { id: '6442', ticker: '6442TT', group: 'fiber', name: '光聖' },
  { id: '3081', ticker: '3081TT', group: 'optics', name: '聯亞光電' },
  { id: '3363', ticker: '3363TT', group: 'optics', name: '上詮' },
  { id: '3163', ticker: '3163TT', group: 'optics', name: '波若威' },
  { id: '2383', ticker: '2383TT', group: 'ccl', name: '台光電' },
  { id: '6274', ticker: '6274TT', group: 'ccl', name: '台燿科技' },
  { id: '8358', ticker: '8358TT', group: 'ccl', name: '金居' },
  { id: '2368', ticker: '2368TT', group: 'pcb', name: '金像電' },
  { id: '4958', ticker: '4958TT', group: 'pcb', name: '臻鼎-KY' },
  { id: '8021', ticker: '8021TT', group: 'pcb', name: '尖點' },
  { id: '3037', ticker: '3037TT', group: 'abf', name: '欣興電子' },
  { id: '8046', ticker: '8046TT', group: 'abf', name: '南電' },
  { id: '2327', ticker: '2327TT', group: 'mlcc', name: '國巨' },
  { id: '2492', ticker: '2492TT', group: 'mlcc', name: '華新科' },
  { id: '3026', ticker: '3026TT', group: 'mlcc', name: '禾伸堂' },
  { id: '3017', ticker: '3017TT', group: 'cooling', name: '奇鋐' },
  { id: '3653', ticker: '3653TT', group: 'cooling', name: '健策' },
  { id: '3324', ticker: '3324TT', group: 'cooling', name: '雙鴻' },
  { id: '8996', ticker: '8996TT', group: 'cooling', name: '高力' },
  { id: '2308', ticker: '2308TT', group: 'power', name: '台達電' },
  { id: '2301', ticker: '2301TT', group: 'power', name: '光寶科' },
  { id: '6415', ticker: '6415TT', group: 'power', name: '矽力-KY' },
  { id: '3665', ticker: '3665TT', group: 'power', name: '貿聯-KY' },
  { id: '3131', ticker: '3131TT', group: 'equipment', name: '弘塑' },
  { id: '6187', ticker: '6187TT', group: 'equipment', name: '萬潤' },
  { id: '2467', ticker: '2467TT', group: 'equipment', name: '志聖' },
  { id: '3583', ticker: '3583TT', group: 'equipment', name: '辛耘' },
  { id: '7769', ticker: '7769TT', group: 'equipment', name: '鴻勁' },
  { id: '2360', ticker: '2360TT', group: 'equipment', name: '致茂' },
  { id: '2408', ticker: '2408TT', group: 'memory', name: '南亞科' },
  { id: '2337', ticker: '2337TT', group: 'memory', name: '旺宏' },
  { id: '8299', ticker: '8299TT', group: 'memory', name: '群聯' },
  { id: '2344', ticker: '2344TT', group: 'memory', name: '華邦電' },
  { id: '2330', ticker: '2330TT', group: 'foundry', name: '台積電' },
  { id: '2303', ticker: '2303TT', group: 'foundry', name: '聯電' },
  { id: '5347', ticker: '5347TT', group: 'foundry', name: '世界先進' },
  { id: '3533', ticker: '3533TT', group: 'cpu', name: '嘉澤' },
  { id: '5274', ticker: '5274TT', group: 'cpu', name: '信驊' },
  { id: '3044', ticker: '3044TT', group: 'cpu', name: '健鼎' },
  { id: '2317', ticker: '2317TT', group: 'odm', name: '鴻海' },
  { id: '2382', ticker: '2382TT', group: 'odm', name: '廣達' },
  { id: '3231', ticker: '3231TT', group: 'odm', name: '緯創' },
  { id: '6669', ticker: '6669TT', group: 'odm', name: '緯穎' },
];

// Supply chains in sidebar order, each with the hand-picked palette from
// SupplyChain.jsx so lines sharing a chart stay far apart on the hue wheel.
const CHAIN_META = [
  { id: 'optics', label: 'Optics', colors: ['#f87171', '#38bdf8', '#fbbf24'] },
  { id: 'fiber', label: 'Fiber', colors: ['#f43f5e'] },
  { id: 'ccl', label: 'CCL', colors: ['#f87171', '#38bdf8', '#fbbf24'] },
  { id: 'pcb', label: 'PCB', colors: ['#4ade80', '#22d3ee', '#818cf8'] },
  { id: 'abf', label: 'ABF', colors: ['#f97316', '#fca5c1'] },
  { id: 'mlcc', label: 'MLCC', colors: ['#34d399', '#c084fc', '#fb923c'] },
  { id: 'cooling', label: 'Cooling', colors: ['#f87171', '#fbbf24', '#4ade80', '#60a5fa'] },
  { id: 'power', label: 'Power', colors: ['#fb923c', '#22d3ee', '#e879f9', '#a3e635'] },
  { id: 'equipment', label: 'Equipment', colors: ['#f87171', '#fbbf24', '#4ade80', '#22d3ee', '#818cf8', '#f472b6'] },
  { id: 'memory', label: 'Memory', colors: ['#fbbf24', '#34d399', '#60a5fa', '#fb7185'] },
  { id: 'foundry', label: 'Foundry', colors: ['#38bdf8', '#fb923c', '#4ade80'] },
  { id: 'cpu', label: 'CPU', colors: ['#38bdf8', '#fb923c', '#a3e635'] },
  { id: 'odm', label: 'ODM', colors: ['#f87171', '#fbbf24', '#34d399', '#818cf8'] },
];

// ── Generic formatting ──────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeMd(value) {
  return String(value ?? '-').replaceAll('|', '\\|');
}

function fmtTok(v) {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return String(Math.round(v));
}

function fmtPct(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

// Compact % label matching SupplyChain.jsx's pctLabel (0 dp ≥100, else 1 dp).
function pctLabel(v) {
  if (!Number.isFinite(v)) return '';
  const digits = Math.abs(v) >= 100 ? 0 : 1;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

// Revenue label matching SupplyChain.jsx (NT$M below 1B, NT$B above).
function fmtRevenue(v) {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `NT$${(v / 1000).toFixed(1)}B`;
  return `NT$${v.toFixed(0)}M`;
}

function latestFinite(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}

function latestFiniteDate(dates, series) {
  if (!Array.isArray(series) || !dates) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(series[i])) return dates[i] ?? null;
  }
  return null;
}

function pctChangeOverDays(dates, series, days) {
  if (!Array.isArray(series) || !dates?.length) return null;
  let last = -1;
  for (let i = series.length - 1; i >= 0; i -= 1) if (Number.isFinite(series[i])) { last = i; break; }
  if (last <= 0) return null;
  const targetMs = new Date(`${dates[last]}T00:00:00Z`).getTime() - days * 86400000;
  let ref = -1;
  for (let i = last - 1; i >= 0; i -= 1) {
    if (!Number.isFinite(series[i])) continue;
    if (new Date(`${dates[i]}T00:00:00Z`).getTime() <= targetMs) { ref = i; break; }
  }
  if (ref < 0 || !(series[ref] > 0)) return null;
  return ((series[last] - series[ref]) / series[ref]) * 100;
}

function fmtReportDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function orWeekLabel(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function shortDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function periodLabel(period) {
  const m = /^(\d{4})\/(\d{2})$/.exec(period || '');
  if (!m) return period || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} '${m[1].slice(2)}`;
}

function dirOf(cur, prev) {
  if (!(prev > 0) || !Number.isFinite(cur)) return null;
  if (cur > prev) return 'up';
  if (cur < prev) return 'down';
  return 'flat';
}

// ── Demand: replicate openrouterProvider.js exactly ─────────────────────────
// Weekly series with the in-progress ISO week dropped (a partial total would read
// as a fake week-over-week drop). provider === null → platform totals.
function completeWeeks(ranks, provider) {
  const weekly = provider ? ranks?.providerWeekly?.[provider] : ranks?.weeklyTotals;
  if (!weekly?.length) return null;
  const allLabels = ranks.weekLabels ?? [];
  const lastMonday = allLabels[allLabels.length - 1];
  const weekEnd = lastMonday ? new Date(new Date(`${lastMonday}T00:00:00Z`).getTime() + 6 * 86400000) : null;
  const partial = weekEnd && ranks.asOf ? new Date(`${ranks.asOf}T00:00:00Z`) < weekEnd : false;
  return {
    totals: partial ? weekly.slice(0, -1) : weekly,
    labels: allLabels.slice(0, partial ? -1 : undefined).map(orWeekLabel),
  };
}

// Aligned weekly tokens + % growth vs `lag` weeks earlier (52 = YoY) over the
// last W complete weeks. Growth is null where no week is far enough back.
function orTokensWithGrowth(ranks, provider, W, lag = 1) {
  const cw = completeWeeks(ranks, provider);
  if (!cw) return null;
  const { totals, labels } = cw;
  const nearestPriorYearBase = (i) => {
    const j = i - lag;
    if (j < 0) return null;
    if (totals[j] > 0) return totals[j];
    // OpenRouter's provider history can have exact prior-year zero weeks for
    // newly-listed providers/models. Use the nearest non-zero week in a two-month
    // band so the latest bar can still carry a sensible YoY-style comparison.
    for (let d = 1; d <= 8; d += 1) {
      if (j - d >= 0 && totals[j - d] > 0) return totals[j - d];
      if (j + d < totals.length && totals[j + d] > 0) return totals[j + d];
    }
    return null;
  };
  const growth = totals.map((v, i) => {
    const base = nearestPriorYearBase(i);
    return base > 0 ? +((v / base - 1) * 100).toFixed(1) : null;
  });
  const w = Math.min(W, totals.length);
  return { labels: labels.slice(-w), tokens: totals.slice(-w), growth: growth.slice(-w) };
}

// Per-company table: the last `nWeeks` complete weeks, oldest → newest so the most
// recent week sits on the far right. The most recent complete week is "this week" —
// the in-progress week is dropped, which is exactly the "three weeks back from last
// week if this week isn't complete yet" behaviour.
function buildDemandTable(ranks, nWeeks = 3) {
  const totalCw = completeWeeks(ranks, null);
  const weekHeaders = totalCw ? totalCw.labels.slice(-nWeeks) : []; // oldest → newest

  const rows = DEMAND_COMPANIES.map(({ provider, label }) => {
    const cw = completeWeeks(ranks, provider);
    if (!cw || cw.totals.length < 2) {
      return { label, latest: null, cells: weekHeaders.map(() => null) };
    }
    const { totals } = cw;
    const n = totals.length;
    const cells = [];
    for (let k = nWeeks; k >= 1; k -= 1) {
      const i = n - k; // k=nWeeks → oldest, k=1 → most recent complete week
      if (i < 1) { cells.push(null); continue; }
      const cur = totals[i];
      const prev = totals[i - 1];
      const wow = prev > 0 ? (cur / prev - 1) * 100 : null;
      cells.push({ dir: dirOf(cur, prev), wow, tokens: cur });
    }
    return { label, latest: totals[n - 1], cells }; // oldest → newest
  });

  return { weekHeaders, rows };
}

function buildDemandCharts(ranks) {
  const total = orTokensWithGrowth(ranks, null, DEMAND_WEEKS, 52) ?? { labels: [], tokens: [], growth: [] };
  const companies = DEMAND_CHART_COMPANIES.map((company) => {
    const chart = orTokensWithGrowth(ranks, company.provider, DEMAND_WEEKS, 52);
    const latestYoy = latestFinite(chart?.growth);
    const latestTokens = latestFinite(chart?.tokens);
    return { ...company, chart: chart ?? { labels: [], tokens: [], growth: [] }, latestYoy, latestTokens };
  })
    .filter(c => c.chart.labels.length > 0)
    .sort((a, b) => (Number.isFinite(b.latestYoy) ? b.latestYoy : -Infinity) - (Number.isFinite(a.latestYoy) ? a.latestYoy : -Infinity));

  return { total, companies };
}

// Latest-week mainstream-model token bar chart. For each target company, the
// highest-token model in ranks.topModels; companies absent from the top list
// (Grok/xAI) fall back to their provider-weekly total for the same week.
function buildModelBars(ranks) {
  const top = ranks?.topModels ?? [];
  const bars = MODEL_COMPANIES.map((t) => {
    const mine = top.filter(m => m.provider === t.provider).sort((a, b) => b.tokens - a.tokens);
    if (mine.length) {
      const m = mine[0];
      return { company: t.label, model: m.name, tokens: m.tokens, color: modelColor(m.slug) };
    }
    const pw = ranks?.providerWeekly?.[t.provider];
    const tokens = pw?.length ? pw[pw.length - 1] : null;
    return { company: t.label, model: t.fallbackName ?? t.provider, tokens, color: t.fallbackColor ?? provColor(t.provider), approx: true };
  });
  return bars.filter(b => Number.isFinite(b.tokens) && b.tokens > 0).sort((a, b) => b.tokens - a.tokens);
}

// ── Supply: per-company monthly YoY + revenue tiles per chain ───────────────
function buildSupplySections(mops, months = SUPPLY_MONTHS) {
  const liveById = mops?.companies ?? {};
  const roster = COMPANIES.map(c => ({ ...c, monthly: liveById[c.id]?.monthly ?? [] }));

  return CHAIN_META.map((meta) => {
    // Colour is assigned by position in the full chain roster (before dropping
    // empty series) so a line always matches its tile swatch on the website.
    const chainMembers = roster.filter(c => c.group === meta.id);
    const cos = chainMembers.filter(c => c.monthly.length > 0);

    const periodSet = new Set();
    cos.forEach(c => c.monthly.forEach(r => periodSet.add(r.period)));
    const periods = [...periodSet].sort().slice(-months);

    const series = cos.map((c) => {
      const idx = chainMembers.indexOf(c);
      const color = meta.colors[idx % meta.colors.length];
      const byP = Object.fromEntries(c.monthly.map(r => [r.period, r.yoy]));
      const last = c.monthly.at(-1);
      return {
        label: `${c.ticker} ${c.name}`,
        ticker: c.ticker,
        name: c.name,
        color,
        data: periods.map(p => (byP[p] != null ? byP[p] : null)),
        revenue: last?.revenue ?? null,
        yoy: last?.yoy ?? null,
        mom: last?.mom ?? null,
        period: last?.period ?? null,
      };
    });

    const latestVals = series.map(s => s.yoy).filter(Number.isFinite);
    const latestAvgYoy = latestVals.length ? latestVals.reduce((sum, v) => sum + v, 0) / latestVals.length : null;

    return { ...meta, periods: periods.map(periodLabel), series, hasData: series.length > 0, latestAvgYoy };
  })
    .filter(section => section.hasData)
    .sort((a, b) => (Number.isFinite(b.latestAvgYoy) ? b.latestAvgYoy : -Infinity) - (Number.isFinite(a.latestAvgYoy) ? a.latestAvgYoy : -Infinity));
}

// ── Pricing: representative series per sector (mirrors pricingTrend.js) ──────
function meanSeries(spotSeries) {
  const series = Object.values(spotSeries ?? {});
  if (!series.length) return [];
  const n = Math.max(...series.map(s => s.length));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const vals = series.map(s => s[i]).filter(Number.isFinite);
    out.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN);
  }
  return out;
}

// The last `n` datapoint-over-datapoint changes of a series, most recent first.
function recentChanges(values, dates, n = 3) {
  const pts = [];
  (Array.isArray(values) ? values : []).forEach((v, i) => {
    if (Number.isFinite(v)) pts.push({ v, d: dates?.[i] ?? null });
  });
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const cur = pts[pts.length - 1 - k];
    const prev = pts[pts.length - 2 - k];
    if (!cur || !prev || !(prev.v > 0)) { out.push(null); continue; }
    const pct = ((cur.v - prev.v) / prev.v) * 100;
    out.push({ dir: dirOf(cur.v, prev.v), pct, date: cur.d });
  }
  return out;
}

// ISO-week Monday for a YYYY-MM-DD date.
function isoWeekStart(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// Collapse a daily {dates,values} series into weekly averages (one point per ISO
// week, dated by that week's Monday). Non-finite values are skipped.
function weeklyFromDaily(dates, values) {
  const buckets = new Map();
  (dates ?? []).forEach((d, i) => {
    const v = values?.[i];
    if (!d || !Number.isFinite(v)) return;
    const wk = isoWeekStart(d);
    const e = buckets.get(wk) ?? { sum: 0, n: 0 };
    e.sum += v; e.n += 1;
    buckets.set(wk, e);
  });
  const weeks = [...buckets.keys()].sort();
  return { dates: weeks, values: weeks.map(w => buckets.get(w).sum / buckets.get(w).n) };
}

// Daily mainstream DRAM spot: mean across the (non-module) chip models of the
// daily TrendForce spot history — the daily basis for a weekly mainstream index.
function dailyMainstreamDram(dram) {
  const hist = dram?.history;
  if (!hist?.dates?.length) return { dates: [], values: [] };
  const chips = (dram.models ?? []).filter(m => m.category !== 'module').map(m => m.model);
  const models = chips.length ? chips : Object.keys(hist.series ?? {});
  const values = hist.dates.map((_, i) => {
    const vals = models.map(m => hist.series?.[m]?.[i]).filter(Number.isFinite);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  return { dates: hist.dates, values };
}

// Daily mainstream GPU rental benchmark: actual vast.ai on-demand medians only.
// AWS / OCPI are spot-price sources and are intentionally excluded here.
function dailyGpuBenchmark(gpu) {
  const gH = gpu?.history;
  if (!gH?.dates?.length) return { dates: [], values: [] };
  return { dates: gH.dates, values: gH.index ?? [] };
}

// Every pricing sector as a WEEKLY series (avg of that week's daily datapoints),
// so all four share a fresh weekly cadence instead of a stale monthly index /
// too-short daily series. Table shows the three most recent week-over-week moves.
function buildPricingTable(data) {
  const mem = dailyMainstreamDram(data.dram);
  const gpu = dailyGpuBenchmark(data.gpu);
  const weekly = {
    Memory: weeklyFromDaily(mem.dates, mem.values),
    GPU: weeklyFromDaily(gpu.dates, gpu.values),
    CPU: weeklyFromDaily(data.cpu?.history?.dates, meanSeries(data.cpu?.history?.spotSeries)),
    TPU: weeklyFromDaily(data.tpu?.history?.dates, meanSeries(data.tpu?.history?.spotSeries)),
  };

  return ['Memory', 'GPU', 'CPU'].map((label) => {
    const w = weekly[label];
    return {
      label,
      latest: w.values.at(-1) ?? null,
      changes: recentChanges(w.values, w.dates, 3), // recent-first, dates = week Mondays
    };
  });
}

// ── Pricing charts: static counterparts to src/pages/pricing/Pricing.jsx ────
const DRAM_PALETTE = [C.teal, C.openai, C.anthropic, C.google, C.minimax, C.kimi, C.deepseek, C.perplexity, C.red, C.slate];
const NAND_MODELS = ['SLC', 'MLC', 'TLC'];
const NAND_MODEL_COLORS = { SLC: C.openai, MLC: C.anthropic, TLC: C.teal };
const GPU_PALETTE = {
  H100_SXM: C.openai,
  H100_PCIe: C.deepseek,
  H100_NVL: C.kimi,
  H200: C.anthropic,
  B200: C.google,
  A100_SXM: C.teal,
  A100_PCIe: C.perplexity,
  RTX_5090: C.red,
  RTX_4090: C.minimax,
};
const GPU_LABELS = {
  H100_SXM: 'H100 SXM',
  H100_PCIe: 'H100 PCIe',
  H100_NVL: 'H100 NVL',
  H200: 'H200',
  B200: 'B200',
  A100_SXM: 'A100 SXM4',
  A100_PCIe: 'A100 PCIe',
  RTX_5090: 'RTX 5090',
  RTX_4090: 'RTX 4090',
};
const GPU_SPOT_MODEL_KEYS = ['H100_SXM', 'H200', 'B200', 'A100_SXM', 'RTX_5090'];
const GPU_AWS_SPOT_KEYS = { H100_SXM: 'H100', H200: 'H200', A100_SXM: 'A100' };

function dayLabel(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function monthYearLabel(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} '${String(d.getUTCFullYear()).slice(-2)}`;
}

function priceHistoryLabel(isoDate, weeks) {
  return weeks <= 52 ? dayLabel(isoDate) : monthYearLabel(isoDate);
}

function lineDataset(label, color, data) {
  return { label, color, borderColor: color, data };
}

function tileFromSeries(label, color, dates, series, extra = {}) {
  return {
    label,
    model: label,
    color,
    price: latestFinite(series),
    chg7d: pctChangeOverDays(dates, series, 7),
    chg30d: pctChangeOverDays(dates, series, 30),
    date: latestFiniteDate(dates, series),
    ...extra,
  };
}

function dateWindowStart(dates, weeks) {
  if (!dates?.length) return 0;
  const anchor = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
  const cutoff = anchor - weeks * 7 * 86400000;
  const start = dates.findIndex(d => new Date(`${d}T00:00:00Z`).getTime() >= cutoff);
  return start < 0 ? 0 : start;
}

function windowHistory(history, weeks) {
  if (!history?.dates?.length) return null;
  const start = dateWindowStart(history.dates, weeks);
  return { start, dates: history.dates.slice(start) };
}

function windowTrendforceHistory(history, weeks) {
  if (!history?.dates?.length) return null;
  const start = dateWindowStart(history.dates, weeks);
  return {
    dates: history.dates.slice(start),
    series: Object.fromEntries(Object.entries(history.series ?? {}).map(([k, arr]) => [k, arr.slice(start)])),
  };
}

function backfillLeading(arr) {
  const first = arr.findIndex(Number.isFinite);
  if (first <= 0) return arr;
  const fv = arr[first];
  return arr.map((v, i) => (i < first ? fv : v));
}

function averageAlignedSeries(seriesMap, keys, length, requireAll = false) {
  return Array.from({ length }, (_, i) => {
    const vals = keys.map(k => seriesMap?.[k]?.[i]).filter(Number.isFinite);
    if (requireAll && vals.length !== keys.length) return null;
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3) : null;
  });
}

function nandCapacityGb(product) {
  const m = String(product ?? '').match(/(\d+(?:\.\d+)?)\s*Gb\b/i);
  return m ? Number(m[1]) : NaN;
}

function nandCellType(product) {
  const m = String(product ?? '').match(/\b(SLC|MLC|TLC)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function buildDramSpotChart(dram, category, title, weeks) {
  const models = (dram?.models ?? [])
    .filter(m => (category === 'module') === (m.category === 'module'))
    .sort((a, b) => b.price - a.price);
  const history = windowTrendforceHistory(dram?.history, weeks);
  if (!models.length || !history?.dates?.length) return null;

  const datasets = models.map((m, i) => lineDataset(m.model, DRAM_PALETTE[i % DRAM_PALETTE.length], history.series[m.model] ?? []));
  return {
    id: category === 'module' ? 'dram-modules' : 'dram-chips',
    title,
    yFmt: category === 'module' ? (v => `$${v.toFixed(0)}`) : (v => `$${v.toFixed(2)}`),
    tileFmt: category === 'module' ? (v => `$${v.toFixed(0)}`) : (v => `$${v.toFixed(2)}`),
    labels: history.dates.map(dayLabel),
    dates: history.dates,
    datasets,
    tiles: datasets.map((ds, i) => tileFromSeries(ds.label, ds.color, history.dates, ds.data, { variants: models[i]?.variants })),
  };
}

function buildNandSpotChart(nand, weeks) {
  const history = windowTrendforceHistory(nand?.history, weeks);
  if (!history?.dates?.length) return null;
  const products = (nand?.products?.length ? nand.products : Object.keys(nand?.history?.series ?? {}).map(product => ({ product })));

  const groups = new Map();
  for (const p of products) {
    const model = nandCellType(p.product);
    const gb = nandCapacityGb(p.product);
    if (!model || !Number.isFinite(gb) || gb <= 0) continue;
    if (!groups.has(model)) groups.set(model, []);
    groups.get(model).push({ product: p.product, gb });
  }

  const models = NAND_MODELS.filter(m => groups.has(m));
  if (!models.length) return null;

  const datasets = models.map((model) => {
    const members = groups.get(model);
    const series = history.dates.map((_, i) => {
      const perGb = members
        .map(({ product, gb }) => {
          const v = history.series[product]?.[i];
          return Number.isFinite(v) ? v / gb : null;
        })
        .filter(v => v != null);
      return perGb.length ? perGb.reduce((a, b) => a + b, 0) / perGb.length : null;
    });
    return lineDataset(model, NAND_MODEL_COLORS[model], series);
  });

  return {
    id: 'nand-spot',
    title: 'NAND flash spot prices',
    yFmt: v => `$${v.toFixed(3)}/Gb`,
    tileFmt: v => `$${v.toFixed(3)}`,
    tileUnit: '/Gb',
    labels: history.dates.map(dayLabel),
    dates: history.dates,
    datasets,
    tiles: datasets.map(ds => tileFromSeries(ds.label, ds.color, history.dates, ds.data)),
  };
}

function combinedGpuSpotSeries(gpu, aws) {
  const aH = aws?.history;
  const gH = gpu?.history;
  const allDates = [...new Set([...(aH?.dates ?? []), ...(gH?.dates ?? [])])].sort();
  if (!allDates.length) return null;

  const gIdx = gH?.dates ? Object.fromEntries(gH.dates.map((d, i) => [d, i])) : {};
  const aIdx = aH?.dates ? Object.fromEntries(aH.dates.map((d, i) => [d, i])) : {};
  const vastVal = (vk, d) => {
    const i = gIdx[d];
    if (i == null) return null;
    const sp = gH?.spotSeries?.[vk]?.[i];
    if (Number.isFinite(sp)) return sp;
    const od = gH?.series?.[vk]?.[i];
    return Number.isFinite(od) ? od : null;
  };
  const awsVal = (ak, d) => {
    const i = aIdx[d];
    return i == null ? null : aH?.spotSeries?.[ak]?.[i];
  };

  const fullSeries = {};
  for (const vk of GPU_SPOT_MODEL_KEYS) {
    const ak = GPU_AWS_SPOT_KEYS[vk];
    const combined = allDates.map((d) => {
      if (ak) {
        const av = awsVal(ak, d);
        if (Number.isFinite(av)) return av;
      }
      const v = vastVal(vk, d);
      return Number.isFinite(v) ? v : null;
    });
    if (combined.some(Number.isFinite)) fullSeries[vk] = combined;
  }

  const present = GPU_SPOT_MODEL_KEYS.filter(k => fullSeries[k]?.some(Number.isFinite));
  if (!present.length) return null;
  return { allDates, fullSeries, present };
}

function buildGpuSpotChart(gpu, aws, weeks) {
  const combo = combinedGpuSpotSeries(gpu, aws);
  if (!combo) return null;
  const { allDates, fullSeries, present } = combo;

  const start = dateWindowStart(allDates, weeks);
  const dates = allDates.slice(start);
  const windowed = Object.fromEntries(present.map(k => [
    k,
    GPU_AWS_SPOT_KEYS[k] ? backfillLeading(fullSeries[k].slice(start)) : fullSeries[k].slice(start),
  ]));

  const datasets = present.map(k => lineDataset(GPU_LABELS[k] ?? k, GPU_PALETTE[k] ?? C.slate, windowed[k] ?? []));

  return {
    id: 'gpu-spot-combined',
    title: 'GPU spot prices',
    yFmt: v => `$${v.toFixed(2)}/hr`,
    tileFmt: v => `$${v.toFixed(2)}`,
    tileUnit: '/hr',
    labels: dates.map(d => priceHistoryLabel(d, weeks)),
    dates,
    datasets,
    tiles: datasets.map(ds => tileFromSeries(ds.label, ds.color, dates, ds.data)),
  };
}

function buildGpuSpotAverageChart(gpu, aws, weeks) {
  const combo = combinedGpuSpotSeries(gpu, aws);
  if (!combo) return null;
  const { allDates, fullSeries } = combo;
  const values = averageAlignedSeries(fullSeries, GPU_SPOT_MODEL_KEYS, allDates.length, true);
  if (!values.some(Number.isFinite)) return null;
  const start = dateWindowStart(allDates, weeks);
  const dates = allDates.slice(start);
  const windowed = values.slice(start);
  if (!windowed.some(Number.isFinite)) return null;
  return {
    id: 'gpu-spot-average',
    title: 'Aggregate five-model GPU spot average',
    yFmt: v => `$${v.toFixed(2)}/hr`,
    labels: dates.map(d => priceHistoryLabel(d, weeks)),
    dates,
    datasets: [lineDataset('Five-model GPU spot average', C.slate, windowed)],
    tiles: [],
  };
}

function buildPricingCharts(data, weeks = PRICING_WEEKS) {
  return [
    buildDramSpotChart(data.dram, 'chip', 'DRAM chip spot prices', weeks),
    buildDramSpotChart(data.dram, 'module', 'Memory module spot prices', weeks),
    buildNandSpotChart(data.nand, weeks),
    buildGpuSpotChart(data.gpu, data.aws, weeks),
    buildGpuSpotAverageChart(data.gpu, data.aws, weeks),
  ].filter(Boolean);
}

// ── SVG chart helpers ───────────────────────────────────────────────────────
function axisTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(min + ((max - min) * i) / (count - 1));
  return out;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

// Tighter round-up so a 2.3T max doesn't stretch the axis to 5T — snaps to the
// next "nice" value from a fine ladder just above the data.
function niceCeil(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
  const norm = v / mag;
  return (steps.find(s => s >= norm - 1e-9) ?? 10) * mag;
}

// Text with a white outline (paint-order) so labels stay legible over bars/lines.
function haloText(x, y, text, { anchor = 'middle', fill = '#111827', size = 11, weight = '700' } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="Helvetica Neue, Helvetica, Arial, Liberation Sans, DejaVu Sans, sans-serif" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round" paint-order="stroke">${escapeHtml(text)}</text>`;
}

// Weekly token bars (left axis) + YoY growth line (right axis).
function buildTokensYoyChartSvg(chart, ariaLabel = 'Weekly tokens versus year-over-year growth', opts = {}) {
  const labels = chart?.labels ?? [];
  const tokens = chart?.tokens ?? [];
  const growth = chart?.growth ?? [];
  if (!labels.length) return '<div class="empty-chart">No demand data</div>';

  const width = opts.width ?? 680;
  const height = opts.height ?? 360;
  const margin = { top: 46, right: 56, bottom: 44, left: 66 };
  const cw = width - margin.left - margin.right;
  const ch = height - margin.top - margin.bottom;

  const tokMax = niceMax(Math.max(1, ...tokens.filter(Number.isFinite)));
  const gVals = growth.filter(Number.isFinite);
  let gMin = Math.min(0, ...gVals);
  let gMax = Math.max(0, ...gVals);
  if (gMin === gMax) { gMin -= 1; gMax += 1; }
  const gPad = (gMax - gMin) * 0.14;
  gMin -= gPad;
  gMax += gPad;

  const step = cw / labels.length;
  const barW = Math.min(20, step * 0.6);
  const xCenter = i => margin.left + step * i + step / 2;
  const yTok = v => margin.top + ch - (v / tokMax) * ch;
  const yGrowth = v => margin.top + ch - ((v - gMin) / (gMax - gMin)) * ch;

  const leftTicks = axisTicks(0, tokMax, 5);
  const rightTicks = axisTicks(gMin + gPad, gMax - gPad, 5);
  const zeroY = gMin < 0 && gMax > 0 ? yGrowth(0) : null;
  const labelEvery = Math.ceil(labels.length / 7);

  const grid = leftTicks.map((t) => {
    const y = yTok(t);
    return `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${width - margin.right}" y2="${y.toFixed(1)}" class="grid-line"></line>
      <text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis-text">${fmtTok(t)}</text>`;
  }).join('');

  const rightAxis = rightTicks.map((t) => {
    const y = yGrowth(t);
    return `<text x="${width - margin.right + 10}" y="${(y + 4).toFixed(1)}" text-anchor="start" class="axis-text growth">${t.toFixed(0)}%</text>`;
  }).join('');

  const bars = tokens.map((v, i) => {
    if (!Number.isFinite(v)) return '';
    const bh = Math.max(1, (v / tokMax) * ch);
    const x = xCenter(i) - barW / 2;
    const y = margin.top + ch - bh;
    const isLast = i === tokens.length - 1;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${isLast ? BAR_STRONG : BAR_COLOR}"></rect>`;
  }).join('');

  const linePts = growth
    .map((v, i) => (Number.isFinite(v) ? `${xCenter(i).toFixed(1)},${yGrowth(v).toFixed(1)}` : null))
    .filter(Boolean);
  const linePath = linePts.length
    ? `<polyline points="${linePts.join(' ')}" fill="none" stroke="${LINE_COLOR}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></polyline>`
    : '';
  const dots = growth.map((v, i) => (Number.isFinite(v)
    ? `<circle cx="${xCenter(i).toFixed(1)}" cy="${yGrowth(v).toFixed(1)}" r="2.2" fill="${LINE_COLOR}" stroke="#fff" stroke-width="1"></circle>`
    : '')).join('');

  const xLabels = labels.map((lab, i) => (i % labelEvery === 0
    ? `<text x="${xCenter(i).toFixed(1)}" y="${height - 22}" text-anchor="middle" class="axis-text">${escapeHtml(lab)}</text>`
    : '')).join('');

  // Prominent growth callout, lifted into the blank strip above the plot so it no
  // longer collides with the bars. The dashed connector drops straight to the exact
  // datapoint (same x as the line's last point).
  const lastGi = growth.reduce((acc, v, i) => (Number.isFinite(v) ? i : acc), -1);
  let callout = '';
  if (lastGi >= 0) {
    const val = growth[lastGi];
    const cx = xCenter(lastGi);
    const tx = Math.min(cx, width - margin.right - 30); // keep text on-canvas
    const cyDot = yGrowth(val);
    const pillY = margin.top - 30;
    callout = `<line x1="${cx.toFixed(1)}" y1="${(pillY + 20).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${cyDot.toFixed(1)}" stroke="${LINE_COLOR}" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"></line>
      <text x="${tx.toFixed(1)}" y="${(pillY + 14).toFixed(1)}" text-anchor="middle" fill="${LINE_COLOR}" font-size="20" font-weight="800" font-family="Helvetica Neue, Helvetica, Arial, Liberation Sans, DejaVu Sans, sans-serif" stroke="#ffffff" stroke-width="3.4" paint-order="stroke">${escapeHtml(fmtPct(val, 0))}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" class="wr-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}">
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${grid}
    ${zeroY != null ? `<line x1="${margin.left}" y1="${zeroY.toFixed(1)}" x2="${width - margin.right}" y2="${zeroY.toFixed(1)}" class="zero-line"></line>` : ''}
    ${bars}
    ${linePath}
    ${dots}
    ${callout}
    <line x1="${margin.left}" y1="${margin.top + ch}" x2="${width - margin.right}" y2="${margin.top + ch}" class="axis-line"></line>
    ${xLabels}
    ${rightAxis}
  </svg>`;
}

function buildPriceLineChartSvg(chart) {
  const labels = chart?.labels ?? [];
  const datasets = chart?.datasets ?? [];
  const values = datasets.flatMap(ds => (ds.data ?? []).filter(Number.isFinite));
  if (!labels.length || !datasets.length || !values.length) return '<div class="empty-chart">No pricing data</div>';

  const width = 520;
  const height = 205;
  const margin = { top: 12, right: 18, bottom: 24, left: 52 };
  const cw = width - margin.left - margin.right;
  const ch = height - margin.top - margin.bottom;

  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  if (yMin === yMax) {
    const bump = Math.max(0.01, Math.abs(yMax) * 0.05);
    yMin -= bump;
    yMax += bump;
  }
  const pad = (yMax - yMin) * 0.12;
  yMin = yMin >= 0 ? Math.max(0, yMin - pad) : yMin - pad;
  yMax += pad;

  const stepX = labels.length > 1 ? cw / (labels.length - 1) : 0;
  const xAt = i => margin.left + stepX * i;
  const yAt = v => margin.top + ch - ((v - yMin) / (yMax - yMin)) * ch;

  const yTicks = axisTicks(yMin, yMax, 4);
  const grid = yTicks.map((t) => {
    const y = yAt(t);
    return `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${width - margin.right}" y2="${y.toFixed(1)}" class="grid-line"></line>
      <text x="${margin.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis-text sm">${escapeHtml(chart.yFmt(t))}</text>`;
  }).join('');

  const lines = datasets.map((ds) => {
    const pts = (ds.data ?? [])
      .map((v, i) => (Number.isFinite(v) ? `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}` : null))
      .filter(Boolean);
    if (!pts.length) return '';
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${ds.color ?? ds.borderColor ?? C.slate}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
  }).join('');

  const lastDots = datasets.map((ds) => {
    const data = ds.data ?? [];
    let i = data.length - 1;
    while (i >= 0 && !Number.isFinite(data[i])) i -= 1;
    if (i < 0) return '';
    const color = ds.color ?? ds.borderColor ?? C.slate;
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(data[i]).toFixed(1)}" r="2.2" fill="${color}" stroke="#fff" stroke-width="0.8"></circle>`;
  }).join('');

  const labelEvery = Math.ceil(labels.length / 5);
  const xLabels = labels.map((lab, i) => (i % labelEvery === 0 || i === labels.length - 1
    ? `<text x="${xAt(i).toFixed(1)}" y="${height - 14}" text-anchor="middle" class="axis-text sm">${escapeHtml(lab)}</text>`
    : '')).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" class="wr-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title)}">
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${grid}
    ${lines}
    ${lastDots}
    <line x1="${margin.left}" y1="${margin.top + ch}" x2="${width - margin.right}" y2="${margin.top + ch}" class="axis-line"></line>
    ${xLabels}
  </svg>`;
}

// Horizontal latest-week token bars — one mainstream model per company. Fixed
// viewBox height (matches the tokens chart) with rows distributed to fill it.
function buildModelBarsChartSvg(bars) {
  if (!bars.length) return '<div class="empty-chart">No model data</div>';

  const width = 430;
  const height = 330;
  const margin = { top: 18, right: 48, bottom: 32, left: 142 };
  const cw = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const rowH = plotH / bars.length;
  const max = niceCeil(Math.max(...bars.map(b => b.tokens)) * 1.08);
  const xAt = v => margin.left + (v / max) * cw;

  const xTicks = axisTicks(0, max, 4);
  const grid = xTicks.map((t) => {
    const x = xAt(t);
    return `<line x1="${x.toFixed(1)}" y1="${margin.top}" x2="${x.toFixed(1)}" y2="${(margin.top + plotH).toFixed(1)}" class="grid-line"></line>
      <text x="${x.toFixed(1)}" y="${height - 14}" text-anchor="middle" class="axis-text sm">${fmtTok(t)}</text>`;
  }).join('');

  const bh = Math.min(26, rowH * 0.6);
  const rows = bars.map((b, i) => {
    const y = margin.top + i * rowH;
    const bw = Math.max(1, (b.tokens / max) * cw);
    return `<rect x="${margin.left}" y="${(y + (rowH - bh) / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${b.color}" opacity="0.9"></rect>
      <text x="${margin.left - 10}" y="${(y + rowH / 2 + 1).toFixed(1)}" text-anchor="end" class="model-name">${escapeHtml(b.model)}${b.approx ? ' *' : ''}</text>
      <text x="${(margin.left + bw + 6).toFixed(1)}" y="${(y + rowH / 2 + 1).toFixed(1)}" text-anchor="start" class="model-val" fill="${b.color}">${escapeHtml(fmtTok(b.tokens))}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" class="wr-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Latest-week tokens by mainstream model">
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${grid}
    ${rows}
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(margin.top + plotH).toFixed(1)}" class="axis-line"></line>
  </svg>`;
}

// Multi-line % chart for a supply chain's YoY, with every datapoint labelled
// (mirrors the site's pointValueLabels). Full width so the labels have room.
function buildYoyLineChartSvg(section) {
  const { periods, series } = section;
  const width = 520;
  const height = 255;
  if (!series.length || !periods.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="wr-chart"><rect width="${width}" height="${height}" fill="#ffffff"></rect><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="axis-text">No revenue data yet</text></svg>`;
  }

  const margin = { top: 14, right: 20, bottom: 24, left: 42 };
  const cw = width - margin.left - margin.right;
  const ch = height - margin.top - margin.bottom;

  const flat = series.flatMap(s => s.data.filter(Number.isFinite));
  let yMin = Math.min(0, ...flat);
  let yMax = Math.max(0, ...flat);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.14;
  yMin -= pad;
  yMax += pad;

  const stepX = periods.length > 1 ? cw / (periods.length - 1) : 0;
  const xAt = i => margin.left + stepX * i;
  const yAt = v => margin.top + ch - ((v - yMin) / (yMax - yMin)) * ch;

  const yTicks = axisTicks(yMin + pad, yMax - pad, 4);
  const grid = yTicks.map((t) => {
    const y = yAt(t);
    return `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${width - margin.right}" y2="${y.toFixed(1)}" class="grid-line"></line>
      <text x="${margin.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis-text sm">${t.toFixed(0)}%</text>`;
  }).join('');
  const zeroY = yMin < 0 && yMax > 0 ? yAt(0) : null;

  const lines = series.map((s) => {
    const pts = s.data
      .map((v, i) => (Number.isFinite(v) ? `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}` : null))
      .filter(Boolean);
    if (!pts.length) return '';
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
  }).join('');

  const dots = series.map(s => s.data.map((v, i) => (Number.isFinite(v)
    ? `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="1.9" fill="${s.color}" stroke="#fff" stroke-width="0.7"></circle>`
    : '')).join('')).join('');

  const labelEvery = Math.ceil(periods.length / 10);
  const xLabels = periods.map((p, i) => (i % labelEvery === 0
    ? `<text x="${xAt(i).toFixed(1)}" y="${height - 12}" text-anchor="middle" class="axis-text sm">${escapeHtml(p)}</text>`
    : '')).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="wr-chart" role="img" aria-label="${escapeHtml(section.label)} supply chain year-over-year growth">
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${grid}
    ${zeroY != null ? `<line x1="${margin.left}" y1="${zeroY.toFixed(1)}" x2="${width - margin.right}" y2="${zeroY.toFixed(1)}" class="zero-line"></line>` : ''}
    ${lines}
    ${dots}
    <line x1="${margin.left}" y1="${margin.top + ch}" x2="${width - margin.right}" y2="${margin.top + ch}" class="axis-line"></line>
    ${xLabels}
  </svg>`;
}

// ── HTML rendering ──────────────────────────────────────────────────────────
// Change cell — optional date label on top (used by pricing, whose columns are
// identified by their datapoint date), then the arrow + %.
function trendCellHtml(cell, extraClass = '') {
  if (!cell || !cell.dir) return `<td class="cell-flat ${extraClass}">—</td>`;
  const date = cell.date ? `<span class="cell-date">${escapeHtml(shortDate(cell.date))}</span>` : '';
  return `<td class="cell-${cell.dir} ${extraClass}">${date}<span class="glyph">${GLYPH[cell.dir]}</span> ${escapeHtml(fmtPct(cell.pct ?? cell.wow, 1))}</td>`;
}

// Demand "this week" cell: the change (larger, primary) on the left, the token
// count (smaller, secondary) on the right.
function valueCellHtml(value, cell) {
  const chg = !cell || !cell.dir
    ? '<span class="cell-chg-big cell-flat">—</span>'
    : `<span class="cell-chg-big cell-${cell.dir}"><span class="glyph">${GLYPH[cell.dir]}</span> ${escapeHtml(fmtPct(cell.pct ?? cell.wow, 1))}</span>`;
  return `<td class="hl cell-value">${chg}<span class="cell-tok-sm">${escapeHtml(value)}</span></td>`;
}

function renderDemandTable(table) {
  const last = table.weekHeaders.length - 1;
  const heads = table.weekHeaders.map((h, i) => `<th class="${i === last ? 'hl' : ''}">${escapeHtml(h)}</th>`).join('');
  const body = table.rows.map((row) => {
    const cells = row.cells.map((c, i) => (i === last
      ? valueCellHtml(row.latest != null ? fmtTok(row.latest) : '—', c)
      : trendCellHtml(c))).join('');
    return `<tr><td class="row-label">${escapeHtml(row.label)}</td>${cells}</tr>`;
  }).join('');

  return `<table class="wr-table">
    <thead><tr><th class="row-label">Company</th>${heads}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// Pricing: shared week-date column headers (like the demand table), cells carry
// only the arrow + %. Sectors align on the same ISO weeks, so a row missing a week
// shows "—" in that column. Latest (rightmost) column subtly highlighted.
function renderPricingTable(rows) {
  const allDates = [...new Set(rows.flatMap(r => r.changes.filter(c => c && c.date).map(c => c.date)))].sort();
  const headerDates = allDates.slice(-3); // oldest → newest
  const last = headerDates.length - 1;
  const heads = headerDates.map((d, i) => `<th class="${i === last ? 'hl' : ''}">${escapeHtml(shortDate(d))}</th>`).join('');

  const body = rows.map((r) => {
    const byDate = Object.fromEntries(r.changes.filter(c => c && c.date).map(c => [c.date, c]));
    const cells = headerDates.map((d, i) => {
      const c = byDate[d];
      const cls = i === last ? 'hl' : '';
      if (!c || !c.dir) return `<td class="cell-flat ${cls}">—</td>`;
      return `<td class="cell-${c.dir} ${cls}"><span class="glyph">${GLYPH[c.dir]}</span> ${escapeHtml(fmtPct(c.pct, 1))}</td>`;
    }).join('');
    return `<tr><td class="row-label">${escapeHtml(r.label)}</td>${cells}</tr>`;
  }).join('');

  return `<table class="wr-table">
    <thead><tr><th class="row-label">Sector</th>${heads}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderSupplyTiles(series) {
  if (!series.length) return '<div class="tiles-empty">Awaiting revenue data.</div>';
  return `<div class="tiles">${series.map((s) => {
    const cls = s.yoy > 0 ? 'up' : s.yoy < 0 ? 'down' : 'flat';
    return `<div class="tile" style="--accent:${s.color}">
      <div class="tile-l1"><span class="tile-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</div>
      <div class="tile-l2"><span class="tile-rev">${escapeHtml(fmtRevenue(s.revenue))}</span><span class="${cls}">${escapeHtml(fmtPct(s.yoy, 1))} YoY</span></div>
    </div>`;
  }).join('')}</div>`;
}

function renderSupplyCard(section) {
  const avg = Number.isFinite(section.latestAvgYoy) ? ` · avg ${fmtPct(section.latestAvgYoy, 1)} YoY` : '';
  return `<div class="supply-card">
    <div class="supply-head">${escapeHtml(section.label)} supply chain${escapeHtml(avg)}</div>
    ${renderSupplyTiles(section.series)}
    ${buildYoyLineChartSvg(section)}
  </div>`;
}

function renderDemandChartCard(company) {
  return `<div class="chart-wrap">
    <h3>${escapeHtml(company.label)}</h3>
    ${buildTokensYoyChartSvg(company.chart, `${company.label} weekly tokens versus year-over-year growth`)}
  </div>`;
}

function renderMiniLegend(datasets) {
  if (!datasets?.length) return '';
  return `<div class="mini-legend">${datasets.map(ds => `<span class="mini-legend-item"><span class="mini-swatch" style="background:${ds.color ?? ds.borderColor ?? C.slate}"></span>${escapeHtml(ds.label)}</span>`).join('')}</div>`;
}

function renderPricingChartCard(chart) {
  return `<div class="chart-wrap">
    <h3>${escapeHtml(chart.title)}</h3>
    ${renderPriceTiles(chart)}
    ${buildPriceLineChartSvg(chart)}
  </div>`;
}

function renderPriceTiles(chart) {
  const tiles = (chart.tiles ?? []).filter(t => Number.isFinite(t.price)).slice(0, 8);
  if (!tiles.length) return renderMiniLegend(chart.datasets);
  const fmt = chart.tileFmt ?? (v => String(v));
  const unit = chart.tileUnit ?? '';
  return `<div class="price-tiles">${tiles.map((t) => {
    const c7 = t.chg7d > 0 ? 'up' : t.chg7d < 0 ? 'down' : 'flat';
    const c30 = t.chg30d > 0 ? 'up' : t.chg30d < 0 ? 'down' : 'flat';
    return `<div class="price-tile" style="--accent:${t.color}">
      <div class="price-tile-name"><span class="tile-dot" style="background:${t.color}"></span>${escapeHtml(t.model ?? t.label)}</div>
      <div class="price-tile-numrow"><span class="price-tile-value">${escapeHtml(fmt(t.price))}<span>${escapeHtml(unit)}</span></span><span class="price-tile-chg"><span class="${c7}">7d ${escapeHtml(fmtPct(t.chg7d, 1))}</span><span class="${c30}">30d ${escapeHtml(fmtPct(t.chg30d, 1))}</span></span></div>
    </div>`;
  }).join('')}</div>`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function renderHtml(report) {
  const demandCards = [
    { label: 'Total weekly token usage', chart: report.demand.tokensYoy },
    ...report.demand.companyCharts,
  ];
  const demandPages = chunkArray(demandCards, 4);
  const supplyPages = chunkArray(report.supply, 4);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Weekly Report ${escapeHtml(report.date)}</title>
  <style>
    :root { --text:#111827; --muted:#6b7280; --line:#e5e7eb; --soft:#f9fafb; --up:${UP_COLOR}; --down:${DOWN_COLOR}; --hl:#eff6ff; }
    * { box-sizing: border-box; }
    body { margin:0; background:#fff; color:var(--text); line-height:1.4;
      font-family:"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
    .wr-table, .axis-text, .model-name, .model-val, .cell-tok-sm, .cell-date, .tile-rev, .tile-l2 { font-variant-numeric:tabular-nums; }
    main { max-width:1120px; margin:0 auto; padding:30px 30px 64px; }
    .report-header { display:flex; align-items:baseline; justify-content:space-between; gap:20px;
      border-bottom:2px solid var(--text); padding-bottom:14px; margin-bottom:8px; }
    .report-header h1 { margin:0; font-size:30px; font-weight:800; letter-spacing:-.01em; }
    .report-date { color:var(--muted); font-size:13px; white-space:nowrap; }
    .table-row { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
    .panel { min-width:0; }
    .as-of { color:var(--muted); font-size:12px; margin:6px 0 26px; }
    section.block { padding:22px 0 30px; border-bottom:1px solid var(--line); }
    section.block:last-child { border-bottom:0; }
    h2.section-title { margin:0 0 12px; font-size:13px; font-weight:800; letter-spacing:.08em;
      text-transform:uppercase; color:var(--text); break-after:avoid; }
    .wr-chart { width:100%; height:auto; display:block; }
    .grid-line { stroke:#eef2f7; stroke-width:1; }
    .zero-line { stroke:#cbd5e1; stroke-width:1; stroke-dasharray:4 4; }
    .axis-line { stroke:#9ca3af; stroke-width:1; }
    .axis-text { fill:#6b7280; font-size:12px; font-family:"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
    .axis-text.sm { font-size:10px; }
    .axis-text.growth { fill:${LINE_COLOR}; }
    .axis-cap { fill:#6b7280; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    .axis-cap.growth { fill:${LINE_COLOR}; }
    .model-name { fill:#374151; font-size:11px; font-family:"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
    .model-val { font-size:12px; font-weight:800; font-family:"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
    .demand-pages { display:grid; gap:14px; margin-top:6px; }
    .demand-page:not(:last-child) { break-after:page; }
    .demand-company-grid, .pricing-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px; margin-top:6px; align-items:stretch; }
    .chart-wrap { border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; }
    .chart-wrap h3 { margin:0 0 8px; font-size:13px; font-weight:800; text-align:center; }
    .chart-wrap .wr-chart { width:100%; height:auto; margin-top:auto; }
    .demand-company-grid .chart-wrap { padding:8px 10px; }
    .demand-company-grid .chart-wrap h3 { margin-bottom:4px; font-size:11px; }
    .pricing-grid { gap:9px; }
    .pricing-grid .chart-wrap { padding:7px 9px; border-radius:8px; }
    .pricing-grid .chart-wrap h3 { margin-bottom:4px; font-size:10px; }
    .mini-legend { display:flex; flex-wrap:wrap; justify-content:center; gap:5px 10px; min-height:18px; margin:-1px 0 4px; }
    .mini-legend-item { display:inline-flex; align-items:center; gap:4px; color:#4b5563; font-size:9px; font-weight:700; white-space:nowrap; }
    .mini-swatch { width:8px; height:8px; border-radius:999px; display:inline-block; flex:none; }
    .price-tiles { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:4px; margin:0 0 5px; }
    .price-tile { border:1px solid var(--line); border-left:2px solid var(--accent); border-radius:5px; padding:3px 5px; background:var(--soft); min-width:0; }
    .price-tile-name { display:flex; align-items:center; gap:3px; color:#374151; font-size:7.2px; line-height:1.1; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .price-tile-numrow { display:flex; align-items:baseline; gap:5px; min-width:0; margin-top:2px; white-space:nowrap; }
    .price-tile-value { font-size:10.4px; line-height:1.1; font-weight:800; font-variant-numeric:tabular-nums; flex:none; }
    .price-tile-value span { margin-left:2px; color:var(--muted); font-size:6.8px; font-weight:700; }
    .price-tile-chg { display:flex; gap:4px; min-width:0; overflow:hidden; font-size:6.9px; line-height:1.1; font-weight:800; font-variant-numeric:tabular-nums; }
    table.wr-table { width:100%; border-collapse:collapse; font-size:13px; margin-top:6px; }
    .wr-table th, .wr-table td { border-bottom:1px solid var(--line); padding:5px 6px; text-align:center; white-space:nowrap; vertical-align:middle; }
    .wr-table th { color:var(--muted); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    .wr-table th.row-label, .wr-table td.row-label { text-align:left; }
    .wr-table td.row-label { font-weight:700; }
    .wr-table tbody tr:last-child td { border-bottom:0; }
    .wr-table td.cell-up, .cell-up, .up { color:var(--up); font-weight:700; }
    .wr-table td.cell-down, .cell-down, .down { color:var(--down); font-weight:700; }
    .wr-table td.cell-flat, .cell-flat, .flat { color:var(--muted); }
    .wr-table th.hl, .wr-table td.hl { background:var(--hl); }
    .cell-date { display:block; font-size:9px; font-weight:500; color:var(--muted); font-family:"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
    .cell-value .cell-chg-big { font-size:15px; font-weight:800; margin-right:7px; }
    .cell-value .cell-tok-sm { font-size:11px; color:var(--muted); }
    .glyph { font-size:11px; }
    .supply-pages { display:grid; gap:9px; }
    .supply-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:9px; margin-top:6px; }
    .supply-page:not(:last-child) { break-after:page; }
    .supply-card { border:1px solid var(--line); border-radius:8px; padding:7px 9px 5px; }
    .supply-head { font-size:10px; font-weight:800; margin-bottom:5px; text-align:center; }
    .tiles { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:4px; margin-bottom:5px; }
    .tile { border:1px solid var(--line); border-left:2px solid var(--accent); border-radius:6px; padding:4px 5px; min-width:0; background:var(--soft); display:flex; flex-direction:column; }
    .tile-l1, .tile-l2 { display:flex; align-items:center; gap:3px; height:16px; min-width:0; }
    .tile-l1 { font-size:8.2px; font-weight:700; color:#374151; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tile-dot { width:6px; height:6px; border-radius:999px; display:inline-block; flex:none; }
    .tile-l2 { justify-content:flex-start; gap:4px; white-space:nowrap; }
    .tile-rev { font-size:9.2px; font-weight:800; font-family:"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; color:var(--text); }
    .tile-l2 .up, .tile-l2 .down, .tile-l2 .flat { font-size:6.8px; font-family:"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
    .tiles-empty { color:var(--muted); font-size:12px; padding:16px 0; }
    .empty-chart { padding:60px 0; text-align:center; color:var(--muted); }
    @page { size: A4 landscape; margin: 9mm 9mm 8mm; }
    @media print {
      main { max-width:none; padding:0; }
      .report-header { padding-bottom:10px; margin-bottom:6px; }
      .report-header h1 { font-size:27px; }
      section.block { padding:8px 0 12px; }
      h2.section-title { margin-bottom:8px; }
      .pricing-block, .supply-block { break-before:page; }
      .demand-page:not(:last-child) { break-after:page; }
      .supply-page:not(:last-child) { break-after:page; }
      .supply-card, .chart-wrap, .panel { break-inside:avoid; }
      .table-row { break-inside:avoid; }
    }
  </style>
</head>
<body>
  <main>
    <header class="report-header">
      <h1>${escapeHtml(fmtReportDate(report.date))}</h1>
      <div class="report-date">AI Weekly Report</div>
    </header>

    <section class="block">
      <h2 class="section-title">AI Demand - OpenRouter Token Usage and YoY Growth</h2>
      <div class="demand-pages">
        ${demandPages.map(group => `<div class="demand-company-grid demand-page">${group.map(renderDemandChartCard).join('')}</div>`).join('')}
      </div>
    </section>

    <section class="block pricing-block">
      <h2 class="section-title">Pricing</h2>
      <div class="pricing-grid">
        ${report.pricingCharts.map(renderPricingChartCard).join('')}
      </div>
    </section>

    <section class="block supply-block">
      <h2 class="section-title">AI Supply Chain - Monthly Revenue YoY</h2>
      <div class="supply-pages">
        ${supplyPages.map(group => `<div class="supply-grid supply-page">${group.map(renderSupplyCard).join('')}</div>`).join('')}
      </div>
    </section>
  </main>
</body>
</html>
`;
}

// ── Markdown rendering (assets written alongside as SVG) ─────────────────────
function renderMarkdown(report, outPath) {
  const baseName = path.basename(outPath, path.extname(outPath));
  const assetsDirName = `${baseName}-assets`;
  const assetsDir = path.join(path.dirname(outPath), assetsDirName);
  fs.mkdirSync(assetsDir, { recursive: true });

  const safeName = value => String(value ?? 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart';
  const lines = [`# AI Weekly Report — ${fmtReportDate(report.date)}`, ''];

  // Demand
  lines.push('## AI Demand - OpenRouter Token Usage and YoY Growth', '');
  fs.writeFileSync(path.join(assetsDir, 'demand-tokens-yoy.svg'), buildTokensYoyChartSvg(report.demand.tokensYoy, 'Total weekly OpenRouter tokens versus year-over-year growth'));
  lines.push(`![Total weekly tokens vs YoY growth](${assetsDirName}/demand-tokens-yoy.svg)`, '');

  for (const company of report.demand.companyCharts) {
    const name = `demand-${safeName(company.provider)}-tokens-yoy.svg`;
    fs.writeFileSync(path.join(assetsDir, name), buildTokensYoyChartSvg(company.chart, `${company.label} weekly tokens versus year-over-year growth`));
    const latest = Number.isFinite(company.latestYoy) ? ` (${fmtPct(company.latestYoy, 0)} YoY)` : '';
    lines.push(`![${escapeMd(company.label)}${latest}](${assetsDirName}/${name})`, '');
  }

  // Pricing
  lines.push('## Pricing', '');
  for (const chart of report.pricingCharts) {
    const name = `pricing-${safeName(chart.id)}.svg`;
    fs.writeFileSync(path.join(assetsDir, name), buildPriceLineChartSvg(chart));
    const series = chart.datasets.map(ds => ds.label).join(' · ');
    lines.push(`_${escapeMd(series)}_`, '');
    lines.push(`![${escapeMd(chart.title)}](${assetsDirName}/${name})`, '');
  }

  // Supply
  lines.push('## AI Supply Chain - Monthly Revenue YoY', '', 'Year-over-year monthly revenue growth per supply chain.', '');
  for (const section of report.supply) {
    lines.push(`### ${section.label} supply chain`, '');
    if (!section.series.length) { lines.push('_Awaiting revenue data._', ''); continue; }
    const tiles = section.series.map(s => `${s.label}: ${fmtRevenue(s.revenue)} (${fmtPct(s.yoy, 1)} YoY)`).join(' · ');
    lines.push(`_${escapeMd(tiles)}_`, '');
    const name = `supply-${section.id}-yoy.svg`;
    fs.writeFileSync(path.join(assetsDir, name), buildYoyLineChartSvg(section));
    lines.push(`![${section.label} YoY growth](${assetsDirName}/${name})`, '');
  }
  lines.push('');

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

// ── Data loading ────────────────────────────────────────────────────────────
function fromSnapshot() {
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  const g = key => raw[key]?.data ?? null;
  const dram = preferLongHistory(g('dram'), fromLocalDramHistory(), 'series');
  const gpu = preferLongHistory(g('gpu'), fromLocalGpuHistory(), 'series');
  const aws = preferLongHistory(g('aws'), fromLocalAwsHistory(), 'spotSeries');
  return {
    openrouterRanks: g('openrouterRanks'),
    mops: fromMopsFile(process.env.WEEKLY_REPORT_MOPS_FILE) ?? g('mops'),
    dram,
    nand: g('nand') ?? fromLocalTrendforceHistory('nand'),
    gpu,
    aws,
    cpu: g('cpu'),
    tpu: g('tpu'),
    source: 'snapshot',
  };
}

function fromMopsFile(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed?.companies ? parsed : null;
  } catch (error) {
    console.warn(`[weekly-report] MOPS file fallback failed (${error.message})`);
    return null;
  }
}

function preferLongHistory(primary, fallback, seriesKey) {
  const pLen = primary?.history?.dates?.length ?? 0;
  const fLen = fallback?.history?.dates?.length ?? 0;
  if (fLen > pLen && Object.keys(fallback?.history?.[seriesKey] ?? {}).length) return fallback;
  return primary ?? fallback;
}

function dayKeys(history) {
  return Object.keys(history ?? {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

function dailyDates(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return [];
  const out = [];
  for (let t = a; t <= b; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function fromLocalDramHistory() {
  try {
    const raw = require('../data/dramHistory.json');
    const dates = dayKeys(raw);
    const latest = dates.at(-1);
    if (!latest) return null;
    const products = [...new Set(dates.flatMap(d => Object.keys(raw[d] ?? {})))].sort();
    const series = Object.fromEntries(products.map(product => [product, dates.map(d => raw[d]?.[product] ?? null)]));
    const models = products.map(model => ({
      model,
      category: /DIMM/i.test(model) ? 'module' : /^GDDR/i.test(model) ? 'graphics' : 'chip',
      price: latestFinite(series[model]),
      variants: 1,
    }));
    return { models, history: { dates, series }, index: null, asOf: latest };
  } catch (error) {
    console.warn(`[weekly-report] local DRAM fallback failed (${error.message})`);
    return null;
  }
}

function fromLocalAwsHistory() {
  try {
    const raw = require('../data/awsHistory.json');
    const dates = dayKeys(raw);
    if (!dates.length) return null;
    const accels = [...new Set(dates.flatMap(d => Object.keys(raw[d] ?? {})))];
    const fill = (field) => Object.fromEntries(accels.map((a) => {
      let last = null;
      const vals = dates.map((d) => {
        const v = raw[d]?.[a]?.[field];
        if (Number.isFinite(v)) last = v;
        return last;
      });
      return [a, vals];
    }));
    return {
      current: {},
      onDemand: raw._meta?.onDemand ?? {},
      history: { dates, spotSeries: fill('spot'), savingsSeries: fill('savings'), interruptSeries: fill('interrupt') },
      asOf: dates.at(-1),
    };
  } catch (error) {
    console.warn(`[weekly-report] local AWS fallback failed (${error.message})`);
    return null;
  }
}

function fromLocalGpuHistory() {
  try {
    const raw = require('../data/gpuHistory.json');
    const dates = dayKeys(raw);
    if (!dates.length) return null;
    const gpus = [...new Set(dates.flatMap(d => Object.keys(raw[d] ?? {})))];
    const fill = (field) => Object.fromEntries(gpus.map((g) => {
      let last = null;
      const vals = dates.map((d) => {
        const v = raw[d]?.[g]?.[field];
        if (Number.isFinite(v)) last = v;
        return last;
      });
      return [g, vals];
    }));
    const series = fill('od');
    const spotSeries = fill('spot');
    const rawSeries = Object.fromEntries(gpus.map(g => [g, dates.map(d => Number.isFinite(raw[d]?.[g]?.od) ? raw[d][g].od : null)]));
    const rawSpotSeries = Object.fromEntries(gpus.map(g => [g, dates.map(d => Number.isFinite(raw[d]?.[g]?.spot) ? raw[d][g].spot : null)]));
    const index = dates.map((_, i) => {
      const vals = gpus.map(g => series[g]?.[i]).filter(Number.isFinite);
      return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3) : null;
    });
    return {
      prices: Object.fromEntries(gpus.map(g => [g, latestFinite(series[g])]).filter(([, v]) => Number.isFinite(v))),
      spot: Object.fromEntries(gpus.map(g => [g, latestFinite(spotSeries[g])]).filter(([, v]) => Number.isFinite(v))),
      availability: {},
      history: { dates, series, spotSeries, rawSeries, rawSpotSeries, index },
      asOf: dates.at(-1),
    };
  } catch (error) {
    console.warn(`[weekly-report] local GPU fallback failed (${error.message})`);
    return null;
  }
}

function fromLocalTrendforceHistory(key) {
  try {
    const { buildHistory, configFor, loadHistory } = require('../scrapers/trendforcePrice');
    const cfg = configFor(key);
    const raw = loadHistory(key);
    const dates = Object.keys(raw ?? {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const asOf = dates.at(-1);
    if (!asOf) return null;
    return {
      products: Object.entries(raw[asOf] ?? {}).map(([product, price]) => ({ product, price, variants: 1 })),
      history: buildHistory(raw, asOf),
      asOf,
      sourceUrl: cfg.url,
      methodology: cfg.methodology,
    };
  } catch (error) {
    console.warn(`[weekly-report] local TrendForce ${key} fallback failed (${error.message})`);
    return null;
  }
}

// Scrape the six datasets live by calling the same scraper functions the server
// uses. Any source that fails falls back to its last-good snapshot value so a
// single flaky feed can't blank a section.
async function fromLiveScrape() {
  const { scrapers } = require('../scheduler');
  const snap = fromSnapshot();
  const keys = ['openrouterRanks', 'mops', 'dram', 'nand', 'gpu', 'aws', 'cpu', 'tpu'];
  const results = await Promise.allSettled(keys.map(k => scrapers[k]()));
  const data = { source: 'live' };
  keys.forEach((k, i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value != null) {
      data[k] = r.value;
    } else {
      if (r.status === 'rejected') console.warn(`[weekly-report] live ${k} failed (${r.reason?.message}); using snapshot`);
      data[k] = snap[k];
    }
  });
  return data;
}

async function fetchJson(url, ms = 30000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

// Load the six datasets the report needs. Primary source is the running server's
// /api/* endpoints (warm cache — no slow re-scrape, no rate-limit risk); if every
// endpoint is unreachable, fall back to the last-good persisted snapshot so the
// report can still be produced offline / in tests.
async function loadWeeklyData({ baseUrl = DEFAULT_BASE_URL, snapshot = false, live = false } = {}) {
  if (snapshot) return fromSnapshot();
  if (live) return fromLiveScrape();

  const endpoints = {
    openrouterRanks: 'openrouter-ranks', mops: 'mops', dram: 'dram', nand: 'nand', gpu: 'gpu', aws: 'aws', cpu: 'cpu', tpu: 'tpu',
  };
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, route]) => [key, await fetchJson(`${baseUrl}/api/${route}`)]),
  );
  const data = Object.fromEntries(entries);

  if (Object.values(data).every(v => v == null)) {
    console.warn('[weekly-report] no server data reachable — falling back to persisted snapshot');
    return fromSnapshot();
  }
  const snap = fromSnapshot();
  return { ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? snap[k]])), source: baseUrl };
}

// ── Assembly ────────────────────────────────────────────────────────────────
function buildReport(data, { date = today() } = {}) {
  const ranks = data.openrouterRanks;
  const demandCharts = buildDemandCharts(ranks);
  const demand = {
    table: buildDemandTable(ranks, 3),
    tokensYoy: demandCharts.total,
    companyCharts: demandCharts.companies,
  };
  const supply = buildSupplySections(data.mops, SUPPLY_MONTHS);
  const pricing = buildPricingTable(data);
  const pricingCharts = buildPricingCharts(data, PRICING_WEEKS);

  const asOfBits = [];
  if (ranks?.asOf) asOfBits.push(`demand as of ${ranks.asOf}`);
  if (data.dram?.asOf) asOfBits.push(`pricing as of ${data.dram.asOf}`);
  const asOfLine = `Data source: ${data.source === 'snapshot' ? 'persisted snapshot' : 'live'}${asOfBits.length ? ` · ${asOfBits.join(' · ')}` : ''}`;

  return { date, asOfLine, demand, supply, pricing, pricingCharts };
}

async function generateWeeklyReport({ date = today(), out = null, format = null, baseUrl, snapshot = false, live = false } = {}) {
  const outPath = path.resolve(out ?? `ai-weekly-report-${date}.html`);
  const outputFormat = format ?? (path.extname(outPath).toLowerCase() === '.md' ? 'md' : 'html');

  const data = await loadWeeklyData({ baseUrl, snapshot, live });
  const report = buildReport(data, { date });

  const content = outputFormat === 'md' ? renderMarkdown(report, outPath) : renderHtml(report);
  fs.writeFileSync(outPath, content);

  return { outPath, format: outputFormat, report, content };
}

function parseArgs(argv) {
  const args = { date: today(), out: null, format: null, baseUrl: undefined, snapshot: false, live: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date' && argv[i + 1]) { args.date = argv[i + 1]; i += 1; }
    else if (arg === '--out' && argv[i + 1]) { args.out = argv[i + 1]; i += 1; }
    else if (arg === '--format' && argv[i + 1]) { args.format = argv[i + 1].trim().toLowerCase(); i += 1; }
    else if (arg === '--base-url' && argv[i + 1]) { args.baseUrl = argv[i + 1]; i += 1; }
    else if (arg === '--snapshot') { args.snapshot = true; }
    else if (arg === '--live') { args.live = true; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await generateWeeklyReport(args);
  console.log(result.outPath);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  generateWeeklyReport,
  loadWeeklyData,
  buildReport,
  buildDemandTable,
  buildModelBars,
  orTokensWithGrowth,
  buildSupplySections,
  buildPricingTable,
  renderHtml,
  renderMarkdown,
  today,
};
