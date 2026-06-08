import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { wkLabels } from '../utils/labels';
import { hBarOpts, fmtK } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import { useData } from '../context/DataContext';

const STATIC_TOTALS = {
  'openai-api':        89400,
  'anthropic-claude':  14200,
  'google-gemini-api': 21800,
  'langchain':         43100,
  'mistral-ai':         6200,
};

const TAG_ORDER = [
  { tag: 'openai-api',        color: C.openai    },
  { tag: 'anthropic-claude',  color: C.anthropic },
  { tag: 'google-gemini-api', color: C.google    },
  { tag: 'langchain',         color: C.red       },
  { tag: 'mistral-ai',        color: C.mistral   },
];

export default function StackOverflow({ weeks: W }) {
  const { liveData } = useData();
  void wkLabels; void W; // unused with only 1 chart

  const totals = useMemo(() => {
    const real = liveData?.soTotals ?? {};
    return TAG_ORDER.map(({ tag, color }) => ({
      tag, color,
      count: real[tag] ?? STATIC_TOTALS[tag],
    }));
  }, [liveData]);

  const totalData = useMemo(() => ({
    labels: totals.map(t => t.tag),
    datasets: [{
      data:            totals.map(t => t.count),
      backgroundColor: totals.map(t => fa(t.color, 0.7)),
      borderColor:     totals.map(t => t.color),
      borderWidth: 1, borderRadius: 4,
    }],
  }), [totals]);

  const hasLive = Object.keys(liveData?.soTotals ?? {}).length > 0;

  return (
    <div className="cgrid">
      <ChartCard
        title="Total Stack Overflow questions (all time) by tag"
        src={hasLive ? 'stackexchange API · live' : 'stackexchange API'}
        subtitle="Cumulative question count per tag — measures ecosystem depth and developer mindshare."
        height={300} span2
      >
        <Bar data={totalData} options={hBarOpts(fmtK)} />
      </ChartCard>
    </div>
  );
}
