import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, stackedOpts, mkDs, fmtM, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

/* ── Static data ───────────────────────────────────────────────────── */
const MKT_LABELS = ['iFlytek','Zhipu AI','Alibaba','SenseTime','Baidu','MiniMax','Others'];
const MKT_DATA   = [9.4, 6.6, 6.4, 6.1, 4.7, 3.8, 63.0];
const MKT_COLORS = [C.openai, C.zhipu, C.deepseek, C.google, C.kimi, C.minimax, C.slate];

const BENCH_MODELS = ['MiniMax M2.5','GLM-5 (Zhipu)','DeepSeek V3.2','Kimi K2.5','Claude Opus 4.6','GPT-4o','Gemini 2.5 Pro'];
const BENCH_VALS   = [80.2, 77.8, 72.4, 69.1, 80.9, 74.2, 76.2];
const BENCH_COLORS = [C.minimax, C.zhipu, C.deepseek, C.kimi, C.anthropic, C.openai, C.google];

// Static fallback prices — overridden by live OpenRouter data when available
const STATIC_PRICE_LABELS = ['Claude Opus 4.6','GPT-4o','Gemini 1.5 Pro','Kimi K2.5','GLM-5','DeepSeek V3.2','MiniMax M2.5','MiMo-V2-Pro'];
const STATIC_PRICE_DATA   = [15.00, 2.50, 1.25, 0.25, 0.30, 0.28, 0.30, 0.30];
const STATIC_PRICE_COLORS = [C.anthropic, C.openai, C.google, C.kimi, C.zhipu, C.deepseek, C.minimax, C.xiaomi];

// OpenRouter model ID prefixes for live price lookup
const PRICE_KEY_MODELS = [
  { match: 'anthropic/claude-opus',   label: 'Claude Opus',     color: C.anthropic },
  { match: 'openai/gpt-4o',           label: 'GPT-4o',          color: C.openai    },
  { match: 'google/gemini-pro-1.5',   label: 'Gemini 1.5 Pro',  color: C.google    },
  { match: 'moonshot/moonshot',        label: 'Kimi',            color: C.kimi      },
  { match: 'thudm/glm',               label: 'GLM (Zhipu)',     color: C.zhipu     },
  { match: 'deepseek/deepseek-chat',  label: 'DeepSeek V3',     color: C.deepseek  },
  { match: 'minimax/minimax',         label: 'MiniMax',         color: C.minimax   },
];

const mktData = {
  labels: MKT_LABELS,
  datasets: [{ label: 'Market share (%)', data: MKT_DATA, backgroundColor: MKT_COLORS.map(c => fa(c, 0.75)), borderColor: MKT_COLORS, borderWidth: 1, borderRadius: 4 }],
};
const benchData = {
  labels: BENCH_MODELS,
  datasets: [{ data: BENCH_VALS, backgroundColor: BENCH_COLORS.map(c => fa(c, 0.75)), borderColor: BENCH_COLORS, borderWidth: 1, borderRadius: 4 }],
};
const benchOpts = {
  ...baseOpts(v => `${v.toFixed(1)}%`),
  indexAxis: 'y',
  scales: {
    x: { grid: GRID, ticks: TICK, border: BORD, min: 60, max: 85 },
    y: { grid: GRID, ticks: TICK, border: BORD },
  },
};

const QTR_LABELS = ['Q1 25','Q2 25','Q3 25','Q4 25','Q1 26'];

