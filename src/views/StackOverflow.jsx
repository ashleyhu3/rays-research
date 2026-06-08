import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, hBarOpts, mkDs, fmtN, fmtK, GRID, TICK, BORD } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

const TOTALS = [
  { tag: 'openai-api',       count: 89400,  color: C.openai    },
  { tag: 'anthropic-claude', count: 14200,  color: C.anthropic },
  { tag: 'google-gemini-api',count: 21800,  color: C.google    },
  { tag: 'langchain',        count: 43100,  color: C.red       },
  { tag: 'mistral-ai',       count: 6200,   color: C.mistral   },
];

const totalData = {
  labels: TOTALS.map(t => t.tag),
  datasets: [{
    data:            TOTALS.map(t => t.count),
    backgroundColor: TOTALS.map(t => fa(t.color, 0.7)),
    borderColor:     TOTALS.map(t => t.color),
    borderWidth: 1, borderRadius: 4,
  }],
};

export default function StackOverflow({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const mainData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('[openai-api]',        C.openai,    trend(1100, 980, W, 0.08)),
      mkDs('[anthropic-claude]',  C.anthropic, trend(180,  412, W, 0.10)),
      mkDs('[google-gemini-api]', C.google,    trend(210,  340, W, 0.09)),
      mkDs('[langchain]',         C.red,       trend(680,  520, W, 0.07)),
    ],
  }), [W]);

  const ansData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('openai-api',       C.openai,    trend(68, 71, W, 0.03)),
      mkDs('anthropic-claude', C.anthropic, trend(52, 62, W, 0.04)),
      mkDs('gemini',           C.google,    trend(48, 55, W, 0.04)),
    ],
  }), [W]);

  return (
    <div className="cgrid">
      <ChartCard
        title="Stack Overflow — new questions per week by tag"
        src="stackexchange API · free · 10k req/day"
        subtitle="New question volume per tagged framework. Adoption friction proxy."
        legend={[['[openai-api]', C.openai], ['[anthropic-claude]', C.anthropic], ['[google-gemini-api]', C.google], ['[langchain]', C.red]]}
        insight="[anthropic-claude] questions grew from <b>~180/wk to 412/wk</b> over 12 weeks — a +129% surge mirroring the PyPI download curve."
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtN)} />
      </ChartCard>

      <ChartCard
        title="Total cumulative questions (all time)"
        src="stackexchange API"
        subtitle="Ecosystem depth and maturity by tag."
        height={200}
      >
        <Bar data={totalData} options={hBarOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        title="Answer rate — % with accepted answer"
        src="stackexchange API"
        subtitle="Higher rate = healthier, more mature developer community."
        legend={[['openai-api', C.openai], ['anthropic-claude', C.anthropic], ['gemini', C.google]]}
        height={200}
      >
        <Line data={ansData} options={baseOpts(v => `${v.toFixed(0)}%`)} />
      </ChartCard>
    </div>
  );
}
