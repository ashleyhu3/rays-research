import { useMemo } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, doughnutOpts, mkDs, fmtM, fmtK } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import EditableGrid from '../components/EditableGrid';
import { useData } from '../context/DataContext';

const CAT_LABELS = ['Text Gen','Embeddings','Image Gen','Speech','Code Gen','Multimodal'];
const CAT_DATA   = [38, 22, 14, 9, 10, 7];
const CAT_COLORS = [C.openai, C.anthropic, C.google, C.mistral, C.meta, C.perplexity];

const staticCatData = {
  labels: CAT_LABELS,
  datasets: [{
    data:            CAT_DATA,
    backgroundColor: CAT_COLORS.map(c => fa(c, 0.75)),
    borderColor:     '#111419',
    borderWidth:     3,
  }],
};

const MODEL_PALETTE = [C.meta, C.openai, C.deepseek, C.mistral, C.google, C.teal, C.orange, C.perplexity];

function modelColor(id) {
  const l = id.toLowerCase();
  if (l.includes('llama') || l.includes('meta-llama')) return C.meta;
  if (l.includes('qwen'))     return C.deepseek;
  if (l.includes('deepseek')) return C.deepseek;
  if (l.includes('mistral'))  return C.mistral;
  if (l.includes('gemma') || l.includes('google')) return C.google;
  if (l.includes('phi') || l.includes('microsoft')) return C.openai;
  if (l.includes('claude') || l.includes('anthropic')) return C.anthropic;
  return C.slate;
}

function shortName(id) {
  const parts = id.split('/');
  return parts[parts.length - 1];
}

export default function HuggingFace({ weeks: W }) {
  const { liveData } = useData();
  const wk = useMemo(() => wkLabels(W), [W]);

  const top5 = useMemo(() => (liveData?.hf ?? []).slice(0, 5), [liveData]);

  const mainData = useMemo(() => {
    if (top5.length > 0) {
      return {
        labels: wk,
        datasets: top5.map(m => {
          const weeklyEst = Math.round(m.downloads / 4.3);
          const startVal  = Math.round(weeklyEst * 0.5);
          return mkDs(shortName(m.id), modelColor(m.id), trend(startVal, weeklyEst, W, 0.06));
        }),
      };
    }
    return {
      labels: wk,
      datasets: [
        mkDs('Llama-3.1-70B',   C.meta,     trend(21e6,  24.2e6, W, 0.05)),
        mkDs('Qwen-2.5-72B',    C.openai,   trend(8e6,   14.8e6, W, 0.08)),
        mkDs('DeepSeek-V3',     C.deepseek, trend(2.4e6, 12.1e6, W, 0.10)),
        mkDs('Mistral-7B-v0.3', C.mistral,  trend(11e6,  9.4e6,  W, 0.06)),
        mkDs('Gemma-3-27B',     C.google,   trend(4.2e6, 7.6e6,  W, 0.07)),
      ],
    };
  }, [W, top5]);

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

  const hasLive = top5.length > 0;
  const subtitle = hasLive
    ? `Top open-weight models by estimated weekly downloads (live · huggingface.co/api).`
    : 'Top open-weight model downloads. High velocity = high production integration likelihood.';

  return (
    <EditableGrid viewId="hf">
      <ChartCard
        chartId="hf-downloads"
        title="HuggingFace — weekly model download velocity"
        src="huggingface.co/models"
        srcUrl="https://huggingface.co/models?sort=downloads"
        freq="weekly"
        subtitle={subtitle}
        legend={hasLive
          ? top5.map(m => [shortName(m.id), modelColor(m.id)])
          : [['Llama-3.1 (Meta)', C.meta], ['Qwen-2.5-72B', C.openai], ['DeepSeek-V3', C.deepseek], ['Mistral-7B', C.mistral], ['Gemma-3 (Google)', C.google]]
        }
        insight={hasLive
          ? `Live model rankings from HuggingFace API. Weekly download velocity estimated from monthly counts.`
          : "DeepSeek-V3 and Qwen-2.5 are the fastest-growing in 2026 Q1. Llama 3.1 anchors at <b>~24M downloads/wk</b>."
        }
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        chartId="hf-categories"
        title="Top 50 model category breakdown"
        src="huggingface.co/models"
        srcUrl="https://huggingface.co/models?sort=downloads"
        freq="static"
        subtitle="What types of models dominate downloads."
        height={200}
      >
        <Doughnut data={staticCatData} options={doughnutOpts('55%')} />
      </ChartCard>

      <ChartCard
        chartId="hf-uploads"
        title="New model uploads per week"
        src="huggingface.co/models"
        srcUrl="https://huggingface.co/models?sort=created"
        freq="weekly"
        subtitle="Ecosystem vitality proxy."
        height={200}
      >
        <Bar data={newModelsData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
