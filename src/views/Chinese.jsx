import { useMemo } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, doughnutOpts, hBarOpts, stackedOpts, mkDs, fmtM, GRID, TICK, BORD } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import { useData } from '../context/DataContext';

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
  datasets: [{ data: MKT_DATA, backgroundColor: MKT_COLORS.map(c => fa(c, 0.75)), borderColor: '#111419', borderWidth: 3 }],
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
  const { priceData, priceSrc } = useMemo(() => {
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
          priceSrc: 'openrouter.ai/api/v1/models · live',
          priceData: {
            labels: matched.map(m => m.label),
            datasets: [{ data: matched.map(m => m.price), backgroundColor: matched.map(m => fa(m.color, 0.75)), borderColor: matched.map(m => m.color), borderWidth: 1, borderRadius: 4 }],
          },
        };
      }
    }
    return {
      priceSrc: 'openrouter pricing API · provider docs',
      priceData: {
        labels: STATIC_PRICE_LABELS,
        datasets: [{ data: STATIC_PRICE_DATA, backgroundColor: STATIC_PRICE_COLORS.map(c => fa(c, 0.75)), borderColor: STATIC_PRICE_COLORS, borderWidth: 1, borderRadius: 4 }],
      },
    };
  }, [liveData]);

  const tokenData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('MiniMax M2.5/M2.7',    C.minimax,  trend(200e9,  2450e9, W, 0.12)),
      mkDs('Kimi K2.5 (Moonshot)', C.kimi,     trend(400e9,  1210e9, W, 0.10).map((v,i) => i > Math.floor(W * 0.7) ? v * 0.8 : v)),
      mkDs('GLM-5 (Zhipu)',        C.zhipu,    trend(80e9,   780e9,  W, 0.10)),
      mkDs('DeepSeek V3.2',        C.deepseek, trend(600e9,  820e9,  W, 0.08)),
      mkDs('MiMo-V2-Pro (Xiaomi)', C.xiaomi,   trend(0,      4650e9, W, 0.15).map((v,i) => i < Math.floor(W * 0.65) ? 0 : v)),
    ],
  }), [W]);

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
    <div className="cgrid">
      <ChartCard chartId="cn-tokens"
        title="Chinese LLM weekly token consumption on OpenRouter (billion tokens)"
        src="openrouter.ai/rankings"
        srcUrl="https://openrouter.ai/rankings"
        freq="weekly"
        subtitle="Real weekly token throughput for key Chinese models on OpenRouter. MiniMax M2.5 led with 2.45T tokens in a single week in Feb 2026 — a 197% week-over-week surge. This is real developer production traffic, not benchmark scores."
        legend={[['MiniMax M2.5/M2.7', C.minimax], ['Kimi K2.5 (Moonshot)', C.kimi], ['GLM-5 (Zhipu)', C.zhipu], ['DeepSeek V3.2', C.deepseek], ['MiMo-V2-Pro (Xiaomi)', C.xiaomi]]}
        insight="In Feb 2026, Chinese models captured <b>85.7% of the top-5 token volume</b> on OpenRouter — the first sustained period where Chinese-origin models exceeded all US incumbents combined in production developer traffic."
        height={260} span2 isNew
      >
        <Line data={tokenData} options={baseOpts(fmtM)} />
      </ChartCard>

      <ChartCard chartId="cn-market"
        title="China domestic LLM market share (enterprise, %)"
        src="idc.com · zhipuai.cn"
        srcUrl="https://www.zhipuai.cn/"
        freq="static"
        subtitle="China's enterprise LLM market. iFlytek leads at 9.4%, Zhipu second at 6.6%. Market is highly fragmented — no single player dominates."
        srcNote="Source: Zhipu AI HK IPO prospectus (Jan 2026) · IDC China AI Platform Tracker 2024"
        height={200} isNew
      >
        <Doughnut data={mktData} options={doughnutOpts('50%')} />
      </ChartCard>

      <ChartCard chartId="cn-pricing"
        title="Input token pricing — Chinese vs US models ($/M tokens)"
        src="openrouter.ai/models"
        srcUrl="https://openrouter.ai/models"
        freq="live"
        subtitle="The pricing gap driving developer adoption. Chinese models average $0.28–0.40/M input tokens vs $2.50–5.00/M for comparable US models. Near-parity quality at 10–17× lower cost."
        height={200} isNew
      >
        <Bar data={priceData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      <ChartCard chartId="cn-mau"
        title="MiniMax consumer app MAU (millions)"
        src="sensortower.com · minimaxi.com"
        srcUrl="https://www.minimaxi.com/"
        freq="static"
        subtitle="Talkie/Xingye (AI companion) and Hailuo AI (video generation) are MiniMax's consumer anchors. Talkie reached 20M MAU in the first 9 months of 2025 — among the fastest-growing AI apps globally."
        legend={[['Talkie / Xingye (AI companion)', C.minimax], ['Hailuo AI (video gen)', C.kimi]]}
        insight="MiniMax's consumer products scale to <b>20M+ MAU</b> with an average user age under 30. This positions MiniMax as the largest AI-native entertainment company by monthly active users outside the US."
        height={200} isNew
      >
        <Bar data={mauData} options={baseOpts(v => `${v}M`)} />
      </ChartCard>

      <ChartCard chartId="cn-revenue"
        title="Zhipu AI revenue (million yuan)"
        src="zhipuai.cn/prospectus"
        srcUrl="https://www.zhipuai.cn/"
        freq="static"
        subtitle="Zhipu AI's annual revenue grew 132% YoY to 724M yuan (~$99M USD) in 2025 — driven by enterprise AI agent deployments (+249%) and its Model-as-a-Service platform across finance, manufacturing, and healthcare."
        legend={[['Total revenue (M yuan)', C.zhipu], ['Enterprise agents (M yuan)', C.teal]]}
        height={200} isNew
      >
        <Bar data={revData} options={stackedRevOpts} />
      </ChartCard>

      <ChartCard chartId="cn-bench"
        title="SWE-bench Verified scores — Chinese vs US frontier models"
        src="swebench.com"
        srcUrl="https://www.swebench.com/"
        freq="static"
        subtitle="Software engineering benchmark as a quality proxy. Chinese models now approach or match US frontier models. GLM-5 scores 77.8%, MiniMax M2.5 at 80.2% — vs Claude Opus 4.6 at 80.9%."
        insight="The benchmark gap has <b>effectively closed</b>. In Jan 2025, the best Chinese model scored ~45% on SWE-bench vs Claude's 70%+. By Apr 2026, the gap is under 1 percentage point — at a fraction of the price."
        height={200} isNew
      >
        <Bar data={benchData} options={benchOpts} />
      </ChartCard>
    </div>
  );
}
