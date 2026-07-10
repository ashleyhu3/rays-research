import { useMemo } from 'react';
import { Line, Bar, Scatter } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, stackedOpts, dualAxisOpts, mkDs, mkBar, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { orTokensWithGrowth, fmtGrowthPct } from '../../utils/openrouterProvider';
import { buildCompanyRevenue, fmtUsd, livePriceForSlug } from '../../utils/companyRevenue';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

// Provider → brand color
const PROV_COLOR = {
  OpenAI:           C.openai,
  Anthropic:        C.anthropic,
  Google:           C.google,
  Meta:             C.meta,
  Mistral:          C.mistral,
  DeepSeek:         C.deepseek,
  'Alibaba (Qwen)': '#facc15',
  xAI:              '#9ca3af',
  MiniMax:          C.minimax,
  'Zhipu AI':       C.zhipu,
  'Moonshot AI':    C.kimi,
  Cohere:           C.perplexity,
  Perplexity:       C.perplexity,
  Tencent:          '#1db954',
  Xiaomi:           C.red,
  OpenRouter:       C.teal,
  ByteDance:        '#fe2c55',
  Baidu:            C.baidu,
  '01.AI':          '#e879f9',
  Other:            C.slate,
};

function provColor(name) { return PROV_COLOR[name] ?? C.slate; }

function modelColor(slug) {
  if (!slug) return C.slate;
  const prefix = slug.split('/')[0];
  const map = {
    openai: C.openai, anthropic: C.anthropic, google: C.google,
    'meta-llama': C.meta, mistralai: C.mistral, deepseek: C.deepseek,
    qwen: '#facc15', 'x-ai': '#9ca3af', minimax: C.minimax,
    thudm: C.zhipu, 'z-ai': C.zhipu, moonshotai: C.kimi,
    cohere: C.perplexity, perplexity: C.perplexity,
    tencent: '#1db954', xiaomi: C.red, openrouter: C.teal,
    bytedance: '#fe2c55', baidu: C.baidu, '01-ai': '#e879f9',
  };
  return map[prefix] ?? C.slate;
}

const fmtB = v => {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
  return String(v);
};

function weekLabel(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// True when the most recent ISO week in the scrape is still in progress (its
// Sunday hasn't been reached yet), so its per-model totals are partial.
function isPartialLatestWeek(ranks) {
  const labels = ranks?.weekLabels ?? [];
  const lastMonday = labels[labels.length - 1];
  if (!lastMonday || !ranks?.asOf) return false;
  const weekEnd = new Date(new Date(lastMonday + 'T00:00:00Z').getTime() + 6 * 86400000);
  return new Date(ranks.asOf + 'T00:00:00Z') < weekEnd;
}

// A "nice" round tick step near hi/count, then the smallest multiple of that
// step at or above `hi` — so the axis fits the data snugly (highest point ~6T →
// top gridline 6T, not 10T) while ticks stay on clean, evenly-spaced values.
function niceLinearBound(hi, count = 5) {
  if (!(hi > 0)) return { max: count, step: 1 };
  const rawStep = hi / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(hi / step) * step, step };
}

// Volume-vs-price scatter: linear axes so equal on-screen distance always means
// an equal change in value (0→10 spans the same width as 90→100), rather than a
// log scale where each power of ten is equally wide. Bounds/ticks are derived
// from the current week's data; each point is one model.
function makeVolPriceOpts(xMax, yMax) {
  const x = niceLinearBound(xMax);
  const y = niceLinearBound(yMax);
  const linAxis = (bound, text, fmt) => ({
    type: 'linear',
    min: 0,
    max: bound.max,
    ticks: { ...TICK, stepSize: bound.step, callback: fmt },
    title: { display: true, text, color: '#94a3b8', font: { size: 11 } },
    grid: GRID,
    border: BORD,
  });
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: ctx => ctx[0]?.raw?.name ?? '',
          label: ctx => `${fmtB(ctx.raw.y)} tokens · $${ctx.raw.x.toFixed(2)}/M input`,
        },
      },
    },
    scales: {
      x: linAxis(x, 'Input price ($/M tokens)', v => `$${v}`),
      y: linAxis(y, 'Weekly tokens', v => fmtB(v)),
    },
  };
}

