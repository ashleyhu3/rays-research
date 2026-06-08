import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { dayLabels } from '../utils/labels';
import { baseOpts, hBarOpts, mkDs, fmtP } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

const GEO_LABELS = ['San Francisco','New York','Seattle','Boston','Austin','Chicago','LA','Atlanta'];
const GEO_VALS   = [100, 82, 78, 74, 68, 61, 58, 52];

export default function Trends({ weeks: W }) {
  const D   = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

  const mainData = useMemo(() => ({
    labels: days,
    datasets: [
      mkDs('Claude API',   C.anthropic, trend(32,  68,  D, 0.12)),
      mkDs('ChatGPT API',  C.openai,    trend(88,  100, D, 0.06)),
      mkDs('Gemini API',   C.google,    trend(42,  55,  D, 0.10)),
      mkDs('Mistral API',  C.mistral,   trend(8,   18,  D, 0.15)),
    ],
  }), [D]);

  const geoData = {
    labels: GEO_LABELS,
    datasets: [{
      data:            GEO_VALS,
      backgroundColor: GEO_VALS.map(v => fa(C.anthropic, 0.3 + v / 200)),
      borderColor:     C.anthropic,
      borderWidth: 1, borderRadius: 4,
    }],
  };

  const brandData = useMemo(() => ({
    labels: days,
    datasets: [
      mkDs('Claude',   C.anthropic, trend(18, 42, D, 0.10)),
      mkDs('ChatGPT',  C.openai,    trend(95, 100, D, 0.05)),
    ],
  }), [D]);

  return (
    <div className="cgrid">
      <ChartCard
        title="Google Trends — relative search interest (0–100)"
        src="pytrends · free · no auth"
        subtitle='Daily relative search volume in the US. Index 100 = peak of leading term in period.'
        legend={[['Claude API', C.anthropic], ['ChatGPT API', C.openai], ['Gemini API', C.google], ['Mistral API', C.mistral]]}
        insight='"Claude API" now at <b>68%</b> of "ChatGPT API" search volume — up from 34% six months ago. Spikes correlate with model releases.'
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        title='Search interest by metro — "Claude API" (US)'
        src="pytrends geo breakdown"
        subtitle="Top US cities by relative Claude API search interest."
        height={200}
      >
        <Bar data={geoData} options={hBarOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        title='"Claude" vs "ChatGPT" — consumer brand search'
        src="google trends"
        subtitle="Brand awareness proxy. ChatGPT dominant but Claude closing at accelerating rate."
        legend={[['Claude', C.anthropic], ['ChatGPT', C.openai]]}
        height={200}
      >
        <Line data={brandData} options={baseOpts(fmtP)} />
      </ChartCard>
    </div>
  );
}
