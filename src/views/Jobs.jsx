import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, mkDs, fmtN } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

const OPEN_ROLES_LABELS = ['Anthropic','OpenAI','Google DM','Mistral','Cohere','Perplexity'];
const OPEN_ROLES_DATA   = [312, 486, 891, 124, 78, 95];
const OPEN_ROLES_COLORS = [C.anthropic, C.openai, C.google, C.mistral, C.teal, C.perplexity];

const openRolesData = {
  labels: OPEN_ROLES_LABELS,
  datasets: [{
    data:            OPEN_ROLES_DATA,
    backgroundColor: OPEN_ROLES_COLORS.map(c => fa(c, 0.7)),
    borderColor:     OPEN_ROLES_COLORS,
    borderWidth: 1, borderRadius: 4,
  }],
};

export default function Jobs({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const mainData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('OpenAI / GPT',       C.openai,    trend(2800, 2620, W, 0.06)),
      mkDs('Claude / Anthropic', C.anthropic, trend(420,  874,  W, 0.08)),
      mkDs('Gemini / Vertex',    C.google,    trend(380,  620,  W, 0.07)),
    ],
  }), [W]);

  const ratioData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('OpenAI R:S',    C.openai,    trend(1.4, 0.9, W, 0.07)),
      mkDs('Anthropic R:S', C.anthropic, trend(2.8, 2.1, W, 0.08)),
    ],
  }), [W]);

  return (
    <div className="cgrid">
      <ChartCard
        title="Job postings — AI model API keywords in F500 descriptions / week"
        src="theirstack API · linkedin · greenhouse"
        subtitle="F500 job descriptions mentioning each model API. The purest enterprise market-pull signal."
        legend={[['OpenAI / GPT', C.openai], ['Claude / Anthropic', C.anthropic], ['Gemini / Vertex', C.google]]}
        insight='"Claude API" job mentions hit <b>874/wk</b>, up <b>+108% QoQ</b>. OpenAI mentions are flat at ~2.6k/wk. Enterprise diversification toward Anthropic is accelerating.'
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtN)} />
      </ChartCard>

      <ChartCard
        title="Research vs Sales/GTM hiring ratio"
        src="greenhouse public API + linkedin"
        subtitle="High research:sales ratio = early expansion. Compressing ratio = harvest/revenue phase."
        legend={[['OpenAI R:S', C.openai], ['Anthropic R:S', C.anthropic]]}
        height={200}
      >
        <Line data={ratioData} options={baseOpts(v => v.toFixed(2))} />
      </ChartCard>

      <ChartCard
        title="Live open roles by AI lab"
        src="greenhouse + lever APIs"
        subtitle="Total live engineering + research openings."
        height={200}
      >
        <Bar data={openRolesData} options={baseOpts(fmtN)} />
      </ChartCard>
    </div>
  );
}