function NoKey() {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: '#94a3b8' }}>
      <p style={{ marginBottom: 8, fontSize: 15 }}>OpenRouter rankings require an API key.</p>
      <p style={{ fontSize: 13 }}>
        Add <code style={{ background: '#1e2330', padding: '2px 6px', borderRadius: 4 }}>OPENROUTER_API_KEY=sk-or-...</code> to your <code>.env</code> and restart the server.
      </p>
      <p style={{ fontSize: 12, marginTop: 8 }}>
        Free keys at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" style={{ color: '#39d0b4' }}>openrouter.ai/keys</a>
      </p>
    </div>
  );
}

export default function DemandOpenRouter({ weeks: W = 52 }) {
  const { liveData: ld } = useData();
  const ranks = ld?.openrouterRanks;

  // Slice all full-history arrays to the requested window
  const wkLabels = useMemo(() => {
    const all = (ranks?.weekLabels ?? []).map(weekLabel);
    return all.slice(-W);
  }, [ranks, W]);

  // ── 1. Top 10 models horizontal bar (latest week) ─────────────────
  const topBarData = useMemo(() => {
    if (!ranks?.topModels?.length) return null;
    const top10 = ranks.topModels.slice(0, 10);
    return {
      labels: top10.map(m => m.name),
      datasets: [{
        label: 'Tokens (latest week)',
        data:            top10.map(m => m.tokens),
        backgroundColor: top10.map(m => fa(modelColor(m.slug), 0.75)),
        borderColor:     top10.map(m => modelColor(m.slug)),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [ranks]);

  // ── 2. Provider stacked bar over W weeks ──────────────────────────
  const provStackData = useMemo(() => {
    const pw = ranks?.providerWeekly;
    if (!pw || !wkLabels.length) return null;
    const provs = Object.keys(pw).filter(p => p !== 'Other');
    const datasets = [
      ...provs.map(prov => ({
        label: prov,
        data:  (pw[prov] ?? []).slice(-W),
        backgroundColor: fa(provColor(prov), 0.75),
        borderColor:     provColor(prov),
        borderWidth: 1,
        stack: 'providers',
      })),
      {
        label: 'Other',
        data:  (pw['Other'] ?? []).slice(-W),
        backgroundColor: fa(C.slate, 0.40),
        borderColor:     C.slate,
        borderWidth: 1,
        stack: 'providers',
      },
    ];
    return { labels: wkLabels, datasets };
  }, [ranks, wkLabels, W]);

  // ── 3. Volume vs price scatter (most recent full week) ────────────
  // One point per tracked model: x = current $/M input price, y = tokens in the
  // latest complete week. Models without a live price or volume are dropped.
  const volPriceData = useMemo(() => {
    const models = ld?.openrouter?.models ?? ld?.openrouter?.data?.models ?? [];
    const list = ranks?.topModels ?? [];
    if (!list.length) return null;
    const partial = isPartialLatestWeek(ranks);
    const pts = list.map(m => {
      const price = livePriceForSlug(m.slug, models);
      const vol   = partial ? m.prevTokens : m.tokens;
      if (!(price > 0) || !(vol > 0)) return null;
      return { x: price, y: vol, name: m.name, color: modelColor(m.slug) };
    }).filter(Boolean);
    if (!pts.length) return null;
    return {
      datasets: [{
        label: 'Models',
        data: pts,
        pointBackgroundColor: pts.map(p => fa(p.color, 0.8)),
        pointBorderColor:     pts.map(p => p.color),
        pointBorderWidth: 1,
        pointRadius: 6,
        pointHoverRadius: 8,
      }],
    };
  }, [ranks, ld]);

  // Linear axis bounds for the scatter, recomputed from the current week's points
  // so the ticks stay evenly spaced with clean round values whatever the range.
  const volPriceOpts = useMemo(() => {
    const pts = volPriceData?.datasets?.[0]?.data ?? [];
    if (!pts.length) return null;
    return makeVolPriceOpts(
      Math.max(...pts.map(p => p.x)),
      Math.max(...pts.map(p => p.y)),
    );
  }, [volPriceData]);

  // ── 4. Combined: total weekly tokens (bars) + YoY growth (line) ───
  const comboData = useMemo(() => {
    const s = orTokensWithGrowth(ranks, null, W, 52);
    if (!s) return null;
    return {
      labels: s.labels,
      datasets: [
        // Lowest order draws last → line renders on top of the bars
        { ...mkDs('YoY growth (%)', C.orange, s.growth), type: 'line', yAxisID: 'y1', order: 0 },
        { ...mkBar('Total tokens', C.teal, s.tokens), yAxisID: 'y', order: 1 },
      ],
    };
  }, [ranks, W]);

  // ── 5. WoW growth horizontal bar ──────────────────────────────────
  const growthData = useMemo(() => {
    if (!ranks?.topModels?.length) return null;
    const models = ranks.topModels
      .filter(m => m.wow !== null && m.prevTokens > 0)
      .sort((a, b) => b.wow - a.wow)
      .slice(0, 10);
    if (models.length === 0) return null;
    const vals = models.map(m => Math.round(m.wow * 100));
    return {
      labels: models.map(m => m.name),
      datasets: [{
        label: 'WoW change (%)',
        data:            vals,
        backgroundColor: vals.map((v, i) => fa(modelColor(models[i].slug), v >= 0 ? 0.75 : 0.40)),
        borderColor:     models.map(m => modelColor(m.slug)),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [ranks]);

  // ── 6. Estimated weekly revenue per company (bar) ─────────────────
  // Σ over each company's models of weekly tokens × $/M input price.
  const revenueData = useMemo(() => buildCompanyRevenue(ranks, ld), [ranks, ld]);

  const asOf = ranks?.asOf ? new Date(ranks.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const latestWeek = ranks?.latestWeek ? weekLabel(ranks.latestWeek) : null;

  if (!ranks) {
    return (
      <div className="chart-grid">
        <div style={{ gridColumn: '1 / -1' }}><NoKey /></div>
      </div>
    );
  }

  return (
    <EditableGrid viewId="openrouter-rankings">

      <ChartCard
        chartId="or-revenue"
        subtitle={`Weekly, past 6 months${asOf ? ` · as of ${asOf}` : ''}. Weekly tokens × current $/M input price, summed per company.`}
        height={380} span2
      >
        {revenueData ? <Line data={revenueData} options={baseOpts(fmtUsd)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-volprice"
        subtitle={`Most recent full week${asOf ? ` · as of ${asOf}` : ''}. Each point is a model: weekly token volume vs current input price (linear axes).`}
        height={380} span2
      >
        {volPriceData && volPriceOpts ? <Scatter data={volPriceData} options={volPriceOpts} /> : <NoKey />}
      </ChartCard>

      {comboData && (
        <ChartCard
          chartId="or-combo"
          height={260} span2
        >
          <Bar data={comboData} options={dualAxisOpts(fmtB, fmtGrowthPct)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="or-top"
        subtitle={`Week of ${latestWeek ?? '—'}${asOf ? ` · as of ${asOf}` : ''}. Prompt + completion tokens combined.`}
        height={260} span2
      >
        {topBarData ? <Bar data={topBarData} options={hBarOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-provstack"
        height={260} span2
      >
        {provStackData ? <Bar data={provStackData} options={stackedOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      {growthData && (
        <ChartCard
          chartId="or-growth"
          height={220}
        >
          <Bar data={growthData} options={hBarOpts(v => `${v > 0 ? '+' : ''}${v}%`)} />
        </ChartCard>
      )}

    </EditableGrid>
  );
}
