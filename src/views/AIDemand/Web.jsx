import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { baseOpts, mkDs } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';

export default function Web({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const visitsData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('chatgpt.com',         C.openai,    trend(1.82e9, 1.95e9, W, 0.04)),
      mkDs('claude.ai',           C.anthropic, trend(380e6,  610e6,  W, 0.07)),
      mkDs('gemini.google.com',   C.google,    trend(520e6,  640e6,  W, 0.05)),
      mkDs('perplexity.ai',       C.perplexity,trend(240e6,  390e6,  W, 0.08)),
    ],
  }), [W]);

  const durationData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('chatgpt.com',  C.openai,     trend(6.2, 6.8, W, 0.04)),
      mkDs('claude.ai',    C.anthropic,  trend(8.1, 9.4, W, 0.04)),
      mkDs('perplexity.ai',C.perplexity, trend(5.8, 6.2, W, 0.05)),
    ],
  }), [W]);

  const bounceData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('chatgpt.com',  C.openai,     trend(38, 35, W, 0.04)),
      mkDs('claude.ai',    C.anthropic,  trend(29, 26, W, 0.04)),
      mkDs('perplexity.ai',C.perplexity, trend(32, 28, W, 0.05)),
    ],
  }), [W]);

  const visitsFmt = v => v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`;

  return (
    <EditableGrid viewId="web">
      <ChartCard
        chartId="web-visits"
        title="Monthly web visits"
        src="similarweb.com"
        srcUrl="https://www.similarweb.com/website/claude.ai/"
        freq="monthly"
        subtitle="Total monthly unique visits. ChatGPT's consumer lead is large but Claude's growth rate is steeper."
        legend={[['chatgpt.com', C.openai], ['claude.ai', C.anthropic], ['gemini.google.com', C.google], ['perplexity.ai', C.perplexity]]}
        height={250} span2
      >
        <Line data={visitsData} options={baseOpts(visitsFmt)} />
      </ChartCard>

      <ChartCard
        chartId="web-session"
        title="Average session duration (minutes)"
        src="similarweb.com"
        srcUrl="https://www.similarweb.com/website/claude.ai/"
        freq="monthly"
        subtitle="Longer = deeper use cases. Claude leads on session depth."
        legend={[['chatgpt.com', C.openai], ['claude.ai', C.anthropic], ['perplexity.ai', C.perplexity]]}
        insight="Claude averages <b>9.4 min</b> vs ChatGPT's <b>6.8 min</b> — <b>38% longer</b>. Reflects enterprise/coding users in extended sessions."
        height={200}
      >
        <Line data={durationData} options={baseOpts(v => `${v.toFixed(1)}m`)} />
      </ChartCard>

      <ChartCard
        chartId="web-bounce"
        title="Bounce rate (%)"
        src="similarweb.com"
        srcUrl="https://www.similarweb.com/website/claude.ai/"
        freq="monthly"
        subtitle="Lower bounce = stickier. Claude and Perplexity lead."
        legend={[['chatgpt.com', C.openai], ['claude.ai', C.anthropic], ['perplexity.ai', C.perplexity]]}
        height={200}
      >
        <Line data={bounceData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>
    </EditableGrid>
  );
}
