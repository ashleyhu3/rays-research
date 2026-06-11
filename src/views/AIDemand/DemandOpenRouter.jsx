import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, stackedOpts, mkDs, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
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

// Stacked bar options with legend shown (for provider breakdown)
const stackedLegendOpts = (yFmt) => ({
  ...stackedOpts(yFmt),
  plugins: {
    legend: {
      display: true,
      position: 'bottom',
      labels: {
        color: '#c8c8c0',
        font: { size: 10, family: "'Inter',sans-serif" },
        padding: 10,
        boxWidth: 10,
      },
    },
    tooltip: {
      backgroundColor: '#1a1f2a',
      borderColor: 'rgba(255,255,255,.12)',
      borderWidth: 1,
      titleFont: { family: "'Inter',sans-serif", size: 11 },
      bodyFont:  { family: "'Inter',sans-serif", size: 11 },
      padding: 10,
      callbacks: { label: c => ` ${c.dataset.label}: ${yFmt(c.parsed.y)}` },
    },
  },
});

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

  // ── 3. Top 8 models weekly token trend (line) ─────────────────────
  const trendData = useMemo(() => {
    if (!ranks?.trend || !wkLabels.length) return null;
    const slugs = Object.keys(ranks.trend).slice(0, 8);
    return {
      labels: wkLabels,
      datasets: slugs.map(slug => mkDs(
        ranks.topModels.find(m => m.slug === slug)?.name ?? slug,
        modelColor(slug),
        (ranks.trend[slug] ?? []).slice(-W),
      )),
    };
  }, [ranks, wkLabels, W]);

  // ── 4. Platform total weekly tokens (bar + trend line overlay) ────
  const platformData = useMemo(() => {
    if (!ranks?.weeklyTotals?.length || !wkLabels.length) return null;
    return {
      labels: wkLabels,
      datasets: [mkDs('Total tokens', C.teal, ranks.weeklyTotals.slice(-W), true)],
    };
  }, [ranks, wkLabels, W]);

  // ── 4b. Platform MoM / YoY growth of weekly token volume ──────────
  // The current ISO week is still accumulating, so growth on its partial
  // total would read as a fake drop — exclude it unless the week is complete.
  const completeWeeks = useMemo(() => {
    const totals = ranks?.weeklyTotals ?? [];
    if (totals.length === 0) return null;
    const lastMonday = ranks.weekLabels?.[ranks.weekLabels.length - 1];
    const weekEnd = lastMonday ? new Date(new Date(lastMonday + 'T00:00:00Z').getTime() + 6 * 86400000) : null;
    const partial = weekEnd && ranks.asOf ? new Date(ranks.asOf + 'T00:00:00Z') < weekEnd : false;
    return {
      totals: partial ? totals.slice(0, -1) : totals,
      labels: (ranks.weekLabels ?? []).slice(0, partial ? -1 : undefined).map(weekLabel),
    };
  }, [ranks]);

  const growthSeries = (lag) => {
    if (!completeWeeks) return null;
    const { totals, labels } = completeWeeks;
    const vals = totals.map((v, i) =>
      i >= lag && totals[i - lag] > 0 ? +((v / totals[i - lag] - 1) * 100).toFixed(1) : null
    );
    const w = Math.min(W, vals.length);
    const sliced = vals.slice(-w), labs = labels.slice(-w);
    if (!sliced.some(v => v != null)) return null;
    return {
      labels: labs,
      datasets: [{
        label: 'Growth (%)',
        data: sliced,
        backgroundColor: sliced.map(v => fa(v != null && v >= 0 ? C.teal : C.red, 0.70)),
        borderColor:     sliced.map(v => (v != null && v >= 0 ? C.teal : C.red)),
        borderWidth: 1, borderRadius: 2,
      }],
    };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const momData = useMemo(() => growthSeries(4),  [completeWeeks, W]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yoyData = useMemo(() => growthSeries(52), [completeWeeks, W]);

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

  // ── 6. Provider share % line over W weeks ─────────────────────────
  const provShareData = useMemo(() => {
    const pw = ranks?.providerWeekly;
    if (!pw || !wkLabels.length || !ranks?.weeklyTotals?.length) return null;
    const totals = ranks.weeklyTotals.slice(-W);
    const provs  = Object.keys(pw).filter(p => p !== 'Other');
    return {
      labels: wkLabels,
      datasets: provs.map(prov => mkDs(
        prov,
        provColor(prov),
        (pw[prov] ?? []).slice(-W).map((t, i) => totals[i] > 0 ? +(t / totals[i] * 100).toFixed(1) : 0),
      )),
    };
  }, [ranks, wkLabels, W]);

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
        chartId="or-top"
        title="Top 10 models — weekly token volume"
        src="openrouter.ai/rankings"
        srcUrl="https://openrouter.ai/rankings"
        freq="daily"
        subtitle={`Week of ${latestWeek ?? '—'}${asOf ? ` · as of ${asOf}` : ''}. Prompt + completion tokens combined.`}
        height={300} span2
      >
        {topBarData ? <Bar data={topBarData} options={hBarOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-trend"
        title="Top 8 models — weekly token trend (last 4 weeks)"
        src="openrouter.ai/rankings"
        srcUrl="https://openrouter.ai/rankings"
        freq="daily"
        subtitle="Rising lines = accelerating developer adoption. Each point is one week of total token throughput."
        height={260} span2
      >
        {trendData ? <Line data={trendData} options={baseOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-provstack"
        title="Provider token volume — stacked weekly breakdown"
        src="openrouter.ai/rankings"
        srcUrl="https://openrouter.ai/rankings"
        freq="daily"
        subtitle="Weekly token volume stacked by model provider. Shows which companies are gaining or losing share over time."
        height={280} span2
      >
        {provStackData ? <Bar data={provStackData} options={stackedLegendOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-provshare"
        title="Provider market share — % of weekly tokens (last 4 weeks)"
        src="openrouter.ai/rankings"
        srcUrl="https://openrouter.ai/rankings"
        freq="daily"
        subtitle="Each line is a provider's percentage of total weekly OpenRouter traffic. Crossing lines = share shifts."
        height={260} span2
      >
        {provShareData
          ? <Line data={provShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
          : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-platform"
        title="OpenRouter — total platform token volume per week"
        src="openrouter.ai/rankings"
        srcUrl="https://openrouter.ai/rankings"
        freq="daily"
        subtitle="All models combined. Tracks overall platform growth week over week."
        height={220}
      >
        {platformData ? <Line data={platformData} options={baseOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      {momData && (
        <ChartCard
          chartId="or-mom"
          title="Weekly token volume — month-over-month growth (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="Each bar compares a week's total platform tokens to the week 4 weeks earlier. The in-progress week is excluded."
          height={240} span2
        >
          <Bar data={momData} options={baseOpts(v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`)} />
        </ChartCard>
      )}

      {yoyData && (
        <ChartCard
          chartId="or-yoy"
          title="Weekly token volume — year-over-year growth (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="Each bar compares a week's total platform tokens to the same week 52 weeks earlier. OpenRouter's dataset starts Jan 2025, so YoY begins Jan 2026."
          height={240} span2
        >
          <Bar data={yoyData} options={baseOpts(v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`)} />
        </ChartCard>
      )}

      {growthData && (
        <ChartCard
          chartId="or-growth"
          title="Week-over-week token growth — top models (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="% change in weekly tokens vs the prior week. Faded bars = declining models."
          height={220}
        >
          <Bar data={growthData} options={hBarOpts(v => `${v > 0 ? '+' : ''}${v}%`)} />
        </ChartCard>
      )}

    </EditableGrid>
  );
}
