import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, mkDs, fmtK, fmtN } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

export default function GitHub({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const mainData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('openai-python',         C.openai,    trend(50e3,  54e3,   W, 0.02)),
      mkDs('anthropic-sdk-python',  C.anthropic, trend(11e3,  18.4e3, W, 0.04)),
      mkDs('google-generativeai',   C.google,    trend(16e3,  20.5e3, W, 0.03)),
      mkDs('mistralai',             C.mistral,   trend(2.8e3, 4.9e3,  W, 0.05)),
    ],
  }), [W]);

  const deltaData = useMemo(() => ({
    labels: wk,
    datasets: [
      { label: 'openai-python',        data: trend(180, 90,  W, 0.15), backgroundColor: fa(C.openai,    0.6), borderRadius: 3 },
      { label: 'anthropic-sdk-python', data: trend(400, 640, W, 0.12), backgroundColor: fa(C.anthropic, 0.7), borderRadius: 3 },
    ],
  }), [W]);

  const cacheData = useMemo(() => ({
    labels: wk,
    datasets: [mkDs('prompt_caching files', C.anthropic, trend(1200, 4800, W, 0.08), true)],
  }), [W]);

  return (
    <div className="cgrid">
      <ChartCard
        title='GitHub "Used By" — repositories depending on each SDK'
        src="github.com/network/dependents · weekly scrape"
        subtitle="Production adoption signal — separates code that ships from code that demos."
        legend={[['openai-python', C.openai], ['anthropic-sdk-python', C.anthropic], ['google-generativeai', C.google], ['mistralai', C.mistral]]}
        insight="anthropic-sdk-python grew from ~11k to <b>18.4k repos</b> in 12 weeks (+67%). openai-python leads at 54k but growth has plateaued."
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        title="Week-over-week new dependents"
        src="github dependents delta"
        subtitle="New repos adopting each SDK per week. Rate-of-change is more predictive than absolute count."
        legend={[['openai-python', C.openai], ['anthropic-sdk-python', C.anthropic]]}
        height={200}
      >
        <Bar data={deltaData} options={baseOpts(fmtN)} />
      </ChartCard>

      <ChartCard
        title='GitHub code search — prompt_caching mentions'
        src="github search API"
        subtitle="Devs add caching only when token costs hurt. A pure production-volume signal."
        height={200}
      >
        <Line data={cacheData} options={baseOpts(fmtK)} />
      </ChartCard>
    </div>
  );
}
