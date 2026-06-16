import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, stackedOpts, mkDs, fmtM, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { orProviderSeries } from '../../utils/openrouterProvider';
import { orComboCard } from '../../components/OrGrowthCards';
import { metricTrendCard } from '../../components/MetricTrendCard';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
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
  ...baseOpts(v => `${v.toFixed(1)}%`),
  indexAxis: 'y',
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

// Pricing comparison — Zhipu vs others (static + live via OpenRouter)
const PRICE_KEY_MODELS = [
  { match: 'anthropic/claude-opus', label: 'Claude Opus',    color: C.anthropic },
  { match: 'openai/gpt-4o',         label: 'GPT-4o',         color: C.openai    },
  { match: 'google/gemini-pro',     label: 'Gemini Pro',     color: C.google    },
  { match: 'thudm/glm',             label: 'GLM-5 (Zhipu)', color: C.zhipu     },
  { match: 'deepseek/deepseek',     label: 'DeepSeek V3',    color: C.deepseek  },
];
const STATIC_PRICE = [
  { label: 'Claude Opus',    color: C.anthropic, price: 15.00 },
  { label: 'GPT-4o',         color: C.openai,    price:  2.50 },
  { label: 'Gemini Pro',     color: C.google,    price:  1.25 },
  { label: 'GLM-5 (Zhipu)', color: C.zhipu,     price:  0.30 },
  { label: 'DeepSeek V3',    color: C.deepseek,  price:  0.28 },
];

export default function DemandZhipu({ weeks: W }) {
  const { liveData: ld } = useData();
  const qN  = Math.min(W, 4);

  // Zhipu token share on OpenRouter (live rankings)
  const orp = useMemo(() => orProviderSeries(ld?.openrouterRanks, 'Zhipu AI', W), [ld, W]);
  const orShareData = useMemo(() => orp && ({
    labels: orp.labels,
    datasets: [mkDs('Share of platform tokens', C.zhipu, orp.share)],
  }), [orp]);

  // Revenue
  const revData = useMemo(() => ({
    labels: REV_YEARS.slice(0, qN),
    datasets: [
      { label: 'Enterprise agents', data: REV_AGENT.slice(0, qN), backgroundColor: fa(C.teal,  0.75), borderRadius: 4 },
      { label: 'Other revenue',     data: REV_TOTAL.slice(0, qN).map((t, i) => t - REV_AGENT[i]), backgroundColor: fa(C.zhipu, 0.50), borderRadius: 4 },
    ],
  }), [qN]);

  // Pricing (live if available, else static)
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
    <EditableGrid viewId="demand-zhipu">
      {orComboCard(ld?.openrouterRanks, 'Zhipu AI', W, C.zhipu, 'zh')}

      {orShareData && (
        <ChartCard
          chartId="zh-or-share"
          title="Zhipu AI — share of OpenRouter weekly tokens (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="Percentage of total weekly OpenRouter token throughput served by Zhipu GLM models."
          height={260} pinTop
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="zh-revenue"
        title="Zhipu AI — annual revenue (million yuan)"
        src="zhipuai.cn · IPO prospectus"
        srcUrl="https://www.zhipuai.cn/"
        freq="static"
        subtitle="Zhipu AI's annual revenue grew 132% YoY to ¥724M (~$99M USD) in 2025. Enterprise AI agent deployments +249% YoY."
        legend={[['Enterprise agents', C.teal], ['Other revenue', C.zhipu]]}
        srcNote="Source: Zhipu AI HK IPO prospectus (Jan 2026) · IDC China AI Platform Tracker 2024"
        height={260}
      >
        <Bar data={revData} options={stackedRevOpts} />
      </ChartCard>

      <ChartCard
        chartId="zh-market"
        title="China domestic enterprise LLM market share (%)"
        src="idc.com · zhipuai.cn"
        srcUrl="https://www.zhipuai.cn/"
        freq="static"
        subtitle="Zhipu AI holds 6.6% of China's enterprise LLM market — second only to iFlytek. Market remains highly fragmented."
        srcNote="Source: Zhipu AI HK IPO prospectus · IDC China AI Platform Tracker 2024"
        height={260}
      >
        <Bar data={mktData} options={hBarOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'zh-hf',
        weeks: W,
        title: 'GLM — HuggingFace family downloads',
        src: 'huggingface.co/api',
        srcUrl: 'https://huggingface.co/zai-org',
        subtitle: 'Open-model demand: cumulative downloads of the GLM family (zai-org).',
        hist: ld?.metricsHistory?.huggingface,
        series: [
          { metric: 'GLM.downloads', label: 'GLM downloads', color: C.zhipu },
        ],
        fmt: fmtM,
        height: 260,
      })}

      <ChartCard
        chartId="zh-pricing"
        title="Input token pricing — GLM-5 vs global frontier models ($/M tokens)"
        src={priceSrc}
        srcUrl="https://openrouter.ai/models"
        freq="live"
        subtitle="GLM-5 at $0.30/M input tokens vs $2.50–15.00/M for comparable US models. Near-parity quality at 8–50× lower cost."
        height={260}
      >
        <Bar data={priceData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      <ChartCard
        chartId="zh-bench"
        title="SWE-bench Verified — GLM-5 vs frontier models"
        src="swebench.com"
        srcUrl="https://www.swebench.com/"
        freq="static"
        subtitle="GLM-5 scores 77.8% on SWE-bench Verified — within 3 points of Claude Opus. The capability gap has effectively closed."
        insight="In Jan 2025, the best Chinese model scored ~45% on SWE-bench vs Claude's 70%+. By mid-2026, GLM-5 at <b>77.8%</b> vs Claude Opus at <b>80.9%</b> — a gap of just 3.1 points."
        height={260} span2
      >
        <Bar data={benchData} options={benchOpts} />
      </ChartCard>
    </EditableGrid>
  );
}
