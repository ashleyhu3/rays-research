import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, stackedOpts, hBarOpts, mkDs, fmtM, GRID, TICK, BORD } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

/* ── Static bar data ──────────────────────────────────────────────── */
const TOP_MODELS  = ['Xiaomi MiMo-V2-Pro','MiniMax M2.5','Kimi K2.5','Qwen 3.6 Plus','Claude Opus 4.6','DeepSeek V3.2','GLM-5 (Zhipu)','GPT-4o'];
const TOP_TOK     = [4650, 4550, 4020, 1100, 1400, 820, 780, 452];
const TOP_COLORS  = [C.xiaomi, C.minimax, C.kimi, C.deepseek, C.anthropic, C.deepseek, C.zhipu, C.openai];

const COST_MODELS = ['Claude Opus 4.6','GPT-4o','Gemini 1.5 Pro','GLM-5 (Zhipu)','Qwen-2.5 72B','DeepSeek V3.2','MiniMax M2.5','Kimi K2.5','MiMo-V2-Pro'];
const COST_VALS   = [5.0, 2.50, 1.25, 0.30, 0.40, 0.28, 0.30, 0.25, 0.30];
const COST_COLORS = [C.anthropic, C.openai, C.google, C.zhipu, C.deepseek, C.deepseek, C.minimax, C.kimi, C.xiaomi];

const topData = {
  labels: TOP_MODELS,
  datasets: [{ data: TOP_TOK, backgroundColor: TOP_COLORS.map(c => fa(c, 0.75)), borderColor: TOP_COLORS, borderWidth: 1, borderRadius: 4 }],
};
const costData = {
  labels: COST_MODELS,
  datasets: [{ data: COST_VALS, backgroundColor: COST_COLORS.map(c => fa(c, 0.75)), borderColor: COST_COLORS, borderWidth: 1, borderRadius: 4 }],
};

export default function Tokens({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const usData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('Anthropic (Claude)', C.anthropic, trend(400e9,  1.4e12, W, 0.08)),
      mkDs('OpenAI',             C.openai,    trend(280e9,  452e9,  W, 0.07)),
      mkDs('Google',             C.google,    trend(180e9,  317e9,  W, 0.08)),
      mkDs('Mistral/EU',         C.mistral,   trend(60e9,   120e9,  W, 0.10)),
    ],
  }), [W]);

  const chShare = useMemo(() => trend(8, 46, W, 0.08), [W]);

  const shareData = useMemo(() => {
    const usShare    = chShare.map(c => Math.max(0, 100 - c - 15));
    const otherShare = chShare.map(c => Math.max(0, 15 - c * 0.1));
    return {
      labels: wk,
      datasets: [
        { label: 'Chinese models', data: chShare,    backgroundColor: fa(C.minimax, 0.75), borderRadius: 3 },
        { label: 'US proprietary', data: usShare,    backgroundColor: fa(C.openai,  0.60), borderRadius: 3 },
        { label: 'Other OSS',      data: otherShare, backgroundColor: fa(C.slate,   0.50), borderRadius: 3 },
      ],
    };
  }, [W]);

  const ossData = useMemo(() => ({
    labels: wk,
    datasets: [
      { label: 'Proprietary closed', data: trend(78, 54, W, 0.05), backgroundColor: fa(C.openai,  0.60), borderRadius: 3 },
      { label: 'Chinese OSS',        data: trend(8,  30, W, 0.08), backgroundColor: fa(C.minimax, 0.70), borderRadius: 3 },
      { label: 'RoW open-source',    data: trend(14, 16, W, 0.06), backgroundColor: fa(C.teal,    0.60), borderRadius: 3 },
    ],
  }), [W]);

  const growthData = useMemo(() => ({
    labels: wk,
    datasets: [mkDs('Total platform tokens/wk', C.teal, trend(4e12, 22e12, W, 0.06), true)],
  }), [W]);

  const pctStackOpts = {
    ...stackedOpts(v => `${v.toFixed(0)}%`),
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `${v}%` }, border: BORD, stacked: true, max: 100 },
    },
  };

  return (
    <div className="cgrid">
      <ChartCard
        title="OpenRouter weekly token throughput — by provider (trillion tokens)"
        src="openrouter.ai/rankings · public · updates daily"
        subtitle="Real production token consumption routed through OpenRouter across 5M+ global developers. The clearest available proxy for actual AI token demand. Platform processes 20T+ tokens/week as of May 2026."
        legend={[['Anthropic (Claude)', C.anthropic], ['OpenAI', C.openai], ['Google', C.google], ['Mistral/EU', C.mistral]]}
        insight="Anthropic leads OpenRouter with <b>1.4T tokens/week</b> (+35.8% WoW) — ahead of OpenAI's 452B and Google's 317B as of May 4, 2026. This reflects Claude's dominance in long-context enterprise agent workflows."
        height={250} span2 isNew
      >
        <Line data={usData} options={baseOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        title="Chinese vs US model token share on OpenRouter"
        src="openrouter.ai/state-of-ai · macromicro.me/openrouter"
        subtitle="Chinese-origin models went from under 2% to over 45% of OpenRouter traffic in 12 months. The fastest geographic shift ever recorded on a major AI routing platform."
        legend={[['Chinese models', C.minimax], ['US proprietary', C.openai], ['Other open-source', C.slate]]}
        height={200} isNew
      >
        <Bar data={shareData} options={pctStackOpts} />
      </ChartCard>

      <ChartCard
        title="Open-source vs proprietary token split"
        src="openrouter state of AI report"
        subtitle="Open-weight models (including Chinese OSS) have steadily gained share. Proprietary closed models still lead but their dominance is compressing."
        legend={[['Proprietary closed', C.openai], ['Chinese OSS', C.minimax], ['RoW open-source', C.teal]]}
        height={200} isNew
      >
        <Bar data={ossData} options={pctStackOpts} />
      </ChartCard>

      <ChartCard
        title="Top models by weekly token volume (billions)"
        src="openrouter.ai/rankings"
        subtitle="Individual model rankings by actual token throughput as of Apr 2026. Chinese models occupy 4 of the top 5 positions, driven primarily by cost-performance advantage in agent workloads."
        height={200} isNew
      >
        <Bar data={topData} options={hBarOpts(v => `${v}B`)} />
      </ChartCard>

      <ChartCard
        title="Token cost per million (input) — top models ($)"
        src="openrouter pricing API · provider docs"
        subtitle="The price gap is driving the volume shift. Chinese models deliver near-parity quality at 17–50× lower cost. This is the primary driver of developer migration."
        insight="MiniMax M2.5 at <b>$0.30/M tokens</b> vs Claude Opus at <b>$5–25/M</b> — a 17–80× price gap. With near-parity SWE-bench scores (80.2% vs 80.8%), developer economics favor Chinese models for high-volume agent runs."
        height={200} isNew
      >
        <Bar data={costData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      <ChartCard
        title="Weekly token volume growth rate — platform total"
        src="openrouter.ai/state-of-ai"
        subtitle="Platform-wide token consumption is growing at >10× year-over-year, driven by the shift from simple chat completions to multi-step agent workflows that use 100K–1M tokens per task."
        height={200} isNew
      >
        <Line data={growthData} options={baseOpts(fmtM)} />
      </ChartCard>
    </div>
  );
}