export default function Chinese({ weeks: W }) {
  const { liveData } = useData();
  const wk  = useMemo(() => wkLabels(W), [W]);
  const qN  = Math.min(W, 5);

  // Build pricing chart from live OpenRouter data; fall back to static values
  const priceData = useMemo(() => {
    const models = liveData?.openrouter?.models;
    if (models?.length > 0) {
      const matched = [];
      PRICE_KEY_MODELS.forEach(({ match, label, color }) => {
        const m = models.find(m => m.id.startsWith(match));
        if (m && m.pricing.prompt > 0) matched.push({ label, color, price: m.pricing.prompt });
      });
      if (matched.length >= 3) {
        matched.sort((a, b) => b.price - a.price);
        return {
          labels: matched.map(m => m.label),
          datasets: [{ data: matched.map(m => m.price), backgroundColor: matched.map(m => fa(m.color, 0.75)), borderColor: matched.map(m => m.color), borderWidth: 1, borderRadius: 4 }],
        };
      }
    }
    return {
      labels: STATIC_PRICE_LABELS,
      datasets: [{ data: STATIC_PRICE_DATA, backgroundColor: STATIC_PRICE_COLORS.map(c => fa(c, 0.75)), borderColor: STATIC_PRICE_COLORS, borderWidth: 1, borderRadius: 4 }],
    };
  }, [liveData]);

  // Real weekly token series from OpenRouter rankings, filtered to Chinese models
  const CN_PREFIXES = [
    { match: 'minimax/',    color: C.minimax  },
    { match: 'moonshotai/', color: C.kimi     },
    { match: 'z-ai/',       color: C.zhipu    },
    { match: 'thudm/',      color: C.zhipu    },
    { match: 'deepseek/',   color: C.deepseek },
    { match: 'qwen/',       color: C.deepseek },
    { match: 'xiaomi/',     color: C.xiaomi   },
  ];
  const tokenData = useMemo(() => {
    const ranks = liveData?.openrouterRanks;
    if (!ranks?.trend) return null;
    const weeks = (ranks.weekLabels ?? []).slice(-W);
    const datasets = Object.entries(ranks.trend)
      .map(([slug, series]) => {
        const cn = CN_PREFIXES.find(p => slug.startsWith(p.match));
        if (!cn) return null;
        return mkDs(slug.split('/')[1] ?? slug, cn.color, series.slice(-W));
      })
      .filter(Boolean);
    return datasets.length > 0 ? { labels: weeks, datasets } : null;
  }, [liveData, W]);

  const mauData = useMemo(() => ({
    labels: QTR_LABELS.slice(0, qN),
    datasets: [
      { label: 'Talkie/Xingye', data: [8,12,16,20,24].slice(0,qN), backgroundColor: fa(C.minimax, 0.75), borderRadius:4 },
      { label: 'Hailuo AI',     data: [1.2,2.4,4.1,5.6,8.2].slice(0,qN), backgroundColor: fa(C.kimi, 0.70), borderRadius:4 },
    ],
  }), [W]);

  const REV_YEARS = ['2022','2023','2024','2025'];
  const REV_TOTAL = [88, 240, 414, 724];
  const REV_AGENT = [12, 48, 110, 306];
  const revN = Math.min(W, 4);
  const revData = useMemo(() => ({
    labels: REV_YEARS.slice(0, revN),
    datasets: [
      { label: 'Enterprise agents', data: REV_AGENT.slice(0,revN), backgroundColor: fa(C.teal,  0.75), borderRadius:4 },
      { label: 'Other revenue',     data: REV_TOTAL.slice(0,revN).map((t,i) => t - REV_AGENT[i]), backgroundColor: fa(C.zhipu, 0.50), borderRadius:4 },
    ],
  }), [W]);

  const stackedRevOpts = {
    ...stackedOpts(v => `¥${v}M`),
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `¥${v}M` }, border: BORD, stacked: true },
    },
  };

  return (
    <EditableGrid viewId="chinese">
      {tokenData && (
        <ChartCard chartId="cn-tokens"
          height={260} span2 isNew
        >
          <Line data={tokenData} options={baseOpts(fmtM)} />
        </ChartCard>
      )}

      <ChartCard chartId="cn-market"
        height={200} isNew
      >
        <Bar data={mktData} options={hBarOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>

      <ChartCard chartId="cn-pricing"
        height={200} isNew
      >
        <Bar data={priceData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      <ChartCard chartId="cn-mau"
        legend={[['Talkie / Xingye (AI companion)', C.minimax], ['Hailuo AI (video gen)', C.kimi]]}
        height={200} isNew
      >
        <Bar data={mauData} options={baseOpts(v => `${v}M`)} />
      </ChartCard>

      <ChartCard chartId="cn-revenue"
        legend={[['Total revenue (M yuan)', C.zhipu], ['Enterprise agents (M yuan)', C.teal]]}
        height={200} isNew
      >
        <Bar data={revData} options={stackedRevOpts} />
      </ChartCard>

      <ChartCard chartId="cn-bench"
        height={200} isNew
      >
        <Bar data={benchData} options={benchOpts} />
      </ChartCard>
    </EditableGrid>
  );
}
