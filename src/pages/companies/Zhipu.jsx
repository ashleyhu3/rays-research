import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { hBarOpts, stackedOpts, fmtM, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { metricTrendCard } from '../../components/chart/MetricTrendCard';
import { buildCompanyPriceBar, pricingBarOpts } from '../../utils/modelPricing';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

// China domestic LLM market — Zhipu highlighted
const MKT_LABELS = ['iFlytek', 'Zhipu AI', 'Alibaba', 'SenseTime', 'Baidu', 'MiniMax', 'Others'];
const MKT_DATA   = [9.4, 6.6, 6.4, 6.1, 4.7, 3.8, 63.0];
const MKT_COLORS = [C.slate, C.zhipu, C.teal, C.slate, C.baidu, C.minimax, C.slate];

const mktData = {
  labels: MKT_LABELS,
  datasets: [{
    label:           'Market share (%)',
    data:            MKT_DATA,
    backgroundColor: MKT_COLORS.map(c => fa(c, 0.80)),
    borderColor:     MKT_COLORS,
    borderWidth:     1,
    borderRadius:    4,
  }],
};

// SWE-bench — Zhipu GLM-5 in context of peers
const BENCH_MODELS = ['GLM-5 (Zhipu)', 'DeepSeek V3.2', 'Kimi K2.5', 'GPT-4o', 'Claude Opus 4.6', 'Gemini 2.5 Pro'];
const BENCH_VALS   = [77.8, 72.4, 69.1, 74.2, 80.9, 76.2];
const BENCH_COLORS = [C.zhipu, C.deepseek, C.kimi, C.openai, C.anthropic, C.google];

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

const REV_YEARS = ['2022', '2023', '2024', '2025'];
const REV_TOTAL = [88, 240, 414, 724];
const REV_AGENT = [12, 48, 110, 306];

const stackedRevOpts = {
  ...stackedOpts(v => `¥${v}M`),
  scales: {
    x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
    y: { grid: GRID, ticks: { ...TICK, callback: v => `¥${v}M` }, border: BORD, stacked: true },
  },
};

export default function DemandZhipu({ weeks: W }) {
  const { liveData: ld } = useData();
  const mh = ld?.metricsHistory;
  const qN  = Math.min(W, 4);

  // Revenue
  const revData = useMemo(() => ({
    labels: REV_YEARS.slice(0, qN),
    datasets: [
      { label: 'Enterprise agents', data: REV_AGENT.slice(0, qN), backgroundColor: fa(C.teal,  0.75), borderRadius: 4 },
      { label: 'Other revenue',     data: REV_TOTAL.slice(0, qN).map((t, i) => t - REV_AGENT[i]), backgroundColor: fa(C.zhipu, 0.50), borderRadius: 4 },
    ],
  }), [qN]);

  // Per-model input price bar (earliest → latest release)
  const priceBar = useMemo(() => buildCompanyPriceBar(ld, 'Zhipu'), [ld]);

  return (
    <EditableGrid viewId="demand-zhipu">
      {orComboCard(ld?.openrouterRanks, 'Zhipu AI', W, C.zhipu, 'zh')}

      <RevPerTokenCard
        chartId="zh-revtoken"
        provider="Zhipu AI"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.zhipu}
        ticker="2513.HK"
      />

      <ChartCard
        chartId="zh-revenue"
        legend={[['Enterprise agents', C.teal], ['Other revenue', C.zhipu]]}
        height={260}
      >
        <Bar data={revData} options={stackedRevOpts} />
      </ChartCard>

      <ChartCard
        chartId="zh-market"
        height={260}
      >
        <Bar data={mktData} options={hBarOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'zh-hf',
        weeks: W,
        hist: ld?.metricsHistory?.huggingface,
        series: [
          { metric: 'GLM.downloads', label: 'GLM downloads', color: C.zhipu },
        ],
        fmt: fmtM,
        height: 260,
      })}

      <ChartCard
        chartId="zh-pricing"
        src={priceBar.src}
        height={260} span2
      >
        <Bar data={priceBar.data} options={pricingBarOpts} />
      </ChartCard>

      <ChartCard
        chartId="zh-bench"
        height={260} span2
      >
        <Bar data={benchData} options={benchOpts} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'zh-web-visits',
        weeks: W,
        hist: ld?.webTraffic?.history,
        series: [{ metric: 'zhipuai.cn.visits', label: 'Monthly visits', color: C.zhipu }],
        fmt: fmtM,
        height: 240,
        span2: true,
      })}
    </EditableGrid>
  );
}
