import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, fmtM, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { metricTrendCard } from '../../components/chart/MetricTrendCard';
import { buildCompanyPriceBar, pricingBarOpts } from '../../utils/modelPricing';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
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
  ...hBarOpts(v => `${v.toFixed(1)}%`),
  scales: {
    x: { grid: GRID, ticks: TICK, border: BORD, min: 60, max: 85 },
    y: { grid: GRID, ticks: TICK, border: BORD },
  },
};

const QTR_LABELS = ['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26'];

export default function DemandMiniMax({ weeks: W }) {
  const { liveData: ld } = useData();
  const mh = ld?.metricsHistory;
  const qN = Math.min(W, 5);

  // Consumer MAU
  const mauData = useMemo(() => ({
    labels: QTR_LABELS.slice(0, qN),
    datasets: [
      { label: 'Talkie / Xingye (AI companion)', data: [8, 12, 16, 20, 24].slice(0, qN), backgroundColor: fa(C.minimax, 0.75), borderRadius: 4 },
      { label: 'Hailuo AI (video gen)',           data: [1.2, 2.4, 4.1, 5.6, 8.2].slice(0, qN), backgroundColor: fa(C.kimi, 0.70), borderRadius: 4 },
    ],
  }), [qN]);

  // Per-model input price bar (earliest → latest release)
  const priceBar = useMemo(() => buildCompanyPriceBar(ld, 'MiniMax'), [ld]);

  return (
    <EditableGrid viewId="demand-minimax">
      {orComboCard(ld?.openrouterRanks, 'MiniMax', W, C.minimax, 'mm', ld)}

      <RevPerTokenCard
        chartId="mm-revtoken"
        provider="MiniMax"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.minimax}
        ticker="0100.HK"
      />

      {metricTrendCard({
        chartId: 'mm-hf',
        weeks: W,
        hist: ld?.metricsHistory?.huggingface,
        series: [
          { metric: 'MiniMax.downloads', label: 'MiniMax downloads', color: C.minimax },
        ],
        fmt: fmtM,
        height: 260,
      })}

      <ChartCard
        chartId="mm-mau"
        legend={[['Talkie / Xingye (AI companion)', C.minimax], ['Hailuo AI (video gen)', C.kimi]]}
        height={260}
      >
        <Bar data={mauData} options={baseOpts(v => `${v}M`)} />
      </ChartCard>

      <ChartCard
        chartId="mm-pricing"
        src={priceBar.src}
        height={260} span2
      >
        <Bar data={priceBar.data} options={pricingBarOpts} />
      </ChartCard>

      <ChartCard
        chartId="mm-bench"
        height={260} span2
      >
        <Bar data={benchData} options={benchOpts} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'mm-web-visits',
        weeks: W,
        hist: ld?.webTraffic?.history,
        series: [{ metric: 'hailuoai.com.visits', label: 'Monthly visits', color: C.minimax }],
        fmt: fmtM,
        height: 240,
        span2: true,
      })}
    </EditableGrid>
  );
}
