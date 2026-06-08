import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, mkDs, fmtM } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

export default function PyPI({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const { pypiData, shareData, npmData } = useMemo(() => {
    const oa = trend(38e6,  42e6,   W, 0.05);
    const an = trend(9e6,   16.2e6, W, 0.06);
    const sAn = an.map((a, i) => parseFloat((a / (a + oa[i]) * 100).toFixed(1)));

    return {
      pypiData: {
        labels: wk,
        datasets: [
          mkDs('openai',              C.openai,    oa),
          mkDs('anthropic',           C.anthropic, an, true),
          mkDs('google-generativeai', C.google,    trend(14e6,   18e6,   W, 0.05)),
          mkDs('mistralai',           C.mistral,   trend(3.2e6,  5.1e6,  W, 0.07)),
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
          mkDs('openai',             C.openai,    trend(9.2e6, 9.8e6, W, 0.05)),
          mkDs('@anthropic-ai/sdk',  C.anthropic, trend(1.8e6, 3.4e6, W, 0.07)),
          mkDs('@google/gen-ai',     C.google,    trend(3.1e6, 4.2e6, W, 0.06)),
        ],
      },
    };
  }, [W]);

  return (
    <div className="cgrid">
      <ChartCard
        title="PyPI weekly downloads — Python SDK installs"
        src="pypistats.org · free · no auth"
        subtitle="Weekly downloads for each AI provider's Python SDK. Zero cost, fully automatable."
        legend={[['openai', C.openai], ['anthropic', C.anthropic], ['google-generativeai', C.google], ['mistralai', C.mistral]]}
        insight="The <b>anthropic</b> package grew <b>+80% in 12 weeks</b>, the fastest of any major provider SDK. OpenAI leads in volume but growth is flat at ~+5% QoQ."
        height={250} span2
      >
        <Line data={pypiData} options={baseOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        title="Anthropic vs OpenAI — share of combined installs"
        src="pypistats.org"
        subtitle="Anthropic's share of the combined install base has nearly doubled in 6 months."
        legend={[['Anthropic %', C.anthropic], ['OpenAI %', C.openai]]}
        height={200}
      >
        <Line data={shareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>

      <ChartCard
        title="npm weekly downloads — JS/TS SDKs"
        src="npmjs.com registry API"
        subtitle="Node.js ecosystem. OpenAI's npm package still leads but Anthropic is closing."
        legend={[['openai (npm)', C.openai], ['@anthropic-ai/sdk', C.anthropic], ['@google/generative-ai', C.google]]}
        height={200}
      >
        <Line data={npmData} options={baseOpts(fmtM)} />
      </ChartCard>
    </div>
  );
}
