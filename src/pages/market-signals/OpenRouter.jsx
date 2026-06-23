import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, stackedOpts, dualAxisOpts, mkDs, mkBar, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { orTokensWithGrowth, fmtGrowthPct } from '../../utils/openrouterProvider';
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
        subtitle={`Week of ${latestWeek ?? '—'}${asOf ? ` · as of ${asOf}` : ''}. Prompt + completion tokens combined.`}
        height={260} span2
      >
        {topBarData ? <Bar data={topBarData} options={hBarOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-trend"
        height={260} span2
      >
        {trendData ? <Line data={trendData} options={baseOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-provstack"
        height={260} span2
      >
        {provStackData ? <Bar data={provStackData} options={stackedLegendOpts(fmtB)} /> : <NoKey />}
      </ChartCard>

      <ChartCard
        chartId="or-provshare"
        height={260} span2
      >
        {provShareData
          ? <Line data={provShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
          : <NoKey />}
      </ChartCard>

      {comboData && (
        <ChartCard
          chartId="or-combo"
          height={260} span2
        >
          <Bar data={comboData} options={dualAxisOpts(fmtB, fmtGrowthPct)} />
        </ChartCard>
      )}

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
