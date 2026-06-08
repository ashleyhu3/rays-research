import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { dayLabels } from '../utils/labels';
import { baseOpts, mkDs, fmtN, fmtK } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

export default function Reddit({ weeks: W }) {
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

  const mentionsData = useMemo(() => ({
    labels: days,
    datasets: [
      mkDs('ChatGPT', C.openai,    trend(8200, 7900, D, 0.09)),
      mkDs('Claude',  C.anthropic, trend(900,  2800, D, 0.12)),
      mkDs('Gemini',  C.google,    trend(2100, 2600, D, 0.10)),
      mkDs('Mistral', C.mistral,   trend(380,  620,  D, 0.15)),
    ],
  }), [D]);

  const sentimentData = useMemo(() => ({
    labels: days,
    datasets: [
      mkDs('ChatGPT', C.openai,    trend(58, 54, D, 0.05)),
      mkDs('Claude',  C.anthropic, trend(68, 72, D, 0.04)),
      mkDs('Gemini',  C.google,    trend(52, 55, D, 0.05)),
    ],
  }), [D]);

  const twitterData = useMemo(() => ({
    labels: days,
    datasets: [
      mkDs('ChatGPT', C.openai,    trend(42e3, 38e3, D, 0.10)),
      mkDs('Claude',  C.anthropic, trend(8e3,  22e3, D, 0.12)),
      mkDs('Gemini',  C.google,    trend(14e3, 18e3, D, 0.10)),
    ],
  }), [D]);

  return (
    <div className="cgrid">
      <ChartCard
        title="Reddit daily mentions — r/MachineLearning · r/ChatGPT · r/LocalLLaMA"
        src="reddit API · free OAuth"
        subtitle="Daily posts + comments mentioning each platform. Community sentiment leading indicator."
        legend={[['ChatGPT', C.openai], ['Claude', C.anthropic], ['Gemini', C.google], ['Mistral', C.mistral]]}
        insight='"Claude" mentions surged to <b>4,200/day</b> during the Claude 3.7 launch, briefly overtaking ChatGPT. Now settled at <b>~2,800/day</b>, up from ~900/day a year ago.'
        height={250} span2
      >
        <Line data={mentionsData} options={baseOpts(fmtN)} />
      </ChartCard>

      <ChartCard
        title="Sentiment score (positive / total mentions)"
        src="reddit API + keyword classifier"
        subtitle="Claude consistently holds the highest positive sentiment of any major AI platform."
        legend={[['ChatGPT', C.openai], ['Claude', C.anthropic], ['Gemini', C.google]]}
        height={200}
      >
        <Line data={sentimentData} options={baseOpts(v => `${v.toFixed(0)}%`)} />
      </ChartCard>

      <ChartCard
        title="X (Twitter) daily mention count"
        src="X API v2 tweet counts"
        subtitle="Daily tweet volume. High noise but useful for spike detection at product launches."
        legend={[['ChatGPT', C.openai], ['Claude', C.anthropic], ['Gemini', C.google]]}
        height={200}
      >
        <Line data={twitterData} options={baseOpts(fmtK)} />
      </ChartCard>
    </div>
  );
}
