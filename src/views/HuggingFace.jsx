import { useMemo } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, doughnutOpts, mkDs, fmtM, fmtK } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

const CAT_LABELS = ['Text Gen','Embeddings','Image Gen','Speech','Code Gen','Multimodal'];
const CAT_DATA   = [38, 22, 14, 9, 10, 7];
const CAT_COLORS = [C.openai, C.anthropic, C.google, C.mistral, C.meta, C.perplexity];

const catData = {
  labels: CAT_LABELS,
  datasets: [{
    data:            CAT_DATA,
    backgroundColor: CAT_COLORS.map(c => fa(c, 0.75)),
    borderColor:     '#111419',
    borderWidth:     3,
  }],
};

export default function HuggingFace({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const mainData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('Llama-3.1-70B',    C.meta,     trend(21e6,   24.2e6, W, 0.05)),
      mkDs('Qwen-2.5-72B',     C.openai,   trend(8e6,    14.8e6, W, 0.08)),
      mkDs('DeepSeek-V3',      C.deepseek, trend(2.4e6,  12.1e6, W, 0.10)),
      mkDs('Mistral-7B-v0.3',  C.mistral,  trend(11e6,   9.4e6,  W, 0.06)),
      mkDs('Gemma-3-27B',      C.google,   trend(4.2e6,  7.6e6,  W, 0.07)),
    ],
  }), [W]);

  const newModelsData = useMemo(() => ({
    labels: wk,
    datasets: [{
      label: 'New uploads',
      data:            trend(4200, 5800, W, 0.08),
      backgroundColor: wk.map((_, i) => fa(C.anthropic, 0.3 + (i / wk.length) * 0.5)),
      borderColor:     C.anthropic,
      borderWidth: 1, borderRadius: 3,
    }],
  }), [W]);

  return (
    <div className="cgrid">
      <ChartCard
        title="HuggingFace — weekly model download velocity"
        src="huggingface.co/api · no auth"
        subtitle="Top open-weight model downloads. High velocity = high production integration likelihood."
        legend={[['Llama-3.1 (Meta)', C.meta], ['Qwen-2.5-72B', C.openai], ['DeepSeek-V3', C.deepseek], ['Mistral-7B', C.mistral], ['Gemma-3 (Google)', C.google]]}
        insight="DeepSeek-V3 and Qwen-2.5 are the fastest-growing in 2026 Q1. Llama 3.1 anchors at <b>~24M downloads/wk</b>."
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        title="Top 50 model category breakdown"
        src="huggingface API"
        subtitle="What types of models dominate downloads."
        height={200}
      >
        <Doughnut data={catData} options={doughnutOpts('55%')} />
      </ChartCard>

      <ChartCard
        title="New model uploads per week"
        src="huggingface models API"
        subtitle="Ecosystem vitality proxy."
        height={200}
      >
        <Bar data={newModelsData} options={baseOpts(fmtK)} />
      </ChartCard>
    </div>
  );
}
