import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, mkDs, fmtM, fmtK } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

const SO_STATIC = {
  'openai-api':        89400,
  'claude':  14200,
  'google-gemini': 21800,
  'langchain':         43100,
  'mistral-ai':         6200,
};
const SO_TAGS = [
  { tag: 'openai-api',        color: C.openai    },
  { tag: 'claude',  color: C.anthropic },
  { tag: 'google-gemini', color: C.google    },
  { tag: 'langchain',         color: C.red       },
  { tag: 'mistral-ai',        color: C.mistral   },
];

function pypiSlice(liveData, pkg, W, fallbackStart, fallbackEnd, ns = 0.05) {
  // Prefer full 52-wk history from backend
  const hist = liveData?.pypiHistory?.[pkg];
  if (hist?.length >= W) return hist.slice(-W);
  // Fall back to anchoring trend to single-week snapshot
  const snap = liveData?.pypi?.[pkg];
  if (snap) return trend(Math.round(snap * 0.65), snap, W, ns);
  return trend(fallbackStart, fallbackEnd, W, ns);
}

function npmSlice(liveData, pkg, W, fallbackStart, fallbackEnd, ns = 0.05) {
  const arr = liveData?.npm?.[pkg];
  if (arr && arr.length >= W) return arr.slice(-W);
  return trend(fallbackStart, fallbackEnd, W, ns);
}

export default function PyPI({ weeks: W }) {
  const { liveData } = useData();
  const wk = useMemo(() => wkLabels(W), [W]);

  const { pypiData, shareData, npmData } = useMemo(() => {
    const pypi = liveData?.pypi ?? {};

    const oa = pypiSlice(liveData, 'openai',              W, 38e6,  42e6,   0.05);
    const an = pypiSlice(liveData, 'anthropic',           W, 9e6,   16.2e6, 0.06);
    const gg = pypiSlice(liveData, 'google-genai', W, 14e6,  18e6,   0.05);
    const mi = pypiSlice(liveData, 'mistralai',           W, 3.2e6, 5.1e6,  0.07);

    const sAn = an.map((a, i) => parseFloat((a / (a + oa[i]) * 100).toFixed(1)));

    return {
      pypiData: {
        labels: wk,
        datasets: [
          mkDs('openai',              C.openai,    oa),
          mkDs('anthropic',           C.anthropic, an, true),
          mkDs('google-genai', C.google,    gg),
          mkDs('mistralai',           C.mistral,   mi),
        ],
      },
      shareData: {
        labels: wk,
        datasets: [
          mkDs('Anthropic %', C.anthropic, sAn, true),
          mkDs('OpenAI %',    C.openai,    sAn.map(s => parseFloat((100 - s).toFixed(1)))),
        ],
      },
      npmData: {
        labels: wk,
        datasets: [
          mkDs('openai',            C.openai,    npmSlice(liveData, 'openai',              W, 9.2e6, 9.8e6)),
          mkDs('@anthropic-ai/sdk', C.anthropic, npmSlice(liveData, '@anthropic-ai/sdk',   W, 1.8e6, 3.4e6, 0.07)),
          mkDs('@google/genai',    C.google,    npmSlice(liveData, '@google/genai',W, 3.1e6, 4.2e6, 0.06)),
        ],
      },
    };
  }, [W, liveData]);

  const soTotals = useMemo(() => {
    const real = liveData?.soTotals ?? {};
    return SO_TAGS.map(({ tag, color }) => ({
      tag, color, count: real[tag] ?? SO_STATIC[tag],
    }));
  }, [liveData]);

  const soData = useMemo(() => ({
    labels: soTotals.map(t => t.tag),
    datasets: [{
      data:            soTotals.map(t => t.count),
      backgroundColor: soTotals.map(t => fa(t.color, 0.7)),
      borderColor:     soTotals.map(t => t.color),
      borderWidth: 1, borderRadius: 4,
    }],
  }), [soTotals]);

  const hasLiveNpm      = (liveData?.npm?.['openai']?.length ?? 0) > 0;
  const hasLivePypiHist = (liveData?.pypiHistory?.['anthropic']?.length ?? 0) > 0;
  const hasLivePypi     = hasLivePypiHist || liveData?.pypi?.['anthropic'] != null;
  const hasLiveSO       = Object.keys(liveData?.soTotals ?? {}).length > 0;

  return (
    <EditableGrid viewId="pypi">
      <ChartCard
        chartId="pypi-installs"
        legend={[['openai', C.openai], ['anthropic', C.anthropic], ['google-genai', C.google], ['mistralai', C.mistral]]}
        height={250} span2
      >
        <Line data={pypiData} options={baseOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        chartId="pypi-share"
        legend={[['Anthropic %', C.anthropic], ['OpenAI %', C.openai]]}
        height={200}
      >
        <Line data={shareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>

      <ChartCard
        chartId="pypi-npm"
        legend={[['openai (npm)', C.openai], ['@anthropic-ai/sdk', C.anthropic], ['@google/genai', C.google]]}
        height={200}
      >
        <Line data={npmData} options={baseOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        chartId="pypi-so"
        height={220} span2
      >
        <Bar data={soData} options={hBarOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
