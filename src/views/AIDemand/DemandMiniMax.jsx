import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, mkDs, fmtM, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { orProviderSeries } from '../../utils/openrouterProvider';
import { orComboCard } from '../../components/OrGrowthCards';
import { metricTrendCard } from '../../components/MetricTrendCard';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

// SWE-bench — MiniMax in context of peers
const BENCH_MODELS = ['MiniMax M2.5', 'Claude Opus 4.6', 'Gemini 2.5 Pro', 'GPT-4o', 'GLM-5 (Zhipu)', 'DeepSeek V3.2'];
const BENCH_VALS   = [80.2, 80.9, 76.2, 74.2, 77.8, 72.4];
const BENCH_COLORS = [C.minimax, C.anthropic, C.google, C.openai, C.zhipu, C.deepseek];

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

const QTR_LABELS = ['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26'];

// Pricing — MiniMax vs peers
const PRICE_KEY_MODELS = [
  { match: 'anthropic/claude-opus', label: 'Claude Opus',    color: C.anthropic },
  { match: 'openai/gpt-4o',         label: 'GPT-4o',         color: C.openai    },
  { match: 'google/gemini-pro',     label: 'Gemini Pro',     color: C.google    },
  { match: 'minimax/minimax',       label: 'MiniMax M2.5',   color: C.minimax   },
  { match: 'thudm/glm',             label: 'GLM-5',          color: C.zhipu     },
];
const STATIC_PRICE = [
  { label: 'Claude Opus',  color: C.anthropic, price: 15.00 },
  { label: 'GPT-4o',       color: C.openai,    price:  2.50 },
  { label: 'Gemini Pro',   color: C.google,    price:  1.25 },
  { label: 'GLM-5',        color: C.zhipu,     price:  0.30 },
  { label: 'MiniMax M2.5', color: C.minimax,   price:  0.30 },
];

export default function DemandMiniMax({ weeks: W }) {
  const { liveData: ld } = useData();
  const qN = Math.min(W, 5);

  // MiniMax token share on OpenRouter (live rankings)
  const orp = useMemo(() => orProviderSeries(ld?.openrouterRanks, 'MiniMax', W), [ld, W]);
  const orShareData = useMemo(() => orp && ({
    labels: orp.labels,
    datasets: [mkDs('Share of platform tokens', C.minimax, orp.share)],
  }), [orp]);

  // Consumer MAU
  const mauData = useMemo(() => ({
    labels: QTR_LABELS.slice(0, qN),
    datasets: [
      { label: 'Talkie / Xingye (AI companion)', data: [8, 12, 16, 20, 24].slice(0, qN), backgroundColor: fa(C.minimax, 0.75), borderRadius: 4 },
      { label: 'Hailuo AI (video gen)',           data: [1.2, 2.4, 4.1, 5.6, 8.2].slice(0, qN), backgroundColor: fa(C.kimi, 0.70), borderRadius: 4 },
    ],
  }), [qN]);

  // Pricing (live if available)
  const { priceData, priceSrc } = useMemo(() => {
    const models = ld?.openrouter?.models;
    if (models?.length > 0) {
      const matched = PRICE_KEY_MODELS
        .map(({ match, label, color }) => {
          const m = models.find(m => m.id.startsWith(match));
          return m && m.pricing?.prompt > 0 ? { label, color, price: m.pricing.prompt } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.price - a.price);
      if (matched.length >= 3) {
        return {
          priceSrc: 'openrouter.ai/api/v1/models · live',
          priceData: {
            labels: matched.map(m => m.label),
            datasets: [{ data: matched.map(m => m.price), backgroundColor: matched.map(m => fa(m.color, 0.75)), borderColor: matched.map(m => m.color), borderWidth: 1, borderRadius: 4 }],
          },
        };
      }
    }
    return {
      priceSrc: 'openrouter.ai · provider docs',
      priceData: {
        labels: STATIC_PRICE.map(m => m.label),
        datasets: [{ data: STATIC_PRICE.map(m => m.price), backgroundColor: STATIC_PRICE.map(m => fa(m.color, 0.75)), borderColor: STATIC_PRICE.map(m => m.color), borderWidth: 1, borderRadius: 4 }],
      },
    };
  }, [ld]);

  return (
    <EditableGrid viewId="demand-minimax">
      {orComboCard(ld?.openrouterRanks, 'MiniMax', W, C.minimax, 'mm')}

      {orShareData && (
        <ChartCard
          chartId="mm-or-share"
          title="MiniMax — share of OpenRouter weekly tokens (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="Percentage of total weekly OpenRouter token throughput served by MiniMax models."
          height={260}
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {metricTrendCard({
        chartId: 'mm-hf',
        weeks: W,
        title: 'MiniMax — HuggingFace family downloads',
        src: 'huggingface.co/api',
        srcUrl: 'https://huggingface.co/MiniMaxAI',
        subtitle: 'Open-model demand: cumulative downloads of MiniMaxAI models.',
        hist: ld?.metricsHistory?.huggingface,
        series: [
          { metric: 'MiniMax.downloads', label: 'MiniMax downloads', color: C.minimax },
        ],
        fmt: fmtM,
        height: 260,
      })}

      <ChartCard
        chartId="mm-mau"
        title="MiniMax consumer app MAU (millions)"
        src="sensortower.com · minimaxi.com"
        srcUrl="https://www.minimaxi.com/"
        freq="static"
        subtitle="Talkie/Xingye (AI companion) and Hailuo AI (video generation) are MiniMax's consumer anchors."
        legend={[['Talkie / Xingye (AI companion)', C.minimax], ['Hailuo AI (video gen)', C.kimi]]}
        insight="Talkie reached <b>20M MAU</b> in the first 9 months of 2025 — among the fastest-growing AI apps globally. Average user age under 30."
        height={260}
      >
        <Bar data={mauData} options={baseOpts(v => `${v}M`)} />
      </ChartCard>

      <ChartCard
        chartId="mm-pricing"
        title="Input token pricing — MiniMax M2.5 vs global frontier models ($/M tokens)"
        src={priceSrc}
        srcUrl="https://openrouter.ai/models"
        freq="live"
        subtitle="MiniMax M2.5 at $0.30/M input tokens vs $2.50–15.00/M for comparable US models."
        height={260}
      >
        <Bar data={priceData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      <ChartCard
        chartId="mm-bench"
        title="SWE-bench Verified — MiniMax M2.5 vs frontier models"
        src="swebench.com"
        srcUrl="https://www.swebench.com/"
        freq="static"
        subtitle="MiniMax M2.5 scores 80.2% on SWE-bench Verified — essentially tied with Claude Opus 4.6 at 80.9%."
        insight="MiniMax M2.5 is the only Chinese model to reach near-parity with the current US frontier on software engineering. At $0.30/M tokens vs $15/M for Claude Opus, the cost-quality ratio is exceptional."
        height={260} span2
      >
        <Bar data={benchData} options={benchOpts} />
      </ChartCard>
    </EditableGrid>
  );
}
